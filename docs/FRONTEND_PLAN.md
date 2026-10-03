# Aptus frontend plan

Updated: 3 October 2026

## Direction

### Product decision: public browsing first

Confirmed by the developer on 3 October 2026:

- Anyone can browse saved job notifications without signing in or entering
  personal details. The home page must offer useful jobs immediately.
- Signing in and completing a profile is optional. It adds personalized,
  deterministic eligibility matches; it does not unlock the public catalogue.
- Signed-in users can still browse all jobs and switch to suitable matches.
- Keep manual-verification results distinct from confirmed rule comparisons.
  Missing eligibility data must never become a guessed recommendation.

The differentiator is a useful public job catalogue plus profile-based matching,
not a form/login wall before users can discover jobs.

Public browsing is now implemented before the profile form, with paginated
server-rendered cards and `/jobs/<id>` detail pages. Login/account ownership
is still not implemented by the browser's saved-profile checkbox or by an
API-returned user ID.

### Next implementation slices

1. Added `GET /api/jobs` on `codex/public-jobs-auth`; see
   [PUBLIC_JOBS_API.md](PUBLIC_JOBS_API.md) for its contract and live-test limit.
   This read-only, paginated endpoint is backed by PostgreSQL. Return
   public notification data only; never include profiles or internal pipeline
   credentials. Display all saved notifications with clear dates/status when
   available, not an invented claim that every notice is still accepting forms.
2. Added public browsing as the default view, reusing card/styles, with native
   page navigation and empty/server-error states. Only six posts are read per
   page. Search/filtering is not implemented yet. No profile is required.
3. Add real authentication and server-verified profile ownership before
   account-based recommendations. Keep All jobs and My matches available
   together; public browsing must continue working when signed out.
4. Optimize the matching query separately, keeping existing deterministic
   eligibility checks and uncertainty handling intact.

Use semantic HTML, CSS, and vanilla TypeScript for the first production UI.
TypeScript builds into ordinary JavaScript before deployment, not per request.
Keep the existing Node.js/TypeScript server and JSON APIs. Do not add a UI
framework or HTMX unless the product develops a concrete need for it.

The Grok concept is visual inspiration, not production data or a feature list.
The current user flow is the profile form, a match request, and match/manual
review results. Preserve existing local changes and backend behavior while
reorganizing the frontend.

## Implemented file layout

```text
public/
  index.html         # page shell; Node inserts the sections below
  parts/
    profile.html     # profile form
    results.html     # result states and containers
    templates.html   # reusable education row and job card
  css/
    tokens.css       # colors, typography, spacing
    base.css         # shared HTML styles and keyboard focus
    layout.css       # page structure and responsive rules
    components.css   # form controls, cards, notices, result states
  js/                # generated files, not edited or committed
frontend/
  app.ts             # connect form, storage, API, and results
  education.ts       # add/remove education rows and validate duplicates
  api.ts             # HTTP requests and response checks
  results.ts         # loading, empty, matches, and manual-review states
  job-card.ts        # reusable card and explanation button
  profile-storage.ts # opt-in browser storage; restore older profiles
  types.ts           # shared browser data shapes
  dom.ts             # find nodes and clone native HTML templates
src/lib/
  render-home.ts     # assemble HTML sections on the server
  static.ts          # serve only the page and permitted CSS/JS files
```

## Run and reading order

- `pnpm serve`: build browser JavaScript, then start the existing backend.
- `pnpm dev:web`: rebuild browser code as you edit; keep the server running
  in a second terminal and refresh the browser.
- `pnpm test:web`: run isolated browser tests with intercepted API responses;
  these tests do not save dummy profiles/jobs to the database.

Start with `frontend/app.ts`: follow form submission into `api.ts`, then
`results.ts` and `job-card.ts`. Read `public/parts/profile.html` beside the
form code. For visual changes, start with `tokens.css`, then `layout.css`.
Edit TypeScript sources, never generated `public/js` files. Open the app through
the running server, not a `file://` URL.

The UI uses the existing match/explain APIs. It does not change matching rules
or the current all-posts query. Cards only display fields returned by the API;
deadlines and PDF/apply links need backend response support before display.
“Read source notification” is not a claim that the link is an official PDF.
Profile storage in this browser is optional; the current match API still saves
profiles to the server database, which the form explicitly discloses.

The Node server must serve `/css/*` and `/js/*` as static assets before the
unknown-route response. Keep the HTML as the initial page; JavaScript enhances
the form and renders the API response. Do not paste all code into one HTML file.

## Delivery phases

### 1. Refactor and polish the existing flow

- Split the current page into the files above without changing its behavior.
- Keep `POST /api/match` and `POST /api/explain` payloads/responses compatible.
- Support loading, validation, network/server error, empty, matches, and manual
  review states.
- Use real API results only; never ship illustrative prototype jobs as live.
- Make source links, application deadlines, and “needs manual verification”
  easy to notice. Never present a partial rule check as guaranteed eligibility.
- Check mobile layout, keyboard/focus, readable contrast, and reduced motion.

### 2. Add public notice pages for search engines

When there is a real need for search traffic, add a stable URL per public job,
for example `/jobs/<stable-id-or-slug>`. The Node server should load that
notice from PostgreSQL and return complete HTML containing its title, details,
dates, source link, and metadata in the initial response. Add crawlable links
and a sitemap. Keep profiles and personalized match results out of indexing.

This requires a public GET route and a deliberate stable URL strategy; the
current server does not provide those yet. Client-rendered content alone is
not the same as server-rendered SEO pages.

### 3. Test with one real user, then iterate

Deploy only after internal endpoints are protected and personal profile data
has an appropriate privacy/retention plan. Start with one trusted tester and
real notices. Observe whether they can understand a result, verify it against
the official source, and spot when manual checking is needed. Fix correctness
and trust problems before adding chat, saved jobs, comparison, or notifications.

## Review rule for generated UI code

Before integrating an AI-generated proposal, check that it does not overwrite
unrelated working changes, invent API endpoints or job data, expose personal
profiles publicly, or claim eligibility beyond the current deterministic
checks. Run the app and tests after each small integration slice.
