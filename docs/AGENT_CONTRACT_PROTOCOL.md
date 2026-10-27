# Aptus multi-agent contract and coordination protocol

Date: 27 October 2026. Owner: Hemant and the main coordinator conversation.

## Status and purpose

This is the operating instruction for future coordinated agent work. Hemant
launches and assigns the implementation agents; this conversation coordinates
their boundaries, reviews evidence, and integrates approved work. No agents
were launched and no application contracts or CI checks were changed by writing
this document. The four-agent allocation below is a template, not a claim that
four tasks are running.

Worktrees prevent agents from overwriting each other's edits. They do not prove
that a Python producer, API, database, matcher, and frontend still agree. A clean
Git merge and four passing local test suites can still produce a broken product.
We therefore freeze shared behavior before parallel implementation and verify
the combined path before accepting it.

This protocol governs coordination going forward. The dated
[26 October record](AGENT_COORDINATION_2026-10-26.md) remains historical evidence,
not a current assignment or release authorization. Project security rules and
[coding standards](CODING_STANDARD.md) continue to apply.

## 1. Decision authority

Concrete code-boundary contracts and their current findings are now indexed in
[docs/contracts/README.md](contracts/README.md). Read that local baseline before
assigning frontend/backend/worker changes. A passing boundary suite does not
override the separate consumer nonconformance audit.

| Role                 | May do                                                                                                                            | Must not do                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Hemant               | Approve scope, disputed semantics, contract revisions and releases                                                                | Be treated as having approved a proposal merely by not replying                                                 |
| Main coordinator     | Inspect current code, prepare and freeze agreed contract records, assign boundaries, review exact commits, coordinate integration | Silently redefine product behavior, override Hemant, or claim unverified deployment                             |
| Implementation agent | Implement its assigned slice against the frozen contract; add focused tests; propose a change request                             | Change a frozen contract, weaken its checks, expand scope, merge, push or deploy without explicit authorization |
| Verification agent   | Reproduce behavior independently; inspect producer and consumer compatibility; report failures                                    | Change expected behavior to make implementation pass or accept its own implementation as independent review     |

Only Hemant and the coordinator manage the contract record. A semantic revision
requires Hemant's explicit approval; the coordinator records and sequences it.
Existing behavior can be recorded without inventing a new policy. If code,
tests and product rules disagree, record the discrepancy and resolve it before
freezing that boundary. Current code is evidence, not automatic permission to
preserve a bug.

Agents may edit implementation within their assigned area, including internal
refactoring that preserves the boundary. Being assigned a schema file does not
grant permission to change shared semantics. New fields and broader input
acceptance also require review: callers may depend on strict rejection.

## 2. Startup: establish one baseline

Before any implementation agent starts, the coordinator must:

1. Read AGENTS.md, coding-safety rules, CODING_STANDARD, LEARNING_PLAN and the
   current task's relevant checkpoint and handoff docs. Inspect actual code.
2. Record `git worktree list --porcelain`, branch, HEAD, working status and remote
   baseline. Preserve staged, unstaged and untracked work. Do not use a dirty
   checkout or an old daily note as an implicit shared release baseline.
3. Select one explicit, reviewed baseline commit. State whether it was fetched
   and when; do not call a local remote-tracking ref freshly verified without
   fetching. Agree any needed uncommitted work separately before using it.
4. Trace each affected boundary in both directions. Identify producer,
   runtime validator, persistence mapping, consumer, tests and legacy behavior.
5. Create a batch record with ownership, contract records, protected paths,
   acceptance cases and exact verification commands. Freeze it before launch.
6. Give every agent the same batch ID, baseline SHA and contract revision.
   Require acknowledgement before edits. An unfilled contract is not frozen.

No current batch is frozen by this document. Do not infer release readiness or
new feature scope from its examples.

## 3. What a contract must specify

A TypeScript interface alone is insufficient. A contract includes observable
behavior at a boundary, including invalid requests and failures.

