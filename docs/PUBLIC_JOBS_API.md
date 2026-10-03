# Public jobs endpoint

Implemented on 3 October 2026 on `codex/public-jobs-auth`.

## Branch relationship

This branch starts from `codex/front-end` (frontend commit `5ce3f54`). Nothing
was merged. It contains the frontend commits plus the public API change.
Merge the frontend first, then compare/merge this branch against the target.
Before the frontend merges, compare this branch against `codex/front-end` to
review only the backend addition. Different branches do not cause conflicts
by themselves; incompatible edits to the same lines can. Avoid unrelated
frontend edits here. Existing unfinished backend edits were kept uncommitted.

Login is planned on this backend branch, not implemented by this endpoint.
Public browsing must remain available without login or a profile.

## Request

```http
GET /api/jobs?page=1&pageSize=20
```

- `page`: defaults to 1; integer from 1 to 10000.
- `pageSize`: defaults to 20; integer from 1 to 100.
- Repeated, empty, fractional, or out-of-range pagination values return 400.
- Other methods return 405 with `Allow: GET`.
- No authentication, profile, matching, LLM call, or database writes.

## Response

```json
{
  "data": [],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "totalItems": 0,
    "totalPages": 0
  }
}
```

Each data item has: `id`, `postName`, `postGroup`, `payLevel`, `vacancies`,
`applicationLastDate`, `ageAsOnDate`, `minAge`, `maxAge`, `educationRequired`,
`minEducationLevel`, `minMarksPercent`, and a nested `source` object.
Source fields: `name`, `url`, `notificationPdfUrl`, `officialSiteUrl`,
`applyUrl`, `fetchedAt`. Stored nullable values remain null; dates serialize
as ISO strings. No source hash or personal profile fields are selected.

One item is one extracted post, not necessarily one notification page: several
posts can share the same source. This lists all stored posts, including those
with expired or unknown deadlines. It does not claim that all applications are
open or that the viewer is eligible. Full conditional eligibility rules are
not included in this list summary.

## How it works and limitations

`src/server.ts` routes requests to `src/routes/jobs.ts`. That file validates
pagination, then Prisma uses PostgreSQL `skip`/`take` and counts stored posts.
Rows sort alphabetically by `postName`, then uniquely by `id`; this is not
newest-first ordering. Count and rows share a repeatable-read transaction so
pipeline updates cannot disagree within one response.

An empty catalogue or a page beyond the last page returns 200 with an empty
`data` list. Database failures return 503 with `{ "error": "..." }`, never a
fake empty list or leaked connection details.

Offset pagination is simple for the initial catalogue. Separate page requests
are not a frozen snapshot: pipeline replacements between requests can move
rows. Deep offsets and exact counts become more expensive as data grows;
measure before adding indexes, cursor pagination, or caching.

Tests: `scripts/jobs.test.ts`, included in `pnpm test`. They exercise the real
HTTP routing with a fake database transaction, not a live PostgreSQL instance.
Docker/PostgreSQL was unavailable during this change, so live database-backed
verification remains required before deployment. No migrations were needed.

Next slice: wire public browsing into the homepage using this endpoint. Then
design real authentication and server-verified profile ownership before adding
account-based recommendations. Existing profile IDs are not authentication.
