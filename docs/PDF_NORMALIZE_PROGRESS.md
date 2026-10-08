# PDF diagnostics — first slice

`services/ai/normalize_pdf.py` exposes `normalize_pdf(body, final_url)`.
Uses the already installed `pdfplumber` 0.11.10, now recorded in requirements
for reproducible installation. No package was installed during this slice.

Input: captured PDF bytes, maximum 20 MiB and 30 pages by default. Output:
page dimensions/rotation, font character counts, native status, native text and
word boxes as alternatives, table regions/cell geometry, URI annotations and
warnings. Coordinates use top-left page points. This diagnostic slice keeps
all selected `text`/`method`/alternative IDs null, including readable candidates,
until a later selection policy is validated. No job facts are extracted.

Quality checks flag no-text/scan candidates, missing character mappings and
known DevLys/KrutiDev fonts returning no Devanagari. English is not rejected
just for being ASCII. These limited heuristics cannot detect every scrambled
font or faulty hidden OCR layer. Document size/page/character limits are not
process isolation or a guarantee against pathological PDF processing time.

## Real RPSC result

Source: https://rpsc.rajasthan.gov.in/Static/RecruitmentAdvertisements/65964E4066334BE887039D268B894F1E.pdf

Saved output: `outputs/normalize/rpsc-pdf-normalized.json`.

- One page, 612 × 1008 points, rotation 0.
- 4,930 extracted characters; 3,507 use `FPIHEQ+DevLys 010`.
- Native status: `suspicious_or_unusable`; resolution: `manual_review`.
- One table region retained with cell geometry; no invented cell labels/values.
- Native text remains a rejected diagnostic alternative; selected text is null.
- Warning: `page_1_requires_fallback`.

Five checks cover the font gate, valid Unicode Hindi, ordinary English, missing
and unmapped text, invalid inputs, and a real minimal PDF byte fixture through
the parser. The fixture verifies native candidate text and coordinates while
keeping selected text null. RPSC was additionally run through the real adapter.

## Real English recruitment-PDF result

The official IBPS attachment did not respond from this environment. One fallback
was fetched from the same discovered IBPS RRB notice:
`https://doc.sarkariresults.org.in/IBPS_SarkariResult.Com_CRP-RRBs-XV-notification%20(1).pdf`.

- It is a 76-page CRP RRBs XV notification for Officers (Scale I–III) and
  Office Assistants (Multipurpose).
- All 76 pages were `usable_candidate` native text; none hit the Hindi legacy-font
  gate.
- The first page correctly contains the recruitment title, application window
  (`01.09.2026 to 21.09.2026`), role names and examination schedule.
- All 76 pages produced native text. Table geometry was detected on 49 pages
  (97 table regions total).

This evaluation explicitly used `max_pages=100`; the normalizer's default
30-page budget would stop this 76-page PDF for manual review. That budget is
intentional, but its production value needs a separate decision.

This proves only that the current diagnostic parser can read this English
recruitment PDF. Every page remains `manual_review`: text is still an
unselected alternative and table cells are geometry only. It does not yet
produce trusted job facts such as qualifications, age rules or category seats.

Next candidate slice: define a narrow acceptance policy that selects native
English text only when the quality gate passes, while retaining the rejected
Hindi/legacy-font path for manual review. OCR, legacy-font conversion, PDF
heading/paragraph reconstruction, trusted table text and production integration
remain separate work.

## PDF evidence selector — first slice

`services/ai/select_pdf_sections.py` exposes `select_pdf_sections(document,
max_characters=120_000)` over existing PDF diagnostics. The normalizer's
diagnostic contract remains unchanged. Selected candidate alternatives are
packaged as evidence ranges, not promoted to validated facts. All output is
`candidate_requires_review` (or `budget_exceeded`).

The selector indexes readable pages; detects six job-critical topic families;
uses heuristic heading boundaries; keeps source text, physical PDF page numbers,
source block IDs and text-line ranges; excludes explicit contents pages; and
records unresolved appendix/section references and unreadable pages. Source-page
bounding boxes are labeled as such: they are not exact section boxes. Budget
overflow omits whole units with IDs and reasons, never silently clips text.

