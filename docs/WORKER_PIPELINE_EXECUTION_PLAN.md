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

### 5. Output validation and review drafts

Keep deterministic post-AI checks for schema shape, dates, numeric ranges,
post names and cited evidence. Validation failure blocks publication. Do not
automatically use an AI reviewer to approve its own extraction.

Save successful candidates as review drafts with their source evidence and
validation findings.

Done when invalid extracted fixtures are blocked and valid fixtures create a
reviewable draft, never a public job.

### 6. Stage-specific recovery

Add retry state after each prior stage has a stable input/output contract.

- fetch/download failure: retry capture later;
- uncertain grouping or incomplete evidence: retain for review, no AI retry;
- transient provider failure: bounded extraction retry;
- invalid AI output: preserve the validation result; do not blindly retry;
- publication failure after approval: retry publication without another AI call.

Done when a failure can resume from its failed stage and does not duplicate a
draft, extraction charge or published job.

### 7. Reviewed publication bridge

Connect only an explicitly approved draft to the existing protected TypeScript
ingestion API. Reuse its idempotent source/post handling; retain a durable
publication receipt so retries do not create duplicates.

Done when one approved fixture reaches PostgreSQL once, a repeated publication
is idempotent, and unapproved drafts cannot publish.

## Non-goals until this plan is complete

- Enabling all configured sources.
- Automatic publication from raw AI output.
- Production deployment or server-side edits.
- A second AI call as a general validation mechanism.

## Working rule

Implement and test one numbered stage at a time. Do not begin a later stage
until the current stage has a focused fixture-based check and a short written
result.
