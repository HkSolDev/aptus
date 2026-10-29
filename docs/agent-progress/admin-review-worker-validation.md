# Task progress: basic held-candidate review workflow

Updated: 2026-10-29  
Status: Complete — Ready for Review  
Author: Implementation Engineer  
Branch: `codex/admin-review-worker-validation`  
Worktree: `/Users/mrblackghost/Work/Projects/aptus-admin-review-worker-validation`  
Baseline commit: `d930a69e0093a440ef5ad99c92a6ab19326cec17` (verified and fetched from `origin/codex/next-aptus-work` at `2026-10-29T15:48:12+05:30`)  
Dirty checkout preservation: `/Users/mrblackghost/Work/Projects/aptus-next` preserved untouched with all staged, unstaged, and untracked files.

---

## 1. Objective and explicit exclusions

### Objective:
Build one narrow, robust review slice:
$$\text{Existing held candidate} \longrightarrow \text{Inspect evidence} \longrightarrow \text{Save correction} \longrightarrow \text{Request Python validation} \longrightarrow \text{Inspect results}$$

### Explicit exclusions:
- No AI correction suggestions, automatic publication, or candidate approval controls.
- Approval and publication controls are deferred; this slice ends with a saved correction and its worker validation results. Existing publication protections remain intact.
- No general catalogue editing, bulk review operations, or MCP server integration.
- No production database changes, production migrations, or production service restarts.
- No live model calls, web crawling, or network fetching during validation.

---

## 2. Baseline and isolation record

- `pwd`: `/Users/mrblackghost/Work/Projects/aptus-admin-review-worker-validation`
- `git status --short`: clean baseline before task commits on branch `codex/admin-review-worker-validation`
- `git branch --show-current`: `codex/admin-review-worker-validation`
- `git rev-parse HEAD`: `d930a69e0093a440ef5ad99c92a6ab19326cec17`
- Baseline SHA: `d930a69e0093a440ef5ad99c92a6ab19326cec17`
- Sibling worktree created: `../aptus-admin-review-worker-validation`
- Original repository: `/Users/mrblackghost/Work/Projects/aptus-next` preserved intact with all staged, unstaged, and untracked files.

---

## 3. Guidance and relevant code inspected

### Project guidance:
- `.cursor/rules/aptus-coding-safety.mdc`
- `docs/CODING_STANDARD.md`
- `docs/PRODUCT_CHECKPOINT.md`
- `docs/LEARNING_PLAN.md`
- `docs/AUTH_IMPLEMENTATION.md`
- `docs/AGENT_CONTRACT_PROTOCOL.md`
- `docs/contracts/README.md`
- `docs/agent-hub/START_HERE.md` and `docs/agent-hub/BOARD.md`
- `output/planning/admin-review-independent-audit-2026-10-29.md`

### Pipeline & Worker implementation inspected:
- `services/ai/review_publication.py`: reviewed draft validation, approval binding, retryable publication.
- `services/ai/validate_candidate.py`: deterministic structural & quotation gate; purpose validation.
- `services/ai/extract_bundle.py`: `check_evidence()`, leaf traversal, citation-to-text matching.
- `services/ai/store_candidate.py`: storage candidate envelope schema (`StorageCandidate`), evidence location mapping.
- `services/ai/generic_pipeline.py`: artifact routing (drafts, classifications, failures).
- `services/ai/worker_schedule.py`: 6-hour cron scheduler (unsuitable for interactive validation; dedicated validation runner needed).

### Backend & API implementation inspected:
- `src/app.ts`: Fastify app configuration, route registration, origin checks.
- `src/auth/require-session.ts`: authoritative Better Auth session check.
- `src/auth/routes.ts`: authentication routing & session formatting.
- `src/routes/reviewed-ingest.ts`: reviewed candidate ingestion and hash validation.
- `scripts/store-extraction-candidate.ts`: canonical JSON hashing and candidate deduplication.
- `scripts/publish-extraction-candidate.ts`: transactional role-post publisher.
- `prisma/schema.prisma`: existing schema and models (`AuthUser`, `AuthSession`, `Post`, `ExtractionCandidate`).

### Frontend inspected:
- `components/auth/account-menu.tsx`: account disclosure dropdown.
- `components/auth/auth-bar.tsx`: session fetching and authentication status.
- `app/profile/page.tsx`: server-side access control pattern.

