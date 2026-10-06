# Aptus login implementation and review map

Updated: 6 October 2026

## Status

Implementation/review conventions: [CODING_STANDARD.md](CODING_STANDARD.md).
For this auth work the assistant implements; the developer reviews. Record
each completed slice here with actual files, checks, results and next steps.

The developer has authorized implementation after the learning review.
Branch: `codex/login`, based on `codex/public-jobs-auth` at `9c4048e`.
No merge or push was performed. Pre-existing uncommitted changes remain owned
by the developer and must not be bundled into auth commits automatically.

Authentication is NOT implemented yet. The developer approved Fastify and the
auth dependencies on 6 October. The setup checkpoint below records actual files
and checks; later auth slices remain proposed.

Current server: Fastify serves all existing application routes via `pnpm serve`.
The setup/startup checkpoints below are historical; the migration checkpoint
at the end supersedes their native-server and separate-review-command notes.

Learning diagram:
`/Users/mrblackghost/Work/ObsidianVault/03 Projects/Aptus/Aptus Login Flow.canvas`.
Add implementation cards there as slices become real, with links to the actual
files and tests: left to right within a stage, then down to the next stage.
Preserve learning cards and distinguish proposed, implemented and verified.

## Agreed behavior

- Anyone can browse public jobs without a login.
- Google sign-in creates one Aptus account; optional passkeys belong to that
  same account. No passwords, SMS or magic-link sign-in in this implementation.
- Backend-verified sessions determine identity; submitted profile IDs do not.
- PostgreSQL is the authoritative session store. Redis is a proposed cache,
  not a replacement for the database or a fourth identity source.
- The one-minute in-process Map and Promise locks remain parked. Do not silently
  enable cookie caching or trade immediate revocation for a cache TTL.
- Protect mutations against CSRF, enforce ownership, render scraped values as
  text, validate links separately, and keep credentials/applicant data out of logs.
- Credential changes require recent proof using an existing linked method.
  Google SSO redirects alone do not guarantee fresh human verification.
- Google is the current recovery fallback. Losing Google and every passkey has
  no defined recovery route yet; do not invent a support bypass.

## Identity-only database slice — 6 October 2026

Applied locally on 6 October 2026 after Docker became available. No login route
or account-claim feature was activated; existing data remained unchanged.

Review order:

1. `prisma/schema.prisma`: new `AuthUser` contains login identity, not DOB or
   category. Historical `User` remains the applicant profile to avoid breaking
   existing callers and education references. Its nullable, unique `authUserId`
   represents optional one-to-one ownership. Restrict deletion of an owner until
   explicit account/profile deletion policy is implemented.
2. `prisma/migrations/20261006100000_add_auth_identity/migration.sql`: additive
   table/column/index/foreign key only. No ownership default or backfill. Existing
   profile IDs, details and education rows remain untouched; ownership stays NULL.
3. `scripts/auth-models.test.ts`: checks identity fields against installed Better
   Auth 1.7.7, and checks schema/SQL ownership constraints. Prisma 7 compact runtime
   metadata omits nullable/default/unique details, so these checks also read source.
   These are contract checks, NOT evidence of database migration success.
4. `scripts/auth-profile-migration.test.ts`: opt-in PostgreSQL test using separate
   `TEST_DATABASE_URL`. Replays historical migrations in a transaction-local random
   schema, seeds fictional profiles/education, applies the new migration, verifies
   unchanged data and NULL ownership even after identity creation, then rolls back.

No automatic linking by email, name or submitted profile ID. New authenticated
accounts should create their own profile in the later protected-profile slice.
Old unclaimed profiles must not be exposed through authenticated account routes.
Any future transfer/import needs explicit trusted ownership proof; none is offered
here. Existing unauthenticated profile routes remain unsafe for public deployment.

Better Auth must later use `user.modelName: 'AuthUser'`. Session/provider-account,
verification and passkey tables are intentionally deferred to their own slices.
This identity-only schema is not a complete Better Auth database.

Checks: Prisma schema validation/client generation and strict type checks passed;
targeted new-test lint passed. Backend: 41 passed, one database integration test
explicitly skipped (no test URL). Browser: 9 passed. Existing full lint still has 33 errors.
Initial test failures exposed omitted Prisma metadata; assertions were moved to
the schema/SQL rather than removed. Socket/browser tests required sandbox retry.

