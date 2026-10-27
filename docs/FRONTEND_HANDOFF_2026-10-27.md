# Frontend Contract Correctness Handoff — 27 October 2026

**Author**: Agent 3 (Aptus Frontend Contract Implementer)  
**Coordinator & Authority**: Hemant & Main Conversation Coordinator  
**Baseline SHA**: `d930a69e0093a440ef5ad99c92a6ab19326cec17`  
**Branch**: `codex/next-aptus-work`  
**Workspace**: `/Users/mrblackghost/Work/Projects/aptus-next`  
**Contract Revisions**: `contracts/http.schema.json` (revision `local-v1`), `docs/contracts/frontend-backend.md` (`FB-v1`), `docs/contracts/worker-frontend.md` (`WF-v1`)

---

## 1. Summary of Delivered Work

Agent 3 reproduced, diagnosed, and resolved the two assigned contract nonconformances:

1. **FB-NULL-EDUCATION**: The backend provider emits `educationRequired: null` as a valid value for jobs where source qualification text is unstated. Previously, `frontend/types.ts` and `components/jobs/job-card.tsx` declared `educationRequired: string`, excluding `null` and causing TypeScript/wire misalignment. Both definitions have been updated to required-but-nullable `educationRequired: string | null`.
2. **FB-MALFORMED-SUCCESS**: Previously, client functions in `frontend/profile-api.ts` and `frontend/saved-jobs-api.ts` accepted HTTP 200 `{}` without validating response envelopes. This caused:
   - `fetchProfile()` to silently return `null` (falsely representing "applicant has no profile"),
   - `fetchSavedJobs()` to silently return an empty list with fake pagination (falsely displaying "Your shortlist starts here"),
   - `saveJobApi()` to return `false`, which callers (`workspace-provider.tsx`) interpreted as an un-save, falsely removing saved status from the UI,
   - `unsaveJobApi()` to unconditionally return `false` without checking the envelope.
     All endpoints now perform runtime validation of success envelopes, reject missing required keys and wrong types with clear user-facing errors, preserve legitimate `null` profile semantics, and provide retry capability through accessible `role="alert"` notifications.

---

## 2. Isolation and Baseline Inventory

- **CWD**: `/Users/mrblackghost/Work/Projects/aptus-next`
- **Branch**: `codex/next-aptus-work`
- **HEAD Commit**: `d930a69e0093a440ef5ad99c92a6ab19326cec17`
- **Worktree Inventory**:
  - `/Users/mrblackghost/Work/Projects/aptus`: `45b2918 [codex/discovery-links]`
  - `/Users/mrblackghost/Work/Projects/aptus-next`: `d930a69 [codex/next-aptus-work]` (active workspace)
  - `/private/tmp/aptus-worker-extraction-20261027`: `d930a69 [codex/worker-extraction-offline-20261027]` (Agent 2)
  - Other prunable worktrees in `/private/tmp` and `/Users/mrblackghost/.codex/worktrees`
- **Baseline Integrity**: The uncommitted contract pack in `aptus-next` (`contracts/`, `docs/contracts/`, `scripts/contracts/`) was verified against `contracts/lock.json` and passed checksum verification. No protected contract files or schemas were modified.

---

## 3. Exact Modified and New Files

### Modified Owned Files

1. `frontend/types.ts`:
   - Aligned `PublicJobItem.educationRequired` from `string` to required-but-nullable `string | null`.
2. `components/jobs/job-card.tsx`:
   - Aligned local `PublicJobItem.educationRequired` from `string` to `string | null`.
   - Preserved defensive optional chaining (`job.educationRequired?.trim()`).
3. `frontend/profile-api.ts`:
   - Added runtime validation `validateSavedProfile(raw: unknown)` checking `dob` format (`^\d{4}-\d{2}-\d{2}$`), category enum allowlist (`null`, `General`, `OBC`, `SC`, `ST`, `EWS`, `PwBD`), and education entries with levels from `EDUCATION_LEVELS` and marks between `0` and `100` (or `null`).
   - `fetchProfile()` verifies `'profile' in data`. Returns `null` if and only if `data.profile === null`. Rejects missing `profile` key or malformed profile objects.
   - `saveProfileApi()` verifies `'profile' in data && data.profile !== null` and validates the saved profile.
