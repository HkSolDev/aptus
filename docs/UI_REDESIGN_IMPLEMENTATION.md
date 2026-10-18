# Aptus frontend redesign implementation

## Mobile List/Cards and active application deadlines — 18 October

Mobile now exposes the existing layout switch as List / Cards. List uses
separated rows with title, available organization/deadline, qualification
(two-line preview), and existing details/save actions; Cards keeps fuller facts.
No smaller title text or change to desktop layout; existing `layout=rows|cards`
URLs, filters, pagination and Back behavior remain compatible. Saving is still
subject to the existing production/fixture limitations.

The public catalogue and matching query share a deadline condition before rows
and counts are fetched: date before today's India calendar date is excluded;
today/future/null deadlines remain. No records are deleted and existing detail
links remain readable. Public Next listing fetches no longer reuse a cached
response across date changes. Already-open pages update on the next navigation
or reload. This uses stored deadline dates, not an inferred closing time.

Verification: build, typecheck and lint pass. Nine focused browser/deadline
checks pass, including real PostgreSQL filtering/counts/pagination/matching in
an isolated schema, IST midnight rollover, mobile layout height difference,
Cards → detail → Back, no-JavaScript switching and existing auth/navigation.
Jobs API and matching-access regressions also pass. Mobile light/dark List
screenshots inspected; backend restarted on 8081 with the updated query.

## Home presentation — implemented and verified · 15 October

User authorized Home only, followed by code-driven comparison to the latest
`http://127.0.0.1:8766/` reference with the same dummy jobs. No subagents,
dependencies, database writes or deployment. Navigation and other page designs
were not expanded in this slice.

Implemented public Home: compact heading, search first, unboxed mobile search,
tablet/wider search grids, Rows/Cards on wider screens, single-column mobile,
reference card groups (identity/deadline, qualification/pay, actions), filtered
Search results heading, clear/empty states, and retained query/filter/sort/layout
through pagination and browser Back. Unknown deadlines remain last via the
existing API; no eligibility decisions were added. Search limitations and the
deadline notice remain accessible under About search and deadlines instead of
pushing results far down the initial viewport. Single-page pagination is hidden.

`frontend/home-view.ts` validates/serializes view preferences;
`home-layout-controls.tsx` supplies controls; `home.css` scopes presentation to
Home. `app/page.tsx` and catalogue fetching/rendering remain Server Components.
Small Client Components own form navigation, disclosure-adjacent actions and
fictional review state. Installed Next Form omits clicked button name/value from
its FormData; layout buttons therefore use native GET forms with a small router
enhancement. Without JavaScript, ordinary form submission still works.

Local review only: a labeled review profile selector offers Guest, Needs profile
and Example profile ready. Ready shows up to three source-identical example
recommendations, education reasons, remaining checks, native match disclosures,
independent deadline sorting and Rows/Cards. Search/filter hides recommendations;
clearing restores them. Fixture Save toggles consistently on both Home sections;
dismiss, Undo and restore operate in memory only. Profile-state changes reset
the review collection. Setup shows the one relevant Complete profile prompt.

Fixture presentation requires BOTH development `APTUS_LOCAL_REVIEW=1` and the
explicit fixture API marker. URL profile parameters alone cannot enable it in
production. Actual authentication is unchanged; the header still reflects the
real session, rather than pretending the example profile is authenticated.

**Backend/next-page gaps:** no automatic account-owned recommendation read
endpoint currently exists; existing matching is the profile POST/in-memory
results flow. Real Home recommendations are therefore not connected. Fixture
Save is not account persistence; the existing Saved placeholder remains. See all
recommendations links to the existing `/results` destination, whose redesign and
fixture population are outside Home. Real organization metadata/search and ITI
support remain upstream gaps. These are not completed production features.