### Validation taxonomy & Grounding levels:
1. **Schema validity**: The JSON payload matches required fields, types, and ranges (e.g., non-negative integer vacancies, valid ISO date string, non-empty post names). A schema-valid payload can still contain hallucinated values, misassigned fields, or reversed scopes.
2. **Quotation existing in saved evidence**: The exact cited string is found as a substring within the captured source text/sections. This establishes lexical presence in the source, but does not prove what field or role the text applies to.
3. **Quotation supporting the particular corrected fact**: The quoted passage semantically asserts the fact asserted in that specific field (e.g., "qualifying mark 25%" in a selection test does NOT support `min_marks_percent = 25` for academic degree marks; "Balak/Balika" school categories in UPESSC do NOT support male/female candidate gender restrictions). The automated validator cannot prove semantic applicability; it explicitly outputs `semantic_support_verified: false`.
4. **Human deciding candidate is suitable for publication**: An authorized operator inspects the raw evidence and context, confirms semantic applicability, resolves missing or uncertain conditions, records a reason for change, and approves the exact revision. Automated validation must never be presented as proof of factual truth or as automatic human approval.

### Analysis of representative drafts:
- **HLL Lifecare (recoverable held draft)**:
  - Bundle `bcac488ba88570d441c1391f`: Pharmacist notice with 5 role rows.
  - Original draft has null vacancies and null academic marks. The official PDF clarifies qualifications (D.Pharm / B.Pharm), cutoff dates, and walk-in interview schedule.
  - Substantive human corrections resolve role scope, attendance venue classification, and registration conditions without needing new model calls. Passes Python validation cleanly.
- **UPESSC (evidence-blocked draft)**:
  - Bundle `de5fe42b2bb75de3e86c57c6`: Headmaster notice from aggregator source (`authority: needs_review`).
  - Incorrectly converted Balak/Balika school institution types into Male/Female applicant gender requirements.
  - Lacks official notice clauses in preserved evidence. Must remain held; a reviewer cannot invent facts without authoritative evidence. Automated checks must not greenlight publication.

---

## 4. Implementation checklist

- [x] **Contract proposal & Task progress documents**:
  - [x] Create `docs/agent-progress/admin-review-worker-validation-contract-proposal.md`
  - [x] Create `docs/agent-progress/admin-review-worker-validation.md`
- [x] **Database & Storage (Additive schema)**:
  - [x] Add `ReviewItem`, `ReviewRevision`, `ValidationTask` models to `prisma/schema.prisma`.
  - [x] Create additive local migration `prisma/migrations/20261029160000_add_admin_review_workflow/migration.sql`.
  - [x] Implement storage helper functions (`src/lib/review-drafts.ts`):
    - [x] Import draft with deduplication and canonical hashing.
    - [x] Query queue with pagination, notice/role count, and status filtering.
    - [x] Fetch item detail with latest revision, evidence, and validation result.
    - [x] Save revision with stale-edit checking (`If-Match`), reason recording, and canonical hashing.
    - [x] Create and claim validation tasks with lease expiration.
    - [x] Record validation results bound to exact revision.
- [x] **Operator Access Guard**:
  - [x] Implement `src/auth/require-operator.ts`:
    - [x] Requires valid server-verified session.
    - [x] Checks `user.emailVerified === true`.
    - [x] Checks `user.email` against `APTUS_REVIEW_OPERATOR_EMAILS`.
    - [x] Denies access if allowlist is missing or empty.
    - [x] Sets `Cache-Control: private, no-store`.
- [x] **Backend API Endpoints**:
  - [x] `POST /api/internal/review-drafts` (worker draft import; token-protected).
  - [x] `GET /api/admin/review-drafts` (operator review queue).
  - [x] `GET /api/admin/review-drafts/operator-status` (operator check for UI auth-bar).
  - [x] `GET /api/admin/review-drafts/:id` (operator candidate detail).
  - [x] `POST /api/admin/review-drafts/:id/revisions` (operator save correction with `If-Match`).
  - [x] `POST /api/admin/review-drafts/:id/validate` (operator request validation).
  - [x] `GET /api/admin/review-drafts/:id/validation/:taskId` (poll validation status).
  - [x] `POST /api/admin/review-drafts/:id/keep-held` (operator keep-held action).
  - [x] `POST /api/internal/review-tasks/claim` (worker task claim with lease).
  - [x] `POST /api/internal/review-tasks/:taskId/result` (worker submit validation result).
  - [x] `POST /api/internal/review-tasks/:taskId/fail` (worker submit infrastructure failure).
