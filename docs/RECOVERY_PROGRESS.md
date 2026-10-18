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
{
  "bundle_id": "example-recruitment",
  "missing_urls": ["https://example.org/annexure.pdf"]
}
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

### Inline evidence extraction — 8 October 2026

Checkpoint before changing the method: 6889833 on codex/discovery-links.
`inline_extraction.py` derives a typed model response schema from CandidatePost.
Every scalar carries value/status/evidence/reason/scope/scope_evidence. Code
creates final field paths, evidence entries and missing reasons. Qualification
routes stay separate education_options; each route's facts have their own quotes.
Shared/post scope requires a located scope quote; unknown scope is flagged.
Null states distinguish not_located, ambiguous, conflicting and missing_document.
not_located never certifies source absence. Invalid scalar types/absent null
explanations reject the response. Invented quotes remain review errors.

The preparer emits inline-facts-v1. The runner upgrades saved prepared schemas
and uses the current prompt, preserving source units and checking the complete
120,000-character budget. Reusable schema definitions reduce duplication: the
saved IBPS envelope is 59,483 characters (old 55,805), rather than 107,059 with
repeated definitions. This is character size, not a provider token measurement.
Old response files are preserved; no invented citations were added to them.

39 focused tests pass, including nonempty mocked provider conversion, numeric
types, per-route quotes, null explanations, missing-document status and unsafe
scope/quote flags. No real credential file or provider was accessed. Semantic
applicability, complete route detection and amendment resolution still require
review/evaluation. inline_check records the model claims before deterministic
corrections; corrections records moves/nulling afterward. No separate entailment
call, automatic repair loop or shared-rule deduplication is added in this slice.
Next: one fresh Gemini trial to compare field accuracy, citations, null reasons,
post scopes, qualification routes and actual input/output tokens with the saved
baseline. No claim of improved model accuracy until that trial is reviewed.

### Gemini HTTP 400 isolation and transport correction — 8 October 2026

Live, small-output probes accepted the legacy schema, null-only inline fact,
the first 13 fields, and a single deeply nested qualification. The full inline
schema and the version reduced to value/evidence were rejected. This establishes
that the full schema causes rejection; cumulative schema complexity is the
working explanation, not a provider-reported internal limit. Credentials/model
and nesting depth alone were not the cause in these controls.

`compact_inline.py` provides one shallow fact-record schema instead of expanding
every typed field into a nested inline object. field_catalogue preserves allowed
relative paths and value types in the prompt. Code rejects unknown/global paths,
duplicates/parent-child collisions, sparse/unbounded array indices, unreported
scalar fields and invalid final types. Each education route retains its own
records/evidence. The converter feeds the existing quote/scope/null validator;
no fallback to free-text parsing or relaxed local validation. The preparer and
runner now use compact-inline-facts-v1. 43 focused tests pass.

Live compact-schema probe returned HTTP 200. One fresh real IBPS request also
reached generation: 17,040 input + 7,847 output = 24,887 total reported tokens.
It returned one post (Office Assistant), versus 10 in the earlier baseline, with
55 fact records. It also returned language_requirements as a null parent array,
outside the specified scalar/nullable-object format. Strict conversion rejected
the response; no accepted result-inline.json was created by this run. Public raw
provider output is saved in outputs/extract/ibps-html.inline-provider.json for
offline analysis, so no further provider retry is needed to inspect it.

HTTP 400 is resolved for this input. Model completeness and collection-format
adherence are now separate unresolved issues; do not call this an accuracy
improvement or publish this output. No ingestion, dependency, commit or push.

### Roster/shared/batch experiment — 8 October 2026

`extract_bundle.py` now shares its bounded structured provider request through
request_structured; --staged invokes `staged_extraction.py`. Existing single-pass
mode remains for comparisons. Staged mode grounds every roster name in source,
assigns stable IDs, extracts explicitly scoped shared rules once and processes
two target posts per batch. It rejects unexpected/duplicate IDs and retries only
missing or invalid posts once. Qualification routes retain separate evidence.
Shared defaults apply only to listed post IDs, with located scope quotes; semantic
applicability is still not certified. Quote pools reuse spans. Known original
source-unit IDs can also resolve to their entire text as context, explicitly
distinguished from model-selected minimal spans; unknown IDs are still rejected.