4. `frontend/saved-jobs-api.ts`:
   - Added runtime validation `validateSavedJobsResponse(data: unknown)` and `validateSavedJobItem(raw: unknown)` checking required pagination fields (`page`, `pageSize`, `totalItems`, `totalPages` as integers) and job properties (`id`, `postName`, `educationRequired: string | null`, `vacancies`, `savedAt`, etc.).
   - `fetchSavedJobs()` verifies response envelope and items; rejects malformed `{}` without fallback defaulting.
   - `fetchSavedStatus(ids)` validates that `savedIds` is an array of strings. Rejects `{}` or non-string arrays. Returns `[]` immediately if input is empty.
   - `saveJobApi(jobId)` validates `data.saved === true` and optional string `savedAt`. Rejects `{}` or `{ saved: false }` with an error, preventing silent un-saving in callers.
   - `unsaveJobApi(jobId)` validates `data.saved === false`. Rejects `{}` or `{ saved: true }` with an error.

### New Test Files

5. `tests/frontend-contract.test.ts`:
   - 7 unit tests covering malformed success envelopes, wrong types, missing keys, explicit `null`, and valid payloads across all profile and saved-jobs API functions.
6. `tests/frontend-malformed-browser.test.mjs`:
   - Playwright browser test verifying `SaveJobButton`, `SavedJobsView`, and `ProfileForm` behavior against malformed HTTP 200 `{}`: accessible error alert rendering, prevention of false state changes, and recovery upon retry.

---

## 4. Before vs. After Behavior

| Scenario                                                                    | Before Behavior                                                                                                                      | After Behavior                                                                                                                                                           |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `educationRequired: null` in public jobs                                    | Type error in `PublicJobItem` declarations (`string` only).                                                                          | Type-safe `string                                                                                                                                                        | null`in`frontend/types.ts`and`components/jobs/job-card.tsx`. |
| `GET /api/profile` returns HTTP 200 `{}`                                    | `data?.profile ?? null` returned `null`, falsely indicating user has no profile and clearing profile state.                          | Throws `Aptus returned an unexpected response. Please refresh and try again.`; UI alerts user with `role="alert"` and provides "Try again" retry button.                 |
| `GET /api/profile` returns `{ profile: null }`                              | Returned `null`.                                                                                                                     | Preserved: returns `null` (legitimate missing profile).                                                                                                                  |
| `GET /api/profile` returns wrong types (e.g. `{ profile: { dob: 123 } }`)   | Unchecked cast allowed corrupted object into application state.                                                                      | Runtime validation throws; error is surfaced via UI alert.                                                                                                               |
| `PUT /api/profile` returns HTTP 200 `{}`                                    | Threw error, but allowed `{ profile: null }` or unchecked object.                                                                    | Strictly validates `data.profile` against `SavedProfile` schema.                                                                                                         |
| `GET /api/saved-jobs` returns HTTP 200 `{}`                                 | Fallback default returned `{ data: [], pagination: ... }`, silently displaying "Your shortlist starts here".                         | Throws `Aptus returned an invalid saved jobs list.`; UI displays `role="alert"` error banner with "Try again" button.                                                    |
| `GET /api/saved-jobs/status` returns HTTP 200 `{}` or `{ savedIds: [123] }` | Checked only `Array.isArray`; allowed non-string arrays or threw generic error.                                                      | Strictly validates `Array.isArray(data.savedIds) && data.savedIds.every(id => typeof id === 'string')`.                                                                  |
| `PUT /api/saved-jobs/:id` returns HTTP 200 `{}`                             | Returned `false` (`Boolean(undefined)`). Caller removed job from `savedJobIds`, falsely marking it unsaved without showing an error! | Throws `Aptus returned an unexpected response. Please try again.`; caller leaves saved state intact, surfaces `role="alert"` message, and displays "Retry saved status". |
| `DELETE /api/saved-jobs/:id` returns HTTP 200 `{}`                          | Unconditionally returned `false` without checking payload.                                                                           | Strictly checks `data.saved === false`; rejects `{}` or `{ saved: true }`.                                                                                               |

---

## 4. Exact File SHA-256 Hashes

