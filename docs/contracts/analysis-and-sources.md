# Contract analysis, findings and research

Inspected: 27 October 2026, local checkout identified in [README](README.md).
This is a code-boundary audit and verification record, not production proof.

## How the contract design was selected

The community pattern is consumer expectations plus provider verification:
record a real request/response interaction, test the client against it, and
replay it against the provider. A schema without that second check cannot prove
that the application emits the response its consumer expects.
[Pact's explanation](https://docs.pact.io/getting_started/how_pact_works)
also distinguishes communication contracts from full application behavior tests.
We therefore keep schema checks, mapping/behavior tests and DB/browser checks
as separate kinds of evidence rather than calling every test a contract test.

[OpenAPI 3.1.2](https://spec.openapis.org/oas/v3.1.2.html) provides a
language-independent HTTP operation description, including security, parameters,
requests and responses. We use it to describe the existing custom API, without
changing route names, errors or introducing another API version. External
JSON Schema files keep definitions reusable by the existing Fastify validator.
The OpenAPI file is an operation inventory and shape description; it does not
enforce auth or replace the semantic documents.

[JSON Schema's object reference](https://json-schema.org/understanding-json-schema/reference/object)
explains why declaring a property does not make it required and why null is
different from absence. Consequently every contract specifies key presence,
type, nullability and extra-key policy independently. Runtime tests explicitly
disable coercion, default insertion and silent extra-field removal when
checking worker storage and response shapes.

[Pact's applicability guidance](https://docs.pact.io/getting_started/what_is_pact_good_for)
fits teams controlling both sides of an evolving interface. Its ideas apply
here, but adopting a Pact Broker or framework is not required to begin. Our
inference: existing Node tests, Python models and Fastify injection are enough
for this first local contract layer. No Pact dependency/service was installed,
and these tests do not claim to emit Pact files or implement Pact matching.

## Analysis order and evidence

1. Read frontend clients and UI types: catalogue fetcher/card, detail page/view,
   profile/saved clients, profile matching and explanation consumers, workspace
   state and Next rewrite config. These expose what callers actually send and
   which fields they assume exist.
2. Trace registered backend routes and guards through validators, public select,
   profile serializers, saved state, matcher and Prisma models. Compare wire
   names, required/null values, ownership, errors, dates and pagination.
3. Read Python Post/CandidatePost/StorageCandidate, preparation/validation,
   scheduler/generic pipeline, delivery, review approval, receipt/retry handling,
   backend candidate storage and publication. Separate scheduled drafts, reviewed
   publication and legacy ingestion; they are not interchangeable paths.
4. Trace facts across the whole chain and inspect existing acceptance/database
   tests and CI. Reuse the already shared storage schema instead of creating
   competing definitions. Add frozen illustrative source/draft fixtures and
   executable checks around the real implementations.

## Findings requiring follow-up

| ID                   | Evidence and impact                                                                                                                                                                                                | Required next decision/work                                                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FB-NULL-EDUCATION    | Prisma educationRequired is nullable; publicFields returns it unchanged. `frontend/types.ts` and `components/jobs/job-card.tsx` declare string only. A valid backend response violates both frontend declarations. | Align the frontend wire type with the nullable provider field; consolidate duplicated DTO ownership in a separate focused change. Do not make the server invent text.                                                             |
| FB-MALFORMED-SUCCESS | Actual client probes with HTTP 200 `{}`: fetchProfile returns null, fetchSavedJobs accepts the empty object, Save returns false, Remove returns false.                                                             | Reject malformed success envelopes at the consumer boundary instead of rendering empty/unsaved state. Test missing, wrong-type and explicit-null cases separately.                                                                |
| FB-INLINE-CONSUMERS  | Current Next profile form only checks that matches is an array; detail/catalogue cast parsed JSON. `frontend/api.ts` has a stronger match guard, but the current profile form bypasses it.                         | Share or equivalently enforce response validation across actual callers. A helper test alone does not cover inline fetch consumers. This finding is source-inspected, not covered by the dedicated malformed-client probe.        |
| WB-LEGACY-VALIDATION | Legacy input interface is erased; route validates only selected envelope/nested/recruiting fields before persistence. Reviewed storage uses strict shared schema.                                                  | Decide bounded legacy validation/compatibility policy before changing acceptance. Do not declare the legacy producer schema fully enforced server-side.                                                                           |
| WF-LEGACY-IDENTITY   | Legacy reingestion deletes and recreates Post rows; SavedJob relation cascades on delete. No stable post-ID preservation is promised by this path.                                                                 | Review legacy source refresh/dedup and saved-job retention together before changing either side. Do not call count-idempotence stable identity. This impact is inferred from code/schema, not reproduced with a DB in this batch. |
| WF-VISIBILITY        | Generic scheduler produces drafts only; candidate.status remains needs_review even after explicit publication. Next detail fetch caching differs from backend no-store.                                            | Use actual Post/receipt/affected UI evidence for visibility; do not infer it from a worker counter or status. Effective proxy/cache behavior remains unmeasured.                                                                  |

Three further semantic gaps have executable matcher probes:

| ID                   | Observed behavior                                                                                                                    | Contract implication                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| WF-AGE-REFERENCE     | getPostChecks calls ageOn(dob) without the stored ageAsOnDate. A candidate aged 18 on the notice date is compared using today's age. | Preserving the date through storage/display is insufficient; age policy must use the correct reference or remain manual.                   |
| WF-RELAXATION-FLAG   | getEffectiveMaxAge adds a stored OBC relaxation even when categoryRelaxationApplies is false.                                        | The notification-specific flag must not be ignored; review explicit false/null behavior before fixing.                                     |
| WF-CONDITIONAL-GATES | getUnverifiedRequirements returns no reason for an otherwise valid gender requirement plus reviewed nationality requirement.         | These profile-unverified conditions must not silently become eligible. Current manual checks cover only part of the detailed requirements. |

The audit now produces nine concrete findings: two nullable-type locations,
four malformed-response consumers and three matcher semantic probes. The other
table entries remain code-derived risks; saved-job deletion on legacy refresh
has not been reproduced with a real DB in this batch.

No application implementation was changed to resolve these findings in this
batch. Contract creation does not authorize quietly choosing new rejection,
migration, caching or identity policies. Proposed fixes must preserve the
frozen invariants and use the coordination protocol where semantics change.

## Verification record

The worker/backend, frontend/backend and triangular suites exercise real
serialization, request construction, route handling and consumer/rendering code.
Only session lookup and DB operations are replaced. They must be reported as
offline boundary checks. Provider HTTP uses Fastify injection, not a public
network listener. Source fixtures are illustrative and make no paid calls.

The dedicated consumer audit exits 1 while these findings remain. It
must not be rewritten to assert that accepting malformed data is desirable.
The protected-artifact lock detects drift; the separate provenance file records
inspected source hashes. Neither prevents an agent with write access from
editing the guards. Coordinator review and external repository protections
remain necessary.

Final command results for this batch are recorded below after verification.
Full browser, disposable PostgreSQL scenarios, remote CI, build images and live
production were not exercised by these new offline checks.

## Verified command results for this batch

| Check                                               | Result                                                                                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New offline boundary suite (`pnpm test:contracts`)  | 12 passed, zero skipped                                                                                                                                 |
| Consumer/matcher audit (`pnpm audit:contracts`)     | Exit 1, nine known findings; full conformance is blocked                                                                                                |
| Full Node suite with explicit root/nested globs     | 115 tests: 101 passed, 14 skipped, zero failures; completed outside sandbox because existing HTTP tests bind localhost                                  |
| Existing detail React rendering tests               | Six passed                                                                                                                                              |
| `pnpm typecheck`                                    | Passed                                                                                                                                                  |
| `pnpm lint`                                         | Passed                                                                                                                                                  |
| Full Python unittest discovery                      | 371 tests: one failure in test_default_registry_preserves_existing_source_selection; current expanded sources.json enabled set disagrees with that test |
| Formatting / local references / protected artifacts | Checked with installed Prettier and contract suite                                                                                                      |

The sources.json changes were already present at task start and were preserved.
No Python application code was modified. The source-registry failure was not
hidden by changing the expected enabled set. The initial sandbox Node run was
blocked by localhost listen permission; the authorized rerun completed normally.
No real database scenarios, full browser run, Next build, remote CI or production
release was performed. Fourteen skips in the full Node suite are not passes.

The source fingerprint capture predates the intentional CI test-glob correction;
`.github/workflows/ci.yml` is the sole captured source that changed afterward.
Package edits add three contract commands and correct the Node test glob while
preserving the pre-existing test:web edit. Other dirty application work remains
untouched. The test and schema artifacts are local and uncommitted.
