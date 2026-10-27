# FB-v1: frontend ↔ backend

Scope: custom JSON APIs at the local baseline in [README](README.md).
Machine descriptions: `contracts/http.openapi.json` and `http.schema.json`.
Semantic rules here supplement schemas; they are not replaced by TypeScript.

## Routes and callers

| Operation                    | Caller / provider                                                              | Request and success                                                    | Failure behavior                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| GET `/api/jobs`              | `components/jobs/catalogue-grid.tsx` → `src/routes/jobs.ts` / `listPublicJobs` | `page`, `pageSize`, `q`, `qualification`, `sort`; `{data, pagination}` | 400 invalid filters/page; 405 other methods; 503 storage outage                                                           |
| GET `/api/jobs/:id`          | `app/jobs/[id]/page.tsx` → `src/routes/job-detail.ts` / `getPublicJob`         | Safe ID → one public detail object                                     | 404 invalid/missing ID; 405 other methods; 503 storage outage                                                             |
| GET `/api/profile`           | `frontend/profile-api.ts` → `src/routes/profile.ts`                            | Session → `{profile: object or null}`                                  | 401 no session; 503 auth unavailable or storage error                                                                     |
| PUT `/api/profile`           | Same client/provider                                                           | Profile input → `{profile: saved object}`                              | 400 invalid payload; 403 origin mismatch; 401 no session; 503 unavailable                                                 |
| GET `/api/saved-jobs`        | `frontend/saved-jobs-api.ts` → saved-job routes/library                        | Page → `{data: saved jobs, pagination}`                                | 400 invalid page; 401 no session; 503 unavailable                                                                         |
| GET `/api/saved-jobs/status` | Same client/provider                                                           | `ids` comma list → `{savedIds: string[]}`                              | 400 >50/invalid IDs; 401 no session; storage exceptions reach generic error handler                                       |
| PUT `/api/saved-jobs/:id`    | Same client/provider                                                           | No body → `{saved: true, savedAt: ISO timestamp}`                      | 400 invalid ID; 404 missing post; 403 origin; 401 session; 503 storage                                                    |
| DELETE `/api/saved-jobs/:id` | Same client/provider                                                           | No body → `{saved: false}` even if already absent                      | 400 invalid ID; 403 origin; 401 session; 503 storage                                                                      |
| POST `/api/match`            | Profile form / `frontend/api.ts` → `src/routes/match.ts`                       | Preferred `{}`; backend loads saved profile; `MatchResponse`           | 400 missing profile/forged ownership/invalid legacy fields; 403 origin; 401 session; 503 profile read; 500 other failures |
| POST `/api/explain`          | Explanation box / `frontend/api.ts` → `src/routes/explain.ts`                  | `{postId, userId?}` → `{explanation: string}`                          | 400 missing post ID; 404 missing job/profile; 401 session; 503 auth unavailable; 500 other failure                        |

Errors are currently `{error: string}` for these custom routes, not a newly
invented `{code,message}` protocol. Framework errors are sanitized by `src/app.ts`.
Do not silently change error shape, status or method behavior during unrelated
work. Library auth routes have their own response protocol.

## Transport and authority

- Browser `/api/*` calls are rewritten by `next.config.ts` to
  `BACKEND_INTERNAL_URL`; server-rendered catalogue/detail requests call that
  backend directly. Defaults differ between frontend and worker: inspect
  deployment environment, never assume localhost means another container.
- Same-origin cookies accompany browser requests. Session lookup establishes
  `request.authUserId`. Profile and saved-job operations use that ID only.
  `userId`, `id` and `authUserId` are rejected in match ownership input; profile
  input rejects all unknown keys. Explain still accepts a legacy `userId` but
  ignores it when selecting the profile. Response `userId` is an application
  profile ID, not authority for the next request.
- Profile PUT, saved PUT/DELETE and match POST require exact configured Origin
  before private reads/writes. Do not remove this when testing through a proxy.
  Explain is a read operation; its current route has session protection but no
  equivalent explicit origin hook. This is recorded behavior, not permission to
  remove other routes' checks.
- Private responses use no-store headers where implemented. Catalogue fetches
  use no-store; the Next detail fetch requests `revalidate:60` while the backend
  detail route sends no-store. Effective caching across the proxy has not been
  measured; agents must not promise instantaneous publication visibility.
- Body limit is 1,048,576 bytes at Fastify. Request timeout is 30 seconds; this
  is distinct from database transaction and client timeouts.

## Job fields and nulls

