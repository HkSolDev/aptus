# Aptus coordination — 27 October 2026

Status: assignments prepared; agents not launched or work accepted by this record.
Budget: 130 minutes from team kickoff. Hemant launches four agents. Hemant and
the main conversation coordinate, decide scope and review handoffs; they do not
take an implementation lane.

## Evidence and priorities

Notion tracker queried today: 51 non-Done rows, including stale broad tickets.
Do not treat every open row as unimplemented. Profile/Saved review is explicitly
Done in its latest release section; worker recovery was released, while its
broader extraction-quality roadmap remains In progress.

- [Scheduled worker observation](https://app.notion.com/p/405354a1ec5981e49d4bc0edbd778046): Not started.
- [Worker quality roadmap](https://app.notion.com/p/404354a1ec5981ceb208f5bc7412a9a4): In progress. Choose one offline diagnostic slice today.
- [Performance evidence correction](https://app.notion.com/p/404354a1ec5981718325f32cc247d194): Not started.
- [Home/back and global deadline sorting](https://app.notion.com/p/406354a1ec5981dbbae4eac2aa4e0cf2): discussion backlog; no cache architecture selected.
- [Automatic release](https://app.notion.com/p/405354a1ec5981da8a54cbd1481c31e7): required follow-up, Not started; larger than today's bounded correctness work.

Local contract audit previously identified nine failures. They are local findings,
not proof of deployed defects. See [contracts](contracts/README.md) and
[findings](contracts/analysis-and-sources.md). Today's frontend/backend lanes must
reproduce against their actual baseline before editing.

Initial read-only server sample: worker container exited 0 on image 7e974cc;
latest sampled report checked_at 2026-10-27T04:40:07Z (10:10 IST), partial_failure.
It reported 13 attempted sources, 9 succeeded/4 failed, 94 discovered documents,
69 prepared, 19 extraction attempts/10 succeeded/9 failed, 1 created draft,
37 total backlog awaiting review and 0 published. These counters are not unique
new jobs or proof of DB/UI changes. Server agent owns independent verification,
run-window attribution and current counts. Do not rerun extraction to verify them.

## Shared instructions — give to every agent

Read project Agents.md, coding-safety rules, CODING_STANDARD and the contract
protocol plus all three boundary docs before work. Report cwd, branch, HEAD,
dirty status, worktree inventory, intended files and exact baseline first.
Preserve the original dirty aptus-next checkout. Use a distinct worktree per
writer and isolated processes/output/test data. Do not silently reuse old
worktrees merely because their names sound relevant.

The contract pack is local/uncommitted on d930a69; production and current main
can differ. Request the coordinator's exact contract snapshot before starting
dependent edits in another worktree. Never assume a fresh main includes it.
Report any incompatibility between baseline and contract rather than silently
porting old application code. No agent edits protected schemas, fixtures, lock,
audits, acceptance expectations or this coordination document. New focused tests
may live in lane-owned files. Contract change requests go to the coordinator.

No dependency upgrades, production writes, paid AI calls, hold clearing,
publication, restart, push, merge or deployment. Local focused commits are allowed
in isolated worktrees after scope declaration. Only server agent uses production
SSH; other agents request sanitized evidence through coordinator. Never include
tokens, private applicant records or raw credentials in reports.

At 20 minutes report reproduction and bounded proposal before implementation.
Proceed only within assigned behavior; ask coordinator on policy ambiguity or
cross-lane files. Handoffs distinguish verified, partial, blocked and not run.

## Agent 1 — server and job-flow auditor (read only)

Independently verify the scheduled-worker ticket above. Inspect current image
revision/digest, cron/lock, container start/end/exit and persistent run reports.
Compare the last three scheduled runs, deduplicating reports by run identity.
Provide a per-run/per-source table: discovery/capture attempts, prepared inputs,
actual provider calls, successful extractions, fresh/reused drafts, review holds,
published posts and failure reasons. Explain whether succeeded source counts
include partial crawls; do not add overlapping counters as unique jobs.

Answer: how many genuinely new notices/drafts/public posts appeared since the
previous run and in the last 24 hours? Distinguish documents, bundles, posts and
vacancies. Use read-only aggregate DB queries and publication receipts where
available, compare public API visibility, and state when timestamps/identity do
not support an exact number. Reconcile 0 published with intentional review gates.
Inspect representative current capture failures versus historical stored errors.
No broad crawls or pipeline starts. Supply sanitized retained failure locations
for Agent 2 without changing durable state. Hand off the top two demonstrated
blockers, their stages and safe next actions.

Deliver: docs/SERVER_HANDOFF_2026-10-27.md in your own workspace, with timestamped
commands/evidence coverage and no private data. At 30 minutes send the counts
even if DB verification is blocked; continue remaining inspection afterward.

## Agent 2 — worker extraction diagnosis (offline first)

Use the worker roadmap's offline decoding slice. Inspect actual current decoder,
checkpoint/retry code and existing tests. Obtain sanitized retained failing
responses from Agent 1; group by stable diagnostic code and field path.
Separate HTTP success, refusal/truncation, invalid JSON/schema, semantic grounding
failure and checkpoint storage failure. Replay representative failures offline;
use synthetic fixtures if production evidence cannot safely be transferred and
label the coverage limit. Explain why successful provider requests can still
produce failed extraction.

At 20–35 minutes propose ONE smallest reproducible code fix, if evidence supports
one. Preserve all supported facts, numeric fields, nullable unknowns, source
grounding, review gates and immutable checkpoint reuse. Do not invent missing
facts or loosen validation/prompts merely to increase accepted counts. Any
required protected contract change or new model experiment blocks that slice
pending coordinator decision. If no safe bounded fix is established, deliver a
diagnosis and regression fixture instead of speculative implementation.

Own services/ai decoder/retry implementation files and new focused Python tests
only after exact scope declaration; no sources.json changes. Run focused checks
and the relevant Python suite, reporting baseline registry failures separately.
Deliver docs/WORKER_HANDOFF_2026-10-27.md with reproducible before/after evidence,
file list, commit and remaining failures.

## Agent 3 — frontend contract correctness

Reproduce FB-NULL-EDUCATION and FB-MALFORMED-SUCCESS on your verified baseline.
Align the public job wire types with required-but-nullable educationRequired.
Validate actual profile/Saved success envelopes at runtime: missing keys or wrong
types must raise visible recoverable errors, while legitimate null/missing-profile
states retain their contract meaning. Preserve the current valid Save/Remove JSON
request shape and ownership/session/origin behavior. Cover profile GET/PUT,
Saved list/status and Save/Remove consumers as applicable; do not introduce casts
that merely satisfy TypeScript. Include stale account/mutation behavior regression
coverage. Verify callers show errors without falsely marking a job unsaved.

Own frontend/profile-api.ts, frontend/saved-jobs-api.ts, frontend/types.ts and
components/jobs/job-card.tsx, plus new lane-specific tests. Declare any necessary
UI caller expansion first. No backend, matching, worker, schema or package edits.
Do not add a library. Run relevant client/boundary tests, typecheck/lint and a
focused browser flow if tooling is available. Audit remains coordinator-owned.
Deliver docs/FRONTEND_HANDOFF_2026-10-27.md with exact cases and evidence.

## Agent 4 — backend deterministic eligibility

Reproduce WF-AGE-REFERENCE, WF-RELAXATION-FLAG and WF-CONDITIONAL-GATES against
the actual matcher and existing fixtures. Fix bounded violations of existing
invariants: use valid stored ageAsOnDate; explicit false must not add category
relaxation; unsupported/unverified gender/nationality requirements must not
silently produce confirmed eligibility. Before editing, propose exact behavior
for absent/invalid reference dates and null relaxation flags to coordinator;
never guess a permissive default. Unknown facts remain manual verification.

Own scripts/match.ts and necessary focused matching helpers with new lane-owned
tests. No frontend, extraction, Prisma migrations, ingestion or legacy post-ID
rewrite. Test birthday boundaries/leap days, false/null/true relaxation, category
rules and unverified conditions, and existing experience/education logic. Confirm
matching remains deterministic/read-only and account ownership unchanged.
Deliver docs/BACKEND_HANDOFF_2026-10-27.md with policy decisions, failing-before
and passing-after cases, exact commands and commit.

## 130-minute schedule and acceptance

| Elapsed | Agents | Coordinator and Hemant |
| --- | --- | --- |
| 0–15 min | Baseline, contracts, scope and reproductions | Record four owners; resolve worktree/snapshot conflicts |
| 15–35 min | Evidence and smallest fix proposals; server counts | Decide ambiguous matching policies; choose one worker slice |
| 35–85 min | Implement bounded accepted fixes and focused checks | Review reported decisions and dependencies; no fifth coding lane |
| 85–105 min | Finish tests, fixed commits and handoffs | Compare results with contract and inspect evidence |
| 105–130 min | Answer review questions; assigned independent checks | Assign combined verification to an available agent; record accepted/blocked work and next tasks |

At minute 85 stop adding scope. At minute 105 freeze implementations for review.
Use Agent 1 as an independent verifier after its audit if capacity permits; a
fifth agent is optional read-only review, not another feature owner. Passing
isolated tests does not establish combined compatibility. Assign combined
contract, type/lint and relevant integration checks against one explicit tree;
agents must report remaining audit findings rather than modify the audit.

Today's success: trustworthy run/job counts with failures attributed; bounded
frontend/backend fixes with evidence; one worker failure understood or safely
fixed; exact remaining blockers. No promise to deploy within this window.
Performance/caching, CI/CD automation, dashboards, SEO, source expansion and
legacy identity redesign remain queued. Reprioritize if the server audit reveals
an active outage, without letting multiple agents change production.
