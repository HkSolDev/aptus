# Worker pipeline execution plan

Status: proposed on 23 October 2026. This document fixes the implementation
order for the generic worker. It does not claim that these stages are deployed
or connected to PostgreSQL.

## Target flow

```text
source transport -> notice URLs -> HTML/PDF capture -> campaign grouping
-> coverage gate -> evidence fingerprint -> extraction -> output validation
-> review draft -> reviewed publication -> PostgreSQL
```

Each arrow must preserve source locations and write a stage result. A failed
stage must not re-run an already successful expensive stage unless its input
changed.

## Fixed implementation order

### 1. Notice state and evidence fingerprints

Define durable local state for one grouped notice. Store its stable identity,
the ordered document identities and content hashes, extraction schema/prompt
version, stage outcomes and timestamps.

Skip the AI only when the same notice evidence fingerprint and extraction
version were successfully processed. A URL alone is only a locator: a notice at
the same URL may change, and a related corrigendum may arrive at another URL.

Done when an unchanged grouped fixture skips extraction, while changing one
related document requires a new extraction.

Progress (Stage 1 completed on 23 October 2026):

- Implemented durable notice state and canonical grouped-evidence fingerprinting in `services/ai/notice_state.py`.
- Integrated deduplication check, reusable draft bypass, and run-report accounting in `services/ai/generic_pipeline.py`.
- Verified all 12 offline criteria in `services/ai/tests/test_notice_state.py` (reuse on identical fingerprint, re-extract on changed document/corrigendum, version bump invalidation, missing/corrupt draft fallback, failure/blocked isolation, prepare-only isolation, and file-lock race protection).

### 2. RSS and JSON source transport adapters

Add bounded, validated readers for source-list feeds only:

- RSS/XML feed items become discovered notice URLs with title/date metadata.
- JSON listing records become discovered notice URLs with title/date metadata.

They do not extract job facts. Their output joins the existing HTML/PDF capture
queue. Start with the configured SarkariResult RSS seed and SSC JSON seed.

Done when fixture feeds enqueue only validated public notice URLs and the worker
does not send RSS/XML or JSON directly to the HTML reader.

Progress (Stage 2 implemented and independently verified offline):

- Added `services/ai/source_transport.py` with bounded readers for SarkariResult RSS feeds and SSC JSON notice-board envelopes (bounded to 100 entries/destinations, reporting skipped/truncated counts, preserving title/date/parent provenance, avoiding main-notice-only filtering for corrigenda/extensions).
- Updated `services/ai/recover_documents.py` to dispatch XML/JSON to `read_listing` and return distinct listing results without sending them to HTML/PDF normalization or recruitment evidence.
- Integrated listing destinations in `services/ai/shared_crawl.py` into the bounded crawl queue, consuming depth and fetch budget while maintaining edge provenance and reporting incomplete coverage on listing truncation.
- Propagated source identity through `services/ai/shared_pipeline.py` compatibly.
- Independent verification: 14 Stage 2 acceptance tests and 66 relevant tests total passed after fixing the SSC exact-limit truncation boundary. Another 20 boundary scenarios passed. Live-source verification and deployment remain outstanding.

### 3. Campaign grouping reliability

Improve grouping only enough to distinguish a main notice, its corrigenda and
its extensions from unrelated notices, results or listings. Preserve ambiguity
as `needs_review`; never merge merely because documents share a host.

Done when fixtures prove: one HTML plus one PDF becomes one bundle; a
corrigendum attaches to its main notice; two different recruitment campaigns
stay separate.

Progress: Stage 3 implemented and independently verified offline. All 27 campaign-grouping acceptance tests and 79 relevant regression tests passed (106 total). Verification covers recruitment boundaries, amendment association, ambiguity/conflict blocking, navigation isolation, and stable notice identities. Live-source verification and deployment remain outstanding.

### 4. Evidence gate and extraction path

Keep the pre-AI coverage gate. It checks that a group is a usable recruitment
notice with readable, sufficiently identified evidence. It is different from
post-extraction validation and must run first.

Only coverage-approved, changed bundles reach the extraction provider.

Done when incomplete, ambiguous, unreadable or unchanged fixtures make no AI
call and record a reason.

