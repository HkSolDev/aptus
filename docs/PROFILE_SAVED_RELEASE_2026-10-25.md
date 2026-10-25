# Account profile and Saved jobs release — 25 October 2026

## Execution contract

Finish and review the account profile/Saved jobs implementation, resolve failing
checks without weakening security assertions, validate migrations and real-session
ownership, then push the scoped release, wait for every CI job, merge to main,
and deploy the exact merged frontend/backend revisions. Verify production public
and authenticated flows, keep rollback references and record the outcome.
The user explicitly authorized this sequence. Worker improvements, exam targets
and recommendation features are excluded. The original dirty checkout is preserved.

## Release scope

- Authenticated GET/PUT profile with strict date/category/education validation,
  atomic education replacement, private responses and canonical round trips.
- Matching reads only the account-owned saved profile; storage outages return 503,
  while genuinely missing profiles return actionable 400. No matching profile writes.
- Account-owned, paginated Saved jobs with unique account/post membership,
  idempotent removal and race-safe duplicate-skipping insertion. Eight concurrent
  first saves must all return the same timestamp and produce one row.
- Frontend profile restore/update, Save/Remove and paginated Saved list using
  existing design components. Failed profile reads cannot enable blank-form saves.
- Account ID/session generations and per-job mutation versions reject stale async
  responses. Status batches drain at most 50 IDs per request; failures can retry.
- Last-page removal returns to the preceding valid page. No private browser storage.

## Auth test correction

The earlier report attributed the Google reauthentication 404 to Node 24 itself.
Further tracing disproved that conclusion: the request reached the correct route,
but the Google provider was absent. Better Auth generic OAuth performs discovery
at auth initialization. The passkey fixture installed its discovery mock only
later, in the reauthentication subtest, after earlier requests had already
initialized auth using real networking. The observed Node-version difference was
a timing difference, not proof that production needed a runtime upgrade.

`passkey-fixture.ts` now installs the deterministic Google mock before creating
auth and returns that fixture to the policy test. Every existing cross-account,
nonce, ownership, recovery and recent-proof assertion remains in place. The
Node 24 policy suite passes. No production auth protections were relaxed.

## Dependency security

Next 16.4.0 → 16.4.1 and Fastify 5.12.5 → 5.12.6. Bounded overrides pin patched
lodash, mysql2, source-map-js, Zod 4, Undici 7 and affected fast-uri branches.
`@prisma/config` alone uses deepmerge-ts 8.0.0: its changed deep Map merging is
not used by the app's plain-object Prisma config. Prisma generate/migrate and
database suites verify compatibility. No broad dependency-range upgrade was used.

The production audit reports zero known advisories after these patches. This is
a registry advisory check, not a claim that no undiscovered vulnerability exists.

References:

