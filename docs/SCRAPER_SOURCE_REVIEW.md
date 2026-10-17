# Scraper source review — 17 October 2026

## Decision

FreeJobAlert is removed from active scheduled discovery. Its existing collected
records and capture state are untouched.

All 31 unique sources requested by the developer are now registered in
`services/ai/sources/catalog.py` as disabled candidates. This catalog is a
review queue, not an instruction for the worker to fetch every site.

Rajasthan Recruitment Portal is registered as a **disabled** candidate only.
The public vacancy page supplies a title, department, deadline and a JavaScript
detail id, but no stable public notice URL. It cannot enter the capture,
extraction or ingestion pipeline until that detail route and its access policy
are separately verified.

## Initial review

| Source | Type | Listing status | Access/robots status | Duplicate risk | Request estimate | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| Rajasthan Recruitment Portal | Official | Public vacancy cards available | Public page captured once; `robots.txt` request timed out | Medium; it overlaps other Rajasthan publishers | One listing request when enabled | Disabled candidate |
| UPSC | Official | Recruitment advertisements available | Not yet verified | Low | Not assessed | Research later |
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