Progress: Stage 4 completed and independently verified offline: 26 Stage 4 acceptance tests and 119 relevant regression tests passed (145 total). Full CI, live-source verification, and deployment remain outstanding.

- Unified pre-AI evidence gating across preparation and coverage: grouping blockers, explicit content coverage gaps, PDF readability, selection budgets, substantive main-notice evidence, and required document recovery passes are checked directly in `services/ai/check_coverage.py` and `services/ai/build_extraction_input.py`.
- Threaded explicit crawl status into `prepare_extraction` and removed duplicate post-hoc gating from `services/ai/shared_pipeline.py`.
- Added `is_extraction_approved` guard to prevent provider calls on unapproved, blocked, waiting, or contradictory inputs in `services/ai/extract_bundle.py` and `services/ai/generic_pipeline.py`.
- Added per-bundle outcome accounting (`bundle_id`, `outcome`, `reasons`) to pipeline run reports in `services/ai/generic_pipeline.py`, recording `unchanged_evidence_fingerprint` for reused notices and gate reasons for blocked notices.

#### Slice 1: Notice-specific candidate evidence without regex identity

Relax deterministic identity pre-requisites for readable recruitment notices:

- Missing deterministic identity (`insufficient_campaign_identity`) is retained as an advisory review reason and metadata warning rather than a hard extraction blocker for standalone readable notices.
- Contradictory identities (`conflicting_*`), ambiguous associations (`ambiguous_*`), and unmatched amendment targets remain hard extraction blockers.
- Broadened candidate title recognition for notice-specific application titles (e.g. "Online Form", "Apply Online", examination names) corroborated by supporting recruitment context in document text (posts, vacancies, qualifications, dates/fees, or advertisement references), while excluding generic login, contact, and portal directory pages.
- Uncertain notices without shared deterministic identity remain isolated in standalone single-document bundles with stable, deterministic bundle IDs; unrelated documents are never merged by shared host or title phrasing.
- Preserved existing schema/prompt contract (`recruiting_body` and `advertisement_number` remain evidence-grounded nullable fields with exact citations).

Status: Slice 1 refinements implemented and locally verified: 13 notice-classification acceptance tests and 161 relevant regression tests passed (174 total). Captured SSC/SarkariResult replay admits the Coast Guard notice and six recruitment pages while blocking the SSC shortlisting update and scholarship page. Full Python discovery ran 337 tests with two source-selection expectation failures against the pre-existing local registry changes. Independent review and live-provider verification remain outstanding.

- Candidate classification is isolated in `services/ai/notice_classification.py`: generic titles cannot bypass body corroboration, evidence scanning covers all normalized units, and clear non-job purpose headings remain excluded.
- Existing grouping, crawl-completeness, recovery, cache, schema/prompt and publication behavior remain unchanged by these refinements.

#### Slice 2: Per-notice readiness during a partial source crawl

Source-level `partial` is now recorded as advisory `source_crawl_partial`. A fetch/depth budget or an unrelated failed sibling does not invalidate a readable, complete notice already captured. Explicit missing notice dependencies still wait for recovery and block after exhaustion; blocked sources, unreadable evidence and grouping conflicts remain blocked. Crawl reports retain unchecked links and their reasons.

Gemini credentials support a comma-separated `GEMINI_API_KEY` as well as numbered variables. Keys are trimmed and deduplicated in order. Only explicitly rejected credentials trigger fallback; quota errors, timeouts and other provider failures do not rotate keys.

Verification: 81 focused tests passed; full discovery ran 350 tests with only the two pre-existing source-selection failures. A fresh SarkariResult capture produced seven approved inputs despite a partial source crawl. Runtime loading recognized seven comma-separated keys without displaying them. A read-only Gemini check returned HTTP 200 for `gemini-3.8-flash` with `generateContent` support. DU generation failed with `provider_network_failed`; the separate captured SSC notice trial failed at extraction without a returned response. No validated live model output or publication was produced; quota and end-to-end model extraction remain unverified.

### 5. Output validation and review drafts

