# Worker failure reporting and safe recovery handoff — 25 October 2026

## 1. Confirmed root cause in current code

During the recent incident where Docker external DNS resolution failed, all 13 enabled sources failed to resolve hostnames, yet the top-level worker report still emitted `"status": "completed"` with zero discovered jobs.

Investigation across `shared_crawl.py`, `shared_pipeline.py`, and `generic_pipeline.py` identified the exact breakdown in failure propagation:

1. **Failure collapsing in crawler (`shared_crawl.py`):**
   When `capture_with_retry` encountered DNS failures (`socket.gaierror`), `capture` returned `outcome = 'failed'` with `reason = 'gaierror'`. In `crawl_source`, each failed page was recorded with `status: 'failed'`. However, the final status calculation only distinguished `blocked` (for unsupported document types) versus `partial` whenever `report['unchecked'] or failed` was true. Even when 100% of attempted pages failed at the seed URL and zero documents were retrieved, `crawl_source` returned `status = 'partial'`.
2. **Missing failure status in source summary (`shared_pipeline.py`):**
   `prepare_source` mapped `crawl['status'] == 'partial'` to `summary['status'] = 'partial'`. Because no documents were discovered, `prepared_inputs` was `0` and `prepared_paths` was `[]`. No crawl error reasons were propagated to the summary unless the seed was blocked.
3. **Loop bypass and default status masking in generic pipeline (`generic_pipeline.py`):**
   `run_pipeline` initialized `report['status'] = 'completed'`. It inspected `prepared_paths` for bundles. When DNS failed, `prepared_paths` was empty, so the entire bundle loop was bypassed. At the end of the source iteration, `generic_pipeline` checked `if counts['blocked'] or counts['failed']: report['status'] = 'partial_failure'`. Because `counts['failed']` was only incremented within the bundle loop, both counts were 0. The top-level status remained `'completed'`.
4. **Destructive run log overwrite:**
   `generic_pipeline.py` only wrote to `latest-generic-pipeline-run.json`. Every subsequent run completely wiped out previous diagnostic evidence.
5. **Scheduler blind exit code (`worker_schedule.py`):**
   In one-shot mode (`--once`), `main()` printed the JSON output and unconditionally executed `return` (exit code 0), preventing cron or container monitors from detecting complete crawl failures.

---

## 2. Changes and affected files

All changes were implemented in a dedicated branch (`codex/worker-failure-reporting`) in a separate worktree (`/Users/mrblackghost/.codex/worktrees/worker-failure-reporting/aptus`), preserving uncommitted incident fixes and keeping the frontend/backend agent's checkout completely untouched.

| File | Changes made |
| --- | --- |
| `services/ai/shared_crawl.py` | Distinguishes complete crawl failures (`all_failed` where all attempted pages failed) by setting `status = 'failed'`, capturing and exposing `errors` and `reason` (e.g. `gaierror`, `ConnectTimeout`). Retains `status = 'partial'` only when partial discovery actually occurred. |
| `services/ai/shared_pipeline.py` | Propagates `status = 'failed'` and crawl error reasons (`errors`, `reason`) into the source preparation `summary.json`. |
| `services/ai/generic_pipeline.py` | Handles source-level failures (`failed`, `blocked`, `already_running`, and partial runs with errors); records `failure_stages: ['discovery']` and `failure_reasons`; computes bounded stage diagnostic counts (`summary`); differentiates fresh provider attempts from resumed checkpoints and retry-wait states; tracks reused drafts awaiting review vs published receipts; separates per-run review counts from total backlog; prevents reporting `'completed'` when failures or retry-waits occur; and archives each run to `runs/<timestamp>.json` alongside `latest-generic-pipeline-run.json`. |
| `services/ai/worker_schedule.py` | Enforces explicit exit codes in `--once` mode: returns `0` for `completed` and `partial_failure` (where valid work was preserved), and `1` for `failed` or unhandled exceptions to support failure detection. Daemon mode continues indefinitely. |
| `services/ai/tests/test_worker_recovery_and_reporting.py` | Comprehensive regression suite covering the 8 observable cases and 4 newly identified issues offline. |

---

## 3. Status and exit-code contract

### Pipeline run status (`report['status']`)

- **`'completed'`**:
  All enabled sources were successfully crawled, all prepared bundles were processed or safely reused, and zero source, crawl, extraction, or retry-wait failures occurred. A run where all sources succeed and find unchanged content is truthfully reported as `'completed'` with `cached_drafts_reused > 0` and `failed == 0`.
- **`'partial_failure'`**:
  At least one source succeeded or produced reusable work, but one or more sources or bundles encountered a failure, crawl error, review block, or active retry-wait. Successful work (drafts, checkpoints) is preserved and exposed alongside failure diagnostics.
- **`'failed'`**:
  All attempted enabled sources failed (e.g. network/DNS outage across all enabled sources) with zero successful sources, or a catastrophic pipeline error occurred.

