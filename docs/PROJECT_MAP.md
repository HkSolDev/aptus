# Aptus — start here

**Home presentation — 15 October:** Home layout now follows the approved
reference across mobile/tablet/desktop, with independent wider Rows/Cards and
local-only guest/setup/ready examples. Nine reference comparisons and ten
focused checks pass; see [exact scope and backend gaps](UI_REDESIGN_IMPLEMENTATION.md).
Real account recommendations/Saved persistence remain unconnected. Review Home
at `http://127.0.0.1:8082/?reviewProfile=ready` before starting another page.

**Shared navigation — 15 October:** approved mobile bottom Home/Saved/Profile
bar and tablet/desktop top navigation implemented and verified. Production
build/type/lint plus all five Next browser checks pass, including the formerly
pending Home scenario. Exact three-device reference comparison and screenshots
are recorded in [redesign implementation](UI_REDESIGN_IMPLEMENTATION.md).
Saved is an explicit unavailable destination until its backend slice exists.

**Local visual comparison — 15 October:** user approved the reference's four
fictional jobs for review. An isolated fixture API (8891) and implemented Next
review copy (8082) avoid the configured database and existing app server. See
[startup commands and boundaries](UI_REDESIGN_IMPLEMENTATION.md). This is sample
data for comparing the current slice, not completed recommendations or Saved.

**Home search/filter/sort — 15 October:** implemented in Next and the public API;
final build/type/lint checks pass and a real isolated PostgreSQL test passes.
The newly added complete Home browser flow remains unrun because automatic
approval review hit a usage limit. Temporary test DB cleanup and Obsidian sync
are pending too. Read [exact scope and resume point](UI_REDESIGN_IMPLEMENTATION.md)
before advancing; do not claim full browser verification.

**Frontend redesign — 15 October:** first Next.js slice is implemented locally:
neutral system light/dark tokens, compact header/intro, conditional public cards
and a keyboard skip-link/Back regression fix. No deployment or new dependency.
See [implementation, checks and backend gaps](UI_REDESIGN_IMPLEMENTATION.md).
Next: review this slice, then API-backed search/filter/deadline sorting.
Follow-up: approved `/sign-in` card now replaces header provider buttons;
first-slice gutters, heading scale and two-column wider card view corrected
against the saved preview. Final navigation/Saved/recommendation work remains.


Updated: 7 October 2026. A compact navigation map, not a fresh full-system audit.
Current pipeline branch: `codex/discovery-links`. Verify relevant code when its behavior changes.

**Candidate validation slice (8 October):** `services/ai/validate_candidate.py`
checks strict candidate structure, complete ISO dates, numeric bounds, age/pay
and application-date ordering, post-name duplicates and source citations.
Single-pass and staged extraction attach this offline report. Explained nulls
and empty arrays continue as review flags; invalid facts block. Source authority
and scope uncertainty remain visible. No automatic persistence or semantic
certification. See `docs/RECOVERY_PROGRESS.md` for saved-example checks.

## Active pipeline work — 7 October 2026

User direction: shared discovery from a supplied public website URL; English/Hindi
government recruitment pages. Work one stage and one small slice at a time.
Use Ponytail: small readable Python modules, existing dependencies, focused reads
and tests. Explain files and show actual output in a short progress Markdown file.
Do not repeat whole-repository exploration. Preserve unrelated working changes.

**Discovery first slice:** `services/ai/link_discovery.py` collects contextual
links from saved HTML, conservatively resolves/deduplicates destinations, and
keeps every occurrence. `discovery_score.py` assigns separate notice/bridge
scores and ranks unique destinations by their strongest occurrence. It does not
automatically traverse pages. See [files, live results and remaining work](DISCOVERY_PROGRESS.md).
Committed/pushed as `477d2c9` on `codex/discovery-links`.