Keep deterministic post-AI checks for schema shape, dates, numeric ranges,
post names and cited evidence. Validation failure blocks publication. Do not
automatically use an AI reviewer to approve its own extraction.

Save successful candidates as review drafts with their source evidence and
validation findings.

Done when invalid extracted fixtures are blocked and valid fixtures create a
reviewable draft, never a public job.

Progress: Stage 5 implemented and reviewed locally; live Gemini verification pending.

- Review fixes: shared purpose validation now binds citations to their document and valid locations, requires grounded unclear outcomes, validates amendment dates and target references, and applies the same checks on reuse. Non-recruitment outcomes cannot contain posts. Obvious navigation pages remain blocked.
- Invalid responses retain validation findings without success state. Review outcomes preserve source evidence; the generated storage schema is synchronized with the Python contract. Gemini is the default provider unless explicitly overridden.
- Verification: 205 focused tests passed. Full discovery ran 345 tests with only the two pre-existing source-selection failures against local registry changes. Existing tests were updated for the explicit Stage 5 purpose/disposition contract; locking, integrity, grouping-conflict, and publication-boundary assertions remain.
- Fresh SSC capture completed with 20 documents, 7 approved inputs and 13 blocked bundles. SarkariResult captured 23 documents but all remained blocked by the existing partial-crawl policy. No provider credential is available in the verification process, so model accuracy, model availability and free quota remain unverified. No publication or deployment occurred.

- Single-call purpose classification and facts extraction: unified response schema in `services/ai/compact_inline.py` and `services/ai/inline_extraction.py` captures explicit bounded document purpose (`recruitment`, `amendment`, `result`, `admit_card`, `exam_update`, `non_job`, `unclear`), exact evidence quotes, per-document purposes, amendment details, and candidate posts.
- Pre-AI gate contract adjustments in `services/ai/verify_bundle.py`, `services/ai/check_coverage.py`, and `services/ai/build_extraction_input.py`: readable standalone notices reach AI extraction for purpose classification without requiring regex-derived campaign identity; isolated amendments with unresolved targets are retained for review; conflicting multi-document clusters, empty content, and unreadable PDFs remain strictly blocked.
- Deterministic post-AI validation in `services/ai/validate_candidate.py`: validates purpose values, purpose evidence quotes against current source units, per-document purpose citations, amendment details, and posts. Non-job outcomes must have zero posts and verified purpose evidence. Validated candidates receive explicit review/disposition statuses (`valid_recruitment_review_draft`, `amendment_pending_review`, `valid_non_job_classification`, `unclear_purpose_review`, `validation_blocked`) with `persistence_allowed = False`.
- Durable notice state and reuse in `services/ai/notice_state.py` and `services/ai/generic_pipeline.py`: bumped extraction contract version to `extract-bundle-v2`; updated `verify_cached_citations` to support purpose-specific citation checks; unchanged valid recruitment, non-job, amendment, and unclear outcomes are durably reused without repeated AI calls; non-job classifications are persisted to dedicated review storage (`non_jobs/`, `amendments/`, `unclear/`) and accounted separately without incrementing job draft counters.
- Configurable Gemini default model updated to `gemini-3.8-flash` in `services/ai/extract_bundle.py` and `.env.example`.

DeepSeek trial: added explicit `deepseek` transport with `DEEPSEEK_API_KEY`, configurable model (default `deepseek-flash`), JSON mode and local schema/evidence validation. No automatic provider fallback was added. The live DU notice request returned HTTP 200, but the diagnostic response hit the bounded 16,384 output-token allowance (`finish_reason: length`, 18,956 prompt tokens). Incomplete JSON was rejected; no candidate, cache success or publication was produced. Output size/verbosity needs investigation before this source can be accepted end to end. Provider/Stage 5 focused checks: 41 passed; full discovery: 353 tests with the same two pre-existing source-selection failures.

DeepSeek output-limit follow-up: raised the bound to 32,768 tokens and verified 41 focused tests. The captured DU notice returned a complete HTTP 200 response (`finish_reason: stop`, 13,812 completion tokens). Local decoding rejected null items in non-nullable string arrays (category requirements, locations, selection process, language requirements and other requirements). No validation was weakened and no draft/publication was created. The full public-source response is retained in `/private/tmp/aptus-stage5-deepseek-trial-32k/provider-response.json` for review.

