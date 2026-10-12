# Pre-merge CI checkpoint

Updated: 11 October 2026. Integrated current main before preparing the feature
branch for publication. This records local verification; the hosted CI outcome
will be recorded after the pull request finishes.

## Changes

- GitHub Actions now prepares Python, migrated disposable PostgreSQL 17 and
  Chromium, and runs both TypeScript checks, Node/database tests, offline Python
  tests, builds and browser tests. Later checks still run after an earlier quality
  failure. No failures are ignored. Repository permissions are read-only; runs
  have a 20-minute timeout and superseded runs are cancelled.
- Generated Next output, experiments/extraction outputs, virtual environments and
  generated Next declarations are excluded from source formatting checks.
  Existing main's typed-lint scope is preserved; no individual rules are disabled.
- Matching input tests use an illustrative verified-session lookup through the
  real middleware, and explicitly test signed-out and foreign-origin rejection
  before any profile write. No production authentication changed.
- Passkey fixtures compare rows and schema fields by identity rather than
  database ordering. Expected SQL constraint failures now run inside real
  transactions and always roll back. Ownership, uniqueness and private-key
  exclusion assertions remain intact.
- Test mocks await promises and type-check HTTP responses. The extraction launcher
  uses dynamic imports while preserving credential-safe startup behavior.
  HTML escaping accepts only scalar values and safely handles unknown objects.
- Flagged maintained documentation/schema files were formatted without behavioral
  changes. Raw local captures, training data and unrelated dirty work were not
  included in the merge checkout.

## Local acceptance

Run from a clean isolated checkout with frozen-lockfile dependencies and dotenv
loading disabled. PostgreSQL uses illustrative test-only credentials; application
records and real provider credentials are not used.

- `pnpm lint`: passed.
- `pnpm exec prettier --check .`: passed.
- `pnpm typecheck`: passed.
- Offline Python discovery suite: 176 passed.
- Node/database suite: 105 tests passed with no failures or skips.
- `pnpm test:web`: builds and 15 committed browser tests passed.
- New database migrations applied successfully to disposable PostgreSQL.
- Changed-file credential-pattern scan found no matching key/token/private-key
  patterns. This is a focused scan, not a guarantee that every possible secret
  format has been detected. Forbidden environment files were not read.

The original checkout has other uncommitted frontend/auth and legacy-pipeline
work. Its extra tests and edits are excluded unless independently reviewed;
therefore earlier original-checkout test counts differ from this merge checkout.
GitHub CI checks do not deploy the app. Required status checks in branch rules can
block merging; repository merge enforcement is not changed by this update.
