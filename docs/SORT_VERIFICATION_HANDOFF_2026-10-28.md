# JobSortControl verification — corrected handoff (2026-10-28)

## Identity
- Baseline: `526f597c09cb389269b2e31cda74255cfbecf4c8` (origin/main at original verification)
- Previous handoff commit: `bae056d92d7279e3292651fbf5f26311b7349e1c`
- Worktree: `/private/tmp/aptus-agent2-sort-verification`, branch `codex/agent2-sort-verification-handoff`
- Candidate build BUILD_ID (final `pnpm next:build`, exit 0): `1aWGiXD6uc49Vl3obsaZkA`; generated `next-env.d.ts` change from the build was inspected (`.next-design-review` -> `.next` types path) and reverted, not committed.
- Implementation unchanged in this review: `components/jobs/job-search-controls.tsx` JobSortControl is byte-identical to the previous handoff commit. No caching, dependencies, rendering-architecture, qualification or search changes.

## Corrections to the earlier report
- 19 ms / 37 ms (this run: 23 ms desktop / 40 ms mobile-throttled in `outputs/benchmark-candidate.json`) are **Playwright observation latency**: test-runner wall clock until the selected value / `aria-busy` / `Updating…` were observed in the DOM. **Not paint timing.** No PerformanceObserver paint/longtask capture was done, so no paint claim is made anywhere.
- There was **no fixed 600 ms hold**. Fixture gates hold a response until the test explicitly releases it. The stale "600ms" comment in the benchmark runner was removed.
- The primary-checkout report `docs/agent-progress/agent-2.md` was corrected in place with the same wording (that file is untracked in the primary checkout and was not part of this commit).

## What changed in this review
- `tests/sort-verification.test.ts`: paths derived from `import.meta.url`; Next and fixture ports allocated by binding port 0; clear failure with captured stdout/stderr if Next exits early; all gates released and processes stopped in `finally`/`t.after`; MutationObserver injected via `page.addInitScript()` (plain-string script — a serialized TS function referenced transpiler helpers absent in the page) recording every committed ordered card-id state; **new reverse race (test 2b)**: newest response released first, older response last; both races assert gate arrivals, final URL, selection, pending cleared, exact final cards, and that no stale card set appears even transiently in the recorded state sequence; network counters reset immediately before sorting, response bodies awaited, initial/prefetch traffic logged separately from sort-triggered requests.
- `tests/benchmark-runner.ts`: same path/port/exit hygiene; counters reset before sorting with `prefetchAndInitialRequestCount` reported separately from `sortTriggeredRequestCount`.
- `outputs/benchmark-candidate.json`: regenerated in this run (23 ms / 40 ms observation latency; dynamic allocated port in finalUrl).

## Commands and verbatim results
- `node --import tsx --test tests/sort-verification.test.ts` — EXIT 0, 6/6 pass (tests 1, 2, 2b reverse race, 3, 4 plus parent). Logs: `/tmp/sort-final2.log`, `/tmp/sort-test-3.log`.
- `node --import tsx tests/benchmark-runner.ts candidate` — EXIT 0. Log: `/tmp/bench.log`.
- `pnpm next:build` (candidate restore) — EXIT 0. Log: `/tmp/candidate-build.log`.
- `pnpm typecheck` — EXIT 0. Log: `/tmp/typecheck.log`.
- `pnpm lint` — EXIT 0 after removing one unused variable (first run EXIT 1, that single error). Logs: `/tmp/lint.log`, `/tmp/lint2.log`.
- Prettier run on both changed test files.
- Orphan check: `lsof` showed only pre-existing unrelated node listeners on 8891/8082; no listener from this run's allocated ports remained.

## Mutation check (test can fail)
- Reverted `job-search-controls.tsx` to baseline `526f597`, rebuilt (BUILD_ID `aBe0x1pzDHGbhTSVJ9ROc`, exit 0), ran the suite: **EXIT 1** — test 1 failed on baseline (select stayed `soonest`, no immediate feedback, 5s timeout). Tests 2/2b still passed on baseline, so the race assertions are **not** proven sensitive to a stale-commit defect in a form-navigation implementation; they are proven sensitive to the feedback regression and, in the candidate, they record and forbid any transient stale card state. Candidate restored and rebuilt; suite passes 6/6. Log: `/tmp/sort-mutation.log`.

## Artifacts and limitations
- Trace/HAR (untracked, in worktree): `outputs/traces/sort-controlled.zip` / `.har` (regenerated final run), plus earlier `baseline-*` / `candidate-*` traces. They prove request ordering and DOM snapshots for the fixture run; they do **not** prove paint, real-user latency, production or database timing.
- Fixture is a local 6-job API stand-in; gate arrivals counted at the fixture `/api/jobs` boundary (the RSC data source), not via `page.route()` on the browser RSC request — that is the one deliberate deviation from the rewritten prompt, chosen because the server-side RSC fetch is not a browser request Playwright can route.
- Observation latency varies run to run (19–24 ms desktop observed across runs); treat as order-of-magnitude feedback evidence, not a stable benchmark.
