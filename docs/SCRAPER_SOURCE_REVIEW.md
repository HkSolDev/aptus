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

Rajasthan Recruitment Portal is registered as a **disabled** candidate only.
The public vacancy page supplies a title, department, deadline and a JavaScript
detail id, but no stable public notice URL. It cannot enter the capture,
extraction or ingestion pipeline until that detail route and its access policy
are separately verified.

## Initial review

| Source | Type | Listing status | Access/robots status | Duplicate risk | Request estimate | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| Rajasthan Recruitment Portal | Official | Public vacancy cards available | Public page captured once; `robots.txt` request timed out | Medium; it overlaps other Rajasthan publishers | One listing request when enabled | Disabled candidate |
| UPSC | Official | Direct recruitment-advertisement PDFs | Current public listing and PDF captured; robots endpoint did not provide a usable policy document | Low | One listing + at most three PDF requests per run | Active discovery/capture; publication remains gated |
| SSC | Official | Public notice-board JSON with official PDF attachments | Public endpoint captured; recruitment filter verified with fixture and live response | Medium; SSC carries notices for other recruiting bodies | One API listing + at most three PDF requests per run | Active discovery/capture; publication remains gated |
| BPSC | Official | Recruitment page available | Not yet verified | Medium | Not assessed | Research later |
| Punjab Recruitments | Official | Searchable recruitment page available | Not yet verified | Medium | Not assessed | Research later |
| UKPSC | Official | Recruitment notices available | Not yet verified | Medium | Not assessed | Research later |
| HPPSC | Official | Recruitment advertisements available | Not yet verified | Medium | Not assessed | Research later |
| MySarkariNaukri | Third-party | State-wise vacancy listings found | Not yet verified | High | Not assessed | Research later |
| Testbook | Third-party | Job news listing found; mixes results and notices | Not yet verified | High | Not assessed | Research later |
| JobYaari | Third-party | Job listings found | Not yet verified | High | Not assessed | Research later |
| SarkariJobSelection | Third-party | Search surfaced stored PDFs, not a verified listing page | Not yet verified | High | Not assessed | Do not implement |
| Jagran Josh | Third-party | Job news listing found; mixes notices, results and exam content | Not yet verified | High | Not assessed | Research later |
| SarkariResultNext | Third-party | No usable listing page confirmed | Not yet verified | High | Not assessed | Do not implement |
| GovtJobGuru | Third-party | Active-jobs table found | Not yet verified | High | Not assessed | Research later |
| Amar Ujala | Third-party | Jobs news listing found; mixes notices and admit cards | Not yet verified | High | Not assessed | Research later |
| Hindustan Times | Third-party | Employment-news listing found | Not yet verified | High | Not assessed | Research later |
| Times of India | Third-party | Education jobs news listing found | Not yet verified | High | Not assessed | Research later |

Official Uttar Pradesh, Haryana, Delhi, Jammu and Kashmir, central SSC/RRB,
BSSC, PSSSB and UKSSSC portals remain research candidates. None are registered
or scheduled in this slice.

This intentionally evaluates no further adapters. Aptus expands one source at a
time, after a public listing and safe public detail document are confirmed.
