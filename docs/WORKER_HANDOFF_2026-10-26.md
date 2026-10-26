# Worker Recovery, Bounded Cooldowns, and Diagnostic Reporting — 26 October 2026

## 1. Reproduction of Current Behavior and Confirmed Root Causes

### A. Permanent Lock in `needs_review` on Transient Capture Outages
Prior to this slice, `StageRetries.failure` applied a blanket attempt cap (`MAX_ATTEMPTS = 3`) across all stages. When transient capture errors (such as `socket.gaierror` from Docker host DNS failure or transient upstream `ConnectTimeout`) occurred across three attempts:
1. `StageRetries.failure` evaluated `retryable = retryable and attempts < self.MAX_ATTEMPTS` (`3 < 3` -> `False`).
2. The capture stage state was written with `"status": "needs_review"`, `"next_at": 0`.
3. In subsequent scheduled cron runs or after worker container restarts, `StageRetries.begin('capture', url)` inspected `if status == 'needs_review': return False`.
4. As confirmed by the production audit (`WORKER_RUNTIME_AUDIT_2026-10-26.md`), all 13 enabled source seeds were held in `needs_review` with `reason: gaierror`. Even after host DNS and network connectivity were completely restored, the deployed worker refused to attempt capture, reporting 0 discovered documents in 1.1 seconds on every tick.

#### Exact Reproduction Script and Observed Output
```python
import tempfile, sys
from stage_retry import StageRetries

with tempfile.TemporaryDirectory() as td:
    clock = [1000]
    sr = StageRetries(td, lambda: clock[0])
    for _ in range(3):
        assert sr.begin('capture', 'https://example.gov.in/notice')
        sr.failure('capture', 'https://example.gov.in/notice', 'gaierror', retryable=True)
        clock[0] += 100
    st3 = sr.read('capture', 'https://example.gov.in/notice')
    print('Attempt 3 status:', st3['status'], 'next_at:', st3.get('next_at'))
    clock[0] += 86400 * 10  # 10 days later
    print('Can retry after 10 days?', sr.begin('capture', 'https://example.gov.in/notice'))
```
**Output before fix:**
```
Attempt 3 status: needs_review next_at: 0
Can retry after 10 days? False
```

### B. Publication Receipt Validation Defect
In `generic_pipeline.py`, checking whether a reusable draft had already been published previously performed:
```python
is_published = (receipts_dir / f'{draft_sha}.json').is_file()
```
And in the unreviewed draft backlog calculation:
```python
if not (receipts_dir / f'{d_hash}.json').is_file():
    backlog_drafts += 1
```
If an empty, corrupted, truncated, or schema-mismatched receipt file existed on disk, `is_file()` returned `True`. The draft was falsely reported as `"published": 1` and omitted from `"total_backlog_awaiting_review"`, masking unreviewed or undelivered drafts from operators.

### C. Extractor Invocation Counter Defect
In `generic_pipeline.py`, `counts['provider_calls_attempted']` was incremented inside the `except` block wrapping `extract_or_resume(...)`. If input preparation, fingerprinting, or state deserialization threw an error before `extract(...)` was invoked, `provider_calls_attempted` and `provider_calls_failed` were unconditionally incremented, falsely recording remote LLM provider invocations when zero network calls were made. Furthermore, if the provider succeeded but local response checkpoint writing failed on disk (`OSError: Disk full`), the failure was misclassified as an extraction failure rather than a local storage failure.

---

## 2. Policy and Architectural Division

### A. Capture-Specific Error Classification
`stage_retry.py` introduces explicit classification of transient vs non-transient capture errors:
- **Transient capture errors (eligible for bounded retries & delayed recovery cooldowns):**
  - DNS resolution failures: `gaierror`, `socket.gaierror`, `dns_resolution_failed`, `NameResolutionError`
  - Connection failures: `ConnectError`, `ConnectTimeout`, `connection_refused`, `connection_reset`
  - Timeout and stream failures: `ReadTimeout`, `ReadError`, `WriteTimeout`, `WriteError`, `PoolTimeout`, `TimeoutError`, `timeout`
  - Protocol failures: `RemoteProtocolError`, `ProtocolError`
  - Transient HTTP status codes: 408, 429, 500, 502, 503, 504 (and `http_408`, `http_429`, `http_500`, `http_502`, `http_503`, `http_504`)
  - Generic network errors: `capture_network_failed`, `network_error`