Verification: production build, typecheck/lint and ten focused checks pass
(production keyboard/navigation/auth/Home browser flow plus card, fixture API
and view-input tests). Home browser flow includes filtering, both sort choices,
Rows/Cards retention, pagination, details/Back and no-JavaScript search/sort/layout.
Separate comparison script passed all nine 390/834/1440 × guest/setup/ready
combinations against the live reference: identical titles/order, card title
fonts/padding/corners, expected recommendation columns, search placement and no
horizontal overflow. Independent layout changes, recommendation sorting, search
suppression/restore, Diploma filtering, empty results, fixture Save/dismiss/Undo
and mobile dark layout passed. Real-device/user testing remains pending.

Artifacts: `/private/tmp/aptus-home-review-20261015/` contains nine state/device
screenshots, dark mobile screenshot and `comparison.json`. The check script is
`/private/tmp/aptus-home-compare.mjs`; it reads only the two loopback sites.
Review: `http://127.0.0.1:8082/?reviewProfile=ready`; use `reviewProfile=guest` or
`setup` (or the review selector) for the other states. Stop here for user review;
job details is the next separately authorized page. Obsidian summary remains
historical; this repository checkpoint records the current implementation.

## Shared navigation slice — verified · 15 October

User authorized only shared navigation, compared with the latest local reference
on mobile/tablet/desktop using the four fictional jobs. No subagents were used.

- `components/layout/primary-navigation.tsx`: one small Client Component uses
  the current pathname for Home/Saved/Profile active state. Native Next links
  remain usable without JavaScript. Icons use the exact reference SVG paths.
  Job details and existing Matches/results retain Home as their parent.
- `components/layout/header.tsx`, `app/layout.tsx`, `public/css/navigation.css`:
  server-rendered header shell, full-width neutral surface, 68px mobile/76px
  wider header, mobile fixed bottom navigation and wider top navigation. Labels
  read Saved on mobile/Saved jobs wider. Mobile body and scroll padding keep the
  final content/focusable footer above the bar; iOS safe-area insets are included.
- `components/auth/auth-bar.tsx`: guest header link receives the reference's
  simple underlined Sign in styling. Auth requests, sessions, provider controls,
  passkey management and logout behavior are unchanged.
- `app/saved/page.tsx`: minimal truthful destination for the new link. Saving
  is explicitly unavailable; no saved-job storage, account data or fake successful
  saving was introduced. This page is not the approved finished Saved design.
- `next.config.ts`: local review mode hides the development indicator, which
  otherwise covers the mobile Home icon. Normal app configuration retains it.

Verification: production build, typecheck, lint and whitespace checks pass.
`tests/next-navigation.test.ts` passes all five checks: navigation at exact
390/834/1440 CSS pixels, keyboard focus/Enter, active route changes, mobile touch
targets, no-JavaScript navigation/footer clearance, prior sign-in/manage/logout
checks and Home search/filter/sort/pagination/Back. An older exact label-text
selector was corrected to the actual Qualification combobox accessible role;
asserted behavior was retained. The previously pending Home browser scenario
is now verified too.

Separate code-driven comparison against the reference confirms matching header
heights, exact mobile icon paths, fixed mobile/static wider placement and no
horizontal overflow at all three sizes. Dark navigation contrast is 7.79:1
inactive and 12.60:1 active. Artifacts: `navigation-mobile.png`,
`navigation-tablet.png`, `navigation-desktop.png`, `navigation-mobile-dark.png`,
reference header images and `navigation-comparison.json` in the session's
`aptus-implementation` folder. Real-device testing remains pending.

Review at `http://127.0.0.1:8082/`; reference at `http://127.0.0.1:8766/`.
Stopped at navigation. Home Rows/Cards, recommendations, full Saved behavior,
profile and job-detail redesign remain separate slices. Organization pipeline
support and account-owned Saved persistence remain backend gaps.

## Fictional data for local comparison — 15 October

User explicitly authorized dummy data to compare the implementation against the
approved reference on mobile, tablet and desktop. `scripts/design-review-api.ts`
serves the reference's four fictional public jobs on loopback port 8891. It uses
no database, imports no application/auth configuration, accepts GET only, and
does not simulate an authenticated account. Missing deadlines remain null.
Filtering/sorting use the existing public filter parser and the supported stored
levels; title/qualification search retains the current implementation's scope.