| File Path                                        | SHA-256 Hash                                                       | Notes                                                                                  |
| :----------------------------------------------- | :----------------------------------------------------------------- | :------------------------------------------------------------------------------------- |
| `frontend/types.ts`                              | `87c015d5fe78e9f1a601b37c1552f2986f6ca773a1fd0f99841c9cad61f2b580` | Required-but-nullable `educationRequired`                                              |
| `components/jobs/job-card.tsx`                   | `22fd41673eefd963a50f4b9929a9181f561ef0b9f905bc17f00b6e44cd882ee4` | Aligned local wire type                                                                |
| `components/results/recommendations-preview.tsx` | `58b8bf192185687fba054857df6cdf1d037b9ef42514c6e2a5cc328140e2dd78` | Safe `educationRequired: null` handling (`matchesPreviewQualification`)                |
| `frontend/profile-api.ts`                        | `29a6f5518bc2d49bf1ff7e8a88fbd583366c9cf8dbfad90d785f0bbe940273d9` | Type-only `./types.js` import + exhaustive `Record<EducationLevel, true>` + Prettier   |
| `frontend/saved-jobs-api.ts`                     | `d47d283cab987d2c40607841099b45b16c84dec3d751e663b7c35c6c26fc552e` | Shared `isValidIsoDateTime`: strict calendar bounds + RFC 3339 + Prettier              |
| `tests/frontend-contract.test.ts`                | `add08ca8bc92cf2d728c150b7d6fc16b8f58f87ab3bc315d3d48e5793f889bd9` | Unit tests including `educationRequired: null` in `recommendations-preview` + Prettier |
| `tests/frontend-malformed-browser.test.mjs`      | `84ad88a8db6c96753d50e5547cadb5d2a0f4dcbf630d25c9a0ff527af656517f` | Chromium integration test: verifies impossible dates cannot save                       |
| `tests/saved-workspace.test.mjs`                 | `8b8b17e0ebf943f4883ff64743fc7d3bef557c9f9389a9b21342e2217e4dcbc8` | Contract-compliant route fulfillment with `savedAt`                                    |
| `package.json`                                   | `626984791e84b146aced69e8f6df1744f61166cd2908fe35cfc429746132d236` | `test:web` includes `tests/frontend-malformed-browser.test.mjs`                        |
| `docs/WORKER_HANDOFF_2026-10-27.md`              | `54bcf6de9ffb2ba5aa604d84889056843e392c83a605f9fa17f549cda33cb148` | Formatted with Prettier only (content unchanged)                                       |

---

## 5. Resolution of Independent Review & Integration Findings

1. **Finding F1 & F2 (RESOLVED) — Shared RFC 3339 Date-Time & Calendar Validator (`frontend/saved-jobs-api.ts`):**
   - Implemented `isValidIsoDateTime(value: unknown): value is string` matching the frozen contract `contracts/http.schema.json:445-458` (`format: "date-time"`):
     - Strictly checks ISO 8601 / RFC 3339 structure `YYYY-MM-DDTHH:mm:ss(.sss)?(Z|[+-]HH:mm)`.
     - Validates actual calendar month days including non-leap Feb 29 (e.g. `2025-02-29T00:00:00Z` rejected; `2024-02-29T00:00:00Z` accepted) and 30-day month overflows (e.g. `2026-04-31T00:00:00Z` rejected).
     - Does not rely on `Date.parse` alone, preventing loose parsing of `"hello 1"`, `"2026/02/31"`, or rollover of `"2026-02-31T00:00:00Z"`.
     - Verified 100% agreement with Fastify/Ajv contract checker across all probe cases.
   - Used uniformly in both `saveJobApi` and `validateSavedJobItem` (`fetchSavedJobs`).
   - Added unit regression tests in `tests/frontend-contract.test.ts` across Agent 1's exact failing probe examples.
   - Added browser integration check in `tests/frontend-malformed-browser.test.mjs` ensuring an invalid calendar response (e.g. Feb 31) triggers `role="alert"`, displays "Retry saved status", and does NOT update saved state in `#saved-state`.
2. **DOB Calendar Validation (RESOLVED):**
   - `frontend/profile-api.ts`: `validateSavedProfile` strictly checks that parsed UTC date parts match the year, month, and day components of the DOB string, cleanly rejecting impossible dates like `2000-02-31`.
