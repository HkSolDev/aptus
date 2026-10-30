# Home deadline-sort performance — task audit

Task: Aptus Home deadline-sort performance investigation and a measured
public-cache experiment. Senior-engineer, smallest correct solution.
Spinner / disabled-dropdown pending feedback is a separate task and is
preserved, not reworked here.

## 1. Isolation and baseline (verified 2026-10-30)

- Original checkout: `/Users/mrblackghost/Work/Projects/aptus-next`, branch
  `codex/next-aptus-work`, HEAD `d930a69e0093a440ef5ad99c92a6ab19326cec17`,
  heavily dirty (staged, unstaged and untracked work from other tasks).
  Preserved untouched: no stash, reset, clean or edit was performed there.
- Verified agreed baseline: local `origin/main` at
  `5e3b47c23631e5877a395213971cd2313a76b295`
  (`feat(frontend): add persistent light and dark theme toggle`). It contains
  the merged sort release PR #27 (`cf98954`, sort commit `b45c1ed` /
  verification `44d5a0a`) and the theme work on top. This is the latest
  integrated, reviewed line that includes the existing pending feedback.
- Baseline freshness boundary: `origin/main` is a local remote-tracking ref.
  It was **not** freshly fetched in this session, so it is not claimed to be
  the current remote or deployed revision.
- Dedicated worktree: `/private/tmp/aptus-home-deadline-sort-performance`
- Branch: `codex/home-deadline-sort-performance` (new, from `origin/main`)
- Baseline SHA (full): `5e3b47c23631e5877a395213971cd2313a76b295`
- Existing related worktrees were inspected, not modified:
  `/private/tmp/aptus-sort-investigation` (`codex/agent2-sort-and-theme`),
  `/private/tmp/aptus-agent2-sort-verification`
  (`codex/agent2-sort-verification-handoff`),
  `/private/tmp/aptus-sort-ingest-release-20261028`
  (`codex/sort-ingest-release-20261028`),
  `/private/tmp/aptus-frontend-theme-toggle`,
  `/private/tmp/aptus-admin-review-review-fixes`, and the admin-review sibling
  `/Users/mrblackghost/Work/Projects/aptus-admin-review-worker-validation`.
  No overlap file was edited in any of them.
- Nothing pushed, merged or deployed. No secrets, environment values,
  credentials, cookies or authorization headers were read or printed.

### Owned files (recorded before editing)

Owned for this task, in the dedicated worktree only:

1. `docs/agent-progress/home-deadline-sort-performance.md` (this audit)
2. Candidate, only if the cache experiment is justified by measurement:
   `components/jobs/catalogue-grid.tsx` (`fetchPublicJobs` only)
3. Candidate, later slices only and after inspection of the existing
   publication/auth boundaries: one invalidation route/handler reusing the
   existing internal-auth convention, plus its focused test.

Not owned / do not change unilaterally: shared contracts in `contracts/` and
`docs/contracts/`, Prisma schema/migrations, the sort control and its pending
feedback (`components/jobs/job-search-controls.tsx`), theme files, admin-review
files, ingestion logic beyond a post-commit invalidation notification hook if
that slice is reached and agreed.

## 2. Guidance and contracts read

- `Agents.md` (repo root): multi-agent coordination, `pnpm`, Next.js version
  warning (read installed Next docs before choosing APIs).
- `docs/AGENT_CONTRACT_PROTOCOL.md`, `docs/contracts/README.md` (index read;
  no shared contract change is proposed by this task).
- `docs/CODING_STANDARD.md`, `.cursor/rules/aptus-coding-safety.mdc`.
- `docs/PRODUCT_CHECKPOINT.md` (24 Oct checkpoint is dated; treated as intent,
  code verified separately).
- Prior records: `docs/agent-progress/agent-2.md`,
  `docs/PERFORMANCE_AUDIT_2026-10-25.md`,
  `docs/SORT_VERIFICATION_HANDOFF_2026-10-28.md`,
  `docs/RELEASE_SORT_INGEST_2026-10-28.md` (in baseline history).