Run in two terminals:

```sh
pnpm exec tsx scripts/design-review-api.ts
APTUS_LOCAL_REVIEW=1 BACKEND_INTERNAL_URL=http://127.0.0.1:8891 pnpm exec next dev -H 127.0.0.1 -p 8082
```

Open `http://127.0.0.1:8082/`. The existing server on 8080 is untouched. The
review copy uses `.next-design-review` (ignored in Git/ESLint), with corresponding
Next-generated type includes. Normal startup still uses the configured API and
`.next`; no automatic fixture fallback was added. The catalogue shows a review
notice when this explicit fixture API supplies its review marker.

Cards now accept an optional clean `organization` label, never a source-name
substitute. Real extraction/storage/API organization support remains a backend
gap; this change does not claim it exists. Recommendations, Saved, final mobile
navigation and detail redesign remain separate unfinished slices.

Checks: typecheck, lint, diff whitespace and four focused fixture/card checks
pass. Browser review confirms all four cards, automatic Diploma filtering down
to two cards and Clear restoring four. Narrow/tablet/wide viewport checks show
no horizontal overflow; actual CSS widths were 325/695/1200 because this browser
applies zoom. The wide view has two columns; narrower views have one. Exact
390/834/1440 CSS-width and full keyboard/no-JS review remain pending. Screenshot:
session artifacts `aptus-implementation/fictional-jobs-review.jpg`. This is not
completion of the full redesign.

## Home search/filter/sort slice — implemented, final browser check pending · 15 October

Scope: public Home only, using the latest saved preview. Added top search and
qualification controls, separate deadline sort, filtered empty state, clear
action and pagination that retains public search/filter/sort parameters.
Search/filter/page shells and results remain Server Components; small client
forms provide automatic qualification/sort submission via Next Form. Native
GET/Search and Apply sort remain available without JavaScript. No new dependency.

Files: `frontend/public-job-filters.ts` shares public input parsing/options;
`src/routes/jobs.ts` validates requests; `src/lib/public-jobs.ts` filters and
counts in one transaction before offset/limit. Search uses parameterized Prisma
conditions over recorded title/qualification text, escaping LIKE wildcards.
Qualification includes the flat level OR a recorded JSON alternative route.
Deadline sort supports ascending/descending with nulls last and stable ID ties.
The separate legacy HTML caller retains its previous alphabetical order.

`app/page.tsx`, `components/jobs/job-search-controls.tsx` and
`components/jobs/catalogue-grid.tsx` connect the controls to the API. Public
fetches retain the existing 60-second cache, keyed by the full validated query.
No applicant details, credentials or account state are included in these queries.
CSS follows mobile stacking, tablet 220px qualification column and desktop
240px qualification column. The standalone reference was not modified.

Data gaps: ITI is not a separate stored level, so its filter is visibly disabled;
it is never mapped to Diploma. Recruiting organization/exam fields are absent;
names are searchable only when present in recorded title/qualification text,
and this limitation is explained beside search. Qualification filtering is job
discovery, not a full eligibility verdict. Public jobs can still include expired
deadlines; the existing warning remains. Recommendations are not implemented.

Verification completed before the approval blocker:

- Production Next build passes after the final Home CSS change.
- Final `pnpm typecheck`, `pnpm lint` and `git diff --check` pass, including
  the newly added browser-test code (execution of that scenario is pending).
- Public API/legacy browser/Next navigation/card/filter suite: 20 checks passed
  before adding the complete Home interaction scenario.
- A real, disposable PostgreSQL 14 database with all repo migrations passed
  `scripts/public-job-search.integration.test.ts`: alternative Diploma routes,
  case-insensitive search, filtering/counting before pagination, both deadline
  directions, unknown dates last, literal wildcard search and injection-shaped
  text. No configured application database was used or changed.

