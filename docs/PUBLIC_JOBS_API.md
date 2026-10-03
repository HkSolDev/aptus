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
HTTP routing with a fake database transaction. Docker/PostgreSQL was subsequently
started and live reads verified all 14 stored posts with no duplicate IDs across
pages. No migrations were needed.

## Public browser pages (implemented)

The homepage now renders six posts per page, with previous/next links using
`/?page=2#jobs`. It is public, requires no profile, and is assembled on the server
using the same `listPublicJobs` function as the JSON API. No extra browser
JavaScript or client API fetch is needed for browsing.

`GET /jobs/<post-id>` renders a complete HTML detail page: qualifications,
vacancies, dates, age limits, detailed saved age/education conditions, category
relaxation, and collected document/application links. Missing values remain
"Not specified". Text is HTML-escaped and external links allow only HTTP(S)
without embedded credentials. PDF links are not assumed to be official.
Missing/replaced posts return an HTML 404; database failures return an HTML 503.
Post IDs may change when ingestion replaces posts, so these URLs are not yet
stable permanent notification identifiers.

Files to read in order:

1. `src/lib/public-jobs.ts`: shared bounded database reads and public fields.
2. `src/lib/render-catalogue.ts`: cards, pagination, empty/error states.
3. `src/lib/render-job.ts`: detail page fields and documents.
4. `src/lib/render-job-rules.ts`: conditional rules, without eligibility math.
5. `src/lib/job-html.ts`: HTML escaping, safe links, date formatting.

Markup/styles: `public/parts/catalogue.html`, `public/job.html`,
`public/css/catalogue.css`. The existing CSS tokens/cards and profile TypeScript
are reused. Home assembly is in `src/lib/render-home.ts`; routing remains in
`src/server.ts`. No login, matching-query rewrite, source re-extraction, or
database writes were added.

`scripts/public-pages.test.ts` covers HTML content, safe rendering, empty/error
states and 404s. `tests/public-browsing.test.ts` covers pagination, card navigation,
375/768/1280 widths and JavaScript-disabled access. Live browser verification
confirmed the PostgreSQL catalogue pages (6 + 6 + 2 posts) and opening the first
job detail with no browser errors. Preview: `http://localhost:8091/#jobs`.

Next: design real authentication and server-verified profile ownership before
adding account-based recommendations. Existing profile IDs are not authentication.