**Capture first slice:** `services/ai/capture.py` downloads bounded public HTML
or PDF bytes, conditionally revalidates with server headers, handles redirects,
and returns snapshot references. `capture_store.py` stores byte blobs, immutable
snapshot metadata, URL state and attempts. Identical bytes reuse a snapshot;
304 reuses a verified saved body; failures retain the last good snapshot.
Metadata changes affecting interpretation, such as charset, can create a new
snapshot even with identical bytes. A changed byte hash is not a meaningful-job
change verdict. PDF capture does not parse PDF text or perform OCR.
See [Capture files, checks and boundaries](CAPTURE_PROGRESS.md).
Capture code/tests/report and `outputs/capture/check.json` are uncommitted and
not pushed as of this note; user authorized implementation, not a new push.

**Later Capture decision:** production should keep URL/hash/ETag/Last-Modified
metadata durably, use raw HTML/PDF temporarily through successful extraction and
job persistence, then remove the raw file. The archive prototype above has not
yet been simplified or integrated; do not mistake it for the agreed retention policy.

**HTML Normalize completed slice:** `services/ai/normalize_html.py` reads
captured bytes offline into ordered headings, text, lists, table rows and
HTTP(S) link occurrences. Existing BeautifulSoup `html.parser` is pinned by
code; no PDF parser or LLM was added. It retains uncertain header/footer/aside
content, strips scripts/styles/comments and explicit navigation, preserves
Unicode NFC text and resolves only HTTP(S) links. Source table cells remain in
their originating row; merged cells and nested structures produce honest
warnings instead of invented layouts.

Tests: eight implementer smoke checks are in
`services/ai/tests/test_normalize_html_smoke.py`; the other AI's independent
15-case suite is in `services/ai/tests/test_normalize_html.py` and passed
unchanged. Full relevant command passed: 47 tests total. A prior captured
SarkariResult homepage produced 178 blocks and 320 link occurrences in
`outputs/normalize/sarkari-home.json`. See [contract, files, output and limits](NORMALIZE_PROGRESS.md).
All Normalize files/output remain uncommitted and unpushed. Next is manual
review on a real notice page, then separate representative-PDF evaluation.
The small contract has no per-block evidence locator yet; generic chrome and
malformed layout behavior need real-notice review before expanding it.

Live review evidence: a discovered IBPS RRB HTML notice captured and normalized
to 63 blocks/54 links; job dates, fee, age and vacancy/eligibility table survived,
while branding/social text demonstrates the current conservative chrome boundary.
A discovered RPSC PDF captured successfully but `pdfplumber` emitted unreadable
legacy-font Hindi despite a visually readable Hindi page. Do not use its native
text downstream. Exact outputs and URLs are recorded in `NORMALIZE_PROGRESS.md`.

Second live HTML check: the RPSC advertisements listing normalized its 620-row
notice table and found 622 official PDF URLs, but icon-only PDF links became
empty table cells and were detached into the global link list. Required next
HTML refinement: attach every link to its owner block/table cell with row and
heading context. This also solves the earlier "Download Updated Vacancy Details"
case, where anchor text alone was only "Click Here". Do not treat detached RPSC
PDF URLs as related to a specific vacancy row until this is fixed.

**Current handoff:** HTML link ownership is now implemented via
`normalize_html(..., include_link_context=True)`; the legacy two-argument
contract remains compatible. Every contextual link has an owner block plus
table row/cell or list-item indexes as appropriate. Sarkari vacancy-PDF row
context and all RPSC icon PDF row relationships survived the saved-byte reruns
with zero unattached links. Review outputs: `sarkari-with-context.json` and
`rpsc-with-context.json` under `outputs/normalize/`. See Normalize progress.

**PDF diagnostics implemented:** `normalize_pdf.py` retains native alternatives,
word/table geometry, font counts, page statuses and warnings. RPSC's actual
DevLys 010 font produces rejected native text; selected text remains null. All
pages in this first diagnostic slice require review/fallback; no text is
auto-approved. Existing `pdfplumber==0.11.10` is now declared in requirements.
See [PDF files, contract, real result and limits](PDF_NORMALIZE_PROGRESS.md).
One real 76-page English IBPS RRB XV recruitment PDF was also evaluated with
an explicit 100-page budget: every page was a usable native-text candidate,
including recruitment heading, dates and schedule, with 97 detected table
regions. Its source text remains
unselected pending a later acceptance policy; this does not prove structured
PDF extraction. No OCR/converter/production integration yet. No subagents used.

