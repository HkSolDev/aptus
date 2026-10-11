# Three-notice extraction review — 11 October 2026

Purpose: check whether differing job requirements reveal missing schema fields or
response-format defects. Three deliberately varied notices from one official
IIT Kanpur source; this is not a random or cross-site reliability benchmark.
No sub-agents, database writes or publication. Three live extraction requests.

## Results

| Notice | Source requirements | Current result |
| --- | --- | --- |
| [Project Assistant](https://www.iitk.ac.in/dord/project/ncg-pa-09-10-26.html) | Science bachelor's; two posts; resume and contribution text; deadline 25 October | Candidate decoded; application and document arrays populated. Blocked by two errors on official_site_url: missing_valid_citation and fact_quote_not_located. |
| [Project Technician](https://www.iitk.ac.in/dord/project/ee-pt-23-09-2026.html) | Engineering diploma + 4 years OR High School + ITI + 9 years; biodata, cover letter, supporting documents; extended deadline 15 October | Decoding blocked by unknown_field_path. No candidate saved. Exact unknown path intentionally absent from safe logs; no evidence yet that it is a legitimate missing schema field. |
| [Senior Research Analyst](https://www.iitk.ac.in/dord/project/spase-sra-23-09-26.html) | PhD OR postgraduate + 3 years; two posts; emailed resume; deadline 20 October | Alternatives, experience condition and deadline survived. Blocked by 42 errors: one missing_valid_citation, one fact_quote_not_located, 40 scope_quote_not_located. |

The two decoded candidates have no invalid_iso_date or missing_null_explanation
errors. Assistant: 25 accepted citations and 18 null explanations. Analyst: 23
accepted citations and 21 null explanations. These counts do not certify meaning
or completeness. The assistant still infers a monthly pay period not explicit
in the source; desirable skills appear without explicit desirability labels in
other_requirements. They must not become mandatory matching rules.

The schema already supports education alternatives, experience, application
steps, documents and other requirements. Unsupported scalars are nullable with
an explanation; absent arrays use no rows. Neither a new mandatory skills field
nor a schema expansion is justified by these failures. A genuine new requirement
should be added only after reviewing the actual rejected field and source.

## Small completed change

compact_inline.py carries the rejected assignment's path in CompactPathError.
extract_bundle.py exposes it only when it matches a schema-owned scalar or
container path, using a fixed error code. Whole lists/objects remain rejected;
unknown names and values are not printed. Tests cover container paths and
privacy. This fixes diagnostic information, not model correctness.

Checks:

- `PYTHONPATH=services/ai services/ai/.venv/bin/python -m unittest services.ai.tests.test_extraction_input services.ai.tests.test_extract_bundle services.ai.tests.test_inline_extraction -q`: 55 passed.
- `PYTHONPATH=services/ai services/ai/.venv/bin/python -m unittest services.ai.tests.test_staged_extraction services.ai.tests.test_validate_candidate -q`: 12 passed.
- Focused diff whitespace check passed. Full-project checks not run.

Saved public-source inputs/results and summary:
`outputs/extract/three-notice-review-20261011/`.
Assistant used 12,426 reported tokens; analyst used 13,248. Technician's usage is
not retained on decode failure, so these are not the total cost of all three.

## Decision and next step

Keep the basic listing scope; defer richer fields. None of these three results
is ready for draft storage. Do not weaken the citation gate or replace failed
facts with guessed values just to save them.

Next investigate extract_bundle.py's failed-response diagnostic boundary: a
bounded, opt-in public-source replay fixture would let us inspect the rejected
technician path without printing records or credentials. Reproduce offline,
then fix the specific format/quote issue in its owning module. Current artifacts
cannot establish that unknown field's identity. Do not run the same paid trial
unchanged. We remain in EXTRACT/validation, before draft storage and publication.