| Part          | Required detail                                                             |
| ------------- | --------------------------------------------------------------------------- |
| Identity      | Boundary ID, revision, baseline commit, producer and consumers              |
| Shape         | Exact field names, nesting, types, allowed enums and unknown-key policy     |
| Presence      | Required versus optional key, separately from nullable value                |
| Meaning       | Definition, source of truth, units, range and normalization                 |
| Unknowns      | Missing, null, empty string, empty array, zero and false semantics          |
| Time          | Date format, date-only versus instant, timezone and boundary comparisons    |
| HTTP          | Method/path, auth, ownership, request/response shape, status and error body |
| Storage       | Field mapping, transaction scope, overwrite/merge and deletion behavior     |
| Repetition    | Idempotency key, duplicate behavior, timeout ambiguity and retry limits     |
| State         | Allowed transitions, review/approval requirements and durable checkpoints   |
| Compatibility | Supported older payloads, deploy order and migration/rollback constraints   |
| Proof         | Frozen valid/invalid fixtures and concrete producer/consumer checks         |

For extraction, factual uncertainty must remain explicit. Numeric eligibility
facts remain numeric fields; unknown is not zero, a default category, or proof
of eligibility. Code decides eligibility, never the LLM. Database nullability
does not by itself define request optionality or frontend display semantics.

### Required is different from nullable

Illustrative example drawn from the current local Python model in
`services/ai/schema.py`: `min_age: int | None` has no default. Its key is
required while its value can be an integer or null. Reinspect at the selected
baseline before adopting this as a batch contract.

| Fragment in an otherwise valid post | Meaning under that example                                |
| ----------------------------------- | --------------------------------------------------------- |
| `"min_age": 18`                     | Known numeric minimum                                     |
| `"min_age": null`                   | Explicitly unknown; preserve uncertainty                  |
| Key omitted                         | Invalid producer output for this required-key model       |
| `"min_age": "18"`                   | Do not assume validity; explicitly freeze coercion policy |
| `"min_age": 0`                      | Numeric value, not a substitute for unknown               |

An agent must not add `= None`, change a consumer type to optional, coalesce null
to zero, fabricate an empty value, or edit a fixture merely to hide a mismatch.
Handling an already-approved nullable value honestly in the UI is allowed.
Changing which values are permitted is a contract revision.

The current API also has deliberate legacy allowances, such as omitted
`eligibility_rules` on legacy ingestion. Do not erase these or extend them to
every field without a reviewed decision. Python output, wire validation,
database constraints and browser types may legitimately differ; record the
explicit mapping and prove that it preserves meaning.

## 4. Boundaries to register for an affected task

These are discovery pointers, not a complete schema specification or approval
to change these files. Record the exact paths at the chosen baseline.

| Boundary                     | Starting points                                                                                           | Key failure to prevent                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Extraction to ingestion      | `services/ai/schema.py`, `src/routes/ingest.ts`, `src/schemas/eligibility-rules.ts`                       | Dropped fields, coercion, incompatible missing/null rules                 |
| Review to publication        | `services/ai/candidate-storage.schema.json`, `src/routes/reviewed-ingest.ts`, publication/checkpoint code | Altered draft receiving old approval; replay creating duplicates          |
| API to storage to matcher    | `prisma/schema.prisma`, ingestion mappings, matching routes and validators                                | A correctly extracted fact disappearing or changing meaning in storage    |
| Backend to frontend          | `src/lib/public-jobs.ts`, relevant routes, `frontend/types.ts`, API clients                               | Consumer mocks accepting a response the server never emits                |
| Session to private state     | Auth middleware, profile/saved-job routes and clients                                                     | Client identity replacing server ownership; logout leaving private access |
| Worker to scheduler/recovery | Retry, checkpoint, receipt and reporting modules                                                          | Retry of uncertain paid work; stale receipt treated as publication proof  |

Shared types are useful for TypeScript consumers. Python/TypeScript agreement
also needs serialized examples checked by both sides. Runtime validation,
source grounding and behavioral checks solve different problems. No new schema
framework, generator or dependency is authorized by this protocol.

## 5. Four-agent allocation template

The coordinator and Hemant sit above these lanes. Assign real tasks only after
the baseline and contracts are frozen. An idle lane is preferable to invented
work. Agent count does not require four parallel product features.

| Lane            | Default responsibility                                               | Coordination boundary                                                                |
| --------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| A: frontend     | UI, clients, accessibility and browser behavior                      | Consumes frozen API; no unilateral server/schema changes                             |
| B: backend      | API implementation, persistence and deterministic matching           | Preserves frozen producer and consumer contracts; shared migration changes sequenced |
| C: worker       | Python capture, extraction, validation and recovery                  | Produces frozen payloads; preserves review, checkpoint and retry guarantees          |
| D: verification | Read-only initial audit, independent contract and integration checks | Reports discrepancies to coordinator; test-only edits need assigned paths            |