**PDF evidence selection first slice:** `select_pdf_sections.py` consumes existing
diagnostics offline and packages readable native-text candidates into topic
ranges with page/block/line evidence. Six target topics, explicit contents-page
exclusion, unresolved references, rejected-page coverage gaps and whole-unit
character-budget omissions. It never declares complete coverage. IBPS saved-byte
run: 76 indexed pages, 72 candidate ranges, 102,702/190,599 characters selected,
all six topic families matched; Appendix I/II remain unresolved. Full suite:
62 tests passed. Output: `outputs/normalize/ibps-selected-sections.json`.
See PDF progress for limitations, local CLI, and the private Notion slice/backlog
record. Changes in this slice are local and unpushed. Next is source comparison
and better scope/table continuity before automatic LLM use.

8 October latest decision: keep broad selection and prioritize complete evidence.
Removed the extra `refine_pdf_sections` / `--refine` pass: it reduced the saved
IBPS subset by only five characters and could not recover omitted table rows.
`complete_pdf_sections` now restores complete source pages for selected
education/age/reservation/vacancy evidence, preserves other selected lines,
deduplicates overlaps and flags missing blocks and budget excess. CLI supports
`--candidate-json` for the saved broad selection. Contents whitespace bug fixed;
all 18 focused selection tests pass. IBPS qualification pages 18–20 and vacancy
page 47 match full native source text. Output: 123,506 characters, above the
120,000-character budget; do not treat this as approved automatic LLM input.
Unselected pages and cross-page table coverage remain unproven. Improve trimming
later using actual failures, rather than forcing a reduction percentage.
See PDF progress for the decision and checks. GitHub CI does not run Python yet.

Verified: 56 focused Python tests pass, using
`PYTHONPATH=services/ai services/ai/.venv/bin/python -m unittest discover -s services/ai/tests -q`.
Live check: Sarkari HTML `changed → identical`; official RPSC PDF
`changed → revalidated`. Bodies for that check live in the temporary directory
`/private/tmp/aptus-capture-check`; the small result JSON is in `outputs/capture/`.
These checks do not prove ranking accuracy, complete coverage or deployment.

Still separate: human-labeled ranking evaluation, recursive fetch queue/depth
and page budgets, crawl-rule handling, restart/resume, real-notice HTML review and PDF parsing,
parsed-content fingerprints, and integration with the running pipeline.
The existing `pipeline.py` still uses its old adapter/hash path; new components
are callable/local commands, not connected to that flow or a public endpoint.
Capture's DNS checks do not fully prevent rebinding; transport pinning or egress
restrictions are needed before exposing arbitrary URL fetching. Local storage
assumes one worker. Do not resume by silently expanding into the next stage.

Pipeline handoff, 8 October: `services/ai/verify_bundle.py` now groups candidate
recruitment documents offline and preserves HTML/PDF content with source locators.
Explicit role/identity hints, exact campaign matching, configured issuer-host
checks and review flags; no fact override, full authority guarantee or production
integration. Ten focused tests pass. Saved IBPS v1 evidence forms `IBPS / CRP
RRBs XV`, marked for review for mirror authority and appendix references.
See [Verify contract, responsibilities and limits](VERIFY_PROGRESS.md).

Latest real-pair check: selection now retains readable first-page identity
context separately from topic-selected text. Verify uses its actual locators.
Official IBPS XV main PDF plus 25 September corrigendum now form one bundle
(previously two because the main title was dropped). All 31 focused checks pass;
real pair retains separate content. Status remains `needs_review` for amendment
scope, content budget/coverage and unresolved references. See Verify progress.

