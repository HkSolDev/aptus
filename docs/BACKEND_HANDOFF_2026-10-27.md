# Backend eligibility handoff — 27 October 2026

Status: implemented and locally verified; awaiting coordinator acceptance and
independent review. Not integrated, released or production verified.

## Exact tree and ownership

- Worktree: `/private/tmp/aptus-backend-eligibility-20261027`
- Branch: `codex/backend-eligibility-20261027`
- Approved original snapshot: `dcb0ffeb484d7d3495417121a97b48d5c54aa1c8`
- Approved supplemental snapshot: `27f1ab6e7a65c5d70baaf68d84b2299e187ae7d9`
- Local supplemental cherry-pick: `21a535863a3a879834f8413797d5ff23b44a3dce`
- Focused implementation: `0abab811121aae47d45f3d3f54861a0d79bcff0f`

Review the implementation diff against its parent `21a5358`, not the unrelated
original checkout HEAD. The coordinator's manifests are in
`/private/tmp/aptus-backend-coordinator-20261027/`. All ten supplemental-file
SHA-256 hashes match supplement.json. These files are frozen context, including
unreviewed frontend work; this handoff does not accept them.

The worktree inventory and target path/branch were inspected before creation;
neither target existed. The original dirty aptus-next checkout was preserved.
Git worktree metadata required sandbox escalation for cherry-pick and commits;
there were no conflicts. No reset or overwrite was used.

Implementation files:

- `scripts/match.ts`: calendar age, manual reasons and shared post checks.
- `scripts/match-age.ts`: bounded age-limit/relaxation uncertainty helper.
- `src/routes/match.ts`: confirmed/manual results use those same checks.
- `src/routes/explain.ts`: notice age and uncertainty in deterministic text.
- `scripts/match-policy.test.ts`: date, flag, category, conditional and explanation regressions.
- `scripts/match-policy-route.test.ts`: actual handler result partition and age text.
- `scripts/explain.test.ts`: two fixture fields (valid reference date and explicit
  false flag); original passing-age assertion remains unchanged. Missing-date
  behavior is tested separately in the new tests.

## Reproduction and approved policy

Before implementation, the new policy suite ran against dcb0ffe: eight tests,
seven failed and one passed (existing leap-day arithmetic). Actual matcher calls
showed today-age 26 instead of notice-age 17/18, maximum 33 instead of 30 with
explicit false, no manual reasons for gender/nationality, and current-age text
in explanations. These reproduce WF-AGE-REFERENCE, WF-RELAXATION-FLAG and
WF-CONDITIONAL-GATES. No frozen audit/assertion was modified.

Hemant's supplied implementation instructions explicitly approved:

1. Valid stored ageAsOnDate drives comparisons. UTC calendar components prevent
   a date-only birthday shifting with the server timezone. Inclusive boundaries
   and existing February-29/March-1 arithmetic remain; no legal validation claimed.
2. Missing, omitted or invalid Date reference means unknown candidate age for
   this notice, not today's age. Age is manual; independently failing education
   or required marks still excludes the post.
3. False means zero extra years. True applies only a finite nonnegative integer
   explicitly stored for the candidate's exact category, including explicit zero.
4. Null/missing flag, incomplete/invalid applicable relaxation, conflicting
   detailed limits and unsupported age conditions require manual verification.
   No uncertain allowance is represented as applied years. A known minimum
   still excludes an underage candidate when only maximum relaxation is unknown.
5. Unverifiable gender/nationality and detailed category/combination requirements
   add manual reasons. Unknown conditions cannot erase an independent hard fail.

Detailed category rules for a known different category do not invalidate this
candidate's flat age comparison. Unrecognized/group labels are not interpreted
as exact categories. Conditional bound conflicts remain manual, not a new
deterministic policy for choosing among alternative routes. A combination rule
cannot create extra years where relaxation is explicitly disabled.

## Actual lineage and returned behavior