49 focused tests pass, including retry bounds, per-post shared scope, strict
types, source-unit references and reassembly of final evidence paths. No new
dependency, public trigger, ingestion or push. A fresh real Gemini experiment
found exactly the 10 IBPS posts seen in the baseline. Shared stage produced
31 records with 16 quotes. Five batches plus their one repair each followed.
All provider requests succeeded, but 0 posts passed final typed conversion.
The responses omitted required scalar slots (rather than explicitly returning
null with reasons), and some citations used original unit IDs instead of pool
IDs. The strict validator prevented those omissions from silently passing.

Reported live usage: 179,375 input + 43,484 output = 222,859 total tokens across
12 calls; cachedContentTokenCount 105,661 is a subset, not additional tokens.
Earlier single-pass baseline was 26,180. Repeating the full source in each call
is costly, so this is an experimental approach, not a production improvement.
Public raw responses: outputs/extract/ibps-staged/call-1.json through call-12.json.
Original live manifest: outputs/extract/ibps-html.result-staged.json.

After the run, offline-only fixes added MissingFactsError with exact omitted
paths, per-post required_scalar_fields/repair_feedback, and explicit
extraction_incomplete/not_checked statuses when no posts pass. No null facts
were invented or validators weakened. Source-unit references now resolve
deterministically as full context. Replay of the same 12 saved responses remains
0/10: posts 0–7 have unreported fields; posts 8–9 have other invalid structure.
Offline manifest: outputs/extract/ibps-html.result-staged-replay.json. No new
provider tokens were spent on these diagnostics; updated prompt feedback has
not been evaluated live. Next: reduce repeated source input and verify explicit
field completion on a small target before another full-notice experiment.

## Office Assistant focused trial — 8 October 2026

User authorized exactly one fresh call after saved-response preparation. Trial
runner: `outputs/extract/office-assistant-trial.py`; no production code changed.
It retains the complete recruitment table and relevant source links, removes
chrome (17,821 → 6,345 source-text characters), gives an explicit scalar checklist
and fictional supported/null examples. Gemini returned 50 facts and 13 quotes:
8,183 vacancies, age 18–28, bachelor degree, dates, fees and application URL.
Actual usage: 8,066 input + 5,133 output = 13,199 total tokens, one provider call.

Raw result remains `invalid_post_output`: both `pay` and
`category_relaxation_rules` were null while their children were also returned.
An offline diagnostic removing redundant null children found no omitted scalar
fields or quote-location errors. This does not accept the raw response or prove
semantic support. The model omitted exam windows, application steps, required
documents and pre-exam training although supplied. Empty arrays currently lack
explicit completeness decisions. Source authority/main-notice flags remain.
This one-post run is not an equivalent benchmark against ten-post extraction.

Artifacts: `office-assistant.focused-input.json`, `.offline-review.json`,
`.provider-response.json`, `.result.json`, `.analysis.json` under outputs/extract.
Existing compact/staged validation suites: 18 tests passed; runner syntax passed.
No second provider call, ingestion, dependency, subagent, commit or push.
Next: exclusive nullable-parent branches and explicit array-group coverage
decisions, using saved responses before another live test. Plan/results also
saved in Notion's Aptus PDF pipeline evidence-selection page.

## Candidate validation slice — 8 October 2026

Extraction checkpoint `a99dcbd` was pushed to `codex/discovery-links` before
starting this slice. User chose to park prompt completeness improvements and
move forward with missing details explicitly marked for review.

`services/ai/validate_candidate.py` validates the candidate contract, rejects
malformed ISO dates before the legacy nullable-date conversion, negative or
nonfinite numbers, marks over 100, reversed age/pay ranges or application
dates, duplicate/empty names, and missing/invalid source citations. Existing
single-pass and staged extractors attach its report. Null details, empty-list
coverage, source authority and scope uncertainty remain warnings. No provider,
database request, new dependency or change to eligibility decisions.

