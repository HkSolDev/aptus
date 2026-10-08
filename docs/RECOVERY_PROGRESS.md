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

At the original handoff the Post contract did not represent fee facts. The trial
extension below now represents them without changing persisted Post fields.
ready_for_extraction describes usable model input, not publication
approval, complete recall or validated eligibility.

## Structured model trial — 8 October

User-confirmed execution boundary: this pipeline runs manually by the developer
or on cron. Public users browse saved jobs and check their profiles against the
database; they do not trigger discovery, capture, model calls or ingestion.

`CandidatePost` extends the extraction-only output in build_extraction_input.py:
category/region vacancy counts, numeric experience years, fees, numeric pay,
application/fee/exam dates, recruiting body, nationality, locations, selection
steps, documents, language/other conditions and official/application URLs.
The original Post/database/ingestion contract is unchanged. Few worked examples
clarify alternative qualification routes, fee groups and separate deadlines.
HTML/PDF links now have their own evidence IDs and attribute locators when the
normalizer provides an owner/page. These destinations were previously omitted
from model input; unsupported URLs must not be guessed.

`extract_bundle.py` sends one structured-schema request to the selected OpenAI
or Gemini model, using existing httpx/Pydantic. No new dependency. Credentials
come only from the process environment; no credential file is read or printed.
Fixed official provider endpoints, stable errors, no automatic billed retries.
Refused/truncated responses are rejected. Completed results retain model/usage,
parsed candidate facts, coverage warnings and citation audit. The audit checks
exact quote existence and citations for non-null leaves, plus reasons for nulls.
It does not prove that a quote semantically supports the value or the correct
post. All results remain candidate_needs_review; no publication/ingestion.

Prepared one actual saved SarkariResult IBPS RRB HTML notice:
https://www.sarkariresult.com/2026/ibps-rrb-15th-august26/
55,805 input-envelope characters; all seven keyword families have candidates.
Saved to outputs/extract/ibps-html.prepared.json. Secondary-source authority,
role/campaign ambiguity and missing main-notice flags remain; this is a parsing
trial, not an official-source verification. No current live recapture was done.

Live model invocation stopped before network with provider_credential_unavailable:
neither supported credential is available in this execution environment.
No model-generated result file exists; no extracted fact is claimed. Do not read
.env to work around this. Run from an already configured terminal instead:

```sh
PYTHONPATH=services/ai services/ai/.venv/bin/python services/ai/extract_bundle.py outputs/extract/ibps-html.prepared.json outputs/extract/ibps-html.result.json --provider openai --model gpt-4o-mini
```

8 new tests cover both provider payloads using mocked transport, credential
absence, safe HTTP errors, truncated response refusal, quote/null coverage,
candidate schema and link evidence. All 70 focused pipeline tests pass. These
checks do not measure model accuracy. Next: actual configured model run, compare
every post/condition against supplied source, then official-source verification
and stronger semantic/numeric evidence validation before persistence.

## Local credentials launcher and numbered Gemini keys

`scripts/run-bundle-extraction.cjs` now uses the project's installed Node dotenv
package to load the root local configuration into the Python child environment.
It runs the same offline extraction CLI; no web endpoint, dependency or database
change. The developer runs this launcher; the assistant did not open/read the
actual credential file or execute the real launcher against it.

The extraction runner accepts GEMINI_API_KEY_1, _2, ... in numeric order, with
blank/duplicate values skipped. GEMINI_API_KEY is still supported and tried first
when set. An explicit credential rejection (401 or recognized key-specific
400/403 reasons) can try the next configured key. Quota exhaustion, general
permission/schema errors, server failures and uncertain timeouts stop without
key cycling. Project quotas are shared between its keys. No paid fallback.
Results include only credential_attempts, not keys or provider error bodies.

Run from the repository:

```sh
node scripts/run-bundle-extraction.cjs outputs/extract/ibps-html.prepared.json outputs/extract/ibps-html.result.json --provider gemini --model gemini-3.5-flash-lite
```

The example configuration lists blank numbered names only. The real .env is
ignored by Git. Shell/environment values retain precedence over file values.
27 focused extraction/input tests pass; launcher syntax and a fully mocked
configuration/child-process check pass. No real key, credential file or provider
was accessed in these checks, and no model tokens were spent by this change.

### Extraction correction slice — 8 October 2026

`normalize_candidate_facts.py` now corrects three observed trial problems after
schema validation: unsupported CA-to-BACHELORS mappings become null while the
qualification text stays intact; explicitly named pre-exam training moves to
other_requirements (physical efficiency PET stays a selection stage); complete
DD/MM/YYYY dates become ISO dates, while partial months/ranges stay unchanged.
The runner records previous/new values in corrections and remaps moved citations.
The shared extraction prompt now explains the CA and training distinctions.

31 focused extraction/input tests pass. Replaying the saved IBPS rerun locally
retained 10 posts and applied 34 corrections, with zero further changes on a
second pass. This checks cleanup, not model accuracy: no provider request or
credential-file access. Existing citation gaps, source authority/identity review
and merged Treasury qualification alternatives remain unresolved. No ingestion,
schema migration, dependency, commit or push in this slice.
