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
- **Capped Delayed Recovery Cooldown:** When attempts reach 3 or higher, transient capture failures remain in `"status": "retry_wait"` (instead of being marked `"needs_review"`). The delay doubles up to `MAX_CAPTURE_COOLDOWN = 3600` (1 hour) plus deterministic jitter.
- **Attempt Counter Saturation:** The capture attempt counter saturates at `MAX_CAPTURE_ATTEMPTS = 10` (`next_attempts = min(attempts + 1, 10)`). `StageRetries.begin('capture', url)` never locks capture at attempt limit; attempts remain allowed on future cron runs after cooldown.
- **Deterministic Hash-Based Jitter:** Jitter is calculated as `int(sha256(f"{key}:{attempts}")[:8], 16) % (max_jitter + 1)` (up to 20% of base delay, capped at 300s). This ensures stable, reproducible cooldowns across process restarts and prevents stampedes during closely spaced retries.
- **Limited Real Attempts After Cooldown:** When cooldown expires (`clock >= next_at`), `retries.begin('capture', url)` allows exactly ONE real network attempt. If it fails again, `next_at` is immediately updated into the future, guaranteeing no tight loops or stampedes.

### C. Operational Realities: 6-Hour Cron and Pacing Behavior
1. **Burst Reality on 6-Hour Cron:**
   Cron runs every 6 hours (21,600s). Because maximum cooldown delay + jitter is capped at ~3,900s (~1 hour), all previously backoffed URLs will have expired cooldowns when a scheduled 6-hour cron run starts. **Jitter alone does not prevent a request burst across long cron intervals.**
2. **Existing Per-Host Pacing and Concurrency:**
   - In `shared_crawl.py`, document discovery runs in a single-threaded `while queue` loop. Concurrency is strictly **1** (sequential) per crawl.
   - Crawl scope is strictly bounded: `max_fetches` defaults to 12 (hard cap 30) and `max_depth` defaults to 3 (hard cap 4).
   - Currently, there is no inter-request sleep delay between subsequent URLs in the crawl queue; requests execute sequentially back-to-back as fast as network latency allows.
   - In keeping with scope discipline, no speculative token-bucket scheduler or altered provider timing was introduced in this fix.

### D. Preservation of Strong Holds
The following conditions remain strictly locked in `"status": "needs_review"` with `next_at: 0` and are NEVER automatically retried:
1. **Uncertain paid AI completion:** Any extraction job with `status == 'running'` upon crash/restart is flagged with `provider_completion_uncertain`.
2. **Corrupt extraction checkpoints:** Checksum mismatches or payload corruption in `.response.json`.
3. **Factual validation holds:** Validation rejections (`candidate_validation_blocked`) and manual review dispositions (`needs_review`).
4. **Non-transient capture errors:** HTTP 404, `invalid_pdf`, `non_public_destination`, `login_required`.
5. **Stage extraction/publication limits:** 3-attempt lifetime exhaustion for paid LLM calls and publication delivery.

### E. Fail-Closed Receipt Integrity Verification
`review_publication.py` exports `validate_receipt_payload` and `is_valid_receipt_file` enforcing strict fail-closed verification:
- When validating against durable publication state (`stage_retries`), the state record must be valid, have `status == 'success'`, and contain a non-empty `receipt_sha256`.
- Missing `receipt_sha256` raises `ValueError('Missing receipt checksum in publication state')`.
- Corrupt state raises `ValueError('Corrupt publication state')`.
- Checksum mismatch raises `ValueError('Publication receipt integrity mismatch')`.
- `publish()` fails closed if an on-disk receipt has missing, corrupt, or mismatched publication state.