`publicFields` in `src/lib/public-jobs.ts` selects the public DTO. List and detail
serialize Prisma Date objects as ISO timestamps. All selected keys are present.
`id` and `postName` are strings; `source.name`, `source.url`, `source.fetchedAt`
are required strings. The selected source links can be null.

`organization`, `postGroup`, `payLevel`, `vacancies`, `applicationLastDate`,
`ageAsOnDate`, `minAge`, `maxAge`, `educationRequired`, `minEducationLevel` and
`minMarksPercent` can be null. Detail additionally returns `reviewedDetails`,
`eligibilityRules`, `categoryRelaxationApplies`, `categoryRelaxationRules`;
nullable JSON remains null, not `{}` or a guessed rule.

`educationRequired:null` is valid provider output. The existing two list-card
types incorrectly exclude it; see FB-NULL-EDUCATION. Defensive rendering does
not make those type declarations correct. Optional view props are not authority
to make required wire keys optional. Unknown organization is never replaced by
the scraper/source name. Zero vacancies is a known count, not missing data.

Public responses must not contain applicant data, review notes, credentials or
drafts. `reviewedDetails` is a deliberately public set of approved job facts;
`ExtractionCandidate.review` is not that public object.

## Pagination, filters and dates

- Catalogue defaults: page 1, size 20; Next currently requests 6. Page range
  1–10000; size 1–100; integer decimal text supplied once. Duplicates and malformed
  numeric strings fail. `q` max 100 chars, no controls, trimmed/NFC normalized.
  Unknown qualification or sort fails. Sort is `soonest` or `furthest`.
- Catalogue search covers title, qualification text and organization. Sorting
  uses deadline ascending/descending, nulls last, ID ascending tie-breaker.
  Legacy HTML calls without filters use alphabetic title order. Qualification
  filter checks flat minimum or supported nested education options; it is a
  discovery filter, not an eligibility decision.
- Expired application calendar dates are hidden using the current India date.
  Today's deadline remains visible until midnight Asia/Kolkata; unknown
  deadlines remain listed. Display treats stored calendar dates in UTC to avoid
  day shifts. An ISO wire timestamp is not an application closing time.
- Saved list defaults size 20, ordered savedAt descending then ID descending;
  it is an account shortlist and does not apply the catalogue's active filter.
  Count and rows share RepeatableRead snapshots; no agent should weaken
  transaction isolation to improve a test result.
- Pagination `{page,pageSize,totalItems,totalPages}` always exists. Empty result
  has zero totalPages, not one invented page. Client page controls must handle
  empty and out-of-range pages honestly.

## Profile and matching

Input DOB is a real `YYYY-MM-DD` calendar date, year >=1900, not in the future
relative to India today. Category may be omitted or null (unknown), or exactly
General/OBC/SC/ST/EWS/PwBD. At least one unique education level is required:
TENTH/TWELFTH/DIPLOMA/BACHELORS/MASTERS/PHD. Marks may be omitted/null or a finite
number 0–100. Strings are rejected for marks. Unknown outer/education keys fail.

Saving replaces the account profile's education set. Storage uses UNSPECIFIED
for unknown category, but the serializer returns null. Response education is
ordered by the enum's education ranking and always includes `marksPercent`.
GET null means no profile; malformed JSON or a missing `profile` key must not be
treated as proof that no profile exists (current consumer gap).

Match reads the saved account profile without saving submitted profile fields.
The current Next form sends `{}`. Legacy fields are still validated for older
callers; accepting them does not mean they select the candidate. Null ages,
unknown education, missing required marks and unsupported conditional rules
belong in `needsManualCheck`, with reasons, never optimistic matches. Matching
is not paginated today; do not claim the planned pagination stage is complete.
Explain uses stored facts and the deterministic matcher, not a fresh LLM call.
Current compliance is partial: the audit reproduces age-reference, relaxation-flag
and gender/nationality manual-check gaps in scripts/match.ts. A correct JSON
shape does not establish that every eligibility requirement was evaluated.

Save PUT is idempotent per `(authUserId,postId)` and preserves savedAt on repeat;
DELETE is idempotent for that account. Profile PUT describes replacement, not
a patch. A client timeout alone cannot establish whether a mutation committed.
Do not add blind retries or show success from a Boolean cast of a missing field.

## Other exposed surfaces

`/health`, legacy HTML `/`, `/jobs/:id`, static CSS/JS routes and Better Auth
`/api/auth/*` are not custom DTOs in the OpenAPI file. Auth registration exposes
Google sign-in/callback, get-session, sign-out and passkey routes under the
existing auth modules; pin library semantics and run their existing tests.
Design-review fixture responses may have preview-only flags. They are not
production worker facts and must not enter publication or eligibility policy.