Array extraction instruction refinement: updated `INSTRUCTIONS` in `services/ai/build_extraction_input.py` to clearly distinguish nullable scalars (which emit `value=null` facts) from string arrays (which emit indexed entries only for supported string values, omitting all indexed entries when unsupported so decoding retains `[]`). Bumped `EXTRACTION_VERSION` in `services/ai/notice_state.py` to `extract-bundle-v3`. Independent verification pending.

Array-instruction independent verification (`extract-bundle-v3`): 75 focused tests passed, including four new array contract checks. Full discovery ran 357 tests with only the two known source-selection failures. One real DeepSeek DU replay completed (`stop`, 15,846 output tokens) without the previously observed null string-array placeholders. Decoding correctly rejected four other nullable category facts marked `found` with null values (age-rule and vacancy-breakdown categories across two posts). No draft, success state or publication was created. Response retained at `/private/tmp/aptus-stage5-array-v3-trial/provider-response.json`; live Stage 5 acceptance remains incomplete.

Field-status refinement (`extract-bundle-v4`): clarified that every scalar in a supported object row has an independent status. A found age/count does not establish a neighbouring category/gender/region; null values must use an unresolved status with a plain-language reason, preserving manual verification. Validators remain strict. Two new regression tests preserve known row values and reject found/null category facts. Verification: 74 focused tests passed; full discovery ran 359 tests with only the two known source-selection failures.

One real DeepSeek DU replay passed decoding, citation and candidate validation: a local review draft contains Senior Assistant (46 vacancies, maximum age 35) and Assistant (80 vacancies, maximum age 32), with unknown categories/minimum ages retained as null. No found/null contradictions remained. A second run reused the draft with zero extraction calls. Publication count remained zero; semantic review is still required. Artifacts: `/private/tmp/aptus-stage5-status-v4-trial/`.

Stage 5 checkpoint verification: the exact staged snapshot, exported without unrelated local source-registry changes, passed all 359 Python tests. The working tree's two source-selection failures are confined to the preserved local `sources.json` edits. Recruitment review-draft creation and unchanged reuse have one real DeepSeek verification; amendment/non-job/unclear outcomes remain independently verified offline, with additional live coverage outstanding. No deployment or publication is included in this checkpoint.

### 6. Stage-specific recovery

Add retry state after each prior stage has a stable input/output contract.

- fetch/download failure: retry capture later;
- uncertain grouping or incomplete evidence: retain for review, no AI retry;
- transient provider failure: bounded extraction retry;
- invalid AI output: preserve the validation result; do not blindly retry;
- publication failure after approval: retry publication without another AI call.

Done when a failure can resume from its failed stage and does not duplicate a
draft, extraction charge or published job.

Implemented locally (24 October 2026): bounded capture/provider backoff,
scheduled missing-document recovery, checksum-bound extraction checkpoints and
terminal review for invalid/uncertain provider outcomes. Recovery tests include
an actual parsed annexure and replay of the validated real DU result. See
[recovery and publication verification](WORKER_RECOVERY_AND_PUBLICATION.md).

### 7. Reviewed publication bridge

Connect only an explicitly approved draft to the existing protected TypeScript
ingestion API. Reuse its idempotent source/post handling; retain a durable
publication receipt so retries do not create duplicates.

Done when one approved fixture reaches PostgreSQL once, a repeated publication
is idempotent, and unapproved drafts cannot publish.

Implemented and verified against isolated local PostgreSQL (24 October 2026):
explicit byte-bound approval, protected ingestion bridge, existing transactional
publisher, durable receipts and publication-only retries. Seven integration
checks passed, including Python-to-HTTP delivery and lost-receipt redelivery
with stable row IDs. Production deployment/public-job approval are not included.

## Non-goals until this plan is complete

- Enabling all configured sources.
- Automatic publication from raw AI output.
- Production deployment or server-side edits.
- A second AI call as a general validation mechanism.

## Working rule

Implement and test one numbered stage at a time. Do not begin a later stage
until the current stage has a focused fixture-based check and a short written
result.
