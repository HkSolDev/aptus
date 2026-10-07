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