IMPORTANT: the generated client now expects `User.authUserId`. Before using
profile routes against an existing database, review pending migrations and apply
this migration; otherwise Prisma reads may fail on the missing column. Do not
reset the database. Back up the database before applying schema changes.

Follow-up verification: started the existing PostgreSQL container without
replacing its volume. The preservation integration test passed in a disposable
database, which was then removed. It preserved a fictional profile and education
and left ownership NULL after creating an identity. Only this migration was
pending; it was applied after a private backup at
`/private/tmp/aptus-auth-backup.HE6zDf/aptus-before-auth.dump`.
Before/after database fingerprints matched for User, Education, Source and Post.
Actual database: zero profiles/education rows, five sources, fourteen posts.
Therefore actual job preservation was measured; old-profile preservation was
verified on fictional data, not real applicant rows. No profiles were claimed.
The earlier missing-column warning is resolved for this local database only;
other environments still need the migration.

Next: add the remaining Google/session models and backend configuration.
No dependency, Redis, cache lock, commit or push added.

## Core-auth database slice — 6 October 2026

Applied locally; database only. Google sign-in and private-route protection
remain inactive. Passkeys and Redis are still separate later slices.

Review order:

1. `prisma/schema.prisma`: `AuthSession` links an opaque session token and expiry
   to AuthUser; `AuthAccount` links a provider ID/account ID pair to AuthUser;
   `AuthVerification` stores expiring library verification records. Checked all
   core fields against installed Better Auth 1.7.7 `getSchema`, not only web docs.
   Later auth configuration must set user/session/account/verification modelName
   to AuthUser/AuthSession/AuthAccount/AuthVerification respectively.
2. `prisma/migrations/20261006110000_add_auth_core/migration.sql`: transactional,
   additive tables only. Unique session token and unique provider/account pair;
   foreign keys reject missing owners and cascade session/provider records when
   an identity is deliberately deleted. The existing profile-owner deletion
   restriction still applies. UserId/identifier indexes support lookups; expiry
   indexes support later cleanup, not automatic expiry enforcement.
3. `scripts/auth-core-models.test.ts`: pinned-library core field/type/nullability
   and uniqueness contract checks. Existing identity/profile tests unchanged.
4. `scripts/auth-core-migration.test.ts`: actual PostgreSQL tests for unchanged
   fictional old profile/education, duplicate session-token rejection, missing
   owner rejection, provider identity uniqueness across two different owners,
   session deletion leaving the provider account intact, and identity deletion
   removing associated sessions/accounts. Uses a disposable database and a
   transaction-local schema; fake values only. It does not test actual login,
   cookie rejection after logout, expiry decisions or OAuth verification.

Optional accessToken/refreshToken/idToken/password columns are the library's
core contract. They do NOT enable password sign-in or JWT app sessions. Google
provider tokens are distinct from the Aptus session. Decide supported non-storage
or encryption options before enabling the provider; never expose these fields
in public responses/logs. Optional session IP/userAgent fields do not authorize
analytics or metadata collection; configure collection policy in the auth slice.
Database expiresAt is a stored time; auth code must enforce it and cleanup must
be scheduled separately. No expiry-policy or account-linking behavior was invented.

Checks: schema validation/client generation and strict typecheck passed; targeted
new-test lint passed. Backend 43 passed, with two integration tests explicitly
skipped in the default suite; BOTH ran separately against PostgreSQL and passed.
Browser 9 passed. Full lint still has the same 33 unrelated errors.
Applied the sole pending migration after private backup at
`/private/tmp/aptus-auth-core-backup.sO7o42/aptus-before-auth-core.dump`.
Before/after fingerprints of User/Education/Source/Post/AuthUser matched.
Prisma database-to-schema diff reported no difference. Disposable test databases
were removed; no real applicant records were used in tests. No new dependency,
auth route, independent security review, commit or push.

Next: backend environment/origin/Google configuration and library handler,
then verify session persistence/expiry/revocation and protect private profiles.
Keep production deployment blocked until those controls and dependency advisory
review are complete.

