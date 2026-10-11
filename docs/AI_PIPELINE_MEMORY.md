# Aptus extraction → draft storage: AI memory

Updated: 11 October 2026. Branch: `codex/discovery-links`.
Purpose: retrieval and handoff for future assistants, not a product feature.
This is the latest extraction checkpoint; older auth/pipeline notes are historical.
Recheck relevant code and artifacts before acting. No vector DB or embeddings added.

## Read first / retrieval keys

Search terms: `fact decoding`, `compact_inline`, `unknown_field_path`, `pay.period`,
`non_scalar_fact`, `unsupported website citation`, `scope_quote_not_located`,
`desirable skills`, `IIT Kanpur`, `IBPS corrections`, `draft storage`.

- Rules and ownership: [project map](PROJECT_MAP.md), [coding standard](CODING_STANDARD.md),
  [product checkpoint](PRODUCT_CHECKPOINT.md), [learning plan](LEARNING_PLAN.md).
- Investigation/results: [three-notice review](THREE_NOTICE_EXTRACTION_REVIEW.md).
- Earlier context: [extraction review](EXTRACTION_REVIEW_NEXT_STEPS.md).
- Obsidian mirror: [AI Memory](</Users/mrblackghost/Work/ObsidianVault/03 Projects/Aptus/AI Memory/EXTRACTION_TO_DRAFT.md>).

## Latest state / resume here

Latest verification: five illustrative profiles checked offline through the match
handler with mocked database boundaries. Unknown ages stay manual, but matching
ignores alternative qualification/experience conditions and only mentions age.
TENTH alone is included for Technician without verifying ITI. Next small fix is
scripts/match.ts uncertainty reasons + src/routes/match.ts presentation; do not
claim matching complete or infer experience. Two existing rules tests pass;
no production changes/profile writes in this verification. See PUBLISH_PROGRESS.md.


Two source-reviewed candidates are now published LOCALLY in Post: count 14 → 16.
Drafts remain unchanged needs_review rows; each public row links its candidate,
post index and reviewedDetails and records reviewedAt/reviewNote. Explicit
operator publication revalidates the envelope/recomputes its hash, refuses a
changed reviewed draft or conflicting source publication, and reuses stable
rows/URLs on repeat. Candidate's original publication_allowed=false is historical
AI draft metadata; later publication approval lives on Post, not a rewritten draft.

Read [publication decisions and verification](PUBLISH_PROGRESS.md) before resuming.
New relation/details migration applied locally. Three publication tests (including
isolated PostgreSQL) and 12 existing route tests pass. Full typecheck/web build,
focused lint/format and actual no-JavaScript mobile public pages pass. Full-repo
lint fails on existing/generated files. Preview: http://127.0.0.1:8082.
No remote deployment/push. Stage 05 publication works for these two examples;
next verify deterministic matching/unknown conditions. Source-to-listing schedule
integration and real-user trial are later, not proven by this publication.
Assistant's final extraction HTTP 503 remains separate.

Artifacts under `outputs/extract/three-notice-review-20261011/`:

- `technician/verified-rerun/`: result.json, response.json, draft.json.
  Project Technician, 2 vacancies, diploma + 4 years OR High School/ITI + 9 years,
  salary 18,000–45,000, unstated pay period null, extended deadline 2026-10-15;
  application steps/materials and optional desirable skills preserved.
- `research-analyst/verified-rerun/`: same files. Senior Research Analyst,
  2 vacancies, PhD OR postgraduate + 3 years, 32,400/month + 20% HRA,
  deadline 2026-10-20; optional subjects/skills stay out of mandatory education.
- `assistant/verified-rerun/`: final request failed provider_http_503; no new
  candidate/draft. Provider availability is separate from parsing/schema errors.
- `format-fix-summary.json`: compact latest outcome/counts. Artifact files are
  local and untracked; code/document commits do not include the saved records.

72 focused tests passed (extraction input/bundle/inline/staged/validator/storage
preparation). Not a full-project, production, database-integration or semantic
certification claim. Source identity/authority warnings remain. Both drafts
retain needs_review and publication_allowed=false.

## Problems, reasoning and decisions

### Preserve evidence rather than accepting plausible facts

A URL can be real yet unsupported by the quoted section. The assistant copied
source_url provenance into a quote although the section contained no URL. Keep
provenance as source_url; official_site_url/apply_url must have citable literal
source text or explained null. Do not invent a citation from metadata.

The analyst response changed double quotation marks to single marks in a source
sentence and reused it for scope evidence, multiplying errors. Prompt now asks
for short verbatim quotes with punctuation/whitespace preserved. Exact location
checks remain strict; no fuzzy substitution or silent evidence repair was added.
Why: a plausible quote must not become proof of the wrong requirement or scope.

### Diagnose format errors before changing the job schema

A model returns a flat list of field-path facts. A whole array/object is not a
scalar fact. Absent arrays have no rows; absent nullable objects may have a null
parent, but cannot also have child facts. Unknown scalar values are already
nullable and need explanations. Expanding schema without the rejected field
would disguise malformed output rather than establish a missing job concept.

Old technician failure: unknown_field_path, actual wire not retained; exact old
field cannot be reconstructed. New replay exposed different, concrete defects:
assistant supplied absent pay parent AND pay children; technician supplied
not_located pay.period with inferred MONTH. Prompt explicitly clarifies exclusive
parent/children and null for every non-found status. Local gates still reject both.

### Keep optional and route-specific requirements separate

