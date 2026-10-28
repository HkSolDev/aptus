# Sort and ingestion release - 28 October 2026

Scope: combine accepted sort feedback (44dc48f) and unusable legacy ingestion guard (9961e2b) on main 526f597. No schema or dependency changes.

Sort selection updates immediately, retains cards while navigation waits, and announces pending work. Regression tests hold responses in both orders and cover native form submission.

Legacy ingestion refuses malformed names and nonempty batches with no usable names before any database write. Explicit empty-array behavior remains covered. Mixed batches and source/post atomicity are unchanged; atomicity remains a separate follow-up.

Integration corrections: format the sort component and compare seeded database IDs as sorted sets.

Verified locally: typecheck, lint, production Next build, and six sort browser checks. Ingestion database and contract checks and GitHub CI must pass before merge.

Deployment: frontend and API only, immutable full-SHA tags and OCI revision labels. Previous frontend/API tag 526f597c09cb389269b2e31cda74255cfbecf4c8 is the rollback target. Roll back if health fails, catalogue browsing/sorting fails, or API ingestion authorization fails. The worker is unchanged.