## Dependency approval

Proposed: `better-auth`, `@better-auth/passkey`, and, if required by the pinned
release, `@better-auth/prisma-adapter`. Redis integration also needs an approved
client such as `redis`. Check compatible versions and advisories before pinning.

Reason: delegate OAuth/session and WebAuthn protocol handling to maintained
libraries instead of creating authentication or cryptography ourselves.
Use Fastify with TypeScript and existing Prisma; no Express or frontend framework.
The native HTTP dispatcher has been replaced by Fastify; no second server command.
Verify installed source and behavior, not merely documentation claims.

References: [Prisma adapter](https://better-auth.com/docs/adapters/prisma),
[passkeys](https://better-auth.com/docs/plugins/passkey),
[sessions](https://better-auth.com/docs/concepts/session-management).

## Small implementation slices / reading order

1. **Configuration and identity models.** Small `src/auth/` modules for approved
   library configuration and environment validation. Separate login identity
   from applicant details so Google sign-in does not require DOB/category.
   Preserve existing profiles through an explicit migration; never attach them
   to accounts by matching an untrusted email or browser-submitted ID.
2. **Google and sessions.** Mount the library handler in `src/server.ts`;
   configure trusted origins, cookies and fixed safe post-login destination.
   Prove session persistence, expiry and revocation before adding caching.
3. **Private profile boundary.** Shared session guard, server-owned profile
   routes, and updates to matching/explanation callers. Remove reliance on
   sensitive browser storage without silently importing old data into accounts.
4. **Passkeys and fresh proof.** Registration, authentication and removal;
   exact RP/origin, expiring single-use challenges and user verification.
   Gate all credential-management endpoints, including direct library routes.
5. **Abuse controls and safe logs.** Backend request limits/capped cooldown,
   trusted-proxy configuration, safe event/reason/request reference only.
   Dozzle remains a separately reviewed viewer, not public infrastructure.
6. **Redis cache and logout.** Verify library storage semantics, outage fallback
   and late-cache-fill behavior against PostgreSQL revocation. Do not assume
   enabling secondary storage automatically delivers the intended guarantees.
7. **UI and final review.** Small TypeScript modules, accessible sign-in/settings
   controls, public browsing unchanged, then actual browser and integration tests.

Prefer focused modules rather than one large server file. Comments explain
security decisions and non-obvious constraints, not every assignment.
Name actual file paths here after creating each slice; do not document imaginary
files as implemented. Keep unrelated extraction/matching refactors out.

## Test contract — no weakening tests to obtain green results

Write observable behavior checks using illustrative identities and the real
configured handler/storage where feasible. Mocks do not prove OAuth or WebAuthn.
If a test fails, investigate implementation or a demonstrably incorrect test;
document the reason rather than deleting assertions, skipping it or faking success.

- Signed-out browsing works; private profile access fails.
- Account A cannot read/update account B, including forged body IDs.
- Invalid, expired, replayed or browser-mismatched login attempts are rejected.
- Identity verified but session persistence fails: no successful Aptus login.
- Invalid/expired/revoked session rejected; copied cookie fails after logout.
- Missing/invalid required CSRF proof produces no mutation.
- Unsafe return destinations and origins rejected.
- Passkey cancellation leaves account unchanged; wrong challenge/origin/key,
  expired/replayed proof and insufficient recent authentication are rejected.
- Rate-limited requests cannot bypass cooldown by ignoring frontend countdown.
- Redis outages and concurrent logout/cache fills do not restore revoked sessions.
- Logs/errors contain no credentials, callback query strings or applicant fields.

Report unit, database integration, browser and live-provider results separately.
Do not claim live Google/passkey verification without actually completing it.
Do not request secrets in chat; the developer supplies protected local config.

## Policies still to finalize

Session/renewal/absolute lifetimes; fresh-proof window and first-passkey policy;
exact rate limits; one-device versus all-device logout; final credential removal;
Redis failure/revocation guarantees; production RP/origin/proxy configuration.
Propose conservative defaults explicitly before implementing them.

## Coding safeguards checkpoint — 6 October 2026

Documentation/tooling only; authentication has not been implemented by this slice.
`CODING_STANDARD.md` is linked from Agents.md, claude.md, the always-on safety
rule and the existing canvas. No dependency or skill was installed.

- Backend and frontend strict mode were already enabled; left unchanged.
- `eslint.config.js` now enables recommended type-aware checks for `src/` and
  `scripts/`. Frontend retains existing lint checks and strict type checking.
- `package.json` adds `pnpm typecheck` for both TypeScript projects.
- Type checking and targeted formatting checks passed. Existing tests: 29 passed,
  after retrying with permission for temporary localhost servers. No assertions
  or tests were changed. These are existing application tests, not auth coverage.
- `pnpm lint` currently fails: 55 type-aware findings in backend/scripts plus
  7 existing findings in unrelated outputs. Do not suppress them or claim green
  lint. Review findings in a separate scoped slice before implementing auth.
- Canvas JSON and edge references are valid; visual rendering was not inspected.

Next: review the lint findings without unrelated rewrites, then resume the
approved auth slices after dependencies and remaining policies are confirmed.

## Setup checkpoint — 6 October 2026

Active slice: dependency/tooling setup and a testable Fastify foundation, NOT full
login implementation. Existing branch `codex/login`; no merge, commit or push.
Unrelated dirty files are preserved.

Exact pins: `fastify` 5.12.5; `better-auth`, `@better-auth/passkey` and
`@better-auth/prisma-adapter` 1.7.7; `@better-auth/utils` 0.4.2. The explicit
utility pin fixes a root peer mismatch without disabling dependency checks.
Fastify supplies routing/validation, Better Auth owns OAuth/sessions, passkeys
use the WebAuthn plugin, and the adapter reuses Prisma. The lockfile records
transitive dependencies. No Redis client, autoloader, TypeBox, JWT plugin or new
ORM was added. Existing strict TypeScript/ESLint/Prettier setup was retained.

Installed skill: `fastify-best-practices` from
[mcollina/skills](https://github.com/mcollina/skills/tree/main/skills/fastify).
Read it and relevant rules fully. Use structure/schema/testing guidance only
where compatible; verify pinned sources. Aptus rules override conflicting auth
examples, extra dependencies and type-stripping recommendations.

### Actual review order

1. `package.json` / `pnpm-lock.yaml`: dependency pins and peer fix.
2. `src/app.ts`: builds Fastify without listening or DB access. Request logging
   stays off until safe audit events exist; proxy trust stays off. Explicit body
   and request limits, no silent removal of extra schema properties, generic
   errors. Routes must declare `additionalProperties: false` to reject extras.
3. `src/routes/health.ts`: public liveness with a full response schema; NOT
   database/auth readiness.
4. `scripts/app.test.ts`: four real-instance inject tests, health without a
   session, safe 404/500 output and inactive auth routes. Initial missing-module
   test failed before implementation; assertions were not weakened.
5. `src/auth/README.md`: planned module ownership, not fake auth code.

`src/server.ts` and `pnpm serve` are unchanged. The factory is not yet mounted
in the application. Existing profile routes are still NOT safe for public
deployment; installing packages does not protect them.

### Checks / gates

- Strict type checks and targeted lint pass.
- Backend: 33 passed (29 existing + 4 setup checks). Web: 9 passed, including
  browser and no-JavaScript browsing flows.
- Full lint: 62 existing findings remain; no suppression or unrelated fixes.
- Production dependency audit: 8 advisories, 4 high / 4 moderate, through the
  Prisma peer graph: lodash, deepmerge-ts, mysql2, fast-uri, source-map-js.
  Review exposure and compatible fixes before auth activation; no blind major
  upgrades or overrides were applied.
- No live Google/passkey, auth DB integration or independent security review
  completed. No secrets requested or DB schema modified.

Next: developer reviews setup; resolve advisory exposure and existing lint;
migrate existing routes to Fastify preserving contracts; then identity models
and Google sessions. Redis/local caches and concurrency remain later slices.

## Startup checkpoint — 6 October 2026

Small review slice; no login implementation or dependency changes.

- `src/start-server.ts`: starts the existing Fastify factory on loopback only,
  validates `PORT` (default 8081), fails rather than changing an occupied port,
  and closes on SIGINT/SIGTERM with a ten-second shutdown deadline. Importing
  the module does not start a listener or install signal handlers.
- `package.json`: `pnpm serve:fastify` runs this review server. It currently
  serves `/health` only, not the frontend, jobs or authentication.
- `scripts/start-server.test.ts`: configured-port validation, actual HTTP health
  response/close and occupied-port failure. No database or provider mocks needed.
- Strict type checks and targeted lint passed; all 36 backend tests passed after
  allowing temporary localhost listeners. Initial socket tests failed because
  the sandbox denied listening, not because assertions needed changing.
- All nine existing web/browser tests passed, including no-JavaScript browsing.
  Full-project lint still reports the same 62 pre-existing errors; none were
  suppressed. Signal handling is implemented; the tests verify `close()`, not
  OS-signal delivery. No live authentication checks were performed.
- Existing `src/server.ts` and `pnpm serve` remain unchanged: jobs, static/HTML
  pages, matching, explanation and ingestion still depend on the native server.
  Do not remove it until route-by-route parity checks pass and startup switches.

Next review slice: move public jobs into Fastify with the same pagination,
public-field selection and failure behavior. Then migrate public pages and
remaining APIs; remove obsolete native dispatch only after that verification.
Authentication activation and unresolved audit/lint gates remain separate work.

## Unified Fastify migration — 6 October 2026

- `pnpm serve` builds browser assets and starts `src/server.ts`, now Fastify.
  Default port remains 8080; occupied/invalid ports fail explicitly. Loopback
  binding is deliberate while existing private-route security remains unfinished.
- `src/app.ts` registers health, public routes and the three existing POST APIs.
  `src/routes/public.ts` handles job listing, detail pages, homepage and allowed
  CSS/JS assets. Public browsing and no-JavaScript HTML are preserved.
- Existing route modules now take Fastify request/reply objects. Fastify owns
  JSON parsing/body limits; the old event-based body reader and Node dispatcher
  were removed. `src/lib/http.ts` retains only the shared reply helper.
- Removed the temporary `src/start-server.ts` and `serve:fastify` command; startup
  tests now import the single real entry point. Deleted code is reproducible from
  the previous setup discussion/Git history where tracked.
- Tests use `inject()` or a listening Fastify instance rather than handcrafted
  Node request streams. The empty-JSON test still requires 400, now with the
  generic parser error because Fastify rejects the body before the route runs.
  Existing business assertions remain intact. Added malformed/non-object JSON,
  oversized-body and GET-only API regression checks.
- Raw exception logging was removed from migrated handlers to avoid disclosing
  request/database details. Safe structured audit logging remains future work.
- Frontend `frontend/api.ts` already shares fetch, timeout, status and response
  shape handling. No Axios or other dependency was added.
- Verification: all 39 backend tests and nine browser tests passed. Strict
  TypeScript and lint on migrated implementation modules/new inject tests pass.
  Existing type-aware findings in database-fixture tests and unrelated files
  still prevent a clean full-repository lint; no rules were disabled.

This is an HTTP migration, not an authentication implementation. Profile-ID
ownership and internal-ingestion authorization remain unresolved; do not deploy
publicly. Next: resolve security/advisory gates, then implement identity models
and Google sessions against the agreed plan. Redis remains deferred.

## Review branches — 6 October 2026

GitHub PRs #2 (frontend) and #3 (source/backend foundation) are merged. Remaining
completed work is ordered as public jobs, Fastify migration, project guidance,
then auth database models. Each branch targets its predecessor until that PR
merges; no automatic merge is authorized. Google sign-in remains unimplemented.

The combined local code passed strict TypeScript checks, 43 backend tests and
nine browser tests. Two database integration tests were skipped in this run;
their earlier separate results are recorded above. Full lint reports 33 errors,
including existing fixture findings exposed by stricter checking and unrelated
local video outputs. No lint rule or test assertion was weakened for this push.

Uncommitted Python age-validation changes stay local for separate review: the
current cache/payload path can conflate Male with Female through substring
matching and may apply post-specific age facts too broadly. Editor settings
and unrelated video outputs are excluded from the review branches.