- [Next security update](https://nextjs.org/blog/nextjs-security-update-october-14-2026)
- [Deepmerge advisory](https://github.com/advisories/GHSA-ggr8-5vv4-36mx)
- [Deepmerge 8 release and compatibility changes](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0)

## Verification gates

- Frozen-lockfile installation under Node 24 in a clean worktree from current main.
- Typecheck, Next production build, lint and repository formatting.
- Full Node suite including real-session profile/Saved and opt-in search database.
- Full offline Python suite from main, without live source or paid provider calls.
- All browser suites, including desktop/mobile, signed-out and signed-in fixtures,
  real React state races and real built-Next navigation.
- CI builds/startup-checks frontend/API images; existing worker image gate retained.
- Production dependency audit is enforced in CI rather than silently bypassed.

Fixtures use disposable databases and fictional data. The feature integration
uses actual Better Auth session verification, signed cookies, expiry and revocation;
Google exchanges in auth tests remain deterministic fixtures, not live OAuth.
The standalone React harness explicitly replaces Next routing/link boundaries;
separate built-Next tests cover real navigation and responsive layouts.

## Rollout and rollback

Before release: frontend container image is
`yjkbdsihlnbpy1xnauk2890e:d5779421e4287c087220dbdfb3e5ad551f5fe21d`;
API is `localhost:5000/aptus-api:94ccc9d99d163981766ba82cdb5ac1c4e406fd19`.
Retain both. Auto-deploy is currently disabled on both Coolify resources.

1. Merge only after required CI is green; record exact merged SHA.
2. Build the API and migration images from a clean checkout at that SHA, with
   OCI revision labels and immutable tags. Frontend remains its existing Coolify
   Dockerfile resource and is queued at the exact merged commit.
3. Back up production PostgreSQL using a compatible PostgreSQL 18 client, verify
   the archive can be listed and record its private path/hash. Never print URLs,
   credentials, cookies or personal records.
4. Apply only the reviewed additive SavedJob migration with the migration image.
   Inspect existing migration history first; never reset or baseline production.
5. Deploy API through the normal Coolify queue. Verify liveness, database-backed
   catalogue and origin/session rejection before deploying the frontend.
6. Queue the frontend exact commit, verify both images/health and public routes,
   then exercise temporary fictional account profile/Saved ownership and persistence.
   Clean up only those explicitly created records; never modify real users/jobs.
7. Monitor sanitized errors, HTTP failures and latency for 15 minutes after rollout.

Rollback on failed health, persistent 5xx, broken public catalogue, failed account
isolation or critical authenticated flow. Restore the previous API tag through
Coolify; redeploy the retained frontend revision. The additive SavedJob table can
remain for rollback compatibility; do not drop user data as part of rollback.

Production deployment results are recorded separately after execution; these
instructions are not proof that deployment has occurred.

## Local pre-push gate results

Final scoped code: 129/129 Node and database tests passed, with zero skipped;
33/33 frontend/browser tests passed; all 375 offline Python tests passed.
Typecheck, lint, full formatting, Prisma schema validation, fresh migration deploy
and production dependency audit passed. The advisory audit reports zero at every
severity. The deprecated lodash 4.18.0 build was rejected in favour of 4.18.1.
CI and production rollout are still pending at this checkpoint.

## Pre-deploy contract review

Before changing production, a new regression reproduced that a stale client
could submit changed profile fields and receive HTTP 200 while the server matched
the previously stored profile instead. The matching endpoint now rejects any
nonempty legacy input with HTTP 409 and refresh/Save profile guidance (forged
ownership IDs still receive 400). Canonical matching accepts only `{}`.
The remaining legacy form caller explicitly PUTs its whitelisted profile first,
then sends an empty match body. A failed save cannot start matching.

Date, qualification and marks validation coverage moved to profile-save contract
tests rather than keeping obsolete validation behaviour inside matching. Existing
eligibility/manual-review assertions remain unchanged. The follow-up local gate
passed all 132 API/database tests (zero skips) and all 34 browser tests.
The earlier candidate images were built but not deployed; the rollout must use
the follow-up merged commit after its own green CI.

## Public-proxy transport correction

The first b9852a7 rollout passed staging but failed the public Save-job flow:
Chrome and the synthetic-account smoke both received HTTP 415. A real streaming
HTTP proxy regression reproduces rejection when the body is chunked and lacks a
content type. Save and Remove now send explicit JSON `{}` with
`Content-Type: application/json`; session, ownership and origin checks are unchanged.
The regression passes against real Fastify and a streaming Node proxy.

Both services were restored: API 94ccc9d and frontend d5779421. The frontend
rollback required publishing its retained local image to the local registry and
using Coolify's prebuilt-image queue. The original rollback tried a missing root
Dockerfile; a second attempt tried Docker Hub for a local-only image. The final
rollback finished with a healthy retained frontend. The additive SavedJob table
remains; no existing records were removed. Future frontend releases use explicit
local-registry image names and exact commit tags, with the internal API URL set
at image build time.

Validation: typecheck/lint and the streaming-proxy regression pass.
The initial full browser run passed 33 checks and failed one design-review search
interaction; that test passed alone unchanged. The full rerun passed all 34 checks, including that interaction unchanged. Live verification was pending at that checkpoint; the final results follow.

## Corrected release deployed and verified

PR #23 merged as `ca5b28936d7d07a4957ae38f8ef89b911188ac5f`. All eight PR checks
and all four main CI jobs passed (main run 40212425859): 133 Node/database tests
with zero skips, 375 offline Python tests, 34 browser checks, and zero known
production dependency advisories. Both production containers
run exact-commit local-registry images, with verified OCI revision labels and
healthy status. Coolify API deployment sz8lpbqbr5epxyumzqrfo2vx and frontend
jvsfozfmzcpmrdip1tjfaj4e finished.

Exact merged images passed 22 staging API checks and eight real Chrome flows.
A fresh private production backup restored successfully in isolated PostgreSQL 18
(SHA256 43f1e94b4e78cde2a7c91758eb166576d6e460a4791b760bc4654864d213291f).
Production migration history has zero pending migrations.
All 22 production authenticated API checks passed; fictional fixtures cleaned.
Chrome profile update/refresh passed and actual Save and Remove returned 200.
Public loading exceeded five-second operator assertions. With consistent 30-second
waits, the full browser profile update/refresh and Save/refresh/Remove/refresh
flow passed; fictional fixtures were cleaned. The 900-second production watch
passed: 24 rounds, 96 expected HTTP responses and no detected runtime errors.
Disposable staging and temporary release credential files were removed; verified
backups and exact rollback images are retained. Public jobs API latency remains
a documented performance follow-up, not a correctness claim or a measured field
percentile. Synthetic checks do not establish live Google OAuth consent or load
test coverage.

During the watch, a separate read-only worker inspection found the 10 PM run
published zero jobs. The old worker image94ccc9d retains13 capture holds with
needs_review/attempts3 from earlier DNS failures; the run skips fresh capture and
misreports completed. Fresh worker-image DNS checks now succeed. Worker state
was not reset and no provider calls or worker deployment were triggered. Recovery
requirements are recorded in the existing Notion worker tracker.
