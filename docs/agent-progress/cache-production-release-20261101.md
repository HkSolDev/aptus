# Cache production release — 1 November 2026

- Base: 46d2ec2c641a1c4ef1c4d9c831aee6cda527660a.
- Frontend fix commit: b9d01e4548026e79c7d47deac1cf463cb0887357.
- Worktree: /private/tmp/aptus-release-46d2ec2 (detached HEAD).
- Frontend registry/running digest: sha256:8ad00f9b5a7d252585c9def1c636aa0f47336d7db48f0c3aca8a84e6c4f94997.
- API restored to previously verified release 46d2ec2; registry digest:
  sha256:24681cdf1b120c3863042963fcd0a709c7648e6c0330a43a39039bff485c5cd0.
- Coolify deployments aptus-invalidation-1-20261101073613 and
  aptus-invalidation-2-20261101073613 finished. Both containers healthy;
  running OCI revision labels verified. Previous cf989543 images retained.
- Frontend runtime INGEST_TOKEN configured from the existing API setting without
  displaying its value. API FRONTEND_REVALIDATE_URL points to the private frontend.
- Live public /?sort=soonest: first HTTP 200 -> one backend /api/jobs completion;
  second identical HTTP 200 -> cumulative backend completions still one.
  Neither response contained the unavailable notice.
- Authenticated private invalidation from the API returned HTTP 200 and warmed
  newest, soonest, and furthest successfully. No jobs were edited/published.
- Local focused unit/standalone checks: 14 passed before release. Production
  Docker build passed. TTL unset at deployment uses the new 7200-second default.
- Worker unchanged. No migration run during this release.
- Historical miss cause remains unconfirmed. Actual job-publication end-to-end
  invalidation was not tested by creating/changing a production job; the endpoint
  was exercised directly. Two-hour expiry was not waited out live.
- Source fix committed locally; no Git push or merge performed.