Legacy ingestion and reviewed publication already map ageAsOnDate and
categoryRelaxationApplies to nullable Post fields. Reviewed nationality remains
in reviewedDetails, and gender in eligibilityRules. Those producer/storage files
were inspected but unchanged. A real database round trip was not run.

Matching still reads the session-selected saved profile and active posts.
getPostChecks performs deterministic comparisons; getMatchesForUser excludes
known age/education/marks failures. The match handler sends uncertain survivors
to needsManualCheck with reasons, and only verified survivors to matches.
Confirmed userAge/ageComparison now use each notice's date. Explain calls the
same checks and describes missing reference information without a numeric age.
No matching writes, ownership changes, AI calls or new dependencies were added.

The HTTP regression returns one confirmed post with age 30 and allowed 18–30,
five manual posts (missing date, invalid date, null relaxation, nationality,
gender), and excludes known maximum/minimum-age, education and marks failures.
Existing qualification alternatives and scoped experience behavior remain intact.

## Commands and results

All Node checks used the existing installed versions with independent dependency
and generated-client copies in the isolated worktree. No .env was copied.
An offline dependency restore could not find a cached tarball, so existing local
package files were copied instead; no package or lockfile changed.

| Command                                                                                                                                              | Result                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `DOTENV_CONFIG_PATH=/dev/null node --import tsx --test scripts/match-policy.test.ts` before fix                                                      | 1 passed, 7 failed; expected reproduction                                                           |
| `DOTENV_CONFIG_PATH=/dev/null node --import tsx --test scripts/match-policy*.test.ts scripts/match-unverified.test.ts scripts/explain.test.ts` final | 25 passed, zero failures/skips                                                                      |
| `TZ=America/Los_Angeles DOTENV_CONFIG_PATH=/dev/null node --import tsx --test scripts/match-policy*.test.ts`                                         | 11 passed before the last added combination-rule regression; all then-existing policy checks passed |
| `pnpm typecheck` final                                                                                                                               | Passed                                                                                              |
| `pnpm lint` final                                                                                                                                    | Passed                                                                                              |
| `DOTENV_CONFIG_PATH=/dev/null pnpm check:contracts` final                                                                                            | 12 contract tests passed; unchanged audit reports passed with zero findings                         |
| `DOTENV_CONFIG_PATH=/dev/null pnpm test` final, outside sandbox for localhost                                                                        | 127 tests: 113 passed, 14 skipped, zero failed                                                      |
| `git diff --check`                                                                                                                                   | Passed                                                                                              |
| Protected-path diff and artifact lock                                                                                                                | Unchanged; lock passed                                                                              |

The initial dcb0ffe snapshot omitted ten context files. Full checks then failed
with TS2307/module-not-found and related unresolved-type lint errors. The
coordinator supplied the supplement; those failures cleared without modifying
checks. An intermediate full Node run had five localhost EPERM failures;
the authorized unrestricted rerun passed. The final behavior was then checked
again after the last combination-rule fix, producing the results above.

## Limits and remaining review

- Fourteen database scenarios were skipped because separate disposable database
  configuration was absent. Skips are not passes. No migrations were run.
- Contract/HTTP tests use isolated database doubles and Fastify injection;
  they prove the exercised matcher/serialization path, not persisted production facts.
- No full browser, Next build, remote CI, production access/write, paid call,
  push, merge or deployment. Combined integration/independent review remains
  the coordinator's acceptance gate.
- Frontend display dependency: no DTO shape was added or removed. Confirmed
  userAge now means age on the notice date. Existing UI may label it simply
  “Age”; any clearer date label is a coordinator/frontend follow-up, not included.
- Existing arbitrary other_requirements/desirable prose is not interpreted as a
  new hard requirement. This slice covers the assigned age, gender/nationality
  and structured conditional gaps, preserving existing education/experience logic.
- Unknown requirements may produce more manual results, intentionally. Matching
  does not select or legally adjudicate unsupported alternative eligibility routes.
