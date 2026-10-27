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

| Scenario | Before Behavior | After Behavior |
| --- | --- | --- |
| `educationRequired: null` in public jobs | Type error in `PublicJobItem` declarations (`string` only). | Type-safe `string | null` in `frontend/types.ts` and `components/jobs/job-card.tsx`. |
| `GET /api/profile` returns HTTP 200 `{}` | `data?.profile ?? null` returned `null`, falsely indicating user has no profile and clearing profile state. | Throws `Aptus returned an unexpected response. Please refresh and try again.`; UI alerts user with `role="alert"` and provides "Try again" retry button. |
| `GET /api/profile` returns `{ profile: null }` | Returned `null`. | Preserved: returns `null` (legitimate missing profile). |
| `GET /api/profile` returns wrong types (e.g. `{ profile: { dob: 123 } }`) | Unchecked cast allowed corrupted object into application state. | Runtime validation throws; error is surfaced via UI alert. |
| `PUT /api/profile` returns HTTP 200 `{}` | Threw error, but allowed `{ profile: null }` or unchecked object. | Strictly validates `data.profile` against `SavedProfile` schema. |
| `GET /api/saved-jobs` returns HTTP 200 `{}` | Fallback default returned `{ data: [], pagination: ... }`, silently displaying "Your shortlist starts here". | Throws `Aptus returned an invalid saved jobs list.`; UI displays `role="alert"` error banner with "Try again" button. |
| `GET /api/saved-jobs/status` returns HTTP 200 `{}` or `{ savedIds: [123] }` | Checked only `Array.isArray`; allowed non-string arrays or threw generic error. | Strictly validates `Array.isArray(data.savedIds) && data.savedIds.every(id => typeof id === 'string')`. |
| `PUT /api/saved-jobs/:id` returns HTTP 200 `{}` | Returned `false` (`Boolean(undefined)`). Caller removed job from `savedJobIds`, falsely marking it unsaved without showing an error! | Throws `Aptus returned an unexpected response. Please try again.`; caller leaves saved state intact, surfaces `role="alert"` message, and displays "Retry saved status". |
| `DELETE /api/saved-jobs/:id` returns HTTP 200 `{}` | Unconditionally returned `false` without checking payload. | Strictly checks `data.saved === false`; rejects `{}` or `{ saved: true }`. |

---

## 4. Exact File SHA-256 Hashes

| File Path | SHA-256 Hash | Notes |
| :--- | :--- | :--- |
| `frontend/types.ts` | `87c015d5fe78e9f1a601b37c1552f2986f6ca773a1fd0f99841c9cad61f2b580` | Required-but-nullable `educationRequired` |
| `components/jobs/job-card.tsx` | `22fd41673eefd963a50f4b9929a9181f561ef0b9f905bc17f00b6e44cd882ee4` | Aligned local wire type |
| `frontend/profile-api.ts` | `0eb0090b18db5c77746895cb6f9c9629cb9f3ccba340ebe75d0d91974839c983` | Runtime envelope validation + calendar DOB validation |
| `frontend/saved-jobs-api.ts` | `7b13d928f58ba2d2443aca7af771181521af30328d0bbd12aff3c099fa3cc7ea` | Shared `isValidIsoDateTime`: strict calendar bounds + RFC 3339 |
| `tests/frontend-contract.test.ts` | `8ce6cffb65680f3dd3b6326ba74264564110a924d35938039201ecd93d05267d` | Comprehensive unit tests including Agent 1's exact failing cases |
| `tests/frontend-malformed-browser.test.mjs` | `84ad88a8db6c96753d50e5547cadb5d2a0f4dcbf630d25c9a0ff527af656517f` | Chromium integration test: verifies impossible dates cannot save |
| `tests/saved-workspace.test.mjs` | `8b8b17e0ebf943f4883ff64743fc7d3bef557c9f9389a9b21342e2217e4dcbc8` | Contract-compliant route fulfillment with `savedAt` |
| `package.json` | `626984791e84b146aced69e8f6df1744f61166cd2908fe35cfc429746132d236` | `test:web` includes `tests/frontend-malformed-browser.test.mjs` |

---

## 5. Resolution of Independent Review Findings

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
   - `frontend/profile-api.ts:37-47`: `validateSavedProfile` strictly checks that parsed UTC date parts match the year, month, and day components of the DOB string, cleanly rejecting impossible dates like `2000-02-31`.
3. **Browser Test in Normal Test Command (RESOLVED):**
   - `package.json`: Updated `test:web` script to explicitly include `tests/frontend-malformed-browser.test.mjs` alongside `tests/*.test.ts` and `tests/saved-workspace.test.mjs`. Normal test run now executes both browser suites automatically.

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