- [x] **Worker Validation Execution Path**:
  - [x] Implement `services/ai/review_validation_worker.py`:
    - [x] Claims task from `/api/internal/review-tasks/claim`.
    - [x] Runs deterministic `validate_candidate`.
    - [x] Submits result to `/api/internal/review-tasks/:taskId/result`.
    - [x] Supports `--once` for synchronous CLI execution and testing.
    - [x] Separate unit tests in `services/ai/tests/test_review_validation_worker.py`.
- [x] **Frontend Interface**:
  - [x] Account menu: add "Review jobs" link for authorized operators.
  - [x] `/admin/review` queue page:
    - [x] Server-side operator session enforcement (`requireOperator`).
    - [x] Queue listing with title, role count, status, revision, validation state.
  - [x] `/admin/review/[id]` candidate detail page:
    - [x] Server-side operator session enforcement (`requireOperator`).
    - [x] Evidence viewer (safe text / bounded sections).
    - [x] Editable facts with numeric/null preservation.
    - [x] Action buttons: Save correction, Check correction, Refresh result, Keep held.
    - [x] Status indicators: Waiting for worker, Checking, Check completed with issues, Automated checks passed, Infrastructure failed.
    - [x] Accessible keyboard navigation and responsive narrow-screen layout.
- [x] **Verification & Acceptance Evidence**:
  - [x] Access control tests (guest, unverified email, non-operator, missing allowlist).
  - [x] CSRF & origin checks.
  - [x] Import idempotency & replay tests.
  - [x] Stale edit prevention tests (`If-Match` / 412).
  - [x] Worker claim & validation integration tests (real Python execution, 0 model calls).
  - [x] Post-isolation tests (verify zero changes to public `Post` rows).
  - [x] Typecheck (`pnpm typecheck`) and Lint (`pnpm lint`).
  - [x] Contract test suite (`DOTENV_CONFIG_PATH=/dev/null pnpm test:contracts`).
  - [x] Python test suite (`services/ai/tests`).

---

## 5. Observed behavior, recommendations, and unresolved questions

### Observed behavior:
- `validate_candidate.py` runs completely offline without any network or model dependencies when supplied with `result` and `source` dictionaries.
- Existing publication pipeline in `scripts/publish-extraction-candidate.ts` requires candidate to be stored in `ExtractionCandidate` first; our review drafts workflow operates upstream of publication and stores human revisions separately in `ReviewItem` and `ReviewRevision`. Public `Post` rows are untouched.
- `pnpm test:review` runs 4 extensive test suites and passes 100% locally.
- `DOTENV_CONFIG_PATH=/dev/null pnpm test:contracts` passes 12/12 contract tests cleanly.
- `PYTHONPATH=services/ai:services/ai/tests services/ai/.venv/bin/python -m unittest discover -s services/ai/tests -q` passes all 374 unit tests in 3.673s.

### Recommendations:
- Keep `ReviewItem` and `ReviewRevision` tables separate from `ExtractionCandidate` and `Post` to guarantee zero accidental leakage into public job queries.
- When running validation locally in tests or CLI, use `--once` to execute one task deterministically and exit with exit code 0.

### Unresolved questions:
- None currently blocking; operator accounts (`hemantkumar4213@gmail.com`, `mrdevghost@gmail.com`) and worker runtime are selected and recorded.

---

## 6. Decisions, alternatives considered, and concrete reasons

| Decision | Alternative considered | Reason |
|---|---|---|
| **Additive Prisma models (`ReviewItem`, `ReviewRevision`, `ValidationTask`)** | Reusing `ExtractionCandidate` table | `ExtractionCandidate` only stores one snapshot per content hash and lacks immutable revision history, parent linking, audit trail, and validation task leases. Separate models prevent pollution of publication tables. |
| **Durable `ValidationTask` with worker claim lease** | Direct synchronous Python spawn inside Next.js/Fastify | Keeps worker runtime decoupled from Node.js process; mirrors production worker architecture; handles process recovery and worker crashes cleanly. |
| **Revision binding via `If-Match`** | Implicit last-write-wins | Prevents silent data loss when multiple operators or browser tabs edit the same draft concurrently. |
| **Strict verified email allowlist** | Role string on user model | Project rules specifically prescribe `APTUS_REVIEW_OPERATOR_EMAILS` deployment allowlist matching verified account email. |