Combining frontend and backend in one lane is permitted when a task needs one
owner. List both responsibilities and keep independent verification. One
person owning both sides still cannot revise the frozen contract unilaterally.

Each writer gets a separate worktree and branch plus exact owned paths. Shared
files have one writer at a time. Protected contract definitions, golden fixtures,
test runners, CI configuration, dependency versions, migrations and this
protocol are coordinator-controlled unless a specific edit is assigned.
Assignment of a shared-path edit must name its permitted change; it is not a
blanket exception. Do not overwrite another agent's work or cherry-pick it
without coordinator sequencing.

Use distinct ports, build outputs and isolated test storage. No shared writable
`.next`, generated output or writable dependency/virtualenv symlinks. No
production DB writes, paid provider calls, recovery runs or restarts for tests
without explicit authorization. Read installed Next.js guides before Next edits.

## 6. Agent execution rules

1. Report baseline, contract revision, worktree, branch, exact owned paths,
   dependencies and acceptance cases. Stop before editing if they disagree.
2. Implement one small reviewable slice. Preserve external behavior outside it.
3. Use the frozen fixtures and assertions. Add implementation tests without
   weakening independent acceptance tests, runtime validation or security.
4. Report a discovered mismatch immediately with the smallest concrete payload,
   expected behavior, actual behavior and affected producer/consumer. Continue
   only unrelated assigned work while the dependency is unresolved.
5. Never hide a violation using `any`, casts, ignored errors, suppressed checks,
   permissive parsers, silent field removal, defaults, skipped assertions or
   mock responses rewritten to match the new implementation.
6. Hand off exact commit(s), changed paths, commands/results and limitations.
   A statement that tests pass without identifying what ran is insufficient.

## 7. Contract change procedure

An implementer proposes; it does not edit the frozen contract first.

1. File a change request in its handoff: contract ID/revision, reason,
   before/after payloads, semantics, all affected consumers, compatibility,
   migration, rollout, rollback and proposed tests.
2. Coordinator checks the proposal with both sides and presents the concrete
   behavior change to Hemant. No response is not approval.
3. If approved, coordinator records the decision, creates a new revision and
   updates protected artifacts in a separate reviewable change before dependent
   implementation. Preserve the previous revision as historical evidence.
4. Notify all affected agents. Each acknowledges the new baseline/revision and
   updates its task; invalidate earlier acceptance evidence affected by it.
5. Integrate in dependency order, rerun both sides and combined verification.
   A coordinated atomic change or backwards-compatible staged rollout must be
   specified; do not assume old workers disappear when the API deploys.

Even an optional field can affect strict consumers, caches, saved drafts or
approval hashes. Do not label a revision safe solely because it is additive.
An urgent bug does not authorize silently bypassing review or validation.

## 8. Verification that catches semantic conflicts

The coordinator owns acceptance criteria and independent review. Implementer
tests are useful evidence, but are not the only evidence of compatibility.

For every changed boundary:

- Run the same frozen valid and invalid payloads against producer serialization
  and consumer runtime validation. Cross-language tests must exchange actual
  serialized JSON; matching handwritten mocks alone are insufficient.
- Include known value, explicit null, omitted key, empty value, wrong type,
  boundary numbers, invalid enum/date and unknown-key cases as applicable.
  Assert exact field preservation and intended rejection, not only HTTP 200.
- Exercise the real serializer/client pair. Where storage is affected, write
  and read back using an isolated database, then inspect the resulting API or
  matching decision. A mocked DB check does not establish persistence behavior.
- For eligibility, show that uncertain facts stay manual-check cases and do not
  become eligible through defaults. For auth, check direct requests, other-user
  ownership and logout; UI hiding alone is insufficient.
- For publication/recovery, check repeats, lost responses, saved draft reuse,
  stale approvals and state transitions without new paid extraction calls.
- Inspect changes to tests, fixtures, validators, scripts and CI against the
  frozen base. A check that became easier is a finding, even if green.
- Run relevant existing checks on each handoff, then on the combined integration
  commit. Freeze the exact combined commit before final acceptance.

Existing commands include `pnpm typecheck`, `pnpm lint`, `pnpm test`, and
`pnpm test:web`; choose affected suites after inspecting their current scripts.
Record the actual Python interpreter and focused/full suite commands in the
batch. Do not run uninspected tests against production credentials. Builds,
unit tests, DB tests, browser checks, CI and live checks are separate evidence.