- Installed Next.js docs read in the original checkout (`next@16.4.0` there;
  baseline `package.json` pins `16.4.1` — minor version skew noted, cache APIs
  below exist in both lines and must be re-checked against 16.4.1 before use):
  `01-app/01-getting-started/08-caching.md` and `09-revalidating.md`.
  Key facts: this app does **not** set `cacheComponents`, so the previous
  model applies (`fetch` with `next: { revalidate, tags }`,
  `revalidateTag(tag, 'max')` stale-while-revalidate semantics). Enabling
  Cache Components would be a larger, unrequested change and is not proposed.

## 3. Supplied investigation — verification status

Claim source: prior Agent-2 sort investigation and verification records plus
their HAR/trace artifacts. Treated as claims, verified below.

### Artifacts actually present (complete inventory)

Local fixture HARs only; **no production HAR was found** in the primary
checkout or any inspected worktree:

| Artifact | Entries | Home document | Home sort RSC |
|---|---|---|---|
| `aptus-agent2-sort-verification/outputs/traces/baseline-desktop.har` | 24 | 17.9 ms, 200 | `sort=furthest`, 4.0 ms |
| `aptus-agent2-sort-verification/outputs/traces/baseline-mobile-throttled.har` | 25 | 137.3 ms, 200 | `sort=furthest`, 105.8 ms |
| `aptus-agent2-sort-verification/outputs/traces/candidate-desktop.har` | 24 | 12.4 ms, 200 | `sort=furthest`, 23.4 ms |
| `aptus-agent2-sort-verification/outputs/traces/candidate-mobile-throttled.har` | 21 | 138.6 ms, 200 | `sort=furthest`, 106.0 ms |
| `aptus-agent2-sort-verification/outputs/traces/sort-controlled.har` | 24 | 15.8 ms, 200 | `sort=furthest`, 2.5 ms (held/released by fixture) |
| `aptus-sort-ingest-release-20261028/outputs/traces/sort-controlled.har` | 27 | 16.0 ms, 200 | `sort=furthest`, 2.2 ms (held/released by fixture) |
| `aptus-sort-investigation/outputs/traces/sort-interaction.har` | 23 | 14.9 ms, 200 | `sort=furthest`, 2.5 ms |

All URLs are loopback fixture hosts (`127.0.0.1`, ephemeral ports) with 6
representative fixture posts; no cookies, authorization or personal data are
present in the saved evidence used here (only paths, status and timings were
extracted; response bodies were not copied into this file).

### What this does and does not establish

- Every HAR contains exactly **one** sort RSC request, always
  `sort=furthest`. There is **no** `sort=soonest` RSC request in any complete
  HAR; the initial document request carries no explicit sort and therefore
  uses the server default `soonest` (`frontend/public-job-filters.ts`:
  `sort = params.get('sort') ?? 'soonest'`).
- Therefore a claim comparing soonest vs furthest production latency, or any
  "slower soonest requests omitted from the summary", **cannot be verified or
  refuted** from the supplied artifacts. Sample count for soonest-as-a-sort-
  action in the artifacts is 0. This boundary is recorded rather than filled
  with invented production numbers.
- The fixture timings above are local, gated/controlled where noted, and must
  not be presented as production latency. The candidate-desktop `furthest`
  RSC (23.4 ms) is slower than baseline-desktop (4.0 ms) in these single
  samples — another reason single samples are not used as a verdict.
- Historical `docs/PERFORMANCE_AUDIT_2026-10-25.md` (Next 16.4.0 standalone,
  fixture API, `d930a69`) is a lead only, not current evidence.

### Deployed revision

- The task-provided production SHA from the prior record,
  `526f597c09cb389269b2e31cda74255cfbecf4c8`, resolves locally and is an
  ancestor of the baseline (`526f597` → sort/ingest release → theme →
  `5e3b47c`). Source equality for the affected paths between `526f597` and
  the integration candidate was shown in the prior record.