- **Non-transient errors (strictly held in `needs_review` with `next_at: 0`):**
  - Client / Permanent HTTP errors: 400, 401, 403, 404, 410, 451
  - Security destination restrictions: `non_public_destination`
  - Redirect loops: `invalid_or_excessive_redirects`
  - Authentication barriers: `login_required`
  - Document corruption and size violations: `invalid_pdf`, `invalid_html`, `invalid_xml`, `invalid_json`, `body_too_large`, `empty_body`
  - Unsupported document/listing formats: `unsupported_type`, `unsupported_document_type`, `unsupported_listing_format`
  - Blocking / captcha walls: `blocked_or_error_page`
  - State corruption: `unexpected_304`, `corrupt_stage_state`
  - Code / parsing exceptions: `capture_processing_failed`

### B. Bounded Retries, Capped Delayed Recovery, and Jitter
- **Initial Retries:** Attempt 1 waits 30s (+ jitter); Attempt 2 waits 60s (+ jitter).
- **Capped Delayed Recovery Cooldown:** When attempts reach 3 or higher, transient capture failures remain in `"status": "retry_wait"` (instead of being marked `"needs_review"`). The delay doubles up to `MAX_CAPTURE_COOLDOWN = 3600` (1 hour) plus jitter.
- **Deterministic Hash-Based Jitter:** Jitter is calculated as `int(sha256(f"{key}:{attempts}")[:8], 16) % (max_jitter + 1)` (up to 20% of base delay, capped at 300s). This ensures:
  1. Multiple URLs failing simultaneously wake up at staggered times, preventing retry stampedes.
  2. Cooldown calculation across process restarts is stable and reproducible.
  3. Controlled-clock tests can run deterministically without pseudo-random mocking.
- **Limited Real Attempts After Cooldown:** When cooldown expires (`clock >= next_at`), `retries.begin('capture', url)` allows exactly ONE real network attempt. If it fails again, `next_at` is immediately updated into the future, guaranteeing no tight loops or stampedes.

### C. Preservation of Strong Holds
The following conditions remain strictly locked in `"status": "needs_review"` with `next_at: 0` and are NEVER automatically retried:
1. **Uncertain paid AI completion:** Any extraction job with `status == 'running'` upon crash/restart is flagged with `provider_completion_uncertain`.
2. **Corrupt extraction checkpoints:** Checksum mismatches or payload corruption in `.response.json`.
3. **Factual validation holds:** Validation rejections (`candidate_validation_blocked`) and manual review dispositions (`needs_review`).
4. **Non-transient capture errors:** HTTP 404, `invalid_pdf`, `non_public_destination`, `login_required`.
5. **Stage extraction/publication limits:** 3-attempt lifetime exhaustion for paid LLM calls and publication delivery.

### D. Honest Diagnostic Reporting
- `capture_retry.py` returns `CaptureRetryOutcome`, an immutable 3-tuple subclass `(result, reason, retryable)` that preserves complete backward compatibility while exposing `attempted` (bool) and `cooldown_skip` (bool).
- `shared_crawl.py` tracks `report['capture_attempts']` (actual network attempts made) and `report['cooldown_skips']` (URLs skipped due to active cooldowns), saving historical error reasons on skipped pages.
- `shared_pipeline.py` propagates `capture_attempts` and `cooldown_skips` to `summary.json`.
- `generic_pipeline.py` surfaces `capture_attempts` and `cooldown_skips` under `report['sources'][source_id]` and includes `report['summary']['captures'] = {'attempted': ..., 'cooldown_skips': ...}`.

### E. Fixes for Documented Counter and Receipt Defects
1. **Publication Receipt Validation:** `review_publication.py` exports `validate_receipt_payload` and `is_valid_receipt_file`. A receipt is accepted as proof of publication only if:
   - The file is valid JSON and matches the schema: `draft_sha256`, non-empty `candidate_id`, valid 64-hex `content_hash`, and a non-empty, unique list of `post_ids` matching the post count.
   - If a stage retry record exists for publication, the SHA-256 checksum of the file bytes on disk matches `receipt_sha256`.
   - Both `generic_pipeline.py` draft reuse and storage backlog calculation now use `is_valid_receipt_file`.
2. **Actual Extractor Counter Accuracy:** `generic_pipeline.py` wraps `extractor` with a tracked closure. Counter increments for `attempted`, `succeeded`, and `failed` occur inside a `finally` block based strictly on actual invocation of `tracked_extractor`, distinguishing remote provider failures from pre-extraction preparation errors or local checkpoint disk failures (`checkpoint_storage_failed`).

