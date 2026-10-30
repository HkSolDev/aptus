# Frontend theme toggle — audit

## Baseline

- Baseline commit: `d930a69e0093a440ef5ad99c92a6ab19326cec17` (`fix(deploy): include reviewed ingestion dependencies in API image`)
- Branch: `codex/frontend-theme-toggle`
- Worktree: `/tmp/aptus-frontend-theme-toggle` (separate worktree; the original
  checkout at `/Users/mrblackghost/Work/Projects/aptus-next` on
  `codex/next-aptus-work` with unrelated dirty changes was not switched,
  reset, cleaned, or copied from)
- Implementation commit: see "Final commit" below.

## Existing behaviour found during inspection

- `components/layout/header.tsx` rendered the Next.js header (brand,
  `PrimaryNavigation`, `AuthBar`) with no theme button and no existing sun
  button to reuse.
- `public/css/tokens.css` defined light tokens on `:root` and dark tokens only
  inside `@media (prefers-color-scheme: dark)`. Appearance therefore followed
  the device only, with no manual override and no persistence.
- `app/layout.tsx` had no theme initialisation script and no `data-theme`
  attribute. No CSP headers are set in `next.config.ts` or elsewhere in the
  repository, so a small inline initialisation script is not blocked by a
  project CSP (verified by searching for `Content-Security-Policy` /
  `script-src`, no matches).
- Installed Next.js guidance read before changing layout behaviour:
  `node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md`
  (inline script in `<head>`, `suppressHydrationWarning` on `<html>`,
  `data-theme` on `<html>`) and the CSP guide referenced from it.

## Files changed and why

- [theme-toggle.tsx](/tmp/aptus-frontend-theme-toggle/components/layout/theme-toggle.tsx)
  — new client component: one 44px sun/moon button. Moon icon + "Switch to
  dark mode" in light mode; sun icon + "Switch to light mode" in dark mode.
  Reads the effective theme on mount, flips `data-theme` on `<html>`, and
  persists only `aptus-theme` (`light`/`dark`) in `localStorage`. All storage
  access is in `try/catch`, so unavailable storage still switches the page.
- [header.tsx](/tmp/aptus-frontend-theme-toggle/components/layout/header.tsx)
  — two-line integration: import `ThemeToggle` and render it in
  `.header-actions` between `PrimaryNavigation` and `AuthBar`.
- [layout.tsx](/tmp/aptus-frontend-theme-toggle/app/layout.tsx)
  — `suppressHydrationWarning` on `<html>` plus a synchronous inline script
  in `<head>` that applies a stored `aptus-theme` as `data-theme` before
  first paint. With no stored choice it sets nothing, so the CSS media query
  still supplies the device appearance (also the no-JavaScript behaviour).
- [tokens.css](/tmp/aptus-frontend-theme-toggle/public/css/tokens.css)
  — added `:root[data-theme='light']` and `:root[data-theme='dark']` blocks
  reusing the existing light/dark token values verbatim, and scoped the
  device rule to `:root:not([data-theme='light'])`. No new colours were
  introduced; explicit choices override the device preference in both
  directions, and `color-scheme` follows the active mode so form controls
  and scrollbars render correctly.
- [navigation.css](/tmp/aptus-frontend-theme-toggle/public/css/navigation.css)
  — `.theme-toggle` styling only (44px circular button using `--surface`,
  `--line`, `--control-line`, `--soft-hover`, `--ink`). Visible focus comes
  from the existing global `:focus-visible` rule in `base.css`.
- [theme-toggle.test.ts](/tmp/aptus-frontend-theme-toggle/tests/theme-toggle.test.ts)
  — automated behavioural test using the project's existing Playwright /
  `node:test` tooling (no new framework or dependency).

## How it works

- First visit: no stored value, no `data-theme`, so
  `@media (prefers-color-scheme: dark)` decides — device preference.
- Manual choice: the button sets `data-theme` and stores `aptus-theme`.
  The `[data-theme]` token blocks override the media query both ways.
- Persistence: the inline `<head>` script re-applies the stored value before
  paint on reload and full navigation; client-side navigation never removes
  the `<html>` attribute. Only the theme string is stored — no backend,
  account, database, or API involvement.
- Storage unavailable: reads/writes throw, are caught, and the in-page
  `data-theme` switch still works; the choice simply does not persist.
- No JavaScript: the button does not render interactively, and appearance
  remains the pre-existing device-based behaviour.

## Commands run and actual outcomes

- `pnpm typecheck` — pass (both `tsc --noEmit` configs) after a one-time
  `prisma generate` in the fresh worktree.
- `pnpm lint` — pass (full `eslint .`).
- `pnpm next:build` — pass (Next.js 16.4.0; all routes built). An earlier
  attempt failed with a Turbopack "Symlink node_modules could not be
  resolved" error caused by a symlinked `node_modules` in the worktree;
  root cause was the symlink, fixed by using a real `node_modules` copy —
  unrelated to the theme code.
- Theme test (built server + stub fixture API, port 18881):
  `node --import tsx --test --test-concurrency=1 tests/theme-toggle.test.ts`
  — pass, 1/1. It covers checks 1–6, 8, and 10 below plus the no-JavaScript
  case. Note: it was run without the `css-module-hook` import because this
  test imports no CSS modules; the hook is only needed by component tests.
- Playwright browser download (`playwright install chromium`) failed in
  this environment (download timeout), so the test falls back to the
  installed Chrome via `channel: 'chrome'` when the bundled Chromium is
  absent; in CI the bundled browser is used first.

