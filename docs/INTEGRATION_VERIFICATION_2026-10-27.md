# Coordinator integration verification — 27 October 2026

Status: local candidate verified within the coverage below. Main, GitHub and
production have not been changed by this takeover.

## Candidate and ownership

- Code commit: `4fa532ef74df0ac015199204cf270beb3c564d3f`.
- Branch: `codex/contract-integration-20261027`.
- Worktree: `/private/tmp/aptus-contract-integration-20261027`.
- Main coordinator took over Agent 1 after the user reported its usage limit.
- Original application checkout and staging at
  `/Users/mrblackghost/Work/Projects/aptus-next` were preserved. Only canonical
  agent-hub coordination records are updated there.
- Agent 3's accepted commit `526bff4` was already integrated when takeover began.
  No duplicate application of it was needed.

## Integration corrections

1. Added `scripts/match-age.ts` to `deployment/api.Dockerfile`. The previous API
   image built but crashed at startup with `ERR_MODULE_NOT_FOUND`. The rebuilt
   image now starts and serves its health endpoint with networking disabled.
2. Applied formatting to 14 inherited snapshot files so the whole-repository
   formatting gate passes; no product behavior was introduced by formatting.
3. Reconciled the candidate with recorded released main revision
   `7e974cc098f405475f7093567bcf26cde4c40a4a` locally. The earlier snapshot had
   omitted newer production changes. The final candidate retains:
   - Next 16.4.1, Fastify 5.12.6, all dependency overrides and main's exact lockfile.
   - Existing production-dependency audit, search-fixture database setup and all
     three image CI jobs, alongside the added contract gate.
   - Mobile discovery UI/tests, appointment metadata, canonical empty-body
     matching and stale-profile rejection, duplicate-safe concurrent saves,
     authenticated database tests and proxy transport regression.
   - Newer worker recovery, metrics and off-peak behavior plus Agent 2 diagnostics.
4. Adapted the frozen Save test's transport/storage fixture to the released
   implementation, preserving its assertions and schema checks. Only one of
   the 19 locked artifacts changed; no schema or API policy changed. The exact
   before/after hash and reasoning are in
   `CONTRACT_FIXTURE_RECONCILIATION_2026-10-27.md`.
5. Corrected two restored test fixtures to provide required `savedAt`; supplied
   a known appointment type in the null-education card fixture so its existing
   no-placeholder assertion tests education without catching an unrelated row.
   No assertions were removed or relaxed.

## Verification

Node checks use Node 24.10.0. Environment is allowlisted with
`DOTENV_CONFIG_PATH=/dev/null`; no project environment files, provider keys or
production database credentials are loaded. PostgreSQL is Agent 1's disposable
container, bound to `127.0.0.1:54399`, using dedicated test databases.

| Check                                              | Result                              | Evidence log                                                                              |
| -------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------- |
| Full Node suite with PostgreSQL and search fixture | 155 passed, zero failures/skips     | `43-reconciled-node-db-final.log`                                                         |
| Production frontend build and full browser suite   | 53 passed, zero failures/skips      | `44-reconciled-web-final.log`                                                             |
| Frozen contracts and consumer audit                | 12 passed; audit zero findings      | `34-reconciled-contracts.log`                                                             |
| Offline Python suite                               | 414 passed                          | `25-coordinator-python.log`                                                               |
| Typecheck                                          | Passed                              | `35-reconciled-typecheck.log`                                                             |
| Lint                                               | Passed                              | `36-reconciled-lint.log`                                                                  |
| Repository formatting                              | Passed                              | `37-reconciled-format.log`                                                                |
| Production dependency audit                        | Zero advisories at inspection       | `42-reconciled-audit.json`                                                                |
| API image build/startup                            | Passed; health HTTP 200             | `45-final-api-build.log`, `48-final-api-smoke.log`                                        |
| Standalone frontend image build/startup            | Passed; informational page HTTP 200 | `45-final-frontend-build.log`, `49-final-frontend-smoke.log`                              |
| Worker image build, help and diagnostics           | Passed; no pipeline execution       | `45-final-worker-build.log`, `46-final-worker-help.log`, `47-final-worker-diagnostic.log` |

All logs are under `/private/tmp/aptus-verification-logs-20261027/` and should be
preserved/exported if needed beyond temporary storage. Python source is byte-for-
byte unchanged between the 414-test run and final code commit; it was not rerun
solely because unrelated frontend/fixture changes were reconciled.

All images are local amd64 builds labelled with full code commit `4fa532ef...`:

| Image tag                            | Local image ID                                                            |
| ------------------------------------ | ------------------------------------------------------------------------- |
| `aptus-api-coordinator:4fa532e`      | `sha256:74de74c0eda951bdb204362d35b8b61d9776c7e6e35464df91257f63ebe64df5` |
| `aptus-frontend-coordinator:4fa532e` | `sha256:32f2c4e992a5025f358e0b385167c89ad1495646974f9ae7f0a23cd71b3c4ca3` |
| `aptus-worker-coordinator:4fa532e`   | `sha256:78a1430bf57b7b9b62333eaa25a5c609eb0f72b031a2d14dc6f8157b02bbc291` |

Image smoke runs use `--network none --read-only`. API/frontend start their
production server commands and probe an internal endpoint; worker runs help and
an isolated diagnostic assertion. These do not prove deployment, database access
from containers, source connectivity or production throughput.

## Coverage and remaining release work

- An earlier full browser run on the pre-reconciliation snapshot failed a
  review-page search count; the same test passed alone. No deterministic code
  cause was established. Both subsequent full local runs passed, including the
  final restored mobile suite. Treat remote clean CI as the next confirmation.
- Hemant authorized a documentation-only reconciliation after this verification.
  Contract revision `local-v1.1` records the real empty-JSON transport for saved
  mutations, the exact empty `{}` match request, and the 409 stale-client
  rejection. It updates the protected lock and passes `pnpm check:contracts`.
  This did not change runtime behavior, request ownership, wire response shapes
  or eligibility policy.
- GitHub's branch-protection read returned HTTP 403 with a plan requirement for
  this private repository. Required-check enforcement was not verified or
  configured. No repository visibility, plan or settings changes were made.
- Remote CI still needs to run on the final branch. Until it passes, there is no
  GitHub merge, registry push, staging deployment, production migration or
  production verification claim.
- Worker diagnostics explain omissions; they do not improve extraction success,
  clear factual holds or approve publication.
- Performance/navigation implementation remains a separate queued task.

Next release step: review the local candidate and its explicit contract-record
discrepancies, then authorize the GitHub review/CI flow if desired. Preserve the
original dirty checkout and carry the existing production revision forward.