This document does not install an automated enforcement gate. At present its
new rules require coordinator review. Before claiming mechanical enforcement,
assign and verify checks that detect protected-path changes and exercise frozen
contracts, and protect their configuration from implementer approval. Local
hooks or agent promises alone are bypassable. Repository permissions and branch
protection would need separately verified setup; none is claimed here.

## 9. Integration and completion gates

Use these states: `planned`, `contract frozen`, `implementing`, `blocked on
contract`, `handed off`, `independently verified`, `integrated`, `released`,
`live verified`. Never equate them.

The coordinator accepts a slice only when:

- [ ] Scope, paths, baseline and contract revision match the assignment.
- [ ] Protected artifacts have no unauthorized changes; no check was weakened.
- [ ] Producer, consumer and failure semantics match frozen acceptance cases.
- [ ] Relevant independent checks passed against the exact handoff commit.
- [ ] Combined verification passed against the exact integration commit.
- [ ] Missing checks and residual risks are explicit; unresolved required
      checks block completion rather than being relabeled as passing.

Integrate sequentially in a designated clean worktree, preserving the original
dirty checkout. Resolve semantic conflicts before resolving code mechanically.
When the base changes, re-review compatibility and rerun affected checks.
Do not force-reset, blanket-delete, force-push or merge to escape a failing gate.

This protocol authorizes coordination, not production release. Push, merge,
deployment, migrations and live mutation still require task-specific user
authorization. Describe local code, GitHub/CI, built image, deployed version and
live affected-path results separately. Rollback must account for persistent
data and schema changes; reverting code alone may not restore compatibility.

## 10. Copyable batch record — coordinator owns

Create one dated batch file per approved work package and link it from every
agent prompt. Keep the protocol here; do not copy divergent versions of it.

```text
Batch ID / objective / explicitly excluded work:
Status / coordinator / Hemant's scope decision:
Baseline commit / remote verification time / dirty-work preservation:
Agent assignments: owner, worktree, branch, owned paths, forbidden paths:
Integration worktree / branch / integration order:
Runtime ports / test DB / build outputs / no-paid-call policy:

Contract ID / frozen revision / decision reference:
Producer paths / runtime validator / storage mapping / consumer paths:
Protected schemas, fixtures, acceptance tests, scripts and CI paths:
Fields: presence, nullability, type/coercion, meaning, units, defaults:
Unknowns / dates / enums / errors / auth / ownership:
Idempotency / retries / state transitions / approval semantics:
Legacy compatibility / rollout / rollback:
Golden valid and invalid fixtures / expected results:
Exact checks / owner / environment / required versus informational:
Agent acknowledgements: agent, baseline, revision, scope, time:
Change requests / approvals / superseded revisions:
Handoff commits / independent results / combined commit and results:
Remaining risks / blocked checks / release authorization and evidence:
```

## 11. Copyable instruction — give to every agent

```text
Read AGENTS.md, docs/CODING_STANDARD.md, docs/AGENT_CONTRACT_PROTOCOL.md and
the linked batch record before editing. You are an implementer/reviewer within
the assigned scope, not an owner of shared semantics.

Work only in the assigned worktree and owned paths, from the recorded baseline
and frozen contract revision. First report those values and acknowledge the
valid/invalid acceptance cases. If the batch is incomplete, request coordinator
resolution before dependent implementation.

Do not change contract definitions, field presence/nullability, validation,
unknown handling, status codes, auth, ownership, retries, publication rules,
golden fixtures or acceptance expectations without a recorded approved revision.
Do not weaken tests, scripts or CI to make your slice pass. A clean worktree
merge and your own green tests do not establish integration compatibility.

If the contract cannot be met, send a minimal reproducer and change proposal
to the main coordinator; stop dependent work and continue only independent
assigned work. Do not silently change either side or hide the mismatch with
casts, defaults, coercion or rewritten mocks.

Handoff: task, baseline, contract revision, exact commits and paths, observable
behavior, producer/consumer evidence, commands/results, unrun checks, risks and
dependencies. Distinguish implemented, independently verified, integrated and
deployed. Do not merge, push, deploy, mutate production or make paid calls
without explicit task authorization. Hemant and the main coordinator resolve
contract decisions; you implement the approved contract.
```
