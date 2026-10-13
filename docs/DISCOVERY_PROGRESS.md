# Discovery — code and actual results

Branch: `codex/discovery-links`. Checked: 7 October 2026.

## What works

Saved static HTML → collect links and nearby context → notice/bridge scores → ranked unique destinations → JSON output. This is a callable first-stage module and local command. The existing scheduled extraction pipeline is not wired to it yet.

## Files and why they exist

| File                                                        | Responsibility                                                                                             |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [link_discovery.py](../services/ai/link_discovery.py)       | Collect contextual link occurrences, resolve URLs, merge duplicate destinations, rank them and print JSON. |
| [discovery_score.py](../services/ai/discovery_score.py)     | Small English/Hindi rule scorer; returns notice score, bridge score and reasons. Weights are provisional.  |
| [test_discovery.py](../services/ai/tests/test_discovery.py) | Six checks covering duplicates, context, Hindi/PDF references, URL handling and live-page failure cases.   |
| This Markdown file                                          | Entry point for code, real outputs, verification and remaining work.                                       |

No new dependencies. Uses the existing BeautifulSoup installation. No existing extraction or database files were changed for this slice.

## Live static-page results

Public HTML was fetched once per page and passed to the same discovery function. No PDF bodies were read.

| Page                        | Link occurrences | Unique destinations | Duplicates merged | Invalid/empty links skipped |
| --------------------------- | ---------------: | ------------------: | ----------------: | --------------------------: |
| Sarkari Result homepage     |              332 |                 229 |               103 |                           0 |
| RPSC homepage               |              393 |                 323 |                70 |                           5 |
| RPSC advertisements listing |              681 |                 620 |                61 |                           5 |

### Sarkari Result

[Full JSON output](../outputs/discovery/sarkari.json)

| Priority | Predicted role | Link text / local context                     |
| -------: | -------------- | --------------------------------------------- |
|        6 | likely_notice  | IBPS Gramin Bank RRB Online Form 2026         |
|        6 | likely_notice  | UP Assistant Teacher Primary Online Form 2026 |
|        6 | likely_notice  | UP PGT Teacher Online Form 2026               |
|        6 | likely_notice  | MPESB Sub Engineer Online Form 2026           |
|        6 | likely_notice  | Railway Paramedical Post Online Form 2026     |

### RPSC

[Full JSON output](../outputs/discovery/rpsc.json)

| Priority | Predicted role     | Link text / local context                                                                        |
| -------: | ------------------ | ------------------------------------------------------------------------------------------------ |
|        7 | bridge             | Recruitment Advertisements                                                                       |
|        2 | uncertain_or_other | Computer Based Recruitment Test (CBRT)                                                           |
|        2 | uncertain_or_other | OTR/Apply Online (Recruitment Portal)                                                            |
|        2 | uncertain_or_other | 17/08/2026 Appointment Letter Regarding Direct Recruitment of Fourth Class Employee -2024 (RPSC) |
|        1 | uncertain_or_other | 09/09/2026 Corrigendum No. 15/2026-27 for Sub Inspector Comb. Comp. Exam - 2021                  |

### RPSC advertisements

[Full JSON output](../outputs/discovery/rpsc-advertisements.json)

| Priority | Predicted role     | Link text / local context                                                                                                                                        |
| -------: | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|        7 | bridge             | Recruitment Advertisements                                                                                                                                       |
|        7 | likely_notice      | 146 15/06/2022 SR. TEACHER (SANSKRIT EDU.) COMP. EXAM 2022 Corrigendum No 04/2022-23 Regarding Post Bifurcation and Online Form filling date extend For Sr. Teac |
|        5 | uncertain_or_other | 117 11/01/2024 ARCHIVES DEPARTMENT RECRUITMENT 2024 Advt. No. 09/2023-24 for Archives Department Recruitment 2024                                                |
|        5 | uncertain_or_other | 157 28/01/2022 GROUND WATER DEPT. RECRUITMENT 2022 Detailed Advertisement No. 10/2021-22 For Ground Water Dept. Recruitment 2022                                 |
|        5 | uncertain_or_other | 173 11/02/2021 ASST. TESTING OFFICER AND SUPDT. GARDEN 2021 Joint Recruitment Advt. No. 09/2020-21 for the post of Asst. Testing Officer and Supdt. Garden       |

## What the results mean

- Sarkari Result: likely recruitment forms ranked near the top. Scholarship and exam-schedule false positives found during inspection were demoted and covered by a regression check.
- RPSC homepage: Recruitment Advertisements is correctly ranked as a bridge to a listing, rather than an individual notice.
- RPSC listing: PDF references were collected even when their anchors had no visible text. The nearby row supplied the context. Old archive entries also appear; scores do not establish that a job is currently open.
- Some plausible RPSC notices score below the current likely-notice threshold. They remain in the output. Thresholds need labeled examples before changing them further.
- Counts measure link collection and deduplication, not extraction accuracy or complete site coverage.

## Verification

Six discovery tests and four existing HTML section tests pass: 10 total.

```sh
PYTHONPATH=services/ai services/ai/.venv/bin/python -m unittest discover -s services/ai/tests -v
```

Run on another saved page:

```sh
services/ai/.venv/bin/python services/ai/link_discovery.py saved-page.html https://example.gov.in/ > discovery.json
```

## Remaining

For this scoring component: manually label a small sample from these outputs, measure ranking quality, and refine ambiguous local context and notice thresholds. No accuracy percentage has been measured.

For the subsequent traversal slice: actual fetch queue, visited/in-flight states, crawl depth/page limits, public-URL and redirect checks, crawl-rule handling, login/failure reporting, and resumable progress. These are not implemented by the single-page collector. File-extension detection is only a hint; response content type must be checked by that fetcher.

Pipeline integration comes after those checks. The local command reads a supplied HTML file; it does not fetch arbitrary URLs or write to PostgreSQL.