- No read-only production access (SSH, registry, live site) is available in
  this session, and earlier probes failed DNS for `aptus.in`. The deployed
  revision, replica count, environment and database contents are therefore
  **unverified**. No production conclusion is drawn.

## 4. Request path trace (code-verified, baseline `5e3b47c`)

sort selection → browser request → Next.js fetching → API handler →
connection acquisition → transaction/query execution → response processing →
sorted jobs visible

1. `components/jobs/job-search-controls.tsx` (`JobSortControl`, already-fixed
   pending feedback — spinner/disabled state; not reworked): select change
   submits via Next form navigation to `/?sort=…#jobs`.
2. `app/page.tsx`: awaits `searchParams`, validates with `readJobFilters`
   (normalization: `q` trimmed/NFC, ≤100 chars; qualification allow-list;
   `sort ∈ {soonest, furthest}`, default `soonest`; page 1–10000), then
   `await fetchPublicJobs(page, filters)` before rendering. No `loading.tsx`
   / `Suspense` boundary is added by this task.
3. `components/jobs/catalogue-grid.tsx:26-43` `fetchPublicJobs`: builds
   `jobSearchParams(filters, page)` + `pageSize=6`, then
   `fetch(${BACKEND_INTERNAL_URL}/api/jobs?…, { cache: 'no-store' })`.
   Upstream failure or non-OK returns `null`, rendered as the existing
   "Jobs are temporarily unavailable" notice — this behavior must be kept;
   an upstream failure must never become a cached empty success.
4. Next rewrite `/api/:path*` → private Fastify API (`next.config.ts`).
   API handler `src/routes/jobs.ts:handleJobs`: strict page/pageSize/filter
   validation; 400 on invalid, 503 on storage failure.
5. `src/lib/public-jobs.ts:listPublicJobs`: builds `where` =
   `activeApplicationWhere()` (India date: `Asia/Kolkata` `YYYY-MM-DD`,
   `applicationLastDate IS NULL OR >= today 00:00Z`) AND optional keyword /
   qualification conditions; `orderBy` = `applicationLastDate`
   asc (`soonest`) / desc (`furthest`), `nulls: 'last'`, tie-break
   `id: 'asc'`. Runs a `RepeatableRead` transaction
   (`maxWait: 10_000`, `timeout: 5000`): sequential `count` then `findMany`
   (`skip`/`take`, `select: publicFields`). Connection acquisition is inside
   Prisma/`$transaction`; there is no per-step timing or correlated
   Next↔Fastify request ID in the current code, so layer timings cannot be
   produced without temporary instrumentation (not yet approved).
6. Response JSON `{ data, pagination }` is rendered by `CatalogueGrid` /
   `JobCard` (server components).

### Database facts (not causes)

- `prisma/schema.prisma` `model Post` has **no** `@@index` on
  `applicationLastDate` (only `@@unique([extractionCandidateId,
  candidatePostIndex])`); no migration creates one. This is a fact about the
  schema, **not** an established cause of any observed latency. No query plan
  has been run; table size in production is unknown. No index change is
  proposed by this task.

### Causes explicitly NOT established

Missing deadline index, database execution time, connection-pool waits,
proxy buffering and predicted cache-hit latency are all unproven hypotheses
until Slice 1 measurement. Nothing above is presented as a cause.

## 5. Deployment topology relevant to caching (to confirm in Slice 1/2)

