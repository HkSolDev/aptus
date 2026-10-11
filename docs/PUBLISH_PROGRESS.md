# Reviewed draft → public listing — 11 October 2026

## Result / current stage

The two verified LOCAL IIT Kanpur drafts are now public Post records. Count moved
14 → 16; repeat publication reused the same IDs. No remote deployment or push.
Original ExtractionCandidate facts/evidence/review remain unchanged, including
needs_review/publication_allowed=false. These original flags describe the draft,
not the later approval: public Post rows separately record reviewedAt, reviewNote,
extractionCandidateId and candidatePostIndex. Do not rewrite history to imply the
AI itself approved publication.

Local preview runs at http://127.0.0.1:8082 while its process is running:

- Project Technician: /jobs/cmv3t9obl0001t1aqgj7mpg2l
- Senior Research Analyst: /jobs/cmv3t9odi0003t1aqleee0p42

We are in stage 05 public listing publication for these two examples. This is not
completion of v0: eligibility matching, complete source-to-listing orchestration,
scheduling/change detection and the real-user trial remain separate checks.

## Problem / decision / benefit

Existing ingestion replaces all posts for a source and drops newer extraction
fields. Existing Post has payLevel, but that is not a salary amount; application
steps/documents/experience also have no column. Publishing via that route would
lose useful facts and disconnect the visible job from its reviewed draft.

Added an explicit operator publication function/CLI, not a public HTTP route.
It takes a candidate ID, the reviewed content hash and a review note; revalidates
its envelope, recomputes the hash, and rejects changed content. Publication is a
transaction. Existing posts from a different draft or older ingestion on the
same source cause a refusal rather than silent replacement. Candidate ID + post
index is unique, so repeats retain stable public URLs and rows. Source metadata
already present is preserved; this first publication uses the original source
URL, not an inferred application/homepage link.

Additive Post fields link the draft, retain per-post reviewedDetails and record
the explicit review. Scalar facts/education rules retain their existing matching
columns. The details snapshot preserves salary, route-specific experience,
application steps, materials and desirable labels for public display. It does
not invent a missing salary period or reclassify optional skills as mandatory.
Source citations remain in the linked draft; this slice does not add passage
jump links or a public evidence browser. Changed-source replacement is deferred.

## File relationships

- `scripts/store-extraction-candidate.ts`: shared canonical content-hash function;
  storage behavior remains identical.
- `scripts/publish-extraction-candidate.ts`: stored draft → reviewed public rows.
- `prisma/schema.prisma` and additive migration
  `20261011190000_add_reviewed_candidate_publication`: provenance fields,
  relation, uniqueness and review consistency constraint; applied locally.
- `src/lib/public-jobs.ts`: detail query selects reviewedDetails; catalogue query
  continues selecting its existing small public field set.
- `src/lib/render-reviewed-details.ts` → `src/lib/render-job.ts`: escaped salary,
  experience, application/materials and additional details on Fastify job pages.
- `public/css/catalogue.css`: wraps long application text/URLs in detail lists.
- `scripts/publish-extraction-candidate.test.ts`: review/hash guard, content
  changes, idempotence, draft preservation, existing-source refusal and HTML safety.

No extraction prompts/schema, matcher, authentication or Next.js code was changed.
The separate Next detail implementation is not the rendering path verified here;
this local preview uses the existing Fastify public pages. Do not claim Next
frontend or remote publication has been verified.

## Verification

- Publication suite: 3 pass, including PostgreSQL in a temporary isolated schema
  that was removed. Changed content with an unchanged stored hash is rejected.
- Existing public/jobs/ingestion tests: 12 pass (initial sandbox socket restriction
  resolved by rerunning with local server permission).
- Storage boundary: 1 pass, 1 isolated-storage integration test skipped; actual
  draft storage was verified in the preceding slice, not re-certified by this skip.
- Full typecheck and web build pass. Focused ESLint and Prettier pass.
- Full repository lint fails: 13,513 errors/32 warnings, including generated and
  unrelated files. No lint suppressions, unrelated fixes or full-suite claim.
- Actual LOCAL publication/readback: two rows, unchanged per-post details,
  duplicate publication reuses IDs; source drafts retained.
- Actual browser: both IDs in API catalogue; both detail pages HTTP 200; reviewed
  basic fields and official source links visible with JavaScript disabled; mobile
  viewport 375px has no horizontal overflow. A discovered long-URL overflow was
  fixed and both pages rechecked. Technician screenshot was visually inspected;
  both pages were checked through browser assertions.
- Stable preview health and both actual links respond HTTP 200 on port 8082.

Artifacts: `outputs/extract/three-notice-review-20261011/`:
publication-verification.json, public-page-verification.json, each notice's
published-page.png. No full candidate records printed, LLM calls or deployment
performed in this slice. No sub-agents used. Unrelated working changes preserved.

Next slice: verify deterministic matching on these jobs, particularly unknown
age/category and route-specific experience. Listing publication is not a promise
of eligibility. Do not silently turn missing conditions into a positive match.