3. **Browser Test in Normal Test Command (RESOLVED):**
   - `package.json`: Updated `test:web` script to explicitly include `tests/frontend-malformed-browser.test.mjs` alongside `tests/*.test.ts` and `tests/saved-workspace.test.mjs`. Normal test run now executes both browser suites automatically.
4. **Bounded Integration Fixes on Baseline `b8516c5d4aa2ca8ad3e76212c2ea4ae51f9af209` (RESOLVED):**
   - **Worktree / Branch**: `/private/tmp/aptus-agent3-integration-20261027` (`codex/agent3-integration-20261027`, branched from `b8516c5d4aa2ca8ad3e76212c2ea4ae51f9af209`).
   - **`components/results/recommendations-preview.tsx` (`educationRequired: null`):** Added `matchesPreviewQualification(educationRequired, qualification)`. Preserves unknown qualification (`null`) when browsing without a qualification filter (`qualification === ''`), never fabricates qualification text, and returns `false` when a qualification filter (`TWELFTH`, `DIPLOMA`, `BACHELORS`) is active so unknown education is never counted as a confirmed qualification match. Resolves `TS2345` in `tsconfig.next.json` during `pnpm next:build`.
   - **`frontend/profile-api.ts` (`EDUCATION_LEVELS` runtime import):** Replaced the runtime value import of `EDUCATION_LEVELS` from `'./types.js'` with a type-only import (`import type { EducationLevel, SavedProfile, SavedProfileEducation } from './types.js'`) and a compile-time exhaustive map (`EDUCATION_LEVEL_MAP satisfies Record<EducationLevel, true>`). Both `tsc --noEmit` (`NodeNext`), `tsc -p tsconfig.web.json`, `pnpm next:build` (Next.js 16.4.0 Turbopack/webpack), and Node `tsx` tests pass without module resolution errors.
   - **Prettier Formatting (5 files from Integration Report):** Formatted only `frontend/profile-api.ts`, `frontend/saved-jobs-api.ts`, `tests/frontend-contract.test.ts`, `docs/FRONTEND_HANDOFF_2026-10-27.md`, and `docs/WORKER_HANDOFF_2026-10-27.md` (plus verified `components/results/recommendations-preview.tsx`).

---

## 6. UI Caller Verification & Accessibility

1. **`components/profile/profile-form.tsx`**:
   - On `fetchProfile()` failure: sets `loadStatus = 'error'`, renders `<div className="notice notice-error" role="alert">{loadError}</div>`, disables form inputs, and displays "Try again" button calling `loadData()`.
   - On `saveProfileApi()` failure: renders `<div id="save-error" className="notice notice-error" role="alert">{saveError}</div>`.
2. **`components/results/saved-jobs-view.tsx`**:
   - On `fetchSavedJobs()` initial failure: renders `<div className="notice notice-error" role="alert">{error}</div>` and "Try again" button calling `loadJobs(page)`. Does NOT display the empty shortlist illustration.
   - On subsequent failure: retains existing data with an alert banner.
3. **`components/jobs/save-job-button.tsx` & `components/providers/workspace-provider.tsx`**:
   - On `saveJobApi()` or `unsaveJobApi()` failure: `updateSavedJob` catches the error, marks the job ID in `failedIdsRef`, clears checked state, and sets `savedStatusError('Couldn’t confirm saved status. Try again.')`.
   - `SaveJobButton` renders `<button ...>Retry saved status</button>` and `<span role="alert">{error || savedStatusError}</span>`.
   - Clicking "Retry saved status" calls `checkSavedStatus([id])` to verify actual server status before retrying mutation.
   - Stale session/generation checks prevent race conditions or cross-account leakage.

---

## 6. Verification Results (Integrated Baseline `b8516c5d4aa2ca8ad3e76212c2ea4ae51f9af209`)

### 1. Frozen Contract Suite & Consumer Audit (`DOTENV_CONFIG_PATH=/dev/null PYTHONPATH=services/ai pnpm check:contracts`)

- **`pnpm test:contracts`**: **12 passed, 0 failed, 0 skipped** (`~3.5s`). All 19 locked contract artifacts in `contracts/lock.json` verified unchanged.
- **`pnpm audit:contracts`**: **PASSED (Exit 0)** — `{ "status": "passed", "findings": [] }` (**0 findings** across frontend and backend).

