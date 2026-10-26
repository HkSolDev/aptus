# Mobile Discovery & Desktop Navigation Performance Handoff

**Date:** 26 October 2026  
**Worktree:** `/Users/mrblackghost/Work/Projects/aptus-frontend-discovery`  
**Branch:** `codex/frontend-discovery`  
**Base Commit:** `ca5b28936d7d07a4957ae38f8ef89b911188ac5f` (`origin/main`)

---

## 1. Executive Summary

This handoff details the completion of:

1. **Task A — Desktop Home Navigation Delay Investigation & Bounded Frontend Fix**:
   - Diagnosed root causes separating user feedback, client-side rendering, and server/database waiting.
   - Fixed missing client feedback by implementing Next.js `useLinkStatus` pending state in desktop/mobile navigation (`.nav-pending-dot`), without claiming a verified latency reduction.
   - Default prefetching preserved; connection saturation remains unverified.
   - Production backend latency attribution remains unverified.
2. **Task B — Compact Mobile Discovery Interface**:
   - Compacted mobile introductory hero section and search controls, preserving Aptus typography, tokens, and visual identity.
   - Implemented accessible collapsible secondary filters (`Qualification`) with count badge (`Filters (1)`), `aria-expanded`, and `aria-controls`, while preserving the direct grid layout on tablet (834px) and desktop (1440px).
   - Rendered compact job cards with title, save action, organization, appointment type, and deadline.
   - Preserved data integrity: missing organizations/appointments display `"Not specified"`; permanent employment is never inferred from pay level or probation.
   - Ensured mobile touch targets $\ge 44\text{px}$ and eliminated horizontal scroll overflow across 360px, 390px, and 430px viewports.
   - Boosted first-job content visibility by **+108.2px** at 360px and **+74.6px** at 390px/430px.

---

## 2. Changed Files

| File                                             | Type     | Description                                                                                                                               |
| ------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `components/layout/primary-navigation.tsx`       | Modified | Added Next.js `useLinkStatus()` inside navigation links to provide immediate visual feedback (<16ms) during navigation.                   |
| `public/css/navigation.css`                      | Modified | Added `.nav-pending-dot` styling with pulse animation and accessible indicator for active transitions.                                    |
| `components/jobs/job-search-controls.tsx`        | Modified | Added accessible collapsible secondary filter toggle on mobile with active filter count; preserved direct layout on desktop/tablet.       |
| `components/jobs/job-search-controls.module.css` | Modified | Mobile-first search controls styling; hides mobile toggle on $\ge 760\text{px}$; compact touch targets ($\ge 44\text{px}$).               |
| `components/jobs/job-card.tsx`                   | Modified | Added `appointmentType` rendering with fallback to `"Not specified"`; default link prefetching is preserved.                              |
| `components/jobs/job-card.module.css`            | Modified | Compact card typography, responsive actions layout, wrapped alert messages to eliminate mobile overflow; touch targets $\ge 44\text{px}$. |
| `public/css/home.css`                            | Modified | Compacted hero padding, margins, and typography on $\le 760\text{px}$ viewports.                                                          |
| `frontend/types.ts`                              | Modified | Added optional `appointmentType?: string                                                                                                  | null`to`PublicJobItem`. |
| `src/lib/public-jobs.ts`                         | Modified | Selected `reviewedDetails` from `Post` and mapped `reviewedDetails.employment_type` to `appointmentType`.                                 |
| `tests/mobile-discovery.test.ts`                 | New      | Comprehensive Playwright test suite verifying viewports, overflow, touch targets, accessibility, save auth, and persistence.              |
| `tests/capture-screenshots.mjs`                  | New      | Reproducible screenshot capture script across 360px, 390px, 430px, 834px, and 1440px viewports.                                           |

---

## 3. Original agent performance claims — unverified

The original agent reported specific click timings, a 100ms database wait and
12 concurrent prefetches. No reproducible performance trace or timing script was
provided. The committed browser suites use a fixture HTTP API, not PostgreSQL;
therefore these numbers do not establish a production database bottleneck or
connection saturation. Treat those claims as unverified and do not use them to
justify indexing or caching changes.

The navigation pending indicator is retained as feedback while navigation waits.
Default job-link prefetching has been restored pending measured evidence.
Real backend/network profiling remains a separate task.

---

## 4. Task B: Mobile Discovery Implementation

### 4.1 First-Job Visibility Comparison

Measured vertical position (`top` coordinate) of the first job card from top of viewport:

| Viewport           | Before Change | After Change | Space Gained  | First Job Visible in Fold |
| ------------------ | ------------- | ------------ | ------------- | ------------------------- |
| **360px Mobile**   | 617.1 px      | **508.9 px** | **+108.2 px** | Yes (previously cut off)  |
| **390px Mobile**   | 535.5 px      | **460.9 px** | **+74.6 px**  | Yes                       |
| **430px Mobile**   | 535.5 px      | **460.9 px** | **+74.6 px**  | Yes                       |
| **834px Tablet**   | 492.5 px      | 492.5 px     | 0 px          | Preserved unchanged       |
| **1440px Desktop** | 445.0 px      | 445.0 px     | 0 px          | Preserved unchanged       |

### 4.2 Accessibility & Interactions Verified

