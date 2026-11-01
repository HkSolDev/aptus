# Admin review — independent-review fixes

Updated: 2026-10-30
Status: Ready for independent review (not merged, not pushed, not deployed)
Branch: `codex/admin-review-review-fixes`
Worktree: `/tmp/aptus-admin-review-review-fixes` (dedicated worktree; the reviewed
worktree `/Users/mrblackghost/Work/Projects/aptus-admin-review-worker-validation`
and the dirty `/Users/mrblackghost/Work/Projects/aptus-next` checkout were preserved)
Reviewed implementation: `codex/admin-review-worker-validation` @
`178dffda7f91703db2cdce8fb4638ff0620838f1`
Original baseline: `d930a69e0093a440ef5ad99c92a6ab19326cec17`
Reviewed diff: `d930a69..178dffd` (2 commits, 21 files). No fixes had been added
on the implementation branch after the reviewed commit when this work started.
Final commit: recorded in git log on this branch (this file is committed with the fixes).

Operator access stays configuration-driven via `APTUS_REVIEW_OPERATOR_EMAILS`
(deployment value: the two intended operator emails from the task brief).
No privileged identity is hardcoded in authorization logic.

## Findings

| #   | Finding                                                               | Status                  | Likelihood | Impact | Risk |
| --- | --------------------------------------------------------------------- | ----------------------- | ---------: | -----: | ---: |
| A   | Correction after newer worker observation fails (unique constraint)   | Confirmed, fixed        |          7 |      8 |   56 |
| B   | Refresh moves save token off unsaved facts                            | Confirmed (code), fixed |          6 |      9 |   54 |
| C   | Queue has no pagination beyond first 20                               | Confirmed, fixed        |          8 |      5 |   40 |
| D   | API pagination skips a candidate                                      | Confirmed, fixed        |          8 |      6 |   48 |
| E   | Validation claims not exclusive                                       | Confirmed (code), fixed |          5 |      7 |   35 |
| F   | Queue failure shown as empty backlog                                  | Confirmed, fixed        |          5 |      6 |   30 |
| —   | Component render harness broken in this env (existing tests too)      | Unresolved concern      |          4 |      3 |   12 |
| —   | New-item import race on unique `bundleId` (two first imports at once) | Low priority, not fixed |          2 |      4 |    8 |

Security/data-loss note: B and the stale-save path are data-loss class; A is
correctness; the isolation test is privacy class. All are flagged regardless of score.

### A. Corrections fail after a new worker observation

- Reproduction: `scripts/review-workflow-regressions.test.ts` test A failed pre-fix with
  `Unique constraint failed on ReviewRevision_reviewItemId_revisionNumber_key`
  at `saveReviewCorrection` (it allocated `currentRevision.revisionNumber + 1`
  = 3 while a non-current worker observation already held 3).
- Root cause: revision allocation used the current revision, not the maximum;
  "has human corrections" was guessed from `revisionNumber > 1`.
- Fix (`src/lib/review-drafts.ts`): allocate `max(existing revisionNumbers) + 1`;
  human provenance is explicit — worker imports are `createdBy: 'worker_import'`,
  human saves carry the operator email, so `createdBy !== 'worker_import'` means human.
  Save and import hold the item row lock for their transaction (a Prisma row
  update inside the transaction), serializing the base check + allocation.
  Simultaneous saves: one wins, the loser throws `StaleRevisionError`, which the
  route already maps to the documented `412` response.
- Regression tests: A (observation then correction = R4, human stays current,
  all 4 revisions kept) and A-concurrent (one saved, one stale). Both pass.

### B. Refresh advances the revision token without updating unsaved facts

- Root cause: `refreshCandidate` called `setData(fresh)` even with unsaved
  changes, so the save `If-Match`/body token became the newer revision while
  the edited facts still came from the older one.