---

## 7. Files changed and their purpose

| File | Purpose |
|---|---|
| `docs/agent-progress/admin-review-worker-validation.md` | Task progress tracking and audit trail |
| `docs/agent-progress/admin-review-worker-validation-contract-proposal.md` | Formal boundary contract proposal |
| `prisma/schema.prisma` | Additive `ReviewItem`, `ReviewRevision`, `ValidationTask` models |
| `prisma/migrations/20261029160000_add_admin_review_workflow/migration.sql` | Additive SQL migration for review workflow |
| `src/auth/require-operator.ts` | Server-side operator session and allowlist verification |
| `src/lib/review-drafts.ts` | Storage operations for review items, revisions, and validation tasks |
| `src/routes/review-drafts.ts` | API routes for operator queue, detail, revisions, validation, and worker claims |
| `services/ai/review_validation_worker.py` | Python worker runtime for claiming and executing validation tasks |
| `services/ai/tests/test_review_validation_worker.py` | Python unittests for worker claim, validation execution, and result submission |
| `components/auth/account-menu.tsx` | Account menu with "Review jobs" link for authorized operators |
| `components/auth/auth-bar.tsx` | Operator check and prop passing for account menu |
| `components/admin/review-queue-view.tsx` | Accessible queue view component with status badges and filters |
| `components/admin/candidate-detail-view.tsx` | Candidate editor, evidence viewer, and validation display |
| `components/admin/review.module.css` | Accessible styles for review pages |
| `app/admin/review/page.tsx` | Operator review queue Next.js page |
| `app/admin/review/[id]/page.tsx` | Operator candidate review Next.js page |
| `scripts/review-workflow.test.ts` | Node/Fastify integration test suite for auth, replay, revisions, and stale edits |
| `tests/fixtures/review_candidate_fixture.json` | Real representative draft fixture with captured source evidence |
| `package.json` | Added `test:review` test script |

---

## 8. Verification ledger & results

### Test execution summary:

| Test command | Environment | Duration | Pass / Fail | Result summary |
|---|---|---|---|---|
| `pnpm typecheck` | Worktree (`codex/admin-review-worker-validation`) | 8.2s | 0 errors | TypeScript strict typecheck across web & server |
| `pnpm lint` | Worktree (`codex/admin-review-worker-validation`) | 3.1s | 0 errors | ESLint clean |
| `pnpm test:review` | Worktree (`codex/admin-review-worker-validation`), local PostgreSQL 17 | 13.1s | 4 / 4 passed (100%) | Access control, CSRF origin check, DB lifecycle, import replay, human correction, stale edits (412), worker claim, Python validation, public post isolation |
| `python -m unittest discover -s services/ai/tests -q` | Worktree (`codex/admin-review-worker-validation`), Python 3.11 venv | 3.67s | 374 / 374 passed (100%) | All worker tests including worker task claim, result submission, and idle behavior |
| `pnpm test:contracts` | Original checkout (`aptus-next`), Node 24 | 7.87s | 12 / 12 passed (100%) | Contract pack validation passes with 0 regressions |

### Test matrix details (`scripts/review-workflow.test.ts`):
1. **Access control**:
   - Guest user (unauthenticated) receives `401 Unauthorized`.
   - Unverified email user (`emailVerified: false`) receives `403 Forbidden`.
   - Verified non-operator email receives `403 Forbidden`.
   - Empty/missing `APTUS_REVIEW_OPERATOR_EMAILS` denies all access (`403 Forbidden`).
   - Operator check endpoint `/api/admin/review-drafts/operator-status` correctly returns `{ isOperator: true }` only for allowlisted operators.
2. **CSRF & Origin protection**:
   - Mutating operator requests (`POST /api/admin/review-drafts/:id/revisions`) with mismatched origin receive `403 Forbidden`.
3. **Database lifecycle & Replay idempotency**:
   - `POST /api/internal/review-drafts` imports worker artifact into `ReviewItem` and initial `ReviewRevision`.
   - Repeated import of the exact same artifact returns `{ status: 'existing', item_id, revision_hash }` without duplicating rows or creating new revisions.
   - Repeated import of new worker artifact cannot overwrite existing human corrections.
4. **Human corrections & Stale edit rejection (`If-Match`)**:
   - Operator saves correction specifying `If-Match: <baseRevisionHash>`.
   - Next revision is created with parent linking, canonical hash, and reason for change.
   - Second operator attempting to save with old base revision hash receives `412 Precondition Failed` with error code `STALE_REVISION`.