- Frontend: `deployment/frontend.Dockerfile`, Next standalone
  (`output: 'standalone'`, `node server.js`, port 3000), single Coolify
  resource per `docs/RELEASE_DEPLOYMENT.md` ("All three services use
  independent Coolify resources"). No replica/scale configuration was found
  in the repo. If there is exactly one frontend replica with a persistent
  container filesystem, the built-in Next fetch/Data Cache is stored on that
  instance (`.next/cache`) — shared by all requests to that instance, lost on
  redeploy/recreate, and **not** shared if the service is ever scaled to
  multiple replicas. This must be confirmed before the experiment is kept.
- API and frontend are separate services; publication changes commit in the
  API/worker path, so invalidation must cross from the API side to the Next
  server (an authenticated internal notification), unless Slice 3 inspection
  shows an existing shared mechanism.

## 6. Experiment plan with prediction checkpoints

Work stops at each checkpoint for the user's prediction. Silence is not
approval.

### Slice 1 — Verify baseline and obtain correlated measurements

- Narrow question: under matching local conditions (same fixture/API data,
  same sort/filter/page), where does the sort-request time actually go —
  Next RSC handling, Next→API fetch, API total, or rendering — and how much
  run-to-run variance is there?
- Planned change: none to application behavior. Run the existing local
  stack (built Next + fixture/real API as available) and record repeated
  `soonest` and `furthest` requests for page 1 (and a page-2 check),
  including the slower samples; add temporary, removable timing logs only
  if needed to split Next fetch vs API total, and remove them after.
- Expected observable result: a table of individual timings per sort with
  median and range, a statement of which layer dominates (or that no layer
  dominates locally), and whether a public server cache could plausibly
  help at all locally.
- **Status: awaiting user prediction (Checkpoint 1). Not run yet.**

### Slice 2 — One public server-cache experiment (only if Slice 1 supports it)

Design fixed in advance so the result is interpretable:

- Mechanism: existing Next `fetch` Data Cache in `fetchPublicJobs` —
  `fetch(url, { next: { revalidate: 60, tags: ['jobs'] } })` replacing
  `cache: 'no-store'`. No new dependency, no Cache Components flag.
- Cache identity (all normalized inputs that can change the response):
  normalized sort (`soonest`/`furthest`), normalized `q`, normalized
  qualification, page, `pageSize=6`, and the India calendar date
  (`Asia/Kolkata` `YYYY-MM-DD`). The date enters the key because
  `activeApplicationWhere()` changes meaning at IST midnight; including it
  makes rollover produce fresh entries instead of serving yesterday's set.
  All entries share the single tag `jobs`.
- Freshness: `revalidate: 60` seconds. Rationale: public catalogue data
  changes only on reviewed publication (batch events, not continuous user
  writes), so 60 s bounds ordinary staleness tightly while still absorbing
  repeated sort/filter browsing. Maximum expected staleness: 60 s after a
  change that arrives without an invalidation notification; with Slice 3
  invalidation, stale-while-revalidate may still serve one stale response
  while refreshing in the background (per installed Next docs for
  `revalidateTag(tag, 'max')`).
- Failure behavior: upstream non-OK/network failure still returns `null`
  and the existing error notice. `fetchPublicJobs` must not convert a
  failure into an empty successful JSON body, and Next must not be given a
  cacheable 200 on failure — the current `null`-on-error shape is preserved
  (Next caches the fetch result only on success of `fetchPublicJobs`'s
  upstream call as coded; this is verified in the experiment).
- Never cached: personalized results or user-specific eligibility. This
  path is the public catalogue only; profile/match/saved data are out of
  scope and untouched.
- Ordering semantics and API shape unchanged.

### Slice 3 — Authenticated post-commit invalidation (later, separate)

- Notify invalidation only after a relevant publication change commits.
- Reuse the existing internal authentication convention (to be read from the
  ingestion/publication boundary before naming any endpoint).
- Notification is retry-safe (idempotent tag invalidation); a failed
  notification must not fail or misreport the publication. If no durable
  retry mechanism exists, document the gap and obtain agreement before
  adding infrastructure.
- Verify with real Next semantics: `revalidateTag` is
  stale-while-revalidate, not instant global refresh.

### Slice 4 — Warming (only after invalidation is demonstrated)

- Warm only an explicitly listed small set of common public page-one
  entries (e.g. default `soonest` page 1 and `furthest` page 1, no filters),
  reusing the same normalization/fetch path. Handle repeats, failures
  (observable, never a cached empty success) and IST date rollover. No
  general queue framework.

## 6b. Later-slice boundary inspection (read-only prep, 2026-10-30)

Done while Checkpoint 1 awaits a prediction; no experiment was run and no
application file was changed by this prep.

### Publication and internal-auth boundary (for Slice 3)

- Internal ingestion endpoint: `POST /api/internal/ingest` in `src/app.ts`
  (wired with `onRequest: requireIngestToken(env)`), handled by
  `src/routes/ingest.ts`, which calls `ingestReviewedCandidate(body)` in
  `src/routes/reviewed-ingest.ts`.
- Existing internal-auth convention to reuse: `src/auth/require-ingest-token.ts`
  — `Authorization: Bearer <token>`, token from env or a token file (never
  both), 32–512 chars of `[A-Za-z0-9_-]`, SHA-256 + `timingSafeEqual`
  comparison, 503 when unconfigured, 401 on mismatch, `cache-control:
  no-store` on responses. Any cache-invalidation notification must follow
  this same convention; no new auth scheme will be invented. (Token values
  were not read or printed.)
- Publication commit point: `publishExtractionCandidate` in
  `scripts/publish-extraction-candidate.ts` runs inside
  `database.$transaction(...)` (source upsert, unrelated-publication guard,
  per-post upserts). `ingestReviewedCandidate` first stores the candidate,
  then publishes. A notification may only be sent **after**
  `ingestReviewedCandidate` resolves successfully in the route handler —
  never inside the transaction and never on a rejected submission.
- Legacy ingestion (`src/routes/ingest.ts` also handles the legacy path with
  its unusable-batch guard) can also change published posts; whether it is a
  "relevant publication change" for invalidation must be decided explicitly
  in Slice 3, not silently included or excluded.
- Durable retry: no API-side outbox/queue for an API→Next notification was
  found in `src/`. The worker's Python recovery machinery
  (`services/ai/recovery_queue.py`, `stage_retry.py`,
  `extraction_checkpoint.py`) covers pipeline stages, not a post-commit
  cache notification from the API. This is the documented gap Slice 3 must
  surface for agreement before adding any infrastructure; the fallback
  contract is: notification failure is logged/observable, publication still
  reports success truthfully, and the 60 s freshness bound caps the harm.

### Existing cache precedent in the codebase

- `app/jobs/[id]/page.tsx:fetchJobDetail` already uses the installed Next
  fetch cache: `fetch(url, { next: { revalidate: 60 } })` (no tags today).
  The Slice 2 design (same mechanism, plus `tags: ['jobs']` and an
  IST-date-bearing key) therefore reuses an existing, shipped facility
  rather than introducing a new one.
- All other server fetches inspected (`app/profile/page.tsx`,
  `components/jobs/catalogue-grid.tsx`, profile/saved-jobs client APIs) use
  `cache: 'no-store'`, correctly for personalized data. Only the public
  catalogue fetch is a cache candidate.

### Existing test coverage relevant to §8 verification

- `scripts/jobs.test.ts` (sort parsing incl. duplicate `sort` rejection,
  null-deadline shape, `asc`/`nulls: 'last'` ordering expectation),
  `scripts/application-deadline.test.ts` (IST date boundary, null deadlines),
  `scripts/public-jobs.test.ts`, `scripts/public-job-search.integration.test.ts`,
  `tests/sort-verification.test.ts` (pending feedback, race, history,
  non-JS), `tests/next-navigation.test.ts`. These are the suites Slice 2–4
  verification must run unmodified, plus any new focused cache test.

## 7. Risk register (production-risk review)

To be filled with evidence as slices run. Format per item: confirmed bug or
unresolved concern, concrete trigger, code evidence/reproduction,
likelihood 1–10, impact 1–10, risk = likelihood × impact, smallest justified
fix. Below 5: document only. 5 or above: recommend a targeted fix.
Security/privacy/data-loss/correctness violations are flagged regardless.

| # | Item | Status | L | I | Risk | Action |
|---|---|---|---|---|---|---|
| R1 | No Post deadline index exists in schema | Fact, cause unproven | — | — | — | No change without Slice-1 query evidence |

## 8. Tests and verification

Nothing run yet in this worktree. Slice 1 will record exact commands,
sample sizes, individual results, median and range, and will keep local
findings strictly separate from deployed findings.

## 9. Handoff (to complete)

- Baseline SHA, branch, worktree: §1. Final changed files: pending.
- Raw artifact references: §3 (fixture HARs; no production HAR available).
- Experiments, predictions, results: pending Checkpoint 1.
- Cache contract: §6 Slice 2 (design), to be confirmed by measurement.
- Rollback: revert the single `fetchPublicJobs` cache change and/or the
  invalidation commit on `codex/home-deadline-sort-performance`; production
  rollback target from the sort release record is
  `526f597c09cb389269b2e31cda74255cfbecf4c8`. Nothing here is deployed.
- Unrelated work preserved; nothing pushed, merged or deployed: confirmed
  in §1, to be re-confirmed at handoff.

## 11. Implementation record (new objective, 2026-10-30)

The user replaced the goal: implement Newest (default), preserved deadline
sorts, global sort before pagination, spinner + disabled sort with usable
cards/links, public server cache, post-publication invalidation with
selective warming, and stale-last-success during upstream outage. Work
continues in this same worktree/branch; sections 1-10 above remain the
investigation record.

### "Newest" timestamp decision (smallest schema change)

- `Post` had no first-publication timestamp. `reviewedAt` is written by the
  reviewed-publication path at publication; `Source.fetchedAt` is
  `@updatedAt` (last update) and was NOT used.
- Added nullable `Post.publishedAt` + index, migration
  `20261030000000_add_post_published_at`: backfills from `reviewedAt` only;
  rows without it stay null (unknown first publication, sort last) instead
  of receiving the migration time.
- Reviewed publication sets the timestamp only in upsert `create` (its
  `update` is empty). Legacy replacement has no stable per-post identity;
  its timestamp remains null rather than inventing first-publication time.

### Slices implemented

1. Newest: `JobFilters.sort` gains `newest`, default `newest`; Home sort
   control gains the Newest option; `listPublicJobs` orders
   `publishedAt desc nulls last, id asc` (deadline orders unchanged, all
   global before `skip`/`take`). Focused test
   `scripts/public-jobs-sort.test.ts`; `scripts/jobs.test.ts` default-order
   expectation updated to the new agreed default.
2. Pending: sort `<select>` is `disabled` while the transition is pending;
   spinner (`styles.spinner`, reduced-motion aware) + `Updating…` status
   replace the plain text. Cards/links are untouched by the transition, so
   they stay usable; only the sort control is disabled.
3. Cache: `fetchPublicJobs` now uses the Next fetch Data Cache
   (`next: { revalidate: 60, tags: ['jobs'] }` — same facility already used
   by job detail, suited to the single-frontend-replica Coolify topology;
   entries live in that Next server's cache, are not shared across replicas
   and do not survive redeploy). The revalidate value is an interval, not a
   max-staleness guarantee. Cache identity: normalized sort/filters, page,
   `pageSize=6`, and `istDate` (Asia/Kolkata date) in the fetch URL.
   A process-level last-success map returns the previous successful result
   with `freshnessUnconfirmed: true` when upstream fails, and the grid
   shows "Showing the last confirmed results. Freshness could not be
   confirmed…" — distinct from a successful empty result and from the
   no-cache-at-all error notice. An already-open page gets fresh results on
   its next navigation, sort/page change, or reload; no push channel exists
   and none was added.
4. Invalidation + warming: `POST /app/api/revalidate-jobs` (route handler
   wins over the `/api/:path*` rewrite) reuses the ingest Bearer convention
   (`INGEST_TOKEN`, SHA-256 + timingSafeEqual; 503 unconfigured, 401 bad
   token), calls `revalidateTag('jobs', { expire: 0 })` so warming blocks on
   fresh data, then warms only page one for newest/soonest/furthest with no
   filters through `fetchPublicJobs`. The API calls it after publication
   commits (reviewed and legacy paths) via `notifyJobsRevalidated`:
   2 attempts, 3s timeout, failure logged and swallowed so publication is
   never misreported. Repeated delivery is safe (idempotent tag + warm).
   Requires `FRONTEND_REVALIDATE_URL` on the API and `INGEST_TOKEN` on the
   frontend; unconfigured = no-op. The 60s interval schedules refresh on the next read;
   it does not bound staleness during an upstream outage.

## 12. Final verification, measurements and handoff (2026-10-30)

### Changed files (21 paths in the dedicated worktree)

Modified: `.env.example`, `components/jobs/catalogue-grid.tsx`,
`components/jobs/job-search-controls.tsx` (+ `.module.css`),
`frontend/public-job-filters.ts`, `prisma/schema.prisma`,
`scripts/design-review-api.ts`, `scripts/job-search.test.ts`,
`scripts/jobs.test.ts`, `scripts/publish-extraction-candidate.ts`,
`src/lib/public-jobs.ts`, `src/routes/ingest.ts`, `src/routes/jobs.ts`,
`tests/sort-verification.test.ts`.
Added: `app/api/revalidate-jobs/route.ts`,
`components/jobs/jobs-server-cache.ts`,
`prisma/migrations/20261030000000_add_post_published_at/migration.sql`,
`scripts/public-jobs-sort.test.ts`, `src/lib/notify-jobs-revalidation.ts`,
`tests/jobs-cache.test.ts`, this audit file.

### Cache design change forced by measurement

The first implementation used only the Next fetch Data Cache. The outage
measurement then showed the fetch cache serving stale entries on upstream
failure without telling the caller, so the "freshness could not be
confirmed" banner could never appear. The shipped design therefore uses an
explicit in-process server cache (`components/jobs/jobs-server-cache.ts`)
with the same identity (normalized sort/filters, page, pageSize=6, IST
date), one shared `jobs` group, 60s interval, in-flight coalescing, and
explicit stale marking. Invalidation clears the group and warms page one
for newest/soonest/furthest. This is the smallest design that satisfies
the freshness-communication requirement on the single-frontend topology.

### Measured results (local fixture, production webpack build, 5 reads/sort)

Baseline `5e3b47c` (separate temporary worktree, since removed):
soonest median 14.3 ms with 5/5 API hits; furthest 8.8 ms with 5/5 API
hits. Newest did not exist (invalid sort, 0 hits).
After: soonest median 8.1 ms, furthest 6.6 ms, newest 3.7 ms, each with
1/5 API hits. Local timings only — no production claim.
Outage after expiry (2s test interval): HTTP 200, cards present, stale
banner present. Within the interval, the cached entry is served normally.
Invalidation (default interval): changed data not visible before the
authenticated call (`showsV2BeforeRevalidate: false`), visible after
(`true`); no token → 401; warming reported all three sorts `true`.
Browser suite metric: input-to-feedback 142 ms, input-to-final-cards
306 ms (Playwright observation, not paint timing; gated fixture).

### Checks actually run

- `pnpm run typecheck` — pass (both configs).
- `pnpm run lint` — pass.
- `pnpm test` — 125 pass, 15 skipped (opt-in database suites), 0 fail.
- `pnpm run test:contracts` — 12/12 pass.
- New: `scripts/public-jobs-sort.test.ts` (sort matrix, default, global
  order before pagination), `tests/jobs-cache.test.ts` (miss/hit identity,
  failed refresh → marked stale, no-cache failure → null, recovery,
  concurrent-read coalescing, IST rollover) — pass.
- Browser: `tests/sort-verification.test.ts` (pending spinner + disabled
  control, retained usable cards, open-job-while-pending + Back agreement,
  deep links, reload, history, no-JS), `tests/next-navigation.test.ts` —
  18/18 pass combined with the cache test run.
- `next build --webpack` (the deployment's build mode) — pass. The
  default Turbopack build cannot run in this worktree because
  `node_modules` is a symlink to a sibling worktree with an identical
  lockfile (local tooling workaround only; not part of the diff).

### Risk register (final)

| # | Item | Status | L | I | Risk | Action |
|---|---|---|---|---|---|---|
| R1 | No Post deadline index | Fact, cause unproven | 2 | 3 | 6 | No change; no query evidence justified one |
| R2 | Next fetch cache silently serves stale on outage | Confirmed locally, fixed by explicit cache + banner | 8 | 5 | 40 | Fixed in this change |
| R3 | In-process cache is per-replica | Concern if frontend ever scales | 2 | 6 | 12 | Documented; revisit before scaling replicas |
| R4 | Legacy re-ingest deletes/recreates posts, resetting publishedAt | Existing behavior, observed in code | 4 | 3 | 12 | Documented; dedup task owns replacement semantics |
| R5 | Notification unconfigured in production env | Concern until env is set at deploy time | 5 | 3 | 15 | 60s interval bounds staleness; set FRONTEND_REVALIDATE_URL + INGEST_TOKEN on deploy |

### Remaining uncertainty and rollback

- Production deployment, migration application, replica count and live
  timings are unverified (no production access; nothing deployed).
- The migration is additive and nullable; rollback = revert this branch's
  commits. The new column can stay harmlessly if code is rolled back.
- An already-open page obtains fresh results on its next navigation, sort
  or page change, or reload; there is no push channel.
- Unrelated work preserved: the dirty primary checkout and all other
  worktrees were never edited, stashed, reset or cleaned. Nothing was
  pushed, merged or deployed.
- Evidence supports keeping the experiment locally; production benefit
  must be re-measured after a separately authorized deployment.

### Exercise for the developer

Explain, in your own words: a job is published at 10:00, a reader loads
the home page at 10:00:30, the API then goes down, and another reader
loads the same page at 10:02. What does each reader see, when does the
second reader get the freshness warning instead, and what happens to both
readers' pages once the API recovers and a new publication arrives?


## 13. Targeted review fixes (2026-10-30)

Worked in the existing `codex/home-deadline-sort-performance` worktree at
baseline HEAD `5e3b47c`. The earlier implementation is still uncommitted;
its existing changes were preserved. No primary-checkout edits, production
writes, push, merge, deployment, dependency changes, or new schema changes.

### Confirmed issues and decisions

- Cache invalidation race (likelihood 4 × impact 6 = 24): an already-running
  pre-publication fetch remained in `jobsInFlight`; warming joined it and
  its old response repopulated the cleared cache. Added a generation counter,
  detached old in-flight entries on invalidation, and guarded cache writes
  and promise cleanup. An existing reader may finish its original request;
  it cannot seed the new generation or remove its active fetch.
- Legacy publication timestamp (6 × 5 = 30): changed-source ingest deletes
  and recreates all posts, so stamping `new Date()` promoted existing jobs.
  No stable per-post matching exists in this boundary. Use null for legacy
  first-publication time (unknown, sorts last). Reviewed publication still
  stamps creation and preserves its timestamp on replay. No inferred identity,
  deduplication rewrite, or migration change was introduced.

### Regression evidence

- `tests/jobs-cache.test.ts`: held the original response, invalidated, started
  warming, completed warming with new data, then released old data. Before
  the fix, only one fetch started (expected two). After the fix, an outage
  fallback retains the new publication, not the late old response.
- `scripts/ingest.test.ts`: injects two changed-source legacy submissions
  through the real HTTP handler with isolated DB method stubs. Before the
  fix both captured create batches contained new dates; afterward both
  contain null. No real database or notification network call is used.
- Focused cache + sorting + ingestion tests: 17/17 pass.
- `pnpm typecheck`, `pnpm exec tsc -p tsconfig.next.json --noEmit`,
  `pnpm lint`, and `git diff --check`: all pass.
- Full browser/build/production checks were not rerun for this targeted fix.
  Production topology and migration verification remain release work.

Freshness clarification: 60 seconds is a refresh interval, not a maximum
age guarantee. Failed refreshes can continue serving the last success with
`freshnessUnconfirmed`; no new maximum-age policy was added.
