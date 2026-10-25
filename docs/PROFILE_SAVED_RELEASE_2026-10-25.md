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