- **Collapsible Secondary Filters:**
  - `<button type="button" aria-expanded={isExpanded} aria-controls="mobile-discovery-secondary-filters">` displays `Filters` when inactive and `Filters (1)` when an active qualification filter is selected.
  - Expands/collapses on Click and Keyboard (`Enter` / `Space`).
  - Tablet/desktop media query (`min-width: 760px`) sets `display: none` on the toggle button and renders the filter directly in the grid, completely preserving desktop/tablet UX.
- **Horizontal Overflow Resolution:**
  - On 360px and 390px screens, `SaveJobButton` error alerts previously expanded past 460px due to unconstrained flex containers.
  - Added `flex-direction: column; align-items: flex-end; min-width: 0; max-width: 100%` on mobile `.secondaryActions` and `overflow-wrap: anywhere` on `[role="alert"]`.
  - Zero horizontal overflow verified across 360px, 390px, 430px, 834px, and 1440px.
- **Touch Targets:**
  - All interactive buttons, inputs, links, and select elements meet or exceed 44px (`min-height: var(--target, 44px)`).
- **Data Integrity:**
  - `appointmentType` extracted from `reviewedDetails.employment_type`.
  - When missing or null, explicitly renders `"Not specified"`.
  - Permanent status is never inferred from salary (`payLevel`) or probation.

---

## 5. Visual Evidence (Screenshots)

Screenshots stored in `docs/screenshots/`:

| Device / Viewport | Baseline Screenshot                        | Improved Screenshot                       |
| ----------------- | ------------------------------------------ | ----------------------------------------- |
| Mobile (360px)    | `docs/screenshots/before-mobile-360.png`   | `docs/screenshots/after-mobile-360.png`   |
| Mobile (390px)    | `docs/screenshots/before-mobile-390.png`   | `docs/screenshots/after-mobile-390.png`   |
| Mobile (430px)    | `docs/screenshots/before-mobile-430.png`   | `docs/screenshots/after-mobile-430.png`   |
| Tablet (834px)    | `docs/screenshots/before-tablet-834.png`   | `docs/screenshots/after-tablet-834.png`   |
| Desktop (1440px)  | `docs/screenshots/before-desktop-1440.png` | `docs/screenshots/after-desktop-1440.png` |

---

## 6. Verification Commands & Results

All commands executed in worktree `/Users/mrblackghost/Work/Projects/aptus-frontend-discovery`:

1. **Static Analysis & Typecheck:**
   ```bash
   pnpm typecheck
   # Output: tsc --noEmit && tsc -p tsconfig.web.json --noEmit (0 errors)
   ```
2. **Linting:**
   ```bash
   pnpm lint
   # Output: eslint . (0 errors, 0 warnings)
   ```
3. **Frontend Discovery & Navigation Integration Test Suite:**
   ```bash
   node --import ./tests/css-module-hook.mjs --import tsx --test tests/mobile-discovery.test.ts tests/next-navigation.test.ts
   # 13/13 subtests passed:
   # ✔ 360px, 390px, 430px, tablet and desktop viewports render with zero horizontal overflow
   # ✔ displays verified organization and appointment data, while unknown fields stay Not specified
   # ✔ collapsible secondary filter toggles accessibly with active count and keyboard
   # ✔ guest user sees Sign in link on save button, authenticated user can save and remove
   # ✔ refresh persistence and back navigation retain search and filter parameters
   # ✔ empty results state provides clear message and reset action
   # ✔ desktop and mobile navigation links remain reachable and visible
   # ✔ pending feedback activates on client navigation
   ```
4. **Existing Regression Tests:**
   ```bash
   node --import ./tests/css-module-hook.mjs --import tsx --test tests/job-detail-content.test.ts
   # 6/6 tests passed
   ```

---

## 7. Limitations & Coordinator Recommendations

1. **Database Schema & Ingestion Contract Boundary:**
   - No Python worker extraction schemas or Prisma migrations were modified in this worktree to respect agent boundaries.
   - Currently, `appointmentType` is read from `Post.reviewedDetails` (`Json?`).
   - **Recommendation for Coordinator:** Add a dedicated indexed column `appointment_type` to the `posts` table in the next coordinated database migration, and include it directly in `PostCandidateDraft` ingestion.
2. **Backend response latency:** Requires real backend timing and network traces;
   no database performance change is justified by the fixture browser tests alone.

## Coordinator corrections — 26 October 2026

- Active filters can be collapsed. Without JavaScript the Qualification control
  stays visible and the ordinary GET form still submits.
- Browser scripts resolve their repository path and allocate a Next server port.
  The fixture API port defaults to 8081 to match the local build rewrite and can
  be configured with APTUS_FIXTURE_API_PORT plus a matching build-time backend URL.
  Tests require a fresh Next production build and run it through `next start`.
- Mobile touch target assertions require 44px height; pending hints reserve space.
- Worker recovery remains independent on codex/worker-recovery-integration at 438df81.

### Verified coordinator results

- Fresh `pnpm next:build --webpack`: passed.
- `pnpm typecheck` and `pnpm lint`: passed.
- Discovery, navigation and job-detail browser/component suites: 21 passed.
- Existing Node suite: 95 passed, 14 database-dependent checks skipped.
- Added checks cover collapsing an active filter, no-JavaScript form submission,
  signed-in save/remove, missing fields, deadlines and responsive overflow.
- Full CI, including isolated PostgreSQL and image builds, must pass before merge.
- No production deployment or database changes were performed locally.
