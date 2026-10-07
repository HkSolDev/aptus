# Aptus design learnings and first user trial

Date: 2 October 2026

This note captures what we learned from the Aptus design concept and what to
do next. The concept is a reference, not an instruction to rebuild the app or
to claim features that are not implemented.

## What the design taught us

- Aptus should feel like a trustworthy place to read official job notices, not
  a noisy job marketplace. Calm surfaces, clear source links, and visible
  freshness help support that promise.
- Browsing should work before sign-in or profile completion. Ask for education,
  date of birth, and category only when the user wants a personal match.
- Search/chat and job cards should work together: a person can ask in plain
  language, adjust visible filters, inspect results, and open a notice without
  losing their search context.
- Match results need three honest outcomes: passes the requirements checked,
  needs manual verification, or does not meet a checked requirement. Missing
  or conditional facts must not become a confident “eligible” claim.
- Each result should make the original notice easy to verify. Keep application
  deadlines separate from fee deadlines and exam dates; label missing data and
  stale data explicitly.
- The concept's warm paper, dark ink, and restrained teal/terracotta palette
  fits a public-service reading tool. Its hierarchy and spacing are more
  important than copying every decorative detail.
- Mobile should preserve the user's search context when switching among chat,
  results, profile, and job detail. Slow-network, empty, loading, and error
  states are core design states, not polish for later.

## Important gap between the concept and the current app

The downloaded Grok prototype is a multi-screen concept with illustrative
content. The current `public/index.html` is a dark, single-page form/results
interface. The concept describes more than the current product implements,
including chat search, saved/comparison views, settings, and notifications.
Treat those as future ideas unless they are deliberately selected and built.

Do not copy illustrative vacancies or eligibility outcomes into production.
Use real persisted notices and show their source and last-checked time. Keep
eligibility wording conservative until matching covers the relevant rules.

## How we should proceed with design

1. Keep the Grok prototype and this note as references; do not replace the
   working page wholesale based on a mockup.
2. Define the first user task narrowly: enter profile details, see matching
   notices, understand why each one matches or needs checking, and open the
   official source/application link.
3. Compare the current app to that task. Identify the smallest screen-level
   change that makes it easier for the first user, rather than implementing
   every proposed page.
4. Test the flow with the real intended user using real notifications. Watch
   where they hesitate, misunderstand a match, or cannot find the source.
5. Fix the most consequential confusion first, especially false confidence,
   incorrect facts, and broken source/application links. Then repeat with a
   second person before expanding scope.

## Next project milestone: a small, safe user trial

The next milestone is not more speculative UI or another source. It is to put
the existing end-to-end flow in front of the first user and learn whether the
results are useful and trustworthy.

Before sharing it beyond a local development machine:

- Deploy the app and PostgreSQL using the existing deployment plan, with
  production secrets kept out of source control and a restricted database.
- Ensure the ingestion endpoint is not publicly writable; configure its
  internal authentication secret in both services.
- Populate and verify a small set of current notices. Check source links,
  application deadlines, and extracted eligibility facts against the notice.
- Make clear that results are informational and that the official notification
  controls. Provide a visible way to report incorrect or confusing data.
- Check server and pipeline logs, backups, and a basic health check so a failed
  fetch or stopped server can be noticed and diagnosed.
- Share with one trusted tester first. Ask them to complete one real task while
  you observe; do not collect more personal profile information than needed.

For the first trial, ask the tester:

1. Could you find a relevant job without help?
2. Can you tell why a result passed, failed a checked rule, or needs manual
   verification?
3. Could you locate and verify the official notice and its deadline?
4. What was confusing, missing, or surprising?

Record concrete observations and the exact notice involved. Fix correctness or
trust issues before adding more features. Expand to another source only after
this small trial shows the current source-to-match flow is useful and reliable.

## Keep out of the first trial unless already implemented

AI conversational search, saved-job comparison, notifications, and broad
multi-source coverage are not prerequisites for learning from the first user.
The first trial can validate the current form-based matching flow. Add a
feature only when observed user behavior gives it a clear job to do.