Pipeline recovery slice, 8 October: `recovery_queue.py` persists local SQLite
URL tasks and bundle dependencies, deduplicates claims, limits attempts and
rejects stale completions. `recover_documents.py` connects existing capture and
normalizers with bounded process workers and immutable normalized outputs.
All recovered dependencies yield `ready_for_coverage`, not LLM approval.
12 recovery checks and 48 combined focused checks pass; controlled fixtures,
not live downloads. Missing URLs are explicit inputs; automatic coverage,
bundle re-verification, PostgreSQL and legacy pipeline integration remain open.
See [recovery contract, run instructions and limits](RECOVERY_PROGRESS.md).

Pre-LLM handoff, 8 October: `check_coverage.py` produces seven field-family
candidate hints and a coverage_focus list; missing keywords never mean a field
is absent. `build_extraction_input.py` preserves all supplied selected evidence,
HTML cells, PDF locators, quality/authority/amendment flags and a structured
output contract. Explicit linked amendment gaps use the recovery queue; after
terminal recovery, partial extraction keeps warnings without another cycle.
The caller supplies the verified expanded bundle. Oversized/empty inputs are
held without silent truncation. 14 handoff tests and 42 combined checks pass.
No provider call or legacy pipeline integration yet. See Recovery progress.

Model trial, 8 October: `extract_bundle.py` now supports structured OpenAI/
Gemini call with safe error handling and an exact-quote/field citation audit.
CandidatePost adds fee/pay/experience, vacancy breakdown, candidate steps and
links without changing ingestion schemas. Normalized link destinations now
have evidence IDs. One real saved IBPS HTML input is prepared (55,805 characters);
the developer's Gemini trial returned 10 posts, with substantial citation gaps.
`normalize_candidate_facts.py` corrects unsupported CA degree mapping, separates
pre-exam training and normalizes complete dates, recording every correction.
The saved-response replay retained 10 posts with 34 corrections; 31 focused
extraction/input tests pass. Fresh assistant invocation remains blocked because
process credentials are unavailable. Manual/cron only; no public trigger
or ingestion. See Recovery progress for the runnable command and boundaries.

Inline extraction slice: `inline_extraction.py` derives the model schema from
CandidatePost, attaches evidence/status/scope to scalar facts, then builds final
values and citation paths in code. Separate education_options retain their own
evidence. Missing/ambiguous/conflicting/document-gap nulls require explanations.
Scope quotes are located, not certified as applicable; semantic support remains
unverified. 39 focused tests pass, including nonempty mocked provider transport.
The saved IBPS input upgrades to 59,483 characters; no new model trial yet.

Provider compatibility follow-up: Gemini rejected the full nested inline schema
with HTTP 400. Tiny control/legacy/single-deep-field probes succeeded, pointing
to combined schema complexity. `compact_inline.py` now supplies a shallow facts
array per post; Python validates relative paths, reconstructs the nested records
and retains strict CandidatePost types/evidence checks. 43 focused tests pass.
Live compact schema acceptance succeeded. A fresh IBPS request returned only
Office Assistant and an invalid array-parent null, so validation rejected it.
Raw public output: outputs/extract/ibps-html.inline-provider.json. No corrected
model result or accuracy improvement claimed. See Recovery progress.

Staged trial: `staged_extraction.py` adds a grounded roster, scoped shared rules,
quote-reference reuse, two-post batches and one bounded repair per batch. Use
extract_bundle.py --staged; web users cannot trigger it. The common provider
request boundary remains in extract_bundle.py. 49 focused checks pass.
Real IBPS trial found all 10 posts, but final acceptance remained 0/10 due to
unreported required scalar fields and malformed outputs. It used 222,859 total
reported tokens across 12 calls; repeated inputs make this unsuitable as-is.
Offline replay adds exact field-gap diagnostics and resolves known source-unit
references without inventing a supporting span. No additional provider calls.
Do not publish it or treat roster coverage as field completeness. See progress.

Credentials fix: run `scripts/run-bundle-extraction.cjs` manually/from cron to
load the local root configuration using the existing dotenv dependency and
launch Python. extract_bundle accepts numbered Gemini keys in numeric order;
only explicit key rejection fails over. Quota/timeouts stop without cycling.
Real credential files were not read by the assistant; tests used placeholders
and mocked launcher loading. 27 focused checks passed. See Recovery progress.

