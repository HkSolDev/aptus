# Validation queue timeout — 1 November 2026

During production notice review, three of ten calls to `requestValidation`
failed with Prisma P2028. All ten correction readbacks passed. Queuing validation
uses a separate interactive transaction, still limited to five seconds after
the correction-save fix in PR #35.

Confirmed risk: likelihood 8, impact 5, score 40. Operators cannot reliably check
the saved revision when the database round trips exceed five seconds. The
transaction rolls back; a failed request must not be treated as a queued task.

Only the validation-request transaction now receives the same bounded
20-second execution and five-second acquisition budget as correction saves.
Existing completed/running/pending tasks are still reused; no retries or paid AI
calls are added. Authorization, publication and worker behavior are unchanged.

A real PostgreSQL trigger delaying task insertion by 5.2 seconds fails with
P2028 before the fix, then queues exactly one task and reuses it after the fix.
All ten review workflow/regression tests, lint and type checks pass locally.
Production check of the exact current revisions remains required after release.