### Scheduler exit-code contract (`worker_schedule.py`)

- **Daemon mode** (scheduled intervals, without `--once`):
  Never terminates on failure. Logs the structured JSON report and continues sleeping until the next 6-hour India-time boundary.
- **One-shot mode** (`--once`):
  - Returns `0` when `status` is `'completed'`.
  - Returns `0` when `status` is `'partial_failure'` (successful work was stored/preserved for operator review).
  - Returns `1` when `status` is `'failed'` (supports failure detection by calling process, container monitors, or external schedulers; external alerting mechanisms are unverified).
  - Returns `1` on unhandled exception.

---

## 4. Revised diagnostic counter contract (`report['summary']`)

`latest-generic-pipeline-run.json` and `runs/<safe_timestamp>.json` contain structured, bounded diagnostic counts derived strictly from actual stage evidence:

```json
{
  "summary": {
    "sources": {
      "total": 2,
      "enabled": 2,
      "disabled": 0,
      "attempted": 2,
      "succeeded": 1,
      "failed": 1
    },
    "documents": {
      "discovered": 2,
      "prepared": 1
    },
    "artifacts": {
      "cached_drafts_reused": 1,
      "checkpoints_resumed": 0,
      "reused": 1,
      "checkpoint_reused": 0
    },
    "extractions": {
      "attempted": 1,
      "succeeded": 1,
      "failed": 0,
      "resumed_checkpoint": 0,
      "waiting_retry": 0,
      "held_for_review": 0,
      "held": 0
    },
    "drafts": {
      "created": 1,
      "reused_awaiting_review": 0,
      "awaiting_review": 1,
      "published": 0,
      "total_backlog_awaiting_review": 1
    }
  }
}
```

### Counter Definitions
- **`sources`**:
  - `total`: Total sources in registry.
  - `enabled`: Enabled sources configured to run.
  - `disabled`: Disabled sources explicitly skipped.
  - `attempted`: Number of enabled sources attempted.
  - `succeeded`: Sources that completed without errors or produced usable work.
  - `failed`: Sources that completely failed discovery or pipeline execution with no usable work.
- **`documents`**:
  - `discovered`: Total documents crawled across enabled sources.
  - `prepared`: Prepared candidate inputs produced for review.
- **`artifacts`**:
  - `cached_drafts_reused`: Existing identical drafts reused via evidence fingerprint matching without extraction.
  - `checkpoints_resumed`: Interrupted extractions resumed from saved provider response checkpoints without a new provider call.
- **`extractions`**:
  - `attempted`: Fresh LLM provider calls attempted (excludes reused drafts, resumed checkpoints, and retry-wait states).
  - `succeeded`: Successful fresh LLM provider calls.
  - `failed`: Fresh LLM provider calls that failed.
  - `resumed_checkpoint`: Resumed provider responses from checkpoint.
  - `waiting_retry`: Bundles in active exponential backoff waiting for retry window.
  - `held_for_review`: Extractions held due to validation failures or ambiguity.
- **`drafts`**:
  - `created`: New drafts created during this run.
  - `reused_awaiting_review`: Reused unchanged drafts in this run that are not yet published.
  - `awaiting_review`: Total bundles in this run requiring operator review (`created` + `reused_awaiting_review` + amendments + unclear).
  - `published`: Reused drafts in this run confirmed published via durable receipts (`publication/receipts/<draft_sha256>.json`).
  - `total_backlog_awaiting_review`: Storage-wide count of unpublished draft files in `drafts/` + `amendments/` + `unclear/`.

*Note on publication:* Scheduled pipeline runs do not execute publication; publication counts appear only when reviewed publication actually runs.

---

## 5. Recovery and reuse behavior

Verification confirmed that existing stage recovery guarantees protect completed work without duplicate costs:

1. **Extraction checkpoints (`extraction_checkpoint.py`):**
   Completed provider responses are written to `state/stages/extraction/<fingerprint>.response.json` with SHA-256 checksums before validation or candidate storage can fail. Resuming an interrupted run reloads the checkpoint and resumes validation without re-invoking the provider.
2. **Durable notice state (`notice_state.py`):**
   Once a candidate is validated and written to `drafts/<bundle_id>.json`, `NoticeStateManager` records the outcome. Subsequent runs verify the evidence fingerprint and exact draft SHA-256, reusing the draft directly.
3. **Publication boundary isolation (`review_publication.py`):**
   Publication is strictly decoupled from extraction. A delivery failure during reviewed publication records a publication retry state; it never deletes drafts, never invalidates extraction, and never triggers an AI call.
4. **Idempotent repeat delivery:**
   Publication writes durable receipts in `publication/receipts/<digest>.json`. Re-publishing returns the existing receipt immediately.

---

## 6. Verification results

### 12 Observable cases verified in `test_worker_recovery_and_reporting.py`