## Verification checklist (automated test unless marked browser)

1. First visit follows light device preference — pass (body background
   `rgb(245, 245, 247)`).
2. First visit follows dark device preference — pass (`rgb(22, 22, 24)`).
3. Manual light overrides dark device — pass, including after reload.
4. Manual dark overrides light device — pass, including after reload.
5. Selection survives reload and navigation — pass (reload + Saved jobs
   navigation; `localStorage aptus-theme` asserted).
6. Keyboard + accessible name + visible focus — pass (focus outline style
   asserted non-`none`, `Enter` toggles, role/name queries used throughout).
7. Readable on desktop and mobile — browser check (below).
8. Header navigation and sign-in still work — pass (Saved jobs link
   navigates; Sign in link visible after navigation).
9. No hydration errors, console errors, or CSP violations — pass for
   hydration/CSP/page errors in the automated test. In the separate browser
   check the only console entries were resource errors from the stub
   fixture (`500 /api/auth/get-session` from the fixture stub and a 404
   favicon), not hydration or CSP errors.
10. Storage failure does not break rendering or switching — pass
    (`localStorage` getter forced to throw via init script; page renders,
    toggle switches, no page errors).

## Browser checks (separate from the automated test)

Performed with Playwright driving installed Chrome against the production
build with the same stub fixture API (screenshots in `/tmp`, not committed):

- `theme-desktop-dark.png` — dark device: dark page, sun icon in header,
  label "Switch to light mode". Inspected visually: header, search form,
  job card, and controls readable.
- `theme-desktop-light.png` — light device: label "Switch to dark mode",
  body `rgb(245, 245, 247)`, ink `rgb(29, 29, 31)`.
- `theme-mobile-dark.png` — 390px dark: same dark tokens and label.
- `theme-mobile-light.png` — 390px light, moon icon in header, bottom
  navigation intact. Inspected visually: readable, no overlap.

Chrome DevTools MCP is not configured in this environment, so browser
evidence is Playwright + screenshots rather than DevTools panels.

## Shared-file integration points and limitations

- Shared files touched: `components/layout/header.tsx` (one import, one
  element) and `app/layout.tsx` (`<html>` attribute + `<head>` script).
  If another agent edits these, the theme integration is those two small
  insertions plus the new `theme-toggle.tsx`. No held-candidate review,
  auth, API, worker, Prisma, or deployment files were changed.
- Remaining limitations: an explicit choice is per-browser (localStorage),
  not per-account, by design. If a future deployment adds a strict CSP
  without `'unsafe-inline'` or a nonce, the inline initialisation script
  would be blocked and persistence would fall back to the post-hydration
  effect in `ThemeToggle` (still correct, with a possible first-paint
  flash) — the CSP would need a nonce for the script at that point.
- Screenshots were captured in `/tmp` only and are not part of the commit.

## Follow-up fix: device-theme synchronisation

- Starting state for this fix: branch `codex/frontend-theme-toggle` at
  `0d784a18c3bad61fc5704a2f1e62870184540c98`, clean working tree (verified
  with `git status` before editing).
- Confirmed reproduction (Playwright/Chrome against the production build,
  no saved `aptus-theme`, device starts light): body was
  `rgb(245, 245, 247)` with label "Switch to dark mode"; after
  `emulateMedia({ colorScheme: 'dark' })` without reload the body became
  `rgb(22, 22, 24)` but the label still said "Switch to dark mode", and
  clicking set `data-theme="dark"` with no visual change.
- Cause: `ThemeToggle` read the device preference only in its mount
  effect, so the button state never tracked later device changes.
- Change ([theme-toggle.tsx](/tmp/aptus-frontend-theme-toggle/components/layout/theme-toggle.tsx:29)):
  the mount effect now also registers a `matchMedia('(prefers-color-scheme: dark)')`
  `change` listener and removes it on unmount. The listener updates the
  button only when there is no explicit choice — it returns early if
  `data-theme` is present on `<html>` (which covers clicks made while
  storage is unavailable) or if a stored `aptus-theme` exists. Clicking
  therefore always switches away from the currently visible theme, and
  once clicked, device changes no longer override the explicit choice.
  No provider, dependency, cross-tab sync, or system-mode selector added.
- Tests: `tests/theme-toggle.test.ts` was extended (all prior assertions
  retained) with both device transitions (light→dark and dark→light
  without reload): label sync, click switching to the opposite of the
  visible theme, `data-theme` assertion, subsequent device flips leaving
  the explicit choice active, and the storage-unavailable case now also
  asserting the explicit choice survives a device change.
- Results on this branch: focused test
  `node --import tsx --test --test-concurrency=1 tests/theme-toggle.test.ts`
  — pass 1/1; the standalone reproduction script now prints
  "device dark … Switch to light mode" and clicking returns the page to
  light with `data-theme="light"` (script deleted after use).
  `pnpm typecheck` — pass; `pnpm lint` — pass; `git diff --check` — pass;
  `pnpm next:build` — pass.
- Remaining limitations: unchanged from below (per-browser choice; future
  strict CSP would need a nonce). Listener cleanup is by React unmount;
  no cross-tab synchronisation was added, as requested.

## Final commit

- Implementation commit: `245eb2c9bdd155bf3f68175734d449ef4be8233a`
  (this line was added by the docs-only follow-up commit on the same
  branch, so the branch HEAD is that follow-up)
- This document is committed with the implementation; the commit that adds
  the recorded implementation SHA is a docs-only follow-up on the same
  branch. No merge, push, or deploy was performed.
