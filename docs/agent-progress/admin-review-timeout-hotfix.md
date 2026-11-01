# Admin queue loading hotfix — 1 November 2026

Production screenshot showed an unavailable queue and a misleading zero count.
The imported database queue contains 20 items. Direct production queue reads
took 8,887 ms on the first read and 2,415 ms on the next. Frontend-to-private-API
connectivity succeeded in 55 ms for an unauthenticated request. Recent authorized
operator-status requests took approximately 0.6–4.7 seconds.

Admin pages aborted their private fetches after five seconds. A fictional
standalone-production fixture delaying the queue response by six seconds
reproduced the timeout and unavailable state. This is a confirmed bug when a
valid response takes longer than five seconds. Likelihood 8, impact 5, risk 40.

Changed admin queue/detail and operator-status fetch timeouts to a bounded
15 seconds, consistent with existing auth requests. Kept authorization and
`no-store` behavior intact. An unavailable queue now displays an unknown count
instead of falsely reporting zero imported notices. No database migration,
backend change, or cache of private review data.

Verification: regression failed against the prior standalone build and passed
against the fixed build (one six-second delayed response). Three UI tests pass,
including outage versus successful empty results. Local typecheck, lint, and
production build pass. The delayed production regression runs in the existing
CI build/browser test suite. This fixes the demonstrated timeout; it does not
claim to improve database query latency. Authenticated live browser acceptance
still requires the operator's existing session.