| Case | Scenario | Result |
| --- | --- | --- |
| 1 | All enabled sources fail DNS | Visible `status: 'failed'`, `sources['failed'] == 2`, `failure_stages: ['discovery']`, scheduler exits with code 1 supporting failure detection. |
| 2 | One source fails and another succeeds | `status: 'partial_failure'`, successful source drafts preserved, failed source details exposed, scheduler exits with code 0. |
| 3 | All sources succeed with unchanged content | `status: 'completed'`, `sources['failed'] == 0`, `artifacts['cached_drafts_reused'] == 1`, zero LLM calls. |
| 4 | Disabled source in registry | Excluded from attempted/failed counts; does not degrade an otherwise healthy run. |
| 5 | Valid extraction + mocked delivery failure | Mocked HTTP delivery failure tests worker error handling; verified that delivery failure does not invalidate completed extraction or call the model again. (Does not prove database rollback, which requires a live PostgreSQL instance). |
| 6 | Incompatible/tampered checkpoint | Checksum mismatch safely rejected; records `corrupt_extraction_checkpoint` rather than silently reusing bad data. |
| 7 | Awaiting human review | Reported as `drafts['created'] = 1`, `drafts['awaiting_review'] = 1`, never automatically published. |
| 8 | Repeat approved delivery | Existing receipt returned immediately; idempotent delivery without duplicate records. |
| 9 | Partial discovery errors with successful work | Source with `status='partial'`, `errors=['gaierror']` and valid prepared input reports `status: 'partial_failure'`, retains successful draft, and exposes `gaierror` under `failure_reasons`. |
| 10 | Retry-wait preserved | Unfinished extraction in `retry_wait` preserves `partial_failure` status and records `waiting_retry: 1` without calling provider. |
| 11 | Reused drafts awaiting review vs published | Reused unchanged drafts maintain `awaiting_review` until durable publication receipt (`publication/receipts/<draft_sha256>.json`) exists; separating per-run counts from total backlog. |
| 12 | Diagnostic counter accuracy | Fresh provider calls, resumed checkpoints, cached drafts, retry-wait, and review holds are accurately segregated without labeling cached or waiting work as new attempts. |

### Overall regression results

- **Python unit tests**: 383 passed, 0 failed (`Ran 383 tests in 3.697s, OK` in `services/ai/tests`).
- **TypeScript**: `pnpm typecheck` passed (0 errors).

### What remains unverified / could not run:
- **Live database rollback under multi-post PostgreSQL transaction timeouts**:
  The live database timeout test in `scripts/publish-extraction-candidate.test.ts` requires a running PostgreSQL instance with `TEST_DATABASE_URL`, which is not available in offline sandbox environments.
- **External alerting mechanisms**:
  Exit code 1 on failed runs supports external scheduler failure detection (e.g. cron, Kubernetes, Docker monitor), but external alerting pipelines (PagerDuty, email, webhook) are unverified.
- **Node web/CSS tests**:
  `pnpm test` (running `tests/css-module-hook.mjs`) could not execute due to a Node v24.10.0 customization hook contract incompatibility with the test runner.

---

## 7. Remaining limitations and what is NOT implemented

### Explicit Pending Review Findings (Documented for Follow-up Slice)
1. **Validate publication receipt contents and integrity before counting a draft as published**:
   Currently, checking if a reused draft is published checks `(receipts_dir / f'{draft_sha}.json').is_file()`. Parsing and validating the schema, bundle_id, and integrity of receipt file contents before treating the draft as published remains pending for the next review iteration.
2. **Count actual extractor invocations and distinguish provider failures from checkpoint/storage failures**:
   Currently, extraction failure catch blocks capture general errors around `extract_or_resume`. Granular breakdown distinguishing remote LLM network/HTTP provider failures from local disk checkpoint/storage I/O failures remains pending for future refinement.

### System Limitations
- **BHEL/HLL factual extraction quality**:
  Schema validation and JSON formatting do not establish that extracted facts match the official advertisement. Aggregator summaries omit tables, footnotes, and category-specific marks relaxations. This slice only improves failure reporting and prevents token waste; it does not fix semantic extraction errors.
- **Single-machine local locks**:
  Locks use `fcntl` file locks and local directory trees (`state/stages/`, `state/notices/`). Multi-worker or multi-container concurrency across different machines is not supported.
- **Provider quotas and external network**:
  If DeepSeek or Gemini quotas are exceeded or DNS fails on the host, the pipeline will now report the failure truthfully, but cannot resolve host network issues autonomously.

---

## 8. Next stage: official evidence readiness and structured condition parsing

The next worker slice will address the root cause of the BHEL and HLL factual holds:
1. **Official evidence enrichment before extraction**: Prioritize fetching and verifying the primary official PDF notice before sending aggregator summaries to the LLM.
2. **Conditional marks and reservation parsing**: Implement structured condition capture for category-specific marks percentages, experience routes, and footnote exceptions (as outlined in `docs/WORKER_PIPELINE_EXECUTION_PLAN.md`).
