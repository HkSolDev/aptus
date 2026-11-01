# WF-v1: worker → backend → frontend semantic lineage

There is **no direct frontend/worker transport**. This contract describes what
must survive the two real boundaries. It does not authorize a browser worker
endpoint, paid extraction on click, public draft access or a new message bus.

## Field lineage

| Worker fact                     | Stored Post field                                 | API / frontend meaning                                                         |
| ------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------ |
| post_name                       | postName                                          | Required public job title after publication; null legacy title is skipped      |
| recruiting_body                 | organization                                      | Employer/recruiting body; never the scraper label                              |
| vacancies                       | vacancies                                         | Integer count/null; zero is retained                                           |
| application_last_date           | applicationLastDate                               | Calendar deadline serialized as ISO timestamp; India-time catalogue visibility |
| age_as_on_date                  | ageAsOnDate                                       | Stated age reference date used by deterministic age comparison                 |
| min_age / max_age               | minAge / maxAge                                   | Years/null; do not substitute zero or infer missing bounds                     |
| education_required              | educationRequired                                 | Source qualification text/null; numeric marks remain separate                  |
| min_education_level             | minEducationLevel                                 | Enumerated coarse level/null; subject/professional conditions remain detailed  |
| min_marks_percent               | minMarksPercent                                   | Percentage number/null, never fraction or rendered prose parsed back           |
| post_group / pay_level          | postGroup / payLevel                              | Stated group/pay text; not proof of employment type                            |
| category_relaxation_applies     | categoryRelaxationApplies                         | Per-notification boolean/null, not a global category assumption                |
| category_relaxation_rules       | categoryRelaxationRules                           | Per-category years/null; preserve unknown category facts                       |
| eligibility_rules               | eligibilityRules JSONB                            | Nested alternatives/conditions preserved; matcher may require manual checks    |
| Complete reviewed CandidatePost | reviewedDetails JSONB                             | Approved detailed facts for display, preserving unknowns and arrays            |
| Review approval                 | reviewedAt/reviewNote + candidate reference/index | Publication provenance, not public applicant eligibility                       |
| Draft evidence and warnings     | ExtractionCandidate facts/review/evidenceUnits    | Private review material; not public job data by default                        |

The reviewed mapper is `scripts/publish-extraction-candidate.ts`; legacy mapping
is `src/routes/ingest.ts`. Public selection is `src/lib/public-jobs.ts`, detail
serialization is `src/routes/job-detail.ts`, React rendering is
`components/jobs/job-detail-content.tsx`. The legacy HTML renderer is a separate
consumer and must preserve the same unknown/source semantics.

## Detailed fields and precedence

The complete CandidatePost is stored verbatim in reviewedDetails by the reviewed
publication mapper. This includes employment_type, fee_rules, experience_rules,
pay amounts/currency/period, application_steps, documents_required and other
requirements. The API returns the JSON; the React detail view combines flat
fields and approved detailed fields using its current explicit fallback logic.
An empty detailed array is not proof that a requirement does not exist.

Dates in reviewedDetails are calendar strings; flat fields become ISO strings.
Do not compare their raw strings as if they had the same representation. Null
currency or pay period must remain unknown; do not label a numeric salary as
monthly without source support. Conditional qualification/experience/age rules
must remain attached to the relevant route or category, not flattened into a
universal requirement. Unknown reservation category is not General/UR.

Approved per-post official_site_url/apply_url live in reviewedDetails. Discovered
legacy source links live on Source; source URL points at the collected notice.
The detail view checks HTTP(S) safety and uses explicit fallbacks. A missing
source-level link does not prove that a reviewed per-post link was lost.
Schema and formatting checks do not independently prove a URL is official.

## Visibility and decisions

Only Post rows are public. Worker prepared/extracted/draft states do not make a
listing. Human approval and successful backend publication precede visibility.
A publication receipt proves the expected delivery outcome; it does not prove
that the UI has rendered the affected post or that a cache has refreshed.

Catalogue qualification/search filters discover jobs. Matching reads the
authenticated saved profile and deterministic rules. Unknown/unsupported facts
must remain manual-verification cases rather than eligible. The worker never
computes user eligibility, and frontend labels cannot override backend results.
Age reference dates, per-notification relaxation flags and conditional
requirements are handled by the deterministic matcher or exposed as a
manual-check reason. Do not infer permanence from pay level/probation or
suitability from similarity.

## Executable proof and remaining proof

`tests/triangle-contract.test.ts` runs a real Python fixture through draft
preparation, actual backend storage validation, actual publication mapping,
actual public detail HTTP serialization and actual React static rendering.
It checks a known max age of 30, null minimum age/education, named organization,
full reviewedDetails/nested-rule preservation and no public reviewNote.
The test uses the normal workspace provider, not a design-review job flag.

Database operations are replaced with isolated test doubles. This proves the
mapping and consumer compatibility exercised, not DB constraints/transactions,
real authentication, browser effects, proxy caching or production visibility.
Date boundary tests verify India midnight and unknown-date visibility logic.
The existing PostgreSQL publication tests remain necessary for persistent
atomicity, duplicate replay, concurrent behavior and replacement refusal.

Before releasing a cross-lane change, run those disposable DB tests and a browser
check against the combined exact commit. Verify list, detail, manual-check and
saved-job paths. Record deployment/image identity and the live affected-path
result separately. No missing check becomes passed because the merge was clean.