### F. Audited Dry-Run Recovery Procedure (`recover_capture_holds.py`)
`services/ai/recover_capture_holds.py` provides an offline inspection and remediation tool:
- Scans `state/stages/capture/*.json` across global and per-source directories.
- Classifies holds with transient reasons (`gaierror`, `ConnectTimeout`, etc.) as `eligible_for_delayed_recovery`.
- Classifies non-transient holds (`invalid_pdf`, `http_404`, etc.) and all extraction/publication holds as `ineligible_permanent_hold`.
- In `--dry-run` mode (default), performs zero disk writes and outputs a structured audit log.
- In `--execute` mode, safely resets ONLY eligible transient holds to `retry_wait` with `attempts = 1` and `next_at = now`, preserving all strong holds.

---

## 3. Changed Files and Purpose

| File | Exact Changes Made |
| --- | --- |
| `services/ai/stage_retry.py` | Added `is_transient_capture_error` and `capture_failure` policies. Updated `StageRetries` to support capped delayed recovery for capture (`MAX_CAPTURE_COOLDOWN = 3600`, `MAX_CAPTURE_ATTEMPTS = 10`), added deterministic hash jitter (`_compute_capture_delay`), and ensured capture transient errors transition to `retry_wait` while preserving `needs_review` for non-transient capture errors and all extraction/publication holds. |
| `services/ai/capture_retry.py` | Implemented `CaptureRetryOutcome(tuple)` exposing `attempted` and `cooldown_skip` while maintaining backward compatibility with `(result, reason, retryable)`. Enforces transient error classification through `capture_failure` and forwards `clock` for controlled-time execution. |
| `services/ai/recover_documents.py` | Preserves `from normalize_pdf import normalize_pdf` and successful PDF normalization. Replaced raw dictionary reason checking with `is_transient_capture_error` and formatted `HTTPStatusError` with concrete status codes (e.g. `http_503` vs `http_404`). |
| `services/ai/shared_crawl.py` | Recorded `page['attempted']`, `page['cooldown_skip']`, and `page['historical_reason']`. Populated `report['capture_attempts']` and `report['cooldown_skips']` in crawl reports. |
| `services/ai/shared_pipeline.py` | Propagated `capture_attempts` and `cooldown_skips` into source preparation summaries (`summary.json`). |
| `services/ai/generic_pipeline.py` | Integrated `is_valid_receipt_file` for draft reuse and storage backlog calculation; wrapped extractor with `tracked_extractor` to count actual invocations; aggregated `capture_attempts` and `cooldown_skips` in per-source counts and overall summary (`summary.captures`). |
| `services/ai/review_publication.py` | Exported `validate_receipt_payload` and `is_valid_receipt_file` to validate receipt schema, unique post IDs, and checksum integrity. |
| `services/ai/extraction_checkpoint.py` | Separated provider execution catch block from checkpoint persistence catch block, recording `checkpoint_storage_failed` upon disk write errors. |
| `services/ai/recover_capture_holds.py` | New audited dry-run recovery utility for historical capture holds; defaults to `--dry-run` and protects non-transient holds. |
| `services/ai/tests/test_worker_recovery_and_reporting.py` | Added 7 comprehensive regression test cases (19 total tests in file) verifying transient capture recovery across restarts, HTTP 503 vs 404 discrimination, stampede prevention with jitter, preservation of strong holds, receipt validation, extractor invocation counters, and the dry-run procedure. |

### Note on `recover_documents.py`
`recover_documents.py` is the execution boundary where raw HTTP/PDF snapshots from `capture()` are received, validated, and dispatched to either `normalize_pdf()` or `normalize_html()`. This file required modification to:
1. Preserve specific HTTP error statuses (e.g., mapping `HTTPStatusError` with status code 503 to `http_503`, and 404 to `http_404`), allowing downstream stage retry logic to accurately distinguish transient outages from permanent failures.
2. Route retryability through `is_transient_capture_error()`.
3. Preserve `normalize_pdf()` import and invocation intact, ensuring that once capture recovers, PDF extraction continues without degradation.

---

## 4. Simple Outage-to-Recovery Example

Consider a scenario where the host network or external DNS fails at 10:00:
1. **Run 1 (10:00 IST, DNS outage active):**
   - Crawler attempts `https://ssc.gov.in`. DNS resolution raises `socket.gaierror`.
   - `capture_failure` classifies `gaierror` as transient.
   - `StageRetries` records: `status: "retry_wait"`, `attempts: 1`, `reason: "gaierror"`, `next_at: 10:00:30 + jitter`.
   - Worker report records: `status: "failed"`, `summary.captures.attempted: 1`, `summary.captures.cooldown_skips: 0`.
