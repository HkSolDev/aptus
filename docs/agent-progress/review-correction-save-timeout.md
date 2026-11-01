# Review correction save timeout — 1 November 2026

Production browser saves returned HTTP 500 twice, with `revision_save_failed`
storage events. An always-rolled-back reproduction using the running API's
network settings returned Prisma P2028. The same operation with a bounded
20-second transaction completed in 7.67 seconds and was rolled back.

Confirmed production risk: likelihood 9, impact 6, score 54. An operator cannot
save source-backed corrections when database round trips exceed the default
five-second interactive transaction budget. No failed diagnostic write persisted.

The correction-save transaction now has a 20-second execution budget and a
five-second acquisition budget. Authorization, origin checks, row serialization,
base-revision checks, immutable revisions and publication boundaries are unchanged.
This does not speed up the database or change other transaction budgets.

A real PostgreSQL trigger delaying revision insertion by 5.2 seconds reproduces
P2028 before the fix and saves exactly one new current revision after it. All
nine review workflow/regression tests, lint and type checks pass locally.
Production browser save verification remains required after deployment.