### 2. Production Next.js Build & Web Bundle (`pnpm build:web && pnpm next:build`)

- **`pnpm build:web` (`tsc -p tsconfig.web.json`)**: **PASSED (Exit 0, 0 errors)**.
- **`pnpm next:build` (`next build` — Next.js 16.4.0 Turbopack + `tsconfig.next.json`)**: **PASSED (Exit 0, 0 errors)**.

### 3. Full Web & Browser Test Suite (`pnpm test:web`)

- **Command**: `DOTENV_CONFIG_PATH=/dev/null pnpm test:web` (`pnpm build:web && pnpm next:build && node --import ./tests/css-module-hook.mjs --import tsx --test --test-concurrency=1 tests/*.test.ts tests/saved-workspace.test.mjs tests/frontend-malformed-browser.test.mjs`)
- **Result**: **43 passed, 0 failed, 0 skipped** (`47.87s`).
- Includes:
  - `tests/frontend-contract.test.ts` (8 unit/component tests including `recommendations-preview.tsx` `educationRequired: null` handling)
  - `tests/frontend-malformed-browser.test.mjs` (Playwright Chromium malformed-envelope & impossible-calendar-date recovery)
  - `tests/saved-workspace.test.mjs` (Playwright Chromium batching, retry, session isolation, pagination)
  - `tests/frontend.test.ts` (Fastify + Chromium end-to-end flows)
  - `tests/next-frontend.test.ts`, `tests/next-navigation.test.ts`, `tests/page-design.test.ts` (Next.js production & review server browser suites across mobile `390px`, tablet `834px`, and desktop `1440px`)
  - `tests/job-card.test.ts`, `tests/job-detail-content.test.ts`, `tests/public-browsing.test.ts`, `tests/triangle-contract.test.ts`.

### 4. Typecheck, Lint, and Formatting

- **`pnpm typecheck` (`tsc --noEmit && tsc -p tsconfig.web.json --noEmit`)**: **PASSED (Exit 0, 0 errors)**.
- **`pnpm lint` (`eslint .`)**: **PASSED (Exit 0, 0 warnings or errors)**.
- **`pnpm exec prettier --check components/results/recommendations-preview.tsx frontend/profile-api.ts frontend/saved-jobs-api.ts tests/frontend-contract.test.ts docs/FRONTEND_HANDOFF_2026-10-27.md docs/WORKER_HANDOFF_2026-10-27.md`**: **PASSED (Exit 0 — All matched files use Prettier code style)**.

---

## 7. Evidence Categorization

- **Mocked HTTP & Component Unit Checks**: `tests/frontend-contract.test.ts` replaces `globalThis.fetch` with deterministic JSON responses to test parser edge cases and boundary rejections, and tests `matchesPreviewQualification` + `JobCard` SSR markup for `educationRequired: null`.
- **Integration Route Checks**: `scripts/contracts/frontend-backend.test.ts` uses real Fastify app injection with mock session/DB layers to test request/response serialization across HTTP boundaries.
- **End-to-End Browser Flow**: `pnpm test:web` runs actual Chromium via Playwright against both the Fastify server and the production `.next` build (`next start` / `next dev`), verifying DOM assertions, responsive viewports, keyboard navigation, and accessibility alerts.

---

## 8. Remaining Limitations and Next Steps

1. **Sandbox Loopback Execution Note**: Standard sandbox (`BypassSandbox: false`) isolates local loopback sockets (`127.0.0.1`), so Playwright browser suites in `pnpm test:web` require loopback permission (`BypassSandbox: true`). Under non-interactive agent execution, Next.js 16.4.0 emits a one-time agent security upgrade prompt (`SecurityFatalError` for `next@16.4.0`) unless retried or run with non-interactive terminal settings (`__NEXT_AGENT_UPGRADE_FORCE_TERMINAL_FOR_TESTING=1 TERM=dumb`); per scope rules, `next@16.4.0` was not upgraded speculatively.
2. **Database & Live Provider Scenarios**: Real PostgreSQL database scenarios (`TEST_DATABASE_URL`) and live OAuth / deployment checks remain outside frontend scope.
3. **No Unapproved Changes**: No dependencies were added, no CSS was refactored, and no contract locks (`contracts/lock.json`) were altered.