**Pending:** the newly added complete Home browser scenario in
`tests/next-navigation.test.ts` (automatic filter/sort submission, pagination,
browser Back, empty-state clearing and no-JS submission) has NOT been run.
Automatic approval review refused execution because its usage limit was reached;
it explicitly reported a review-service failure, not an unsafe action. Do not
claim this scenario or fresh Home screenshots passed. No bypass attempted.
Previous screenshots predate this slice. Explicit detail-page Back-to-list
context, wider Rows/Cards controls and final mobile navigation remain later work.

Resume: run `pnpm typecheck`, `pnpm lint`, then the new Next browser scenario
with localhost/browser access after approval review becomes available. Resolve
failures, inspect 390/834/1440 screenshots against the reference and record actual
results before calling the slice fully verified. Obsidian memory synchronization
for this slice is pending because writes there need the same approval service.
Temporary test PostgreSQL cleanup is also pending: the server PID was 17202,
port 55439, with its generated root recorded in
`/private/tmp/aptus-search-pg-root`. Normal `pg_ctl ... stop` was denied by sandbox
process-signal permissions. Stop that specific disposable cluster once approval
review is available; do not touch the configured application database.

## Implementation order and reference contract — confirmed 15 October

User reconfirmed: inspect the saved local preview and implement only one page
or small supporting slice at a time. Reference file:
`/Users/mrblackghost/.codex/visualizations/2026/10/14/01a139b0-fa19-7652-877e-a8651f4e771d/aptus-desktop-tablet/index.html`.
Review URL: `http://127.0.0.1:8766/#mobile`. Use its actual device buttons;
the URL hash alone does not prove the current selected width. Inspect current
rendered views, including later script overrides, rather than copying only the
earliest HTML/CSS functions in that file. Do not edit the reference while
implementing the application or invent replacement layouts.

Work order:

1. Shared foundation and controls; retain final navigation as an explicit gap
   until its destinations exist. Sign-in was corrected early at the user's request.
2. Public Home/browsing, then job details as a separate page.
3. Profile redesign, preserving existing auth and deterministic matching boundaries.
4. Real Recommendations, then Saved, each as its own page/slices.

**Next single slice:** public Home search/filter/sort support through bounded
API/database pagination, followed by its corresponding Home controls. Do not
redesign details/profile/recommendations/Saved in that same slice. Home reference:
search by exam/role/organization and qualification at the top; deadline sort
above results; Rows/Cards only on wider screens; mobile single-column cards.
Recommendations require real signed-in/profile-ready data and remain separate.
Employer metadata is still missing upstream; never substitute source names.

For each page: check guest/ready/empty states where relevant, compare 390/834/1440,
verify keyboard/contrast/real behavior, then report exact remaining differences
for developer review before advancing. Prototype examples are not production data.
This checkpoint is a reference review, not another app implementation claim.

## Stage 1 — shared foundation and public cards · 15 October 2026

Implemented the approved neutral visual direction in the Next.js application.
The standalone HTML design remains the reference for later stages.

- `public/css/tokens.css`, `base.css`, `layout.css`: neutral light/dark colors,
  system sans typography, compact introduction and shared spacing. Existing
  system appearance behavior remains; no new theme preference setting.
- `components/layout/header.tsx`, `footer.tsx`, `app/layout.tsx`: simpler
  branding/navigation and a keyboard skip link that targets the main content
  on every route. Working Home, Matches and Profile destinations remain until
  Saved and Recommendations have real application support. Auth is unchanged.
- `app/page.tsx`, `components/jobs/catalogue-grid.tsx`: shorter introduction,
  earlier public jobs, clearer empty/unavailable states and recovery links.
- `components/jobs/job-card.tsx`, `public/css/catalogue.css`: title first,
  readable deadline, qualification, vacancies/pay when recorded, View details.
  Missing optional rows disappear; zero vacancies remains a recorded value.
  Scraper names are not recruiting organizations and are omitted. Cards with
  fewer facts retain their natural height. One column on mobile, two on wider
  screens (corrected against the saved preview in the follow-up below).

