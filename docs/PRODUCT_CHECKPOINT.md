# Aptus product checkpoint

Updated: 3 October 2026

Purpose: keep the project moving in order. New ideas go into the later stages;
they do not change the active stage by default.

## Product goal

Aptus lets anyone browse saved government-job notifications without signing in.
Someone can optionally create an account and enter a profile to see which
stored notifications fit their details. Someone preparing for an exam such as
SSC should also be able to discover other exams whose preparation overlaps.
Eligibility and preparation overlap are separate facts: related does not mean
eligible.

## Current checkpoint

The offline pipeline fetches notifications, sends their text for structured
extraction, validates the results, and stores posts in PostgreSQL. Public pages
now list stored posts and open a detail page. The current local database has
14 saved posts; browser checks showed pages of 6, 6, and 2.

The profile match endpoint still loads every post and filters the results in
application code. Profiles are not protected by real account authentication
yet. This is not finished account-based personalization.

## Work order

### 1. Accounts and profile privacy — next stage

Decide the sign-in method, then add server-verified sessions, logout, profile
ownership checks, and safe cookie/CSRF handling. Keep public job browsing
available when signed out. A browser-stored profile ID is not proof of identity.

**Done when:** a signed-out visitor can browse but cannot save, read, or update
a private profile; a signed-in user can manage only their own profile; logout
invalidates the session; authentication and ownership failures have tests.

### 2. Reliable, paginated profile matching

Use the authenticated profile. Keep eligibility checks deterministic and show
uncertain/incomplete requirements as manual checks. Return results in pages,
ordered newest first, and continue past newer non-matches to find older matches
when needed. Do not load every post into TypeScript and slice it afterward.

**Done when:** tests cover eligible, ineligible, and manual-check jobs across
multiple pages, including a newer non-match followed by an older match. The
ordering and meaning of “newest” are explicitly defined using stored data.

### 3. Exam focus and related opportunities

Represent the exam/recruiting area and preparation-topic overlap as explicit
job metadata. Start with a small, reviewable set of manually curated tags and
examples. Show the selected exam's jobs separately from related exams. Keep
eligibility status visible independently in both groups.

**Done when:** a small fixture set demonstrates why each related exam appears,
unrelated exams stay out, and a related job is not mislabeled as eligible.

### 4. Search, then optional LLM query understanding

Begin with ordinary database search over job title, exam, and recruiting-body
fields. Add natural-language understanding only after the exam/tag vocabulary
and search behavior are useful without it. If an LLM is added, its job is to
map a query to a small validated set of known filters/tags. PostgreSQL retrieves
the jobs; deterministic code evaluates eligibility. The model must not invent
jobs, decide eligibility, or decide which exams are related without recorded
metadata.

**Done when:** the same normalized query returns the same stored-job search
behavior; invalid or uncertain LLM output falls back to clarification or basic
search, never a fabricated match.

### 5. Small real-user trial

Have a few people browse without signing in, then optionally create a profile
and check matches. Record concrete errors and confusing results without
collecting sensitive applicant information unless there is a clear purpose
and the user has agreed.

## Parked ideas

- Book recommendations: revisit after exam overlap is working and validated.
- Do not add notifications, broad scraping, or an autonomous AI agent as part
  of the current stages.

## Working rule

Work on one stage at a time. A new idea goes under “Parked ideas” or into the
stage it belongs to. Finish that stage's small task and its success check before
starting the next one. Update this checkpoint when evidence changes the order.

The immediate next discussion is the sign-in/session design and its access
rules. Do not start an LLM job-search feature before authentication, profile
ownership, and explicit exam metadata have a working foundation.
