# Backend login push checkpoint — 7 October 2026

Backend-only snapshot on `codex/login`, extending existing PR #7 (base:
`codex/project-guidance`). No frontend, Next.js, Docker, extraction cleanup,
generated output, or new dependency changes are included. Only the backend
`start` command is staged from the shared package file; its remaining changes
and the lockfile remain with the frontend/cleanup work.

## Review order

1. `src/auth/config.ts` → `auth.ts`: Google OIDC/PKCE, PostgreSQL sessions,
   seven-day rolling expiry with daily renewal, provider-token disposal.
2. `src/auth/http.ts` → `routes.ts` → `require-session.ts` → `src/app.ts`:
   fixed redirect, cookie forwarding, exact Origin checks and private guards.
3. `src/routes/match.ts` / `explain.ts`: session-owned profiles; old profiles
   remain unclaimed.
4. `src/auth/rate-limit.ts` / `src/lib/logging.ts`: bounded per-peer endpoint
   throttling and privacy-safe security events.
5. Prisma passkey migration → `passkeys.ts` / `recent-proof.ts` →
   `passkey-schema.ts` / `passkey-routes.ts`: domain binding, device verification,
   fresh account proof and owned credential changes. Google remains recovery.
6. Corresponding `scripts/` auth, session, CSRF, passkey and logging tests.

## Verification and merge blockers

- Reviewed the staged snapshot in an isolated temporary directory with the
  existing frozen lockfile; no Next.js dependencies are included.
- `pnpm typecheck`: passed for backend and existing frontend configuration.
- Focused backend/auth ESLint and formatting: passed.
- Focused 14-file auth group: 33 passed, 8 skipped, 0 failed (41 total).
  Docker is stopped and no isolated test database is available. Database
  lifecycle, migration and passkey policy checks must be rerun before merge.
- Full `pnpm test` with local socket access: 63 passed, 3 failed, 8 skipped
  (74 total). The three `scripts/match_api.test.ts` validation cases submit
  anonymously and expect 400; the protected route now rejects before validation.
  Their fixtures need authenticated requests while retaining validation assertions.
  They were not edited or weakened for this push. This is a review checkpoint,
  not a merge-ready or production-ready release.
- Repository-wide lint still fails with 26 errors in pre-existing extraction,
  eligibility/public-page test and HTML-rendering files. Existing GitHub CI
  failures show these same locations. No assertions or lint rules were weakened.
- No new live Google or physical-passkey verification was performed in this
  checkpoint. The independently authored passkey storage fixture has previously
  documented transaction/ordering issues; it remains unchanged for its author.

## Branch order

Existing PRs are stacked: #4 public browsing → #5 Fastify → #6 guidance →
#7 authentication. All four were mergeable at inspection, but CI was failing.
Do not merge merely because there is no textual conflict. Resolve checks first;
merge the parent PR before its child. After each merge, inspect the child's base
and diff; if it still targets the merged feature branch, retarget it to `main`
and rerun checks. Preserve commit ancestry where possible; squash merges may
require rebasing descendants in separate clean checkouts.

Still separate: frontend migration/profile browser privacy, authorized internal
ingestion, production HTTPS/proxy review, all-device logout, and Redis plus the
one-minute cache and logout-coordination design. No session cache was added.