### F. Audited Historical Recovery Utility (`recover_capture_holds.py`)
`services/ai/recover_capture_holds.py` provides an audited, safe remediation tool:
- **Truly Read-Only Advisory Dry-Run:** In `--dry-run` mode (default), the inspection is genuinely read-only. It reads state bytes without opening or creating `.lock` files, without creating directories, and with **zero disk mutations**.
- **Lock Parity with Downloader:** In `--execute` mode, locks `state_path.with_suffix('.lock')`, which is the exact same path (`state/stages/capture/<hash>.lock`) held by the downloader and `StageRetries.lock('capture', url)`.
- **Lock Acquisition Before Read:** The lock is acquired *before* reading the state file. Under that lock, state is re-read and validated. If concurrent operations updated the state (e.g. to `success`), recovery does not overwrite it.
- **Canonical Validation:** Uses `is_valid_stage_record(state, max_attempts=10)` to validate the record. Malformed records (e.g. `attempts="invalid"`, boolean attempts, corrupt JSON) are classified as `ineligible_corrupt_hold` and remain held.
- **Unique UUID Backup Directories:** Every execution creates a unique backup directory `backups/capture_recovery/recovery_<timestamp>_<uuid>` with `mkdir(parents=True, exist_ok=False)`. Two executions with the same clock value never collide or overwrite previous backups.
- **Durable Intent & Completion Journaling:** Before mutating each state file, an `"intent"` entry is durably flushed to `audit_journal.jsonl` using `os.fsync`. After mutation, a `"completed"` outcome is logged with `os.fsync`. If an execution is interrupted, the original backup is intact and the journal clearly identifies which holds were intended vs completed.
- **Audit Manifest:** In `--execute` mode, a complete `audit_manifest.json` is durably written summarizing all recovered records. Production state was not touched.

---

## 3. Changed Files and Purpose

| File | Exact Changes Made |
| --- | --- |
| `services/ai/stage_retry.py` | Exported `file_lock` context manager and canonical `is_valid_stage_record` validator. Updated `StageRetries` to support capped delayed recovery for capture (`MAX_CAPTURE_COOLDOWN = 3600`, `MAX_CAPTURE_ATTEMPTS = 10`), added deterministic hash jitter (`_compute_capture_delay`), ensured `failure()` always writes `'attempts'`, and preserved `needs_review` for non-transient capture errors and all extraction/publication holds. |
| `services/ai/review_publication.py` | Restored fail-closed integrity validation in `validate_receipt_payload`: rejects missing checksums, corrupt publication state, and mismatched checksums when validating durable receipts. |
| `services/ai/recover_capture_holds.py` | Audited capture hold recovery: genuinely read-only advisory dry-run (no `.lock` files created, zero disk mutations); execution mode uses exact downloader lock (`state_path.with_suffix('.lock')`), locks before reading, validates complete canonical records, keeps corrupt/malformed records held, creates unique UUID-named backup directories, and durably records audit intents and outcomes to `audit_journal.jsonl`. |
| `services/ai/capture_retry.py` | Implemented `CaptureRetryOutcome(tuple)` exposing `attempted` and `cooldown_skip` while maintaining backward compatibility with `(result, reason, retryable)`. Enforces transient error classification through `capture_failure` and forwards `clock`. |
| `services/ai/recover_documents.py` | Preserved `from normalize_pdf import normalize_pdf` and successful PDF normalization. Replaced raw dictionary reason checking with `is_transient_capture_error` and formatted `HTTPStatusError` with concrete status codes (e.g. `http_503` vs `http_404`). |
| `services/ai/shared_crawl.py` | Recorded `page['attempted']`, `page['cooldown_skip']`, and `page['historical_reason']`. Populated `report['capture_attempts']` and `report['cooldown_skips']` in crawl reports. |
| `services/ai/shared_pipeline.py` | Propagated `capture_attempts` and `cooldown_skips` into source preparation summaries (`summary.json`). |
| `services/ai/generic_pipeline.py` | Integrated `is_valid_receipt_file` for draft reuse and storage backlog calculation; wrapped extractor with `tracked_extractor` to count actual invocations; aggregated `capture_attempts` and `cooldown_skips` in per-source counts and overall summary (`summary.captures`). |
| `services/ai/extraction_checkpoint.py` | Separated provider execution catch block from checkpoint persistence catch block, recording `checkpoint_storage_failed` upon disk write errors. |
| `services/ai/tests/test_worker_recovery_and_reporting.py` | Added 15 comprehensive regression test cases (27 total tests in file) verifying transient capture recovery across restarts, 6-hour cron timeline, attempt counter saturation, HTTP 503 vs 404 discrimination, lock parity, concurrent updates, malformed record preservation, zero dry-run mutations, unique backup directories across identical clocks, intent/completion journals, receipt integrity, and invocation counters. |

---

## 4. Simple Outage-to-Recovery Example

Consider a scenario where the host network or external DNS fails at 10:00:
1. **Run 1 (10:00 IST, DNS outage active):**
   - Crawler attempts `https://ssc.gov.in`. DNS resolution raises `socket.gaierror`.
   - `capture_failure` classifies `gaierror` as transient.
   - `StageRetries` records: `status: "retry_wait"`, `attempts: 1`, `reason: "gaierror"`, `next_at: 10:00:30 + jitter`.
   - Worker report records: `status: "failed"`, `summary.captures.attempted: 1`, `summary.captures.cooldown_skips: 0`.
