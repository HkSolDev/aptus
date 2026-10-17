# Scraper source review — 17 October 2026

## Decision

FreeJobAlert is removed from active scheduled discovery. Its existing collected
records and capture state are untouched.

Twenty-nine requested sources are registered in
`services/ai/sources/catalog.py` as disabled candidates. This catalog is a
review queue, not an instruction for the worker to fetch every site.

UPSC is active for bounded official-advertisement discovery and PDF capture.
Its direct, UPSC-hosted PDF links are tested with an offline fixture and a
current public advertisement. The current PDF is a readable native-text
candidate, but it remains behind Aptus's PDF evidence-review gate rather than
being automatically published as a job.

SSC is active for bounded notice-board discovery and official PDF capture. Its
public JSON endpoint is filtered to original recruitment notices, excluding
results, answer keys, marks, admit cards, vacancies, cancellations and similar
exam updates. Each selected PDF remains behind the same evidence-review gate.
The current CGEPT recruitment PDF exceeds the 30-page automatic diagnostic
budget, so it is correctly retained for review rather than extracted.

HSSC is active for bounded official-advertisement discovery and PDF capture.
The public table provides direct HSSC-hosted PDF documents. Its adapter accepts
original numbered advertisements and excludes extensions, corrigenda,
additional-post notices and withdrawals. Captured documents remain behind the
same evidence-review gate before publication.

JKSSB is active for bounded official-advertisement discovery and PDF capture.
Its public Advertisement page contains direct JKSSB-hosted PDF links, which
are captured through a dedicated adapter and remain evidence-gated before
publication.

MySarkariNaukri is active for bounded third-party discovery only when a job
card labels a direct external PDF as its official notification. The adapter
captures that PDF, carries the stated recruiting body and deadline where
available, and does not crawl publisher article pages. Documents remain
evidence-gated before publication.

Rajasthan Recruitment Portal is registered as a **disabled** candidate only.
The public vacancy page supplies a title, department, deadline and a JavaScript
detail id, but no stable public notice URL. It cannot enter the capture,
extraction or ingestion pipeline until that detail route and its access policy
are separately verified.

## Initial review

| Source                       | Type        | Listing status                                                      | Access/robots status                                                                              | Duplicate risk                                          | Request estimate                                      | Decision                                                         |
| ---------------------------- | ----------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------- |
| Rajasthan Recruitment Portal | Official    | Public vacancy cards available                                      | Public page captured once; `robots.txt` request timed out                                         | Medium; it overlaps other Rajasthan publishers          | One listing request when enabled                      | Disabled candidate                                               |
| UPSC                         | Official    | Direct recruitment-advertisement PDFs                               | Current public listing and PDF captured; robots endpoint did not provide a usable policy document | Low                                                     | One listing + at most three PDF requests per run      | Active discovery/capture; publication remains gated              |
| SSC                          | Official    | Public notice-board JSON with official PDF attachments              | Public endpoint captured; recruitment filter verified with fixture and live response              | Medium; SSC carries notices for other recruiting bodies | One API listing + at most three PDF requests per run  | Active discovery/capture; publication remains gated              |
| BPSC                         | Official    | Recruitment page available                                          | Not yet verified                                                                                  | Medium                                                  | Not assessed                                          | Research later                                                   |
| Punjab Recruitments          | Official    | Searchable recruitment page available                               | Not yet verified                                                                                  | Medium                                                  | Not assessed                                          | Research later                                                   |
| UKPSC                        | Official    | Recruitment notices available                                       | Not yet verified                                                                                  | Medium                                                  | Not assessed                                          | Research later                                                   |
| HPPSC                        | Official    | Recruitment advertisements available                                | Not yet verified                                                                                  | Medium                                                  | Not assessed                                          | Research later                                                   |
| MySarkariNaukri              | Third-party | Job cards with labelled external official PDFs                      | `robots.txt` permits public paths with a two-second crawl delay                                   | High                                                    | One listing + at most three labelled official PDFs    | Active discovery/capture; publication remains gated              |
| Testbook                     | Third-party | Public notification articles found; mixes jobs and exam content     | Listing path was reachable; published rules did not block it                                      | High                                                    | One listing + at most three verified official notices | Candidate; strict recruitment and official-link filters required |
| JobYaari                     | Third-party | Not confirmed                                                       | Listing request timed out                                                                         | High                                                    | Not assessed                                          | Keep disabled                                                    |
| SarkariJobSelection          | Third-party | Not confirmed                                                       | Listing request timed out                                                                         | High                                                    | Not assessed                                          | Keep disabled                                                    |
| Jagran Josh                  | Third-party | Public landing page mixes jobs, results and broad education content | `robots.txt` disallows `/government-jobs/*` detail paths                                          | High                                                    | Not applicable                                        | Do not implement                                                 |
| SarkariResultNext            | Third-party | Not confirmed                                                       | Listing request timed out                                                                         | High                                                    | Not assessed                                          | Keep disabled                                                    |
| GovtJobGuru                  | Third-party | Public page mixes jobs, results, admit cards and answer keys        | `robots.txt` disallows uploaded PDFs                                                              | High                                                    | Not applicable                                        | Do not implement                                                 |
| Amar Ujala                   | Third-party | Public jobs-news listing mixes jobs and results                     | Listing path reachable; no relevant path restriction found                                        | High                                                    | One listing + at most three verified official notices | Candidate; strict filters and official links required            |
| Hindustan Times              | Third-party | Public employment-news listing mixes jobs and results               | Listing path reachable; no relevant path restriction found                                        | High                                                    | One listing + at most three verified official notices | Candidate; strict filters and official links required            |
| Times of India               | Third-party | Public education-jobs listing mixes jobs and results                | Listing path reachable; no relevant path restriction found                                        | High                                                    | One listing + at most three verified official notices | Candidate; strict filters and official links required            |

Official Uttar Pradesh, Haryana, Delhi, Jammu and Kashmir, central SSC/RRB,
BSSC, PSSSB and UKSSSC portals remain research candidates. None are registered
or scheduled in this slice.

This intentionally evaluates no further adapters. Aptus expands one source at a
time, after a public listing and safe public detail document are confirmed.