## Passkeys — 7 October 2026

Review route: `prisma/schema.prisma` / additive passkey migration →
`src/auth/passkeys.ts` (plugin/domain/device proof) → `recent-proof.ts` (five-minute
authentication freshness) → `passkey-schema.ts` / `passkey-routes.ts` (validated
HTTP) → `frontend/passkeys.ts` / `passkey-ceremony.ts` (UI/WebAuthn).
`auth.ts` composes the plugin and same-account reauth; `routes.ts` supplies the
Origin gate; rate-limit/logging modules cover new operations. Existing PostgreSQL
session guard remains authoritative. No Redis/session-cache change.

Tests: `scripts/passkey-policy.test.ts`, `passkey-browser.test.ts`,
`helpers/passkey-fixture.ts`; independent `passkey-models.test.ts` needs fixture
correction. See [implementation evidence and local activation](AUTH_IMPLEMENTATION.md#passkey-implementation--7-october-2026).

## Working agreement: small steps, fewer tokens

For each requested implementation:

1. Name the main file, intended change and focused check before editing.
2. Work on that small slice, then stop for the developer to review.
3. Explain any necessary supporting files first; do not force an unsafe one-file fix.
4. Read this map and only relevant code/docs. Avoid repeating broad research,
   full suites, independent reviews or canvas rewrites for every small change.
5. Run focused checks; use broader checks when integration/security risk warrants.
6. Report changed files, results and remaining risk briefly. Do not push unless asked.

Keep this map current only where the task changes it. Link existing history rather
than duplicating it. No keys, tokens, applicant details or private logs here.

## What the product does

Anyone can browse stored government jobs without login. Account holders will
enter their profile and get deterministic eligibility matches, with manual-check
results when requirements are uncertain. Related-exam discovery is later work.
The LLM extracts job facts offline; it does not decide a person's eligibility.

## How the pieces connect

```text
Python main → pipeline → SarkariResult HTML → text / sections / links
                   ↓ changed content only
             extract → provider API → Pydantic posts → age validation
                   ↓ finished JSON
Fastify app → internal ingest → Prisma → PostgreSQL
                   ↓ stored jobs
Public routes → catalogue / detail HTML → browser (login not required)

Google login → auth routes → Better Auth OIDC → PostgreSQL session
                   ↓ signed opaque cookie
Private profile guard / account-owned matching: NEXT, not connected yet
```

## Python extraction files

Paths in this section are under `services/ai/`.

| File | Responsibility / connection |
| --- | --- |
| `main.py` | Loads configuration; exposes Python health/pipeline trigger handlers. |
| `pipeline.py` | Orchestrates discovery, fetching, change checks, extraction, validation and ingestion. |
| `sources/sarkariresult.py` | Discovers notices and parses HTML into full text, bounded sections and links; saves PDF links, not PDF contents. |
| `hash_cache.py` | Hashes content and loads/saves the local successful-run cache. |
| `extract.py` | Builds extraction prompts from text/sections and returns structured posts. |
| `llm.py` | Chooses the configured provider; keeps provider selection out of extraction logic. |
| `providers/base.py` | Common provider protocol / expected return shape. |
| `providers/openai.py` | OpenAI-compatible provider request and response handling. |
| `providers/gemini.py` | Gemini provider request and response handling. |
| `providers/__init__.py` | Marks the provider package. |
| `schema.py` | Pydantic post/batch and eligibility-rule shapes. Correct shape does not prove factual correctness. |
| `age_extractor.py` | Reads explicit source age facts without an LLM. |
| `validate.py` | Compares extracted age rules with source facts. Not complete validation of every eligibility condition. |
| `requirements.txt` | Python dependencies. |
| `tests/test_sections.py` | HTML section/table extraction checks. |

Some Python files have developer-owned uncommitted edits. This map does not
certify those edits or claim a new live pipeline run.

## TypeScript backend files

| File | Responsibility / connection |
| --- | --- |
| `src/server.ts` | Starts/stops the listening server and validates its port. |
| `src/app.ts` | Builds one Fastify app, registers routes, sets limits and safe errors. |
| `src/db.ts` | Shared Prisma/PostgreSQL client. |
| `src/routes/health.ts` | Public health route. |
| `src/routes/public.ts` | Registers public catalogue, detail and asset routes. |
| `src/routes/jobs.ts` | Validates bounded pagination for the read-only jobs API. |
| `src/routes/ingest.ts` | Validates Python's finished JSON and persists notifications/posts. Not an LLM extraction step. |
| `src/routes/match.ts` | Existing applicant/profile input handling and matching caller; account protection still needed. |
| `src/routes/explain.ts` | Explains selected stored facts and deterministic checks; no per-request LLM required. |
| `src/schemas/eligibility-rules.ts` | Runtime validation of detailed eligibility-rule shapes. |
| `src/lib/public-jobs.ts` | Bounded public database queries and selected public fields. |
| `src/lib/render-home.ts` | Composes the home HTML and its parts. |
| `src/lib/render-catalogue.ts` | Renders stored job cards and pagination. |
| `src/lib/render-job.ts` | Renders one job's detail page. |
| `src/lib/render-job-rules.ts` | Renders detailed eligibility rules. |
| `src/lib/job-html.ts` | Shared HTML escaping, dates, facts and document links. |
| `src/lib/static.ts` | Serves only allowed public assets; not arbitrary project files such as .env. |
| `src/lib/http.ts` | Shared JSON response helper. |
| `scripts/match.ts` | Deterministic age/education/category comparison helpers used by match/explain. |
| `scripts/validate-post.ts` | Basic numeric/source checks at the ingestion boundary. |

Cleanup, 6 October: removed the unused TypeScript PDF/LLM extraction experiment
and its chunk/dedup/schema helpers. Python → ingest remains the extraction path.
Removed optional `.vscode/settings.json`; editor configuration is not required
by the app. `pnpm start` now launches the same current server as `pnpm serve`.
Retained `scripts/validate-post.ts`: ingestion still calls it.

## Google / session files — review in this order

| File | Responsibility |
| --- | --- |
| `src/auth/config.ts` | Validates explicit auth opt-in, canonical origin and private backend configuration. |
| `src/auth/auth.ts` | Better Auth OIDC, model mappings, provider-token non-storage, seven-day rolling session and honest logout. |
| `src/auth/rate-limit.ts` | Per-source/per-auth-endpoint counters and increasing cooldown; wired by auth.ts. In-memory for one process; independent behavior suite passes 6 checks; PostgreSQL case skipped without TEST_DATABASE_URL. |
| `src/auth/http.ts` | Safe Fastify/Fetch conversion, separate cookies and limited session JSON. |
| `src/auth/routes.ts` | Endpoint allowlist, bounded inputs, exact POST origin and fixed safe redirects. |
| `src/auth/README.md` | Short module boundary and reading guide. |
| `.env.example` | Empty configuration template; never put real credentials here. |

Auth is disabled by default. PostgreSQL is authoritative; one opaque session
cookie, not an app JWT access/refresh pair. Daily renewal extends expiry to seven
days ahead via protected POST; GET is read-only. Separate absolute cap deferred.
Logout currently revokes this session only. No automatic email/profile ownership
linking. Redis, local Map/locks, passkeys and login UI are not implemented.

## Next.js frontend (App Router)

Configured with `tsconfig.next.json` and `next.config.ts`. Next.js serves the browser-facing origin (`http://localhost:8080`) and rewrites `/api/:path*` to Fastify backend on port 8081.

| File | Responsibility |
| --- | --- |
| `app/layout.tsx` | Root layout with tokens, `WorkspaceProvider`, skip link, header, and footer. |
| `app/page.tsx` | Server-rendered public jobs browsing with pagination. |
| `app/jobs/[id]/page.tsx` | Dynamic server-rendered job details with graceful backend API fallback. |
| `app/profile/page.tsx` | Private profile workspace wrapper with `robots: noindex, nofollow` and private cache headers. |
| `app/results/page.tsx` | Private match results workspace wrapper with `robots: noindex, nofollow` and private cache headers. |
| `app/how-it-works/page.tsx` | Informational guide on deterministic matching and source verification. |
| `app/auth/error/page.tsx` | Safe OAuth error recovery page owned directly by Next.js. |
| `components/providers/workspace-provider.tsx` | In-memory React Context managing profile and match state across navigation without browser storage. |
| `components/auth/auth-bar.tsx` | Google sign-in trigger, session polling, renewal, sign-out, and passkeys trigger. |
| `components/auth/passkeys.tsx` | WebAuthn registration, authentication, list, and removal. |
| `components/jobs/catalogue-grid.tsx` | Public jobs grid fetching from Fastify `/api/jobs` at build/request time. |
| `components/jobs/job-card.tsx` | Public job card with metadata facts. |
| `components/profile/profile-form.tsx` | Profile entry form, duplicate education validation, and `POST /api/match` caller. |
| `components/profile/education-row.tsx` | Individual qualification input row with duplicate warnings. |
| `components/results/results-view.tsx` | Renders matched jobs, manual check items, and stale result indicators. |
| `components/results/result-card.tsx` | Individual matched/manual job result card with source links. |
| `components/results/explanation-box.tsx` | Interactive toggle fetching criteria explanations from `/api/explain`. |
| `tests/next-frontend.test.ts` | End-to-end integration test validating SEO HTML, private cache headers, in-memory state preservation, and zero browser storage. |

## Legacy frontend files (HTML/CSS/TS)


| File | Responsibility |
| --- | --- |
| `frontend/app.ts` | Coordinates profile form submission, auth setup and result UI. |
| `frontend/auth.ts` | Google sign-in button flow, redirect navigation and error state. |
| `frontend/api.ts` | Backend requests and response checks. |
| `frontend/education.ts` | Education rows and form validation. |
| `frontend/results.ts` | Loading, stale state and result groups. |
| `frontend/job-card.ts` | Reusable match card and explanation interaction. |
| `frontend/dom.ts` | DOM lookup / template helpers. |
| `frontend/types.ts` | Browser-facing profile/result types. |
| `frontend/profile-storage.ts` | Existing opt-in browser profile storage; must be replaced in the private-profile slice. Never use for auth tokens. |
| `public/index.html` | Home page shell. |
| `public/job.html` | Job detail shell. |
| `public/parts/profile.html` | Profile form markup. |
| `public/parts/catalogue.html` | Public browsing markup. |
| `public/parts/results.html` | Match result containers. |
| `public/parts/templates.html` | Reusable browser templates. |
| `public/css/tokens.css` | Design variables. |
| `public/css/base.css` | Base element styles. |
| `public/css/layout.css` | Page / responsive layout. |
| `public/css/components.css` | Shared UI components. |
| `public/css/catalogue.css` | Public catalogue styling. |

`tsconfig.web.json` compiles frontend TypeScript to generated `public/js/` once
at build time, not on every user request. Do not hand-edit generated JS.

## Database / project setup

- `prisma/schema.prisma`: source, post, applicant/education and auth models.
  Applicant `User` is distinct from login `AuthUser`; ownership is nullable.
- `prisma/migrations/*/migration.sql`: ordered schema history. Auth migrations
  are additive; no automatic claiming of old profiles. Never reset real data.
- `prisma/migrations/migration_lock.toml`: migration provider metadata.
- `prisma7.config.ts`: Prisma tooling configuration.
- `Dockerfile`, `.dockerignore`, `docker-compose.yml`: local backend image,
  existing persistent PostgreSQL service, and local-only Dozzle viewer; not a
  complete public deployment. See the local-container section in
  `docs/AUTH_IMPLEMENTATION.md` before starting or publishing these services.
- `package.json` / `pnpm-lock.yaml`: commands and installed dependency versions.
- `tsconfig.json`, `tsconfig.web.json`, `eslint.config.js`: type/lint safeguards.
- `generated/prisma/`: generated client, not hand-written source.

## Tests: choose the smallest relevant group

- Auth configuration / HTTP: `scripts/auth-config.test.ts`, `auth-routes.test.ts`.
- Auth persistence / renewal / logout: `scripts/auth-sessions.test.ts`;
  `scripts/helpers/auth-database.ts` creates disposable schemas;
  `google-fixture.ts` simulates Google HTTP, not live Google login.
- Identity / migration preservation: `auth-models.test.ts`,
  `auth-core-models.test.ts`, `auth-profile-migration.test.ts`,
  `auth-core-migration.test.ts` under `scripts/`.
- App / startup: `scripts/app.test.ts`, `start-server.test.ts`.
- Public API / HTML: `scripts/jobs.test.ts`, `public-pages.test.ts`.
- Eligibility / ingestion / explanation: `scripts/eligibility-rules.test.ts`,
  `validate-post.test.ts`, `ingest.test.ts`, `match_api.test.ts`, `explain.test.ts`.
- Browser: `tests/frontend.test.ts`, `tests/public-browsing.test.ts`.

Last auth checkpoint: 58 backend checks and 9 browser checks passed; strict
TypeScript and auth-file lint passed. Full lint has 33 unrelated errors and the
production dependency audit has 8 unresolved advisories. These are dated results,
not a guarantee for future changes. Temporary test schemas were removed.

## History / decisions: read only the relevant record

- [AUTH_IMPLEMENTATION.md](AUTH_IMPLEMENTATION.md): latest auth slices, exact
  review order, verification, library safeguards and remaining risks.
- [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md): earlier pipeline architecture and
  reasoning; its 2 October snapshot is not current auth status.
- [PRODUCT_CHECKPOINT.md](PRODUCT_CHECKPOINT.md): product stages and parked ideas.
- [CODING_STANDARD.md](CODING_STANDARD.md): naming, modules, comments and review rules.
- [LEARNING_PLAN.md](LEARNING_PLAN.md): developer learning / assistant work split.
- [PUBLIC_JOBS_API.md](PUBLIC_JOBS_API.md): public jobs API contract.
- [FRONTEND_PLAN.md](FRONTEND_PLAN.md): frontend direction.
- [DESIGN_LEARNINGS_AND_USER_TRIAL.md](DESIGN_LEARNINGS_AND_USER_TRIAL.md): design history / trial direction.
- `Agents.md`, `claude.md`, `.cursor/rules/aptus-coding-safety.mdc`: agent guidance.

Obsidian visual history:
[Aptus Login Flow.canvas](</Users/mrblackghost/Work/ObsidianVault/03 Projects/Aptus/Aptus Login Flow.canvas>).
Section F links actual auth files; earlier sections preserve learning discussions.

## Next checkpoint — not another feature jump

Review the Google/session slice, then implement the private-profile boundary in
small steps. Name the session-guard file first; do not bundle passkeys, Redis,
search, matching pagination or UI redesign into that step. Protected profile
ownership, ingestion access and live Google testing remain deployment gates.
Do not treat this map as proof that all those controls already exist.

## Logging slice — 7 October 2026

`src/lib/logging.ts` owns safe Pino configuration, request timing and fixed
security event/reason names. `src/app.ts` enables it; auth routes and the session
guard call it at decisions. `scripts/security-logging.test.ts` checks emitted
JSON and private-value exclusion. stdout → Docker (container only) → optional
Dozzle viewer. See `AUTH_IMPLEMENTATION.md` for verification and remaining gaps.

## Local containers — 7 October 2026

`Dockerfile` builds and runs the Fastify app; `docker-compose.yml` connects it to
the persistent PostgreSQL service and local-only Dozzle dashboard. `.dockerignore`
keeps secrets and generated files out of the build context. `src/server.ts` reads
the configured bind host so the container is reachable through its localhost-only
published port. See `AUTH_IMPLEMENTATION.md` for run steps and security boundary.
