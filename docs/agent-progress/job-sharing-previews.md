# Job sharing and previews

Baseline: 5e3b47c23631e5877a395213971cd2313a76b295 (origin/main).
Worktree: /tmp/aptus-job-sharing-previews. Branch: codex/job-sharing-previews.

Approved scope: public detail-page Share/Copy link, job-specific metadata and
one neutral shared image. No backend, database, worker or personal data changes.
Owned paths: job detail page/component, new job-sharing modules and tests,
static share-image route, this record. No frozen API semantics change.

Public origin: set SITE_URL to the exact public HTTPS origin in the frontend
runtime. Without it, ordinary title/description and browser-origin sharing work,
but canonical/Open Graph metadata is deliberately omitted rather than guessed.
Restart/redeploy is required to apply configuration; deployment is not part of
this PR. Backend BETTER_AUTH_URL is not exposed to the frontend.

The /share-image PNG is prerendered at build time with existing Next ImageResponse.
This avoids a Docker public-asset copy change or a new image dependency.

References read: installed Next metadata/OG guide; MDN
https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share and
https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText.
Cancellation is quiet; failed clipboard writes expose a selectable public URL.

Verification: focused metadata tests 2/2; typecheck, lint, build:web and production
Next webpack build passed. Build reports /share-image as static/prerendered.
Crawler/browser test initially hit sandbox port restrictions, then a tsx nested
callback serialization issue; the test helper was corrected and rerun.
Crawler/browser test passed 1/1 using system Chrome: WhatsApp user agent metadata
in head, absolute PNG URL/content type, native-share payload with query removed,
cancellation, successful copy, unavailable clipboard/native-share fallback,
keyboard activation and 390px layout without horizontal overflow.
Broader suite first failed on sandbox socket permissions; unrestricted rerun
recorded separately below. Existing DB-dependent skips are not DB verification.

Risk review: no additional confirmed production bug found in the final focused
diff. SITE_URL configuration and a real WhatsApp preview are release prerequisites;
passing local HTML/browser checks does not establish platform preview rendering.

Implementation commit: 7701381. GitHub PR: https://github.com/HkSolDev/aptus/pull/29.
Prior recorded HEAD: 038ea527ad8ee938babc53dad444cba04bb61ffc.

## CI Failure Diagnosis and Fix

### Verified starting state

- Branch: `codex/job-sharing-previews`
- Worktree: `/tmp/aptus-job-sharing-previews`
- Starting HEAD: `038ea527ad8ee938babc53dad444cba04bb61ffc`
- Target: `main`

### Observed CI Failures

GitHub Actions CI runs 41014332089 (pull_request) and 41014324114 (push) failed:

- Failed job: `test`
- Step 1: `Frozen contract and consumer audit checks` (`pnpm check:contracts`)
  - Failed test: `tests/triangle-contract.test.ts` ("Python facts survive the actual publication mapper, HTTP serialization and frontend rendering")
  - Error: `ReferenceError [Error]: React is not defined at JobShareActions (components/jobs/job-share-actions.tsx:39:3)`
- Step 2: `Build and browser tests` (`pnpm test:web`)
  - Failed tests: `tests/job-detail-content.test.ts` (5 tests) and `tests/triangle-contract.test.ts`
  - Error: identical `ReferenceError [Error]: React is not defined at JobShareActions (components/jobs/job-share-actions.tsx:39:3)`

### Clarification of earlier uncertain statements

The earlier uncertainty regarding failures in "real Python draft agrees with frozen fixture and the backend storage schema" and "publication receipt schema and actual Python receiver reject false success" during an unrestricted local run was resolved: both of those Python tests passed in CI. The earlier local failure was an artifact of missing local virtualenv in the worktree. The only actual failure in CI was `ReferenceError: React is not defined` inside `JobShareActions`.

### Root Cause and Reproduction

- In Node test runs (`tsx`), JSX transforms compile JSX tags to `React.createElement` / `React.Fragment`.
- `components/jobs/job-share-actions.tsx` imported only `{ useState }` from `'react'`, leaving `React` undefined in module scope when `JobDetailContent` rendered `JobShareActions` under `renderToStaticMarkup`.
- Reproduction: Running `node --import ./tests/css-module-hook.mjs --import tsx --test --test-concurrency=1 tests/job-detail-content.test.ts` reproduced the 5 test failures and stack trace immediately.

### Smallest Evidence-Backed Fix

- Updated `components/jobs/job-share-actions.tsx` to `import React, { useState } from 'react';`.
- No backend, worker, database, or test files modified.
- Fix commit SHA: `408471f70c22b661a71ae118d263b751503a7294`.

### Verification Commands and Observed Results

- `node --import ./tests/css-module-hook.mjs --import tsx --test --test-concurrency=1 tests/job-detail-content.test.ts`: 6/6 passed.
- `node --import ./tests/css-module-hook.mjs --import tsx --test --test-concurrency=1 tests/job-sharing.test.ts`: 2/2 passed.
- `node --import ./tests/css-module-hook.mjs --import tsx --test --test-concurrency=1 tests/job-sharing-browser.test.ts`: 1/1 passed.
- `pnpm typecheck`: 0 errors.
- `pnpm lint`: 0 errors.
- `pnpm exec prettier --check components/jobs/job-share-actions.tsx`: code style confirmed.
- `pnpm check:contracts`: 12/12 tests passed; audit findings clean.
- `pnpm test`: 119 passed, 15 skipped (DB integration tests requiring dedicated DB).
- `PYTHONPATH=services/ai services/ai/.venv/bin/python -m unittest discover -s services/ai/tests -q`: Ran 414 tests, OK.

### Fix Commits and CI Links

- Fix commit SHA: `408471f70c22b661a71ae118d263b751503a7294`
- Audit record commit SHA: `5dc91e8e53c3ee2fc98e7cc43d5aca25ba10d131`
- Pull request CI run: https://github.com/HkSolDev/aptus/actions/runs/41029543942
- Push CI run: https://github.com/HkSolDev/aptus/actions/runs/41029539786

### Deployment & Platform Verification Boundary

Public WhatsApp preview requires production deployment with configured `SITE_URL` and remains unverified until tested on a live public URL. No production changes authorized.