Pages, catalogue fetching and cards remain Server Components. A small
`components/layout/skip-link.tsx` Client Component moves focus without adding
a hash history entry; its ordinary anchor remains the no-JavaScript fallback.
Production browser checks caught stale detail content after Back when using
the native hash link; Next Link did not reliably transfer keyboard focus.
No dependency, database change, paid provider call or deployment added.
The existing public 60-second fetch cache and alphabetical pagination remain.
Shared CSS also reaches the legacy Fastify HTML frontend; its existing public
browsing checks cover that baseline, not a full redesign of the legacy pages.

### Checks

- `pnpm typecheck`, `pnpm lint`, `pnpm next:build`: pass.
- `node --import tsx --test tests/job-card.test.ts`: three checks pass for
  recorded/missing fields, scraper suppression, pay level and escaping.
- Existing focused public API/pages/browser suite: 12 checks pass. These
  exercise the Fastify public frontend, not the new Next.js UI.
- Separate isolated Next.js browser check: fixtures at 390/834/1440, no horizontal
  overflow; empty optional rows omitted; keyboard skip/focus, details navigation,
  Back and no-JavaScript browsing checked. The production regression in
  `tests/next-navigation.test.ts` now passes for skip focus → details → Back.
  Run it after `pnpm next:build` using `node --import tsx --test
tests/next-navigation.test.ts` (temporary isolated API and port 18880).
- Checked neutral text/background contrasts: light supporting text at least
  5.36:1; dark supporting text at least 6.73:1. Checked control borders/focus
  exceed 3:1. This is not a complete accessibility audit.

Browser fixtures live only in the isolated test API, never production code.
Screenshots/check report are in the session artifact `aptus-implementation`
folder. Real-device, signed-in provider and brother usability checks remain.
The local public API currently returns 503 for catalogue reads; no fixture
fallback was added to the application.

### Next reviewable stage

Implement real public search, qualification filtering and deadline sorting
through the API and database pagination, then wire the top-of-page controls.
Do not sort/filter only the current six records in the browser. Organization
still needs extraction → ingestion → storage → API before it can be shown.
Later stages: rich detail content, sign-in/profile presentation, real account
Saved/Recommendations and their final mobile bottom navigation. No fake
controls, inferred organization or personal eligibility guarantees.

## Sign-in and first-slice fidelity correction · 15 October 2026

User identified that the header still showed the old Google/passkey buttons.
Implemented `/sign-in` as the approved centered, 440px maximum-width card:
Google first, passkey second, icons, passkey explanation, Continue browsing jobs
and New to Aptus guidance. The page shell stays a Server Component. AuthBar's
existing request/session/logout handlers are reused; the header shows Sign in
for guests, and signed-in people can reach passkey management via Manage sign-in.
No provider buttons or sign-in errors clutter the public browsing header.
Unsupported/unavailable passkeys retain a disabled option and Google fallback.
No backend auth, cookie, CSRF, authorization or dependency changes.

Compared actual CSS against the saved HTML preview for all three widths.
Corrected mobile gutters to 20px, wider content to a 1136px interior, heading
scale to 28–36px, mobile cards to 18px titles/20px padding/14px corners, and
wider card view to two columns with 16px gaps. Earlier three-column styling
was an implementation deviation, not a newly approved design decision.

This is still a partial implementation: temporary Home/Matches/Profile top
navigation differs from the approved mobile Home/Saved/Profile bottom navigation.
Rows/Cards switching, search/filter/sort controls, recommendations and Saved
destinations remain separate implementation slices. Organization data is absent;
no replacement employer or nonworking control was invented.

Checks: type/lint/build pass; production browser tests cover header-to-sign-in,
390/834/1440 widths, provider error/loading/retry, unavailable/available passkeys,
passkey-option request failure, browsing return, and preserved account passkey
management/sign-out. Providers are mocked in those tests; no real Google OAuth
completion or hardware passkey enrollment/sign-in was performed. Local sign-in
screenshots were inspected; underlying local API availability is still separate.