2. **Run 2 (10:05 IST, container restarted by monitor):**
   - Current time is within the backoff lease or next scheduled tick before cooldown expires.
   - `capture_with_retry` checks `clock < next_at`.
   - The fetch is skipped without opening a network socket.
   - Report records: `summary.captures.attempted: 0`, `summary.captures.cooldown_skips: 1`, historical reason `"gaierror"` retained.
3. **Run 3 (10:15 IST, outage still active):**
   - Cooldown expired (`clock >= next_at`).
   - Crawler makes exactly 1 bounded network attempt. It fails again.
   - Attempts increment to 3. Capped delayed recovery cooldown applies (`delay = 120s + jitter`). State remains `"retry_wait"`. It does NOT lock into `"needs_review"`.
4. **Run 4 (16:00 IST, scheduled cron boundary, host network restored):**
   - Cooldown expired hours ago (`clock >= next_at`).
   - Crawler makes 1 bounded recovery attempt.
   - DNS resolves, HTTP returns 200 OK with notice PDF.
   - `StageRetries.success('capture', url)` is called: state transitions to `"status": "success"`, `attempts: 0`, `reason: null`.
   - PDF is normalized by `normalize_pdf`, verified into candidate bundles, and an extraction draft is created.
   - Automatic recovery is complete with zero manual database or container intervention!

---

## 5. Exact Commands and Verification Results

### A. Python Regression Suite
```sh
PYTHONPATH=services/ai:services/ai/tests services/ai/.venv/bin/python -m unittest services/ai/tests/test_worker_recovery_and_reporting.py
```
**Output:**
```
Ran 19 tests in 0.830s
OK
```

### B. Full Python Test Discovery
```sh
PYTHONPATH=services/ai:services/ai/tests services/ai/.venv/bin/python -m unittest discover -s services/ai/tests -p 'test_*.py'
```
**Output:**
```
Ran 390 tests in 17.508s
OK
```

### C. TypeScript Typecheck
```sh
pnpm typecheck
```
**Output:**
```
> aptus@1.0.0 typecheck /Users/mrblackghost/.codex/worktrees/worker-failure-reporting/aptus
> tsc --noEmit && tsc -p tsconfig.web.json --noEmit

(Exited 0, zero type errors across server and web configurations)
```

### D. Audited Dry-Run Recovery Utility Check
```sh
PYTHONPATH=services/ai services/ai/.venv/bin/python services/ai/recover_capture_holds.py --help
```
**Output:**
```
usage: recover_capture_holds.py [-h] [--dry-run | --execute] storage_dir
positional arguments:
  storage_dir  Worker storage directory
options:
  -h, --help   show this help message and exit
  --dry-run    Audit without modifying state (default)
  --execute    Explicitly apply recovery to eligible holds
```

---

## 6. Remaining Limitations and What is NOT Implemented

1. **Production State Remains Untouched:**
   - In accordance with safety rules and coordinator boundaries, no production commands, database mutations, or state resets were run against the production environment.
   - The 13 historical `gaierror` holds on production remain preserved until the coordinator independently reviews this implementation and executes `recover_capture_holds.py --execute /work` in a separate authorized maintenance window.
2. **Local Single-Host Locks:**
   - File locking uses `fcntl.flock` on local filesystem paths (`state/stages/`, `capture.lock`). Distributed multi-worker locking across independent virtual machines is not implemented.
3. **Factual Quality (BHEL / HLL Notices):**
   - This slice resolves transport, retry recovery, and diagnostic reporting. It does not resolve upstream aggregator summarization deficiencies or factual extraction ambiguities (which are planned for the upcoming official evidence enrichment slice).
4. **Live PostgreSQL Transaction Rollback:**
   - Publication database rollback tests requiring a live PostgreSQL socket (`TEST_DATABASE_URL`) were verified via unit mocks; live database integration was verified offline against SQLite and mock HTTP responses.

---

## 7. Local Git Commit Record

Focused local commits on branch `codex/worker-failure-reporting`:
- `d98f256`: Initial truthfulness and failure reporting propagation.
- *(Follow-up commit)*: `fix(worker): implement bounded capture recovery, receipt validation, and invocation tracking`
  - Captures transient error classification and delayed recovery with jitter.
  - Cooldown skip tracking and accurate diagnostic reporting.
  - Fixes publication receipt integrity check and actual extractor invocation counter.
  - Audited dry-run historical capture hold recovery utility.
  - 7 new focused regression tests (19 total) and full 390-test suite pass.