2. **Run 2 (10:00:10 IST, 10 seconds later):**
   - Current time is within the initial 30s cooldown window (`clock < next_at`).
   - `capture_with_retry` checks `clock < next_at`.
   - The fetch is skipped without opening a network socket.
   - Report records: `summary.captures.attempted: 0`, `summary.captures.cooldown_skips: 1`, historical reason `"gaierror"` retained.
3. **Run 3 (10:15 IST, outage still active):**
   - Cooldown expired (`clock >= next_at`).
   - Crawler makes exactly 1 bounded network attempt. It fails again.
   - Attempts increment to 3. Capped delayed recovery cooldown applies (`delay = 120s + jitter`). State remains `"retry_wait"`. It does NOT lock into `"needs_review"`.
4. **Run 4 (16:00 IST, scheduled 6-hour cron boundary, host network restored):**
   - Cooldown expired hours ago (`clock >= next_at`).
   - Crawler makes 1 bounded recovery attempt across fresh process restart.
   - DNS resolves, HTTP returns 200 OK with notice PDF.
   - `StageRetries.success('capture', url)` is called: state transitions to `"status": "success"`, `attempts: 0`, `reason: null`.
   - In contrast, any uncertain AI completion holds (`provider_completion_uncertain`) or candidate validation holds (`candidate_validation_blocked`) remain strictly in `"needs_review"` and are never touched.
   - Automatic recovery is complete with zero manual database or container intervention!

---

## 5. Exact Commands and Verification Results

### A. Python Focused Regression Suite
```sh
PYTHONPATH=services/ai:services/ai/tests services/ai/.venv/bin/python -m unittest services/ai/tests/test_worker_recovery_and_reporting.py
```
**Output:**
```
Ran 27 tests in 0.998s
OK
```

### B. Full Python Test Discovery
```sh
PYTHONPATH=services/ai:services/ai/tests services/ai/.venv/bin/python -m unittest discover -s services/ai/tests -p 'test_*.py'
```
**Output:**
```
Ran 398 tests in 11.169s
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

---

## 6. Recorded Later Improvement

- **Decoupled Paced Document Capture and Queued AI Extraction:**
  Separate offline paced document capture from queued AI extraction. This architecture will allow document fetching to run with configurable per-host pacing intervals during standard hours, while queuing extraction bundles for execution during verified off-peak / discounted LLM provider pricing windows, cleanly reusing verified evidence artifacts and durable checkpoints without repeating web fetches.

---

## 7. Remaining Limitations and What is NOT Implemented

1. **Production State Remains Untouched:**
   - In accordance with safety rules and coordinator boundaries, no production commands, database mutations, or state resets were run against the production environment.
   - The 13 historical `gaierror` holds on production remain preserved until the coordinator independently reviews this implementation and executes `recover_capture_holds.py --execute /work` in a separate authorized maintenance window.
2. **Local Single-Host Locks:**
   - File locking uses `fcntl.flock` on local filesystem paths (`state/stages/`, `capture.lock`). Distributed multi-worker locking across independent virtual machines is not implemented.
3. **Factual Quality (BHEL / HLL Notices):**
   - This slice resolves transport, retry recovery, and diagnostic reporting. It does not resolve upstream aggregator summarization deficiencies or factual extraction ambiguities (which are planned for the upcoming official evidence enrichment slice).

## Coordinator integration corrections — 26 October 2026

Integration branch: `codex/worker-recovery-integration`, based on `origin/main`
`ca5b289`. Agent 2's branch and worktree remain preserved.

- Combined capture recovery and truthful scheduler exit codes with main's
  existing DeepSeek off-peak gate. ProviderDeferred is handled before generic
  extraction errors, restores the retry attempt, and preserves retry_wait.
- Separated extraction invocation counters from actual provider HTTP attempts.
  `summary.extractions` counts extractor invocations; `summary.provider_requests`
  counts HTTP attempts at the request boundary, including credential failover.
  Missing credentials, clock deferrals, cached drafts and resumed checkpoints
  cause zero provider requests. HTTP success means a successful HTTP status,
  independently of later JSON/schema validation; it does not prove billing.
- Added offline regressions for missing credentials, deferral, malformed JSON
  after HTTP 200, transport failure and pipeline summary propagation.

Verification: full Python suite 408 passed; pnpm typecheck and pnpm lint passed.
No live provider requests, production writes or historical hold recovery executed.
Database-backed publication tests require TEST_DATABASE_URL and remain unverified.