One saved IBPS PDF rerun indexed 76 pages and selected 72 candidate ranges,
102,702 of 190,599 source characters (about 46% reduction). All six topic
families had matches, no units exceeded the budget, and Appendix I/II references
were reported unresolved. Dates are on physical page 1, qualifications on 18,
and fees on 21. These physical page numbers differ from printed labels. Review
output: `outputs/normalize/ibps-selected-sections.json`. Topic matches and text
reduction do not prove recall or complete job-rule coverage.

Six focused regression checks in `test_pdf_selection.py` cover cross-page
conditions/notes, split headings, references, contents entries, rejected pages,
amendments and whole-unit budget omission. Full relevant suite: 62 tests pass.

Next: manually compare selected ranges with IBPS source scope, exceptions and
vacancy notes. Then improve heading/scope propagation, cell evidence and table
continuity, resolve within-document references, and package complete units using
actual model token budgets. Within-document references belong in selection;
external notice/corrigendum authority and bundling belong in Verify. No automatic
dependency closure, trusted table reconstruction, LLM call, or integration yet.

Notion record (private draft):
https://app.notion.com/p/3f2354a1ec598123b126ed8a15c39559

## Section and table-note preservation — 8 October 2026

Implemented locally in `select_pdf_sections.py`, selector version `pdf-sections-v2`.
User requested implementation only: no tests were written/run and no real PDF
rerun was performed for this change. The 62-test result and IBPS reduction above
are historical v1 results, not evidence for v2. Existing result JSON is unchanged.

Known section titles now define boundaries; capitalized post names, table column
labels and NOTES do not split a section by themselves. Split title lines and
numbered/roman title prefixes are supported heuristically. A selected unit also
keeps its immediately preceding unit when that unit contains post/scope cues.
This retains source wording without interpreting which role a rule applies to.

When selected text touches a page with detected table geometry, retain all native
text on that page to avoid dropping rows, scope labels or notes. Also retain the
following readable page when it has early note/continuation cues, or when the
current table reaches the lower page and the next has a table near its top.
Overlapping ranges merge before character budgeting, preserving original order
and evidence locators. Selection reasons explain these expansions. Page gaps
do not become ordinary section continuations.

This is conservative evidence retention, not validated table reconstruction.
Adjacent tables may be unrelated; retained extra text is intentional. Notes far
from the table, undetected borderless tables, unusual headings, and dependencies
still require review. Whole expanded units can exceed the character budget;
omissions remain explicit. No promise of smaller text or complete coverage.

Next: the independent AI/developer tests this change and compares retained
sections/table notes against the real PDF, including post-specific scope.

## Latest decision: complete evidence before further trimming — 8 October 2026

This supersedes the untested v2 handoff above. The extra saved-subset refinement
was run on IBPS: 102,702 → 102,697 characters, with no removed sections. Removed
`refine_pdf_sections` and `--refine` because they added complexity without useful
noise reduction, and could not recover rows missing from the first selection.
Keep the broad selector. A fixed percentage is not an acceptance criterion.

`complete_pdf_sections(candidate, document)` restores whole source pages for
selected education, age, reservation and vacancy evidence. Other source ranges
are preserved, overlapping lines deduplicated, and original page/block/line
locators retained. CLI takes `--candidate-json` to use the saved broad selection.
No raw input/output fixture was overwritten. Contents-page detection now accepts
leading whitespace. Only the selector and these two continuity records changed.

Verification: 18 focused existing selection tests passed. Real saved IBPS run:
123,506 characters, zero unavailable blocks, all six topic labels present.
Source comparison assertions confirmed complete native text for qualification
pages 18–20 and vacancy page 47. Page 47 increased from 35 selected characters
to its full 1,845 characters. The output explicitly reports `budget_exceeded`
against 120,000 characters; restored text is not silently truncated.

Limits: readable source text is not guaranteed correct table reconstruction;
unselected pages, related notes on other pages and Appendix I/II dependencies
still require source review. Generic topic matches may restore extra pages.
No automatic LLM call or production integration. Python checks were local;
existing GitHub CI currently covers TypeScript/JavaScript only.
Next: move toward Verify with this broad evidence and explicit review/budget
flags; revisit trimming from actual extraction failures and unnecessary text.
