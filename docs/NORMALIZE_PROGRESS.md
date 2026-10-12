# HTML normalization — first slice

Branch: `codex/discovery-links`. Offline parser only; no new dependency.

## Files and plan

- `services/ai/normalize_html.py`: captured bytes + final URL → ordered blocks,
  links, title and warnings. Callable as `normalize_html(html, final_url)`.
- `services/ai/tests/test_normalize_html_smoke.py`: implementer's checks, kept
  separate from the other AI's `test_normalize_html.py`, which appeared during
  implementation and was run unchanged (15 tests passing).
- `outputs/normalize/sarkari-home.json`: complete output from the previously
  captured SarkariResult homepage; no new network fetch.
- `docs/PROJECT_MAP.md`: active-stage memory and links to this record.

Preserve content first. Walk DOM order, keep explicit headings, paragraphs,
lists, source table rows/cells and HTTP(S) link occurrences. Remove scripts,
styles, comments and explicit navigation; retain uncertain headers/footers and
link-heavy regions. Normalize Unicode to NFC and whitespace without splitting
inline words. Resolve links using final URL and the first valid HTML base.

Merged cells appear once in their originating row with `table_spans_present`;
the small rows-only contract does not reconstruct a rectangular span grid.
Nested tables/lists retain text but flatten internal structure with warnings.
Malformed HTML follows BeautifulSoup's fixed `html.parser` tree, which does
not guarantee browser-equivalent repair. HTML is bounded to Capture's 5 MiB.

## Result to inspect

The saved homepage produces **178 blocks and 320 HTTP(S) link occurrences**,
with no structural warnings. First blocks include the site title and welcome
text; recruitment links remain in later blocks and in `links`.
This count does not measure content completeness or job relevance. Site branding
and promotional text remain because generic chrome guessing can delete useful
notice content. This is a homepage example, not proof on every notice layout.

The JSON contains `format`, `title`, `blocks`, `links`, and `warnings`.
Each table carries the nearest preceding heading as `heading_context`.
Links are a separate occurrence list; source locators/owner IDs are not yet in
this first contract, so it is not sufficient for exact extraction evidence.

## Live source run — 7 October 2026

HTML URL selected from Discovery: `https://www.sarkariresult.com/2026/ibps-rrb-15th-august26/`.
Capture returned 200 HTML (115,382 bytes) with no ETag or Last-Modified. The
normalizer produced 63 blocks, 54 link occurrences and `table_spans_present`.
The output retains the job title, dates, fee, age limits, vacancy total and
post/eligibility rows, but also early site-branding/social blocks. This is the
expected conservative result and identifies the next real-notice review task.
Full output: `outputs/normalize/live-html-normalized.json`; concise result:
`outputs/normalize/live-run-summary.json`.

PDF URL selected from Discovery: `https://rpsc.rajasthan.gov.in/Static/RecruitmentAdvertisements/65964E4066334BE887039D268B894F1E.pdf`.
Capture returned 200 PDF (114,216 bytes) with ETag and Last-Modified. No Aptus
PDF normalizer exists yet. An offline `pdfplumber` probe found one page and one
table, but extracted legacy-font Latin-looking text while the visibly rendered
page is readable Hindi. Record this PDF as native-text-unusable: never pass it
to job extraction. The PDF stage must compare OCR with a validated legacy-font
conversion before choosing its fallback. Probe output:
`outputs/normalize/live-pdf-probe.json`.

Rajasthan HTML listing run: `https://rpsc.rajasthan.gov.in/advertisements`.
Capture returned 200 HTML (794,860 bytes); normalization produced 26 blocks,
638 link occurrences, and 622 PDF URLs. The primary table correctly preserves
release date, exam name and description for 620 rows, but its `Link` cells are
empty because the page uses icon-only anchors. Their URLs are only present in
the global link list. This is a real correctness gap: Aptus cannot yet relate a
specific RPSC row to its official PDF. The next HTML refinement must attach link
occurrences to their owner block/table cell and include local row/heading context
(for example, exam name + release date + description). Do not score or fetch
those links from the normalized table until that relationship exists. Full output:
`outputs/normalize/live-rpsc-html-normalized.json`; concise summary:
`outputs/normalize/live-rpsc-run-summary.json`.

## Link ownership fix — current review slice

Call `normalize_html(body, final_url, include_link_context=True)` to include
`owner` and `context` on each link. The two-argument call preserves the earlier
contract for existing callers and the independently supplied tests. Integration
must use the context-enabled mode when relating attachments to notices.
`owner.block` indexes `blocks`; table owners also have zero-based `row` and
`cell`, and list owners have `item`. `context` contains the nearest external
heading, owning text, and (for tables) the complete local row. Headings inside
table cells survive in the row text. Icon-only links retain an empty anchor
label but now point to their actual owner. Their URLs are not lost.

Reruns use previously captured bytes, with no new fetch:

- `outputs/normalize/sarkari-with-context.json`: 65 blocks, 54 links, zero
  unattached links. Vacancy PDF owner: block 13, row 25, cell 1; context row
  starts `Download Updated Vacancy Details`.
- `outputs/normalize/rpsc-with-context.json`: 37 blocks, 638 links, zero
  unattached links. First recruitment PDF owner: block 14, row 1, cell 4,
  carrying release date, exam and corrigendum description in its row.

Block counts increase because context-enabled mode retains icon-only link
containers as empty paragraphs to give them an explicit owner. Existing plain
outputs above are historical runs; use these context-enabled files for review.
Three new regression tests in `test_html_link_context.py` exercise table row
isolation, Click Here labels, and paragraph/list/heading/icon ownership.
PDF diagnostics now live in [PDF_NORMALIZE_PROGRESS.md](PDF_NORMALIZE_PROGRESS.md).

## Verification and limits

Eight implementer smoke tests cover exact ordered output, inline word joining,
line breaks, Hindi, table cells/spans, nested-table text, URL resolution,
unsafe schemes, repeated link occurrences, chrome preservation, malformed HTML,
empty input and input limits. All 15 independent tests passed unchanged; combined
with eight smoke tests and 24 existing pipeline tests, 47 tests pass. Command:
`PYTHONPATH=services/ai services/ai/.venv/bin/python -m unittest discover -s services/ai/tests -v`.
These tests do not establish universal HTML support.

Next: inspect a real notice page's output. PDF library evaluation follows
separately. PDF parsing, OCR,
job-fact extraction and production pipeline integration are not implemented here.
Capture remains the earlier archive prototype; its agreed production direction
is temporary raw files until successful job persistence plus durable URL/hash/
validator metadata. That simplification is a separate slice.
