# Verify candidate bundles — 8 October 2026

Goal: associate the right documents before fact extraction, preserving their
individual HTML/PDF content, source URLs, snapshots (when supplied), and locators.

## Responsibilities

- `services/ai/verify_bundle.py`: offline role hints, explicit identity evidence,
  conservative campaign matching, configured official-host checks, review flags,
  and JSON bundle output. No fetching, PDF parsing, LLM calls or database writes.
- `services/ai/tests/test_verify_bundle.py`: focused behavioral regression checks.
- This record and `PROJECT_MAP.md`: contract, actual checks and remaining gaps.

Input is an object with `documents[]` and optional `issuer_hosts`. Each document
contains `document_id`, `source_url`, `format` (`html`/`pdf`) and `content`.
PDF content is the selected evidence output from `select_pdf_sections.py`;
HTML content is the ordered block output from `normalize_html.py`. Reject raw
PDF diagnostics lacking selected text by flagging empty content; do not forward
rejected native text. Content is retained in the output document unchanged.

Optional `issuer_hosts` maps an issuer name to explicitly approved HTTPS hosts,
e.g. `{"Example Commission": ["jobs.example.gov.in"]}`. This is operator
configuration, not a scraped claim of authority. Exact hostname matches only;
HTTP, mirrors and deceptive domain suffixes need review. An official host is
still only an authority candidate, not proof of publication or correct facts.

Run with the existing Python environment:

```sh
PYTHONPATH=services/ai services/ai/.venv/bin/python services/ai/verify_bundle.py input.json
```

The callable interface is `verify_bundles(documents, issuer_hosts=...)`.
Output contains `verify_version` and `bundles[]`; each bundle contains identity,
stable bundle ID, `documents[]`, status and `review_reasons`. No new dependency.

## Matching and safety

Recognize explicit labels for issuer, campaign, advertisement number and year.
IBPS's `CRP RRBs XV` title is supported as a narrow first-source pattern. A
configured issuer alias can be identified when present in the source text.
Record quotes and page/block locators for every identity hint. Unknown fields
remain null; generic date occurrences do not become the recruitment year.

Join using issuer plus dated advertisement number, or issuer plus campaign and
explicit year/edition. Incomplete/ambiguous identities stay in separate bundles.
Matching is exact after Unicode/case/whitespace normalization; no fuzzy merges.
Documents using different forms of identity (e.g. one has only an ad number,
another only a campaign) may remain separate for review. Duplicate document IDs
are rejected; snapshot deduplication belongs before Verify.

Role hints: main notice, vacancy annexure, corrigendum, cancellation, form/appendix,
or unknown. Role detection uses title/leading text, not arbitrary body mentions.
Amendments and cancellations are bundled but always require scope review: newer
timestamps alone never override facts. Contradictory explicit campaign identities,
multiple main documents, missing main notices, uncertain authority, Capture
coverage gaps, unresolved references and character-budget excess produce review
flags. Fact-level conflicts and precise amendment precedence remain later work;
this slice never labels a bundle fully verified.

## Checks and result

10 focused tests passed: mixed HTML/PDF retention, domain spoofing/mirrors/HTTP,
campaign-year/ad isolation, incomplete identities, amendment/cancellation review,
identity conflicts, preserved Capture flags, duplicate IDs, mismatched content,
ambiguous labels, and title identity versus older campaign references in body.

Saved IBPS v1 selection check (no new fetch): issuer `IBPS`, campaign `CRP RRBs XV`,
role `main_notice`, 72 saved sections preserved; status `needs_review` for mirror
authority and unresolved appendix references. This check used the existing
102,702-character v1 artifact, not the later 123,506-character restoration.
Restoration budget flags are supported and tested separately with fixtures.
No subagents, production integration, GitHub CI change, commit or push.

Next: developer reviews bundle output and supplies approved issuer hosts. Add
source-specific identity patterns only from real failed matches; resolve actual
notice/amendment relationships before automatic structured extraction.

## Real official pair: title-retention fix — 8 October 2026

Initial real test produced two bundles: the current selector omitted the main
notice's opening title, so Verify had no campaign identity. Fixed at the boundary:
`select_pdf_sections.py` retains `identity_context` from the first 12 source lines
of readable page 1, with page/block/line locators. Page restoration also supplies
this context when consuming an older saved selection. Unusable page 1 is never
replaced by a later page's title. `verify_bundle.py` reads this source context for
role/identity evidence while retaining the selected document content unchanged.

Reran the same downloaded official PDFs without another network fetch:

- `https://ibps.in/wp-content/uploads/CRP-RRBs-XV-notification.pdf`: 76 pages,
  main notice, 52 evidence units, 132,646 selected characters.
- `https://www.ibps.in/wp-content/uploads/Corrigendum-CRP-RRBs-XV_25.09.2026.pdf`:
  one page, corrigendum, one evidence unit, 967 selected characters.

Result: one `IBPS / CRP RRBs XV` bundle, both official-host candidates, separate
text and locators retained. Still `needs_review` for amendment scope, main-notice
budget excess and coverage gaps, and unresolved references. No forced year or
advertisement number. Downloaded inputs: `outputs/verify/live-ibps/`.
The standard Python Capture connection failed; public bytes were downloaded
with the system HTTP client with TLS verification enabled. This Verify check
does not certify Capture's networking. No changes to Capture itself.

31 focused checks passed (selection, independent selection, Verify), including
regressions for header retention, unusable first-page rejection, and matching
when selected content lost the title. Real-pair assertions passed for one bundle,
correct roles, official hosts, and unchanged individual document content.

## Amendment-scope hints — 8 October 2026

`amendment_scope` in `verify_bundle.py` reads corrigendum/cancellation source
sentences. It records affected topic hints (vacancies, deadline, age,
qualification, fee, reservation, cancellation), explicit annexure/section/post/
bank targets, source quotes and original page/block locators. Locators are at
the source-unit level, not exact sentence boxes. Statements of unchanged terms
are kept separately; references to already-updated annexures are not new changes.
Unknown topics or missing targets remain `needs_review`. Recognized scope is
only `candidate_scope`; the existing amendment-review flag is intentionally
retained. No numerical facts, automatic precedence or document overwrites.

Saved official IBPS pair check: one bundle; corrigendum scope is `vacancies` /
`Annexure I`, page 1. Its explicit statement that all other terms remain unchanged
is retained with evidence. This does not resolve the actual replacement vacancy
rows, which require the updated annexure and later extraction/source comparison.
Focused regressions cover explicit changes, negated changes, unknown targets,
unchanged terms, post scope, and reference-only wording. Only Verify code, its
existing tests and this progress record changed in this slice.