5. **Worker task claim, Python execution & Result submission**:
   - Operator requests validation (`POST /api/admin/review-drafts/:id/validate`), creating `pending` `ValidationTask`.
   - Python worker claims task (`POST /api/internal/review-tasks/claim`), receiving claim token and 5-minute lease.
   - Python worker invokes `validate_candidate()` deterministically without model calls or network access.
   - Candidate with unsupported fact returns `completed_with_issues` with exact errors.
   - Grounded correction passes validation with `checks_passed`.
   - Worker cannot report results for a stale revision (rejected with 409).
   - Expired task claims are automatically reclaimed after lease timeout.
6. **Public catalogue isolation**:
   - `GET /api/jobs` and `GET /api/jobs/:id` verified before and after review workflow.
   - Exactly 0 `Post` rows created or modified.
   - Review drafts and raw evidence remain completely isolated from public catalogue.

---

## 9. Real production risk review

| Risk / Failure mode | Severity | Likelihood | Defense location | Concrete test | Residual risk |
|---|---|---|---|---|---|
| **1. Reviewer silently overwrites another reviewer's work** | Medium | Possible | Backend API & DB (`If-Match` header check in `saveReviewCorrection`) | `scripts/review-workflow.test.ts: Stale revision save returns 412` | Reviewer who receives 412 must manually refresh and re-enter diff if their edits conflicted. |
| **2. Worker crashes midway through validation task** | Medium | Possible | Database lease timeout (`claimExpiresAt` in `claimValidationTask`) | `scripts/review-workflow.test.ts: Expired claim re-claimed after lease timeout` | While task is claimed, task appears "checking" until the 5-minute lease expires and another worker claims it. |
| **3. Reviewer enters valid JSON that contradicts captured source evidence** | High | Expected | Worker runtime (`validate_candidate` quotation gate via `extract_bundle.py:check_evidence`) | `scripts/review-workflow.test.ts: Worker flags ungrounded fact as completed_with_issues` | Automated validation checks lexical presence and structural validity, but cannot verify semantic nuance (explicitly labeled `semantic_support_verified: false`). |
| **4. Unauthenticated user or unauthorized email accesses review page or API endpoints** | High | Rare | Server-side `requireOperator` guard, session verification, verified email allowlist | `scripts/review-workflow.test.ts: Access control suite (guest, non-operator, unverified email, missing allowlist)` | Operator email allowlist misconfiguration in deployment environment (missing environment variable safely fails closed to deny all access). |
| **5. Reviewer bypasses UI and calls publication directly** | Critical | Rare | Codebase architecture (No publication endpoints exist on review items; `publish-extraction-candidate.ts` requires existing `ExtractionCandidate` record and is untouched) | `scripts/review-workflow.test.ts: Public catalogue isolation (zero changes to Post)` | Future publication workflow slice will require independent transactional authorization and publisher gates. |
| **6. Worker reports validation success for a stale revision** | Medium | Rare | Backend API revision token check (`submitValidationResult` verifies `task.revisionHash === body.revision_hash`) | `scripts/review-workflow.test.ts: Worker submits result for obsolete revision returns 409` | None; mismatched results are immediately rejected by the backend. |

---

## 10. Handoff notes

### For Hemant & Coordinator:
- **Baseline commit**: `d930a69e0093a440ef5ad99c92a6ab19326cec17`
- **Task worktree**: `/Users/mrblackghost/Work/Projects/aptus-admin-review-worker-validation`
- **Task branch**: `codex/admin-review-worker-validation`
- **Original checkout**: `/Users/mrblackghost/Work/Projects/aptus-next` remains completely untouched.
- **Verification commands to replicate**:
  ```bash
  cd /Users/mrblackghost/Work/Projects/aptus-admin-review-worker-validation
  pnpm typecheck
  pnpm lint
  TEST_DATABASE_URL="postgresql://aptus:aptus@127.0.0.1:5432/aptus" DATABASE_URL="postgresql://aptus:aptus@127.0.0.1:5432/aptus" pnpm test:review
  PYTHONPATH=services/ai:services/ai/tests services/ai/.venv/bin/python -m unittest discover -s services/ai/tests -q
  ```
- **Operator accounts configured**:
  `hemantkumar4213@gmail.com`, `mrdevghost@gmail.com`.
