# Vision Recovery, Targeted Enrichment & Autonomous Publication Progress

- **Worktree**: `/private/var/folders/td/j1hpygvj2hd4vtbh_g2slst80000gn/T/opencode/aptus-next-vision-enrichment-20261103`
- **Branch**: `codex/vision-enrichment-20261103`
- **Base SHA**: `93a99368da9cc1de2b248444e7f9a170a34ab50b`
- **Prerequisite Commit**: `dfa7bef` (`feat(extract): order primary notice first and bind post conditions (v5)`) — isolated commit containing only the 5 Task-A files (`services/ai/build_extraction_input.py`, `services/ai/notice_state.py`, `services/ai/tests/test_extraction_input.py`, `services/ai/tests/test_notice_state.py`, `docs/agent-progress/headmaster-ocr.md`).

## Owned Paths (Feature Slice)

- **Gemini Benchmark Evaluator Fix**:
  - `/private/var/folders/td/j1hpygvj2hd4vtbh_g2slst80000gn/T/opencode/aptus-headmaster-gemini-vision-20261103/evaluate-gemini-condition.py`
  - `/private/var/folders/td/j1hpygvj2hd4vtbh_g2slst80000gn/T/opencode/aptus-headmaster-gemini-vision-20261103/test_condition_experiment.py`
- **Gemini Key Pool & 429 Rotation**:
  - `.env.example`
  - `services/ai/extract_bundle.py`
  - `services/ai/providers/gemini.py`
  - `services/ai/tests/test_gemini_provider.py`
- **Component A — Vision Recovery**:
  - `services/ai/vision_recovery.py`
  - `services/ai/tests/test_vision_recovery.py`
- **Component B — Targeted Enrichment**:
  - `services/ai/targeted_enrichment.py`
  - `services/ai/tests/test_targeted_enrichment.py`
- **Component C — Autonomous Pipeline, Scheduled Worker Integration, 7-Rule Acceptance & TypeScript Persistence**:
  - `services/ai/autonomous_pipeline.py`
  - `services/ai/tests/test_autonomous_pipeline.py`
  - `services/ai/generic_pipeline.py`
  - `services/ai/tests/test_generic_pipeline.py`
  - `services/ai/store_candidate.py`
  - `services/ai/candidate-storage.schema.json`
  - `prisma/schema.prisma`
  - `prisma/migrations/20261103153000_add_autonomous_notice_records/migration.sql`
  - `src/routes/autonomous-ingest.ts`
  - `src/routes/ingest.ts`
  - `scripts/autonomous-ingest.test.ts`

## Key Decisions

1. **Multi-post Benchmark Evaluator**: Updated `evaluate-gemini-condition.py` to validate every PDF-backed Headmaster post rather than only `pdf_hm_posts[0]`, plus added 4 two-post regression tests in `test_condition_experiment.py`.
2. **Safe `GEMINI_API_KEYS` Rotation**: `gemini_api_keys()` reads `GEMINI_API_KEYS` (comma-separated, trimmed, deduplicated), falling back to `GEMINI_API_KEY` and `GEMINI_API_KEY_1..N`. `GeminiProvider` rotates once per key across the pool only for HTTP `429` / `RESOURCE_EXHAUSTED` and never logs key values or rotates on `400`/`401`/`403`/`500`, malformed JSON, or validation failures.
3. **Immutable 4-Version Vision Evidence & Bounded Page Selection (`MAX_VISION_PAGES_PER_NOTICE = 3`)**: `recover_unreadable_pdf_pages()` invokes Gemini Vision only when `unusable_pdf_pages()` marks a verified PDF page as `suspicious_or_unusable`, `image_only_or_scan_candidate`, or `no_native_text`. `select_unreadable_pages_for_vision()` filters unreadable pages by relevance to missing required fields, records irrelevant pages as `status: "skipped"` (`vision_page_not_relevant_to_missing_fields`), caps recovery at 3 pages per notice (`vision_page_cap_deferred`, `retryable: True`), preserves existing HTML/PDF sections when any page fails, and keeps canonical PDF SHA-256, native text, rendered page image, and Vision output as four separate immutable evidence versions.
4. **Post-Scoped Targeted Enrichment**: `plan_enrichment_requests()` and `run_targeted_enrichment()` require verified notice identity (`issuer` + `advertisement_number`/`campaign` + `year`), create at most one request per `(post_name, field_path)`, require official captured source provenance with exact quote + locator, and mark `historical_cutoffs` with `reference_only: True` so they never affect eligibility.
5. **7-Rule Automated Acceptance & Additive Prisma Schema**: `evaluate_automated_acceptance()` and `ingestAutonomousNotice()` enforce all 7 rules before touching `Post`. Added `AutomatedNoticeRecord` in `prisma/schema.prisma` without adding columns to `ExtractionCandidate` or `Post`, preserving compatibility with all existing migration and storage tests.

## Confirmed Defects Reproduced & Repaired

