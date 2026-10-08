# Missing-document recovery — 8 October 2026

Goal: recover explicitly missing evidence once, without holding up unrelated
bundles; bounded retries and restart-safe state. This is a local callable slice,
not a complete coverage detector or production scheduler.

## Files and responsibility

- `services/ai/recovery_queue.py`: SQLite URL tasks and bundle dependencies;
  atomic claims, three attempts, delayed retries, five-minute claims, stale
  completion rejection. No fetching or job interpretation.
- `services/ai/recover_documents.py`: existing safe capture → HTML/PDF normalize
  → PDF selection/completion → saved full and selected JSON references.
  Bounded process workers (default two, at most four), no new package.
- `services/ai/tests/test_recovery_queue.py`: behavioural queue, restart,
  concurrency, failure, HTML and PDF handoff checks.

SQLite is the local prototype storage, not the planned production PostgreSQL
integration. It is separate from the application's notification database; no
Redis. Each process opens its own short-lived connection. Network/PDF work runs
outside queue transactions. Capture uses separate per-URL stores and a per-URL
file lock because the original archive assumes one worker. Normalized results
use immutable per-run paths so an expired worker cannot replace accepted text.
File locking targets the current macOS/Linux runtime.

## Contract

Supply `bundle_id` and `missing_urls` explicitly, only from evidence-backed
references. One request is limited to 50 URLs. URL identity reuses discovery's
normalizer, strips fragments, retains query parameters, rejects credentials.
Capture still validates public destinations; queued URLs are not automatically
trusted. The arbitrary-URL capture DNS-rebinding limitation remains unchanged;
this is not a public fetch endpoint.

Tasks: queued → running → done, retry_wait, or needs_review. Delays are 30 and
60 seconds; attempts include interrupted workers. Expired claims can be reclaimed.
Timeouts/network errors and selected temporary HTTP statuses retry; permanent
errors need review. Exceptions are not stored as raw messages. A late worker
cannot commit after expiration or a replacement claim.

Bundle status is derived from persistent dependencies. All dependencies done
means **ready_for_coverage**, never ready_for_LLM or safe_to_publish. Any terminal
failure becomes needs_review after pending tasks settle. Successful task results
contain source/final URLs, hash/snapshot ID, full-normalized and selected-content
paths. Separate document evidence and normalizer warnings remain intact.

Finished tasks are reused within this recovery cycle. This is not periodic
recapture/change detection scheduling: a future crawl needs an explicit new
recovery generation/version policy rather than resetting a shared task silently.

## Run

Request file (illustrative URL):

```json
{"bundle_id":"example-recruitment","missing_urls":["https://example.org/annexure.pdf"]}
```

```sh
PYTHONPATH=services/ai services/ai/.venv/bin/python services/ai/recover_documents.py /private/tmp/aptus-recovery/queue.db /private/tmp/aptus-recovery/documents --request /private/tmp/recovery-request.json --bundle example-recruitment
PYTHONPATH=services/ai services/ai/.venv/bin/python services/ai/recover_documents.py /private/tmp/aptus-recovery/queue.db /private/tmp/aptus-recovery/documents --workers 2 --limit 10 --bundle example-recruitment
```

Each invocation processes due tasks only; it does not sleep until retries become
due. Run again later using a scheduler. The worker command waits for its bounded
batch, so invoke it as a separate worker process, not inline in the main pipeline.
The legacy `pipeline.py` has not been modified or integrated.

## Verification and remaining work

12 focused recovery tests pass; combined selection/Verify/recovery run passes
48 tests. Real SQLite transactions/reopening and concurrent claims were tested.
HTML normalization and PDF selection/completion were exercised with controlled
capture/diagnostic fixtures. An empty two-process worker batch also passed.
No live download, LLM call, production database, GitHub CI or deployment was run.

Original next integration: coverage identifies evidence-backed missing dependencies,
requests recovery, loads returned documents into the original bundle and reruns
Verify/coverage. Text recovery can read normalized_path instead of downloading
again. Automatic identification of missing sections, semantic coverage verdicts,
OCR, annexure identity confirmation, generation policy and raw-document cleanup
after successful extraction remain separate. Do not treat recovered content as
authoritative or complete just because its task succeeded.

## Coverage and pre-LLM handoff — 8 October

Implemented `services/ai/check_coverage.py` and `build_extraction_input.py`.
`prepare_extraction(verified_bundle, recovery_queue=queue)` returns coverage,
recovery status and an inspectable `llm_input`, without calling a provider.

- Scan all selected PDF sections and HTML blocks/tables. Seven field families
  produce candidate_found/not_located hints with document, unit and page/block
  locators. Missing keywords do not mean not_stated or force extracted nulls.
- coverage_focus includes fields not located and amendment-affected fields.
  The LLM instructions ask it to inspect all supplied evidence, especially these
  fields; unsupported/conflicting facts must remain null with an explanation.
- Explicit amendment Annexure/Appendix targets can automatically use one
  unambiguous matching link label/owner context. Ambiguous/missing links are
  not guessed. Callers can alternatively provide evidence-backed
  missing_documents entries with source_document_id, URL, exact quote and fields.
  Every dependency must match actual source text and an actual source link.
- Initial linked gaps enqueue through the existing RecoveryQueue and wait.
  Pending tasks still wait. Terminal recovery makes the next pass final: it may
  prepare partial extraction with missing-document/recovery warnings rather than
  enqueue a third cycle. Explicit recovery_pass=1 supports offline use.
- The caller must expand and verify the original bundle with recovered content
  before passing it back in. This builder does not blindly attach a downloaded
  annexure to a campaign. If recovered content is still absent, its gap remains
  in the LLM input. A completed task is not proof of evidence completeness.
- The payload contains actual text, HTML table cells, evidence IDs and source
  locations, document role/authority, amendment candidates and quality warnings.
  Full normalized diagnostics/byte files and local file paths are not sent.
  The structured output contract reuses Post and adds field-path quotations
  and missing-field reasons. Provider integration and citation validation remain
  next; this builder alone cannot guarantee an LLM obeys that contract.
- Count the entire input envelope against the configurable character budget
  (default 120,000). Exceeding it returns no LLM input and a review reason;
  nothing is silently truncated. Characters are not a model token estimate.

Controlled mixed PDF/HTML example: ready_for_extraction; focus education,
category_relaxation, fee and vacancies. Text saying "Candidates must possess
professional registration" survived despite no qualification keyword match.
Its main:unit-0 evidence still points to PDF page 2. Original amendment review
flags remain. This fixture is not a real recruitment or a live LLM response.

14 new handoff checks pass; combined handoff/recovery/Verify run: 42 tests.
Checks cover unusual wording, table/page evidence, automatic linked recovery,
failed-recovery final pass, ambiguity, grounded references, mutation protection,
empty content and budget refusal. No network, paid model call, deployment or
GitHub CI changes. Legacy pipeline.py and provider implementations are untouched.

CLI input is {"bundle": verified_bundle, "missing_documents": optional_array}:

```sh
PYTHONPATH=services/ai services/ai/.venv/bin/python services/ai/build_extraction_input.py /private/tmp/verified-bundle.json --queue-db /private/tmp/aptus-recovery/queue.db
```

The existing Post contract does not yet represent fee facts. Fee text is retained
and highlighted, but changing persisted extraction fields is a separate schema
decision. ready_for_extraction describes usable model input, not publication
approval, complete recall or validated eligibility.