No automatic publication: `persistence_allowed` stays false because exact
quote location is not semantic verification. Structurally valid partial
candidates return `needs_review` with their full facts. Invalid candidates
return `blocked` without validated facts. This is the review boundary, not
a production ingestion integration or a claim that missing data is harmless.

Checks: 55 focused Python tests passed. Saved raw Office Assistant result
blocks (no decoded facts). The explicitly labelled offline diagnostic copy
passes structural/citation checks with 29 review warnings, including source
authority, missing-main-notice and omitted-array concerns. It does not accept
the original provider response. Reports: outputs/extract/office-assistant.validation.json
and office-assistant.diagnostic-validation.json. No fresh Gemini tokens spent.
Next: review acceptance and a deliberate mapping into the internal ingestion
contract, retaining source/evidence and uncertainty; do not silently persist
these richer CandidatePost fields through the legacy Post-only API.

## Candidate database storage — 8 October 2026

User authorized adding database storage. This slice stores structurally valid,
incomplete results as review drafts, not approved public jobs. No extraction
or matching call is exposed to website visitors.

Files and responsibilities:

- `prisma/schema.prisma` and additive migration
  `20261008190000_add_extraction_candidates`: immutable candidate versions with
  full facts/review/evidence JSON and unique content hash. The SQL check keeps
  status `needs_review`; existing Source/Post tables are unchanged.
- `services/ai/store_candidate.py`: reruns candidate validation, rejects blocked
  output or bundle mismatch, retains source identity, quotes, document role,
  authority, locations and inline field/scope checks. It prepares an envelope
  without database/provider calls.
- `services/ai/candidate-storage.schema.json`: generated from the Python contract
  plus storage bounds; a test checks synchronization. Regenerate with
  `storage_schema()` after changing the contract, never edit JSON manually.
- `scripts/store-extraction-candidate.ts`: local TypeScript command; reuses
  Fastify's installed validator offline with coercion/removal/defaults disabled.
  No network listener or public endpoint. Prisma stores only the draft envelope.
  Canonical SHA-256 plus a unique constraint deduplicates repeat/concurrent
  input. Changed facts/review/provenance retain separate versions.

Operator flow, from repository root:

```sh
PYTHONPATH=services/ai services/ai/.venv/bin/python services/ai/store_candidate.py outputs/extract/your-result.json outputs/extract/your-prepared.json outputs/extract/your-storage.json --source-name 'Recruitment source' &&
node --env-file=.env --import tsx scripts/store-extraction-candidate.ts outputs/extract/your-storage.json
```

The command may load configured credentials locally; never inspect or print
the environment file. A blocked result cannot prepare the storage envelope.
The earlier `persistence_allowed: false` means no automatic public-job write;
this explicitly separate review table may store `needs_review` candidates.
Missing details remain null and retain reasons; no dummy job facts are added
to a real candidate, no automatic promotion and no new LLM call.

Verification: 58 focused Python tests passed, two TypeScript tests passed with
real temporary PostgreSQL (zero skipped), typecheck passed, focused lint passed.
Database checks retained all facts/review/locations, reused identical concurrent input
despite reordered object keys, stored changed input separately, rejected a
published status and preserved an existing Post fixture. Schema synchronized.
Full repository lint failed on existing/generated files including `.next`;
the new storage files pass their focused lint checks. No unrelated cleanup.

Deployment: configured local PostgreSQL returned connection_refused. Migration
was verified in an isolated temporary database, not applied to the configured
database; no real recruitment was saved. Start the normal database, then apply
pending migrations deliberately with `pnpm exec prisma migrate deploy --config
prisma7.config.ts` after checking which migrations are pending. Temporary test
database is shut down after verification. Production rollout is not claimed.
Next: operator review and promotion into Post, with per-post URLs and richer
display fields mapped deliberately; current public-job API does not expose drafts.