Desirable physics/programming subjects were initially promoted to mandatory
education; postgraduate-only experience had an insufficiently scoped rule.
Prompt now labels desirable details in other_requirements and scopes experience
in education conditions/experience_rules.conditions. No new schema or DB field
was needed for this slice. Why: useful job detail must not exclude eligible people.

### Retain a response only when replay is requested

Previously decode failures lost the response and usage, forcing new paid calls
to investigate. extract_bundle.py now supports opt-in --save-response, storing
parsed wire + provider metadata before decoding for public-source trials only.
No prompt, HTTP headers or credentials are saved. Default remains no response
file. Use retained public fixtures offline before making another live call.
Do not generalize this retention to private applicant data or print full records.

### Basic utility first, draft before publication

User accepts title, qualification alternatives, vacancies, pay/deadline and source
link as useful basic information. Improve richer details incrementally rather
than blocking on universal completeness. This does not relax invalid-fact gates.
Draft storage preserves uncertainty, evidence and human-review status separately
from public jobs or eligibility decisions. LLM extracts; deterministic code matches.

## File relationships / ownership

| File | Responsibility and next connection |
| --- | --- |
| [services/ai/normalize_html.py](/Users/mrblackghost/Work/Projects/aptus/services/ai/normalize_html.py) | Saved captured HTML → blocks/links with source locations |
| [services/ai/verify_bundle.py](/Users/mrblackghost/Work/Projects/aptus/services/ai/verify_bundle.py) | Normalized evidence → grouped source bundle/identity warnings |
| [services/ai/build_extraction_input.py](/Users/mrblackghost/Work/Projects/aptus/services/ai/build_extraction_input.py) | Coverage-approved bundle → input; CandidatePost/BundleFacts and shared instructions |
| [services/ai/compact_inline.py](/Users/mrblackghost/Work/Projects/aptus/services/ai/compact_inline.py) | Shallow provider schema/catalogue; path facts → nested inline tree; reject invalid paths, missing scalars, overlapping containers |
| [services/ai/inline_extraction.py](/Users/mrblackghost/Work/Projects/aptus/services/ai/inline_extraction.py) | Inline tree → values, exact fact/scope citations and null explanations; generates absolute posts.N field paths |
| [services/ai/extract_bundle.py](/Users/mrblackghost/Work/Projects/aptus/services/ai/extract_bundle.py) | Provider request → compact decode → normalization → evidence/validation reports; safe stage errors and opt-in replay |
| [services/ai/normalize_candidate_facts.py](/Users/mrblackghost/Work/Projects/aptus/services/ai/normalize_candidate_facts.py) | Deterministic date/qualification/training corrections; no speculative new change |
| [services/ai/validate_candidate.py](/Users/mrblackghost/Work/Projects/aptus/services/ai/validate_candidate.py) | Strict facts/dates/ranges/citation gate; errors block, warnings remain review items |
| [services/ai/store_candidate.py](/Users/mrblackghost/Work/Projects/aptus/services/ai/store_candidate.py) | Revalidate result/source and build offline draft envelope; never writes DB |
| [services/ai/candidate-storage.schema.json](/Users/mrblackghost/Work/Projects/aptus/services/ai/candidate-storage.schema.json) | Generated Python storage contract consumed by TypeScript |
| [scripts/store-extraction-candidate.ts](/Users/mrblackghost/Work/Projects/aptus/scripts/store-extraction-candidate.ts) | Validate envelope; hash and upsert immutable ExtractionCandidate draft via Prisma |
| [prisma/schema.prisma](/Users/mrblackghost/Work/Projects/aptus/prisma/schema.prisma) | ExtractionCandidate stores facts, review and evidence; not public job publication |
| [scripts/run-bundle-extraction.cjs](/Users/mrblackghost/Work/Projects/aptus/scripts/run-bundle-extraction.cjs) | Authorized live extraction launcher; configuration handled internally, never inspect real credential files |

## Historical IBPS trap

Recomputed original errors: result.json had 20 date / 537 citation / 153 missing
null-explanation errors. result-rerun.json had 20 / 519 / 132. Corrected artifact
had 0 / 515 / 132. Normalizing saved rerun reproduced corrected facts and all
34 corrections exactly. Raw rerun lacks corrections and bypassed normalized
serialization; current and first committed launcher normalize and include them.
Its exact original command/uncommitted version was not retained. Do not simply
call it old, claim normalization failed, or treat corrected as storage-ready.
Corrected also lacks bundle_id. Citation/null errors originate in check_evidence,
not the date normalizer. These counts describe those saved files, not new runs.

## Git history / guardrails

Local commits: fd7e76d safe stage errors → 3f62b55 URL prompt → 79f936f application
instructions → ce587a0 safe decoding diagnostics → 330fa9c compact path diagnostics
→ c8c03b2 replay + format/quote/optional-skill fixes. Not pushed in this work.

No sub-agents. Necessary targeted tools only. Preserve unrelated dirty files.
Never open .env/.env.* except example; never print credentials/full records.
Live calls and local commits were explicitly authorized; no automatic retries for
unchanged decoding failures. Earlier memory-only request did not authorize database writes.
Later user explicitly authorized LOCAL migration and draft storage; both are complete.
User subsequently authorized LOCAL reviewed publication; two posts are published.
Remote deployment and push remain separate actions.

## Publication ownership update

scripts/publish-extraction-candidate.ts → reviewed Post rows/provenance;
src/lib/render-reviewed-details.ts → public salary/application/experience display.
See [publication file map](PUBLISH_PROGRESS.md#file-relationships).