## 6. Verification Results

### 1. Consumer Contract Audit (`DOTENV_CONFIG_PATH=/dev/null pnpm audit:contracts`)
- **Status**: Nonconformant (Exit 1) due **only** to the three backend matcher findings assigned to Agent 4.
- **Frontend Findings**:
  - `FB-NULL-EDUCATION` (`frontend/types.ts`): **RESOLVED** (0 findings)
  - `FB-NULL-EDUCATION` (`components/jobs/job-card.tsx`): **RESOLVED** (0 findings)
  - `FB-MALFORMED-SUCCESS` (`fetchProfile`): **RESOLVED** (0 findings)
  - `FB-MALFORMED-SUCCESS` (`fetchSavedJobs`): **RESOLVED** (0 findings)
  - `FB-MALFORMED-SUCCESS` (`saveJobApi`): **RESOLVED** (0 findings)
  - `FB-MALFORMED-SUCCESS` (`unsaveJobApi`): **RESOLVED** (0 findings)
- **Remaining Audit Findings**:
  - `WF-AGE-REFERENCE` (`scripts/match.ts`): Agent 4 ownership
  - `WF-RELAXATION-FLAG` (`scripts/match.ts`): Agent 4 ownership
  - `WF-CONDITIONAL-GATES` (`scripts/match.ts`): Agent 4 ownership

### 2. Contract Test Suite (`DOTENV_CONFIG_PATH=/dev/null pnpm test:contracts`)
- **Result**: 12 passed, 0 failed, 0 skipped (duration ~10.4s).
- Exercises real Fastify route injection with auth session guards, OpenAPI/JSON Schema resolution, lock file checks, and triangle contract validation.

### 3. Focused Frontend Contract Tests (`node --import ./tests/css-module-hook.mjs --import tsx --test tests/frontend-contract.test.ts`)
- **Result**: 7 passed, 0 failed, 0 skipped (duration ~154ms).
- Explicitly verifies missing required keys (`{}`), wrong types (numbers, objects, invalid dates, invalid enums), boundary null values, and valid payloads.

### 4. Playwright Browser Tests
- **`tests/frontend-malformed-browser.test.mjs`**:
  - **Result**: 1 passed, 0 failed (duration ~1.4s).
  - Validates full browser DOM rendering with Chromium:
    - `SaveJobButton` malformed HTTP 200 `{}` -> shows accessible `[role="alert"]`, keeps state uncorrupted, displays "Retry saved status", and recovers on retry.
    - `SavedJobsView` malformed HTTP 200 `{}` -> shows accessible `[role="alert"]`, avoids false empty state, and recovers on "Try again".
    - `ProfileForm` malformed HTTP 200 `{}` -> shows accessible `[role="alert"]`, disables inputs, and recovers on "Try again".
- **`tests/saved-workspace.test.mjs`**:
  - **Result**: 1 passed, 0 failed (duration ~2.2s).
  - Existing browser regression suite remains green (batching, retry, session isolation, pagination).

### 5. Typecheck and Lint
- **`pnpm typecheck`**: Passed with 0 errors across root project and `tsconfig.web.json`.
- **`pnpm lint`**: Passed with 0 warnings or errors.

---

## 7. Evidence Categorization

- **Mocked HTTP Unit Checks**: `tests/frontend-contract.test.ts` replaces `globalThis.fetch` with deterministic JSON responses to test parser edge cases and boundary rejections.
- **Component & Integration Route Checks**: `scripts/contracts/frontend-backend.test.ts` uses real Fastify app injection with mock session/DB layers to test request/response serialization across HTTP boundaries.
- **End-to-End Browser Flow**: `tests/frontend-malformed-browser.test.mjs` and `tests/saved-workspace.test.mjs` run an actual Chromium browser via Playwright against an HTTP test server with client bundle execution, DOM assertion, and accessibility inspection.

---

## 8. Remaining Limitations and Next Steps

1. **Backend Matcher Findings**: `WF-AGE-REFERENCE`, `WF-RELAXATION-FLAG`, and `WF-CONDITIONAL-GATES` in `scripts/match.ts` are outside Agent 3 ownership and are being resolved by Agent 4.
2. **Production / Database Scenarios**: Real PostgreSQL database scenarios and live network deployment checks are coordinator-controlled. All tests reported here were executed offline in isolated test environments.
3. **No Unapproved Changes**: No dependencies were added, no CSS was refactored, and no contract locks were altered.
