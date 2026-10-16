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

## Recruiting organization slice — mapping (16 October 2026)

Isolated branch `codex/aptus-organization-pipeline`, base `20f2b4a`.

- `services/ai/schema.py`: promote the candidate-only nullable `recruiting_body`
  into the shared Post contract. Extraction prompts require the recruiting body
  explicitly named in the notice, verbatim; unclear/conflicting means null.
- `extract.py`: retain only names located in supplied notice text. Bundle/staged
  extraction inherits the field; candidate validation additionally requires its
  name in a located citation. Quote presence is not semantic certification;
  candidate review remains required. No source/title/website fallback.
- `pipeline.py`: existing `model_dump(mode="json")` carries the field unchanged.
- `src/routes/ingest.ts`: validate nullable/bounded text before database access;
  map `recruiting_body` to `Post.organization`. Legacy omission stores null.
  Keep `Source.name` and all source URLs unchanged and separate.
- `prisma/schema.prisma` + additive SQL migration: nullable `organization` text;
  existing rows stay null, with no inferred backfill.
- `src/lib/public-jobs.ts`: select organization for list/detail and add it to
  existing case-insensitive keyword OR, preserving escaping/pagination/order.
  Existing frontend already accepts this field; no design edits needed.

At this base, candidate extraction is an offline review flow, with no candidate
publication/storage command. `src/schemas/notification.schema.ts` belongs to the
older TypeScript extraction experiment, not this Python ingestion contract; it
is outside this slice. No new publication route or extraction system is added.

Verification will use fictional provider output, HTTP ingestion and API tests,
plus a disposable local PostgreSQL database if available. No configured app DB,
secret environment files, live provider calls, push or deployment.

### Completed behavior and checks

- `recruiting_body` is required-but-nullable in current Python output; blank
  text becomes null, non-text/control characters/overlong names are rejected.
  Extraction nulls a name absent from the supplied notice text. Ingestion also
  nulls unlocated names and accepts omitted fields from legacy producers.
- Candidate validation requires the recruiting name in its cited quote; the
  existing evidence gate checks the quote's source location. The source website
  name is never used as a fallback. Identifying a name as the recruiter still
  depends on extraction/source review; substring checks alone cannot prove that
  semantic relationship. No live-model accuracy claim is made.
- Passed: all 164 Python tests (including five new organization cases), 22
  focused Node checks, changed-file ESLint and Prettier, focused strict TS
  compilation, frontend TypeScript build, Prisma client generation and diff
  whitespace checks. The Python handoff test inspects the serialized payload.
- Passed: disposable localhost PostgreSQL integration, including all migrations,
  preservation of an existing post with null organization, repeated ingestion,
  stored organization/null/legacy omission, anonymous list/detail responses,
  case-insensitive organization-only search and literal wildcard escaping.
  No configured application database or real user records were accessed.
- Repository `pnpm typecheck` still fails for the existing missing `openai` and
  `pdf-parse` modules. Repository lint still reports the 58 existing errors;
  changed files pass. Full `pnpm test`: 72 passed, 3 failed, 9 skipped. The three
  failures are the existing unauthenticated match-validation tests (503 versus
  expected 400); their tests, auth middleware and match route are unchanged from
  the base. Optional database/browser checks account for skipped tests. This
  slice does not repair unrelated auth/test setup.

### Migration and backfill boundary

Apply `20261016000000_add_recruiting_organization` and regenerate Prisma before
running this application version against a persistent database. Only the
isolated fixture DB was migrated here. Existing posts stay null until explicit
notice re-extraction/re-ingestion; unchanged-content hashes can skip those
notices, so a normal scheduled run is not a backfill. Never fill old values from
`Source.name`, page titles or website identity. No automatic backfill, live LLM
call, frontend design change, push or deployment was performed.
