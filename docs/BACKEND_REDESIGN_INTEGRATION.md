# Backend redesign integration

Base: frontend checkpoint `4dd8bcb`. Branch: `codex/aptus-backend-integration`.

## Implemented

- Slice 1: register public `GET /api/jobs/:id`, reusing the focused handler
  from the separate job-details-api worktree without importing its schema changes.
- Reuse `getPublicJob`'s explicit selection: stored eligibility alternatives,
  age/category conditions, public notification/application URLs and collection
  date. Preserve nulls; exclude raw hashes, source IDs and applicant data.
- Existing Server Component already fetches this endpoint and renders the
  approved detail component. No visual or matching changes.

## Verified

- Passed: six focused API/detail-rendering checks, changed-file Prettier and
  ESLint, frontend and Next TypeScript checks, `next build --webpack`, and
  `git diff --check`.
- API cases: anonymous read, preserved nulls/alternatives/conditions/links,
  exact public field selection, malformed/oversized IDs, rejected writes,
  missing record (404), and database failure (503 without private error text).
- API tests use fictional records and replace the Prisma read; no database
  connection or migration is needed for this routing slice.
- Repository `pnpm typecheck` remains blocked by the previously documented
  missing legacy `openai` and `pdf-parse` modules. `pnpm lint` reports 58
  pre-existing errors in legacy scripts/backend files; none are in this slice.
- No live database, deployment or fresh browser/visual comparison was run.
  The existing public selector and frontend appearance are unchanged.

## Remaining

- Recruiting organization is absent from storage; do not use the source name.
- Qualifications with degree/subject/ITI and multiple entries per level.
- Account-owned Saved/Hidden lists and bounded recommendations.
- Incremental frontend integration for those account flows.

## Next slice

Slice 2 only: carry nullable recruiting organization through extraction,
validation, ingestion, additive storage migration and public search/API.