1. **Defect 1 — Accepted autonomous jobs lost their ingestion envelope (`draftEnvelope: null`)**:
   - **Root cause**: `run_autonomous_notice()` in `services/ai/autonomous_pipeline.py` passed extra keys (`persistence_allowed`, `publication_status`, `audit_lineage`), omitted required `extraction_version` in `automated_decision`, and passed a `list` for `vision_recovery` (`DraftReview.vision_recovery` requires `dict[str, JsonValue] | None`). `prepare_storage()` raised `ValidationError` (a `ValueError` subclass), which was caught by `except (KeyError, TypeError, ValueError): draft_envelope = None`, emitting `decision: 'accepted'` with `draftEnvelope: null`.
   - **Fix**: Aligned the `prepare_storage()` call in `run_autonomous_notice()` with `AutomatedDecisionSummary` (`decision`, `reason_codes`, `evidence_fingerprint`, `extraction_version`) and `vision_recovery={'requests': vision_requests} if vision_requests else None`. If `prepare_storage()` raises or returns `None`, `run_autonomous_notice()` explicitly downgrades `decision` to `'blocked'` (`publication_status='blocked'`, `persistence_allowed=False`, `posts=[]`) with `candidate_storage_contract_failed:<ErrorType>` in `reason_codes`. Updated `scripts/autonomous-ingest.test.ts` to generate payloads via `run_autonomous_notice()` directly and assert that accepted notices persist `Source`, `ExtractionCandidate`, `Post`, and `AutomatedNoticeRecord` while null/invalid `draftEnvelope` payloads are rejected with `AutonomousIngestError`.
2. **Defect 2 — Production worker did not invoke the Vision/autonomous path**:
   - **Root cause**: `worker_schedule.py` → `generic_pipeline.py` blocked immediately when `is_extraction_approved(prepared)` was `False` (`llm_input: None`) due to unreadable PDF pages (`content_coverage_gap`), before Vision recovery could run and rebuild `prepared`.
   - **Fix**: Wired `recover_unreadable_pdf_pages()` into `generic_pipeline.run_pipeline()` when `not is_extraction_approved(prepared)` and a verified PDF has unusable pages, rebuilding `prepared = prepare_extraction(v_res['bundle'], ...)` before re-checking `is_extraction_approved(prepared)`. After `extract_or_resume`, `run_pipeline()` merges validated Vision facts via `apply_validated_vision_recovery()`, runs `validate_candidate()`, prepares the storage draft, evaluates `evaluate_automated_acceptance()`, and invokes autonomous persistence only when `acceptance['decision'] == 'accepted'`.
3. **Defect 3 — Vision `candidate_facts` were discarded during merge**:
   - **Root cause**: `apply_validated_vision_recovery()` in `services/ai/autonomous_pipeline.py` iterated only over `experience_alternatives` and ignored `candidate_facts`.
   - **Fix**: Added an explicit allowlist (`ALLOWED_VISION_FACT_FIELDS`: `education_required`, `min_education_level`, `min_marks_percent`, `application_start_date`, `application_last_date`, `fee_payment_last_date`, `age_as_on_date`, `min_age`, `max_age`, `vacancies`/`total_vacancies`, `experience_years`/`minimum_experience_years`) validated in both `validate_vision_page_output()` and `_coerce_and_validate_vision_fact()`. `apply_validated_vision_recovery()` merges allowlisted post-bound facts with full provenance (`exact_quote`, `physical_pdf_page`, `section_locator`, `document_id`, `source_url`), never overwrites conflicting extracted facts (`vision_extracted_fact_conflict`), and keeps unsupported fields unresolved (`vision_unsupported_field`), blocking autonomous acceptance on any conflict or unsupported field.
4. **Defect 4 — Vision recovery could fan out to every unreadable page**:
   - **Root cause**: `recover_unreadable_pdf_pages()` in `services/ai/vision_recovery.py` iterated over all `unusable_pdf_pages(doc)` without topic filtering or a per-notice page cap, and attached recovered sections only when `not still_unreadable_pages`.
   - **Fix**: Added `MAX_VISION_PAGES_PER_NOTICE = 3` and `select_unreadable_pages_for_vision()` to select only unreadable pages relevant to missing required fields up to the cap, recording skipped (`vision_page_not_relevant_to_missing_fields`) and cap-deferred (`vision_page_cap_deferred`, `retryable=True`) pages and preserving all existing HTML/PDF sections plus recovered sections even if another page fails.

## Verification

- **Gemini Benchmark Evaluator**:
  - `python3 evaluate-gemini-condition.py` → 5/5 checks PASS, 9/9 artifact SHA-256 hashes unchanged
  - `python3 -m unittest discover -s ... -p 'test_condition_experiment.py' -v` → 12/12 tests OK
- **Python Unit & Full Test Suite**:
  - `test_gemini_provider.py` → 6/6 tests OK
  - `test_vision_recovery.py` → 4/4 tests OK (including multi-page cap, relevance selection, and evidence preservation)
  - `test_targeted_enrichment.py` → 3/3 tests OK
  - `test_store_candidate.py` → 3/3 tests OK
  - `test_autonomous_pipeline.py` → 7/7 tests OK (including non-null `draftEnvelope`, storage contract failure downgrade, and Vision `candidate_facts` merge/conflict/unsupported-field tests)
  - `test_generic_pipeline.py` → 4/4 tests OK (including worker unusable-PDF → Vision recovery → rebuilt input → autonomous ingest boundary test)
  - `test_worker_schedule.py` → 2/2 tests OK
  - Full Python suite (`services/ai/tests`) → 405/405 tests OK
- **TypeScript Typecheck, Lint & Ingestion Tests**:
  - `tsc -p tsconfig.json --noEmit` → 0 errors
  - `eslint` on modified TypeScript files → 0 errors
  - `tsx --test` across `autonomous-ingest.test.ts`, `validate-post.test.ts`, `eligibility-rules.test.ts`, `ingest.test.ts`, `reviewed-ingest.test.ts` → 13 passed, 0 failed (1 DB-gated test skipped)
  - `git diff --check` → clean (0 whitespace/conflict issues)

## Remaining Boundary

- **Locally tested is not deployed**: All changes are verified offline with deterministic unit/integration fixtures and committed locally on `codex/vision-enrichment-20261103`. No live Gemini/Search calls, database migrations against production, git pushes, merges, or deployments were performed.