- Fix (`components/admin/candidate-detail-view.tsx`): the editor keeps an
  explicit `editingRevisionId` bound to the facts being edited; saving sends
  that id. Manual refresh and validation-poll refresh share
  `resolveCandidateRefresh` (`components/admin/candidate-refresh.ts`): with
  unsaved changes and a different fresh revision it keeps editing state and
  shows a conflict banner ("A newer revision was saved… Saving them will be
  rejected as stale") with an explicit "Reload newer revision (discard my
  edits)" action. Unsaved work is never silently rebased or discarded.
- Behavioral test: `tests/review-refresh.test.ts` covers both entry points
  (manual and validation-result refresh use the same refresh path) plus the
  no-unsaved apply case; saving old edits keeps the old base id, so the server
  stale check (412) applies instead of claiming the newer revision.

### C. Queue has no usable pagination

- Fix: the server page now passes `next_cursor` through; `ReviewQueueView`
  keeps items/cursor in state and "Load more candidates" fetches
  `/api/admin/review-drafts?limit=20&cursor=…` (existing API convention),
  de-duplicating by id. The notice bar now reads "N roles on this page"
  instead of presenting the loaded page's roles as the queue total
  (`totalItems` from the API remains the queue-wide notice count).
- Test: `tests/review-admin-ui.test.ts` (render) — see Limitations for harness.

### D. API pagination skips a candidate

- Root cause: `listReviewQueue` popped the `limit + 1`th item and returned
  _its_ id as `next_cursor`; the next request then did `cursor + skip: 1`,
  skipping that item. Ordering was `updatedAt desc` only (unstable on ties).
- Fix: cursor is now the last _returned_ item's id; ordering is
  `updatedAt desc, id desc` (deterministic, cursor-compatible).
- Regression test: D imports 5 items forced to equal `updatedAt`, pages with
  limit 2, and asserts every id exactly once. Passes.

### E. Validation task claims are not exclusive

- Root cause: claim did `findFirst` then unconditional `update` by id; two
  overlapping transactions could both select and overwrite each other's token.
- Fix: atomic conditional claim — `updateMany` guarded by
  `status = 'pending' OR (running AND claimExpiresAt < now)`; only a count of
  1 owns the task, with a bounded retry over the next candidate. No new
  dependency or queue framework. Lease default remains 60 seconds.
- Regression test: E runs concurrent claims (exactly one winner), expires a
  1-second lease, reclaims it, and proves the previous owner's
  `submitValidationResult` is rejected (`claim token` mismatch). Passes.

### F. Queue failures appear as an empty backlog

- Root cause: `app/admin/review/page.tsx` swallowed fetch errors/non-OK into
  an empty queue payload.
- Fix: the page distinguishes failure (non-OK status, timeout, transport
  error) from success and passes `initialError`; `ReviewQueueView` renders
  "Review queue temporarily unavailable" with a Retry link, and renders the
  empty-queue message only after a successful empty response.
- Test: `tests/review-admin-ui.test.ts` covers the outage render and the
  successful-empty render (503/timeout both funnel into `initialError`).

## Operational connection (manual, first slice)

Implemented code already contained the import endpoint and the Python runner;
what was missing was a documented, runnable connection. This is manual — no
scheduler was added, and validation never crawls, fetches, extracts, or calls
a model.

Import an existing persisted worker draft (JSON artifact with saved evidence)
into the private review queue (idempotent; replaying the same artifact returns
`duplicate: true` and creates nothing new):

```bash
curl -sS -X POST "$BACKEND_INTERNAL_URL/api/internal/review-drafts" \
  -H "Authorization: Bearer $APTUS_INTERNAL_INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @/path/to/held-draft.json
# 201 {item_id, bundle_id, revision_id, revision_number, canonical_hash, duplicate:false}
# 200 with duplicate:true on exact replay
```

Run pending validation tasks through the selected Python worker runtime
(claims one task with a 60-second lease, runs deterministic
`validate_candidate`, submits the result; drop `--once` to poll):

```bash
cd services/ai
.venv/bin/python review_validation_worker.py --once \
  --api-url "$BACKEND_INTERNAL_URL" --token "$APTUS_INTERNAL_INGEST_TOKEN"
```

## Verification evidence (actual outcomes)

| Command                                                                      | Result                                                                          |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `tsx --test scripts/review-workflow-regressions.test.ts` (isolated Postgres) | 4/4 pass (A, A-concurrent, D, E)                                                |
| `tsx --test scripts/review-workflow.test.ts`                                 | 4/4 pass, incl. repaired isolation test returning 200 from the same isolated DB |
| `tsx --test tests/review-refresh.test.ts`                                    | 3/3 pass                                                                        |
| `python -m unittest services.ai.tests.test_review_validation_worker`         | 4/4 pass                                                                        |
| `tsc --noEmit`, `tsc -p tsconfig.web.json`, `tsc -p tsconfig.next.json`      | 0 errors                                                                        |
| `eslint .`                                                                   | 0 errors                                                                        |
| `tests/review-admin-ui.test.ts` (render)                                     | Not run — see Limitations                                                       |
| Browser demonstration (9 steps)                                              | Incomplete — see Limitations                                                    |

Corrections to earlier claims (see also the amendment note in
`admin-review-worker-validation.md`):

- The old obsolete-revision check did **not** prove a 409: submitting an old
  revision's result was accepted and only updated that revision; the test
  verified the current revision stayed unchanged. That behavior is retained
  deliberately — old-revision history cannot alter the current revision.
- A quotation existing in source text proves only lexical presence, not that
  the quote semantically supports the edited fact (`semantic_support_verified`
  remains `false`).
- Actual lease is 60 seconds (not 5 minutes). Actual shapes: import returns
  `{item_id, bundle_id, revision_id, revision_number, canonical_hash, duplicate}`;
  queue returns `{items, next_cursor, counts_as_of, total_items}`; stale save
  returns HTTP 412 `{error}`.
- Implemented ≠ tested ≠ manual ≠ deployed: the fixes above are implemented
  and unit/integration-tested locally; import + runner are manual operations;
  nothing here is deployed.

## Limitations / incomplete checks

- Browser demonstration (§6 steps 1–9) was not executed: no authenticated
  operator browser session is available in this environment. The underlying
  behaviors are covered by the API/DB/UI-logic tests above; the render test
  `tests/review-admin-ui.test.ts` also could not run because the repo's
  component harness (`tests/css-module-hook.mjs` + tsx) fails identically on
  pre-existing tests (e.g. `tests/job-detail-content.test.ts`) in this
  environment. Both are marked incomplete, not passed.
- Tests ran against local PostgreSQL 14 (project CI uses its own Postgres);
  isolated schemas only — no production data was touched.
- Low-priority (risk < 5 after flagging): first-import race on unique
  `bundleId` under simultaneous first imports of the same bundle (unique
  constraint surfaces an error; no data loss). Documented, not fixed.

## Follow-up fix: same-revision refresh discarded unsaved edits

Starting state: commit `d624ac7` on `codex/admin-review-review-fixes`,
clean working tree (verified before editing).

- Reproduction: dirty edits on R1 + a refresh returning the _same_ R1
  (manual Refresh, hold-reason update, or validation polling) returned
  `apply-fresh` from `resolveCandidateRefresh`, so the editor replaced the
  edited facts with the server's R1 facts. Likelihood 6 × impact 7 = **42**
  (unsaved-data-loss). The line above in §B ("Unsaved work is never silently
  rebased or discarded") was therefore too broad and is corrected by this fix.
- Root cause: the helper only protected dirty edits when the fresh revision
  _differed_ from the editing revision, and refresh decisions were taken
  from state captured when the request started.
- Fix (frontend only): the helper gains a `preserve-editing` decision for
  dirty + same-revision (validation/status refresh via `setData`, editable
  facts/reason/dirty/base untouched, no false conflict); different-revision
  still shows the conflict. `candidate-detail-view.tsx` now decides from
  refs read when the response _arrives_, and marking an edit dirty is
  synchronous, so typing during an in-flight refresh cannot be overwritten.
  Only explicit discard-and-reload or a successful save replaces facts.
  Files: `components/admin/candidate-refresh.ts`,
  `components/admin/candidate-detail-view.tsx`, `tests/review-refresh.test.ts`.
- Regression first: new helper test `dirty refresh returning the same
revision preserves editing` failed pre-fix (`apply-fresh`) and passes now.
- Actual editor evidence (isolated local DB `aptus_review_ui`, seeded
  fixture + test operator session, system Chrome via Playwright, servers
  on 8081/18080 — all torn down afterwards): dirty same-revision refresh
  kept fact + reason; in-flight typing survived a held refresh; external
  R2 produced the conflict banner and the stale save was rejected (412);
  discard-and-reload loaded R2 and cleared dirty state; a successful save
  advanced to R3; the real Python runner claimed R3's task and the shown
  result arrived while a further edit was preserved.
- Commands: refresh tests 4/4; combined review suites
  (`review-workflow`, `review-workflow-regressions`, `review-refresh`)
  12/12; `pnpm typecheck` 0 errors; `pnpm lint` 0 errors;
  `git diff --check` clean.
- Remaining gaps: the §6 nine-step browser demonstration from the original
  brief remains not executed as a full end-to-end pass; the editor paths
  above were verified in the browser, queue pagination/outage were not
  re-verified in this follow-up. The component render harness limitation
  noted above is unchanged.

## Follow-up fix: edits during an in-flight save were overwritten (Risk 28)

Starting state: commit `e690993` on `codex/admin-review-review-fixes`,
clean working tree. Note: `docs/AGENT_CONTRACT_PROTOCOL.md` and
`docs/contracts/README.md` do not exist on this branch (they are untracked
files in another checkout); no contract, schema, API, or worker files were
changed, so nothing in this fix depends on them.

- Root cause: while a save was pending, every fact input, the role
  selector, and the change-reason field stayed editable. A second edit
  (F2) made during that window was silently replaced when the F1 save
  succeeded and its forced refresh applied the saved facts.
- Fix (frontend only, `components/admin/candidate-detail-view.tsx`): all
  editable fact inputs, the vacancies Set/Null toggle, the role selector,
  and the change-reason field are `disabled` while `saving`; the actions
  that could race or replace editor state in that window (discard-and-
  reload, Check correction, Keep held, Refresh result) are also disabled
  while saving. Conflict, same-revision-refresh, and successful-save
  behavior are unchanged.
- Regression: `tests/review-editor-save-race.browser.mjs` (manual browser
  regression; needs the isolated local harness described in the previous
  section — it is not part of the automated suites). It holds the save
  response, asserts the controls are disabled, and proves F2 cannot be
  entered. Pre-fix it failed (`#post-name must be disabled while saving`);
  post-fix it passes (`SAVE-RACE BROWSER REGRESSION: PASS`), including
  that the saved revision and F1 facts are correct after the response.
- Commands: refresh + review regression + workflow suites 12/12;
  `pnpm typecheck` 0 errors; `pnpm lint` 0 errors; `git diff --check`
  clean; Next build succeeded for the browser run.
- Not verified: nothing beyond the above; no merge, push, deploy,
  production data, schema, API, or worker changes were made.

## Follow-up fix: failed refresh after a successful save left validation on the old revision

Verified starting state: commit `68961a6` (`68961a6222e864368e9e8245291da032d044e7c3`)
on branch `codex/admin-review-review-fixes`, worktree
`/tmp/aptus-admin-review-review-fixes`, clean working tree.

- Trigger and code evidence: `handleSaveCorrection` saved R2, updated the
  editing base, showed "Saved correction as Revision R2", then called
  `refreshCandidate(true)`. That helper swallowed non-OK/failed GETs, so
  `data.revision.id` stayed R1 while "Check correction" submitted
  `data.revision.id` — validation would have run against R1. (Saving and
  refreshing are separate requests, so the first can succeed while the
  second fails.) Risk 3 × 6 = 18.
- Reproduction: `tests/review-editor-saved-refresh.browser.mjs` (manual
  browser regression, isolated harness as in previous sections) failed
  the post-save detail GET with 503. Pre-fix, the saved confirmation
  appeared but the refresh-needed message did not (assertion failure) —
  the bug is now browser-reproduced, not only code-confirmed.
- Solution: `refreshCandidate` now reports success/failure. A failed
  post-save refresh sets a `needsSavedRefresh` state that shows
  "Correction saved. Refresh the saved revision before checking it.",
  disables "Check correction", and makes its handler refuse to submit.
  This is sufficient because validation can only run once a successful
  refresh has reconciled the displayed revision with the saved one; no
  automatic retry loop was added — the existing "Refresh result" action
  is the retry.
- Consistency preserved: the retry goes through the existing
  dirty-edit/conflict rules. If the reviewer edited after the failed
  refresh, a same-revision retry preserves those edits while updating
  status; a different revision shows the existing conflict, and the
  requirement stays in place until discard-and-reload reconciles.
  Save-in-flight disabling, stale-save 412 handling, and same-revision
  preservation are unchanged. The fix does not submit
  `editingRevisionId` behind a stale display.
- Files: `components/admin/candidate-detail-view.tsx` (state, refresh
  result, validation guard/button, message),
  `tests/review-editor-saved-refresh.browser.mjs` (regression), this record.
- Observed results: browser regression pre-fix FAIL (missing message),
  post-fix PASS (saved confirmation kept; message shown; Check disabled
  with zero validation requests; successful retry displayed R2 and the
  validation request carried R2's id; a deliberately failed save kept
  unsaved facts with no saved state; a later refresh preserved further
  edits). Refresh/review suites 12/12; `pnpm typecheck` and the Next
  tsconfig 0 errors; `pnpm lint` 0 errors; `git diff --check` clean;
  Next build succeeded. Harness servers/database were torn down.
- Incomplete/remaining risk: the browser regression is manual (isolated
  harness required), not a CI suite. No other behavior was changed or
  re-verified in this follow-up.
