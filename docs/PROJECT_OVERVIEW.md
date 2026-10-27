# Aptus: architecture, decisions, and current progress

<!-- aptus-checkpoint-2026-10-24 -->

**Current checkpoint — 24 October 2026:** [Production, worker results and review-system next steps](PRODUCTION_REVIEW_CHECKPOINT_2026-10-24.md). Frontend `d577942`, backend/worker `94ccc9d` deployed. Worker saves drafts but has published zero new jobs in the observed runs. Earlier snapshots below are historical.

Snapshot: 2 October 2026. Implementation reviewed at commit `d66efff`.

Follow-up changes in the working tree now preserve detailed rules in JSONB,
validate their incoming shape, and have been verified against local PostgreSQL.
The explanation endpoint now reads the selected job from PostgreSQL and uses
the same deterministic candidate checks as matching. The fixed SSC PDF and
per-explanation OpenAI call have been removed from the running app path.

This is a working project record, not a claim that everything is deployed or
production-ready. It summarizes our work and reasoning; it is not a verbatim
chat transcript. Read [LEARNING_PLAN.md](LEARNING_PLAN.md) for what to learn,
what to implement yourself, and what to delegate.

## 1. What we are building

Aptus helps a person understand which Indian government job notifications
match their education, date of birth, and category. The first intended user
is the developer's brother. It is not a resume builder.

The important output is a useful, explainable match with source links, or a
clear request for manual verification when information is missing. A plausible
AI answer is not sufficient: an incorrect age or qualification can mislead
someone applying for a job.

One notification page can describe multiple distinct posts. Fetching one URL
does not imply that extraction must return exactly one `Post`.

## 2. Architecture: intended versus implemented

### Current connected path

```text
Python: source discovery -> fetch one notification -> parse HTML
                                                       |
                         Page(text, sections, links) <-+
                                  |
                         local content-hash check
                         unchanged: skip
                         changed: continue
                                  |
Python: prompt + provider -> LLM -> Pydantic PostBatch
                                         |
                         source age facts -> deterministic age validation
                                         |
                         Post models -> JSON payload
                                         |
TypeScript: /api/internal/ingest -> basic numeric checks
                                         |
                           Prisma -> PostgreSQL
                                         |
App: user form -> deterministic matching -> results + manual-check cases
```

The diagram uses horizontal groups and vertical handoffs deliberately: each
row describes related work; moving down changes responsibility.

### Python age-validation handoff

After extraction, the pipeline reads explicit minimum/maximum age clauses
from the page's `age_limit` section and compares them with each post's LLM age
rules. Clear contradictions are logged and the affected age values are nulled
before sending the posts to TypeScript, so those cases require manual review
instead of driving a potentially wrong match. Ambiguous source clauses are
left unresolved. This is a narrow guardrail, not complete validation of every
category, post-specific condition, or relaxation combination.

Basic numeric checks still run in TypeScript as a second boundary check.
Deduplication and source-grounding checks beyond age remain future work.

Scheduling with cron and deployment to the Oracle VM are planned. The reviewed
Docker Compose file starts PostgreSQL only; it is not a complete app deployment.

## 3. What happens at each phase

### Discover and fetch

`list_jobs()` reads SarkariResult's RSS feed and filters titles using recruitment
signals and exclusion words. This is a heuristic, not a guarantee that every
item is a valid recruitment notice. `fetch(url)` downloads HTML and calls
`parse_page()`.

The Python adapter currently uses HTTPX and BeautifulSoup. Earlier project
notes mention Cheerio/Playwright; those are not this adapter's implementation.

### Collect text, sections, and links

`parse_page()` removes some page clutter and builds a `Page` with:

- `text`: cleaned table content, or page text when there are no tables.
- `sections`: dates, fees, age limits, posts/qualifications, and vacancy sections
  recognized by known heading labels.
- `links`: notification PDF, official website, and application URLs.

Section extraction stays within a heading's cell, or collects consecutive table
rows until a likely section boundary. This prevents neighboring fees from
being mistaken for dates. It remains site-specific and can miss new layouts.

Table rows are represented as JSON arrays of cells. Empty cells retain their
position so a vacancy count stays aligned with its role and qualification.
Nested tables are rendered through their containing cells once, not repeated
by a second traversal. Rendering uses a copy so later searches see unchanged HTML.

The full fallback text is cleaned source content, not an exact copy of all HTML.
On pages with tables, non-table text may be omitted. PDF URLs are collected;
the current adapter does not download or read the PDFs.

### Skip unchanged content

`hash_cache.py` stores hashes in `downloads/extraction_hash_cache.json`.
The pipeline compares the cleaned page text, not raw HTML bytes. An unchanged
hash skips another LLM call. The cache is updated only after a successful
HTTP ingestion response.

PostgreSQL also stores a source hash, but Python currently does not query it
before extraction. Therefore the local cache is the actual pre-LLM skip check.
A link-only change may not change the text hash; this is a known limitation.

### Build the prompt and call the provider

`extract.py` sends labelled excerpts and the cleaned full source text. Excerpts
help highlight relevant areas; the full text provides surrounding conditions.
This is not a guarantee of accuracy or a finished token-budgeting strategy.

The prompt requests facts, not eligibility decisions. It instructs the model
to preserve education alternatives, gender/category age conditions, explicit
relaxation rules, uncertainty, and application deadlines distinct from fees.
Source text is treated as data, not instructions.

`llm.py` selects an adapter using `LLM_PROVIDER`. `LLMProvider` is a Python
`Protocol`: it describes the method providers must expose. It does not select
or call a provider by itself. The `...` is a placeholder for the contract's
method body, not extraction logic.

OpenAI and Gemini adapters call HTTP APIs directly. An OpenAI-compatible
endpoint can use the OpenAI adapter only if it supports the request shape and
structured-output options being sent. A new provider may require its own
adapter and factory registration; provider independence is not automatic
compatibility with every model.

The OpenAI adapter retries selected temporary HTTP/network failures and wraps
errors. Gemini's adapter does not currently have equivalent retry handling.
Provider support in code does not prove both providers were live-tested.

### Validate the structure

Pydantic turns response JSON into `PostBatch` and `Post` objects. Explicit
numeric fields enable later comparisons. Nullable values express uncertainty;
`extra="forbid"` rejects unexpected fields. Date handling accepts supported
formats and converts unclear/invalid values to null.

Schema validation answers: "Does this have the expected structure?"
It does not answer: "Is 37 the correct age for this gender and post?"
The number 37 can be valid JSON, an integer, and still belong to a different rule.

`age_extractor.py` deterministically reads explicit minimum/maximum age clauses
from the age section and preserves unsupported wording with a null age.
`validate.py` compares those facts against each post's `AgeRule` objects. The
pipeline calls it after the LLM and before TypeScript ingestion. It handles
clear age/gender mismatches; it does not fully resolve category-specific,
post-specific, or combined-relaxation rules.

### Send JSON and persist it

`model_dump(mode="json")` converts models and dates into JSON-compatible values.
Python sends posts, source text, hash, and HTML-derived links to TypeScript.
The endpoint exists for storage; it does not send the page back to an LLM.

The ingestion route upserts `Source`, checks basic ages/marks/relaxation ranges,
and replaces that source's posts inside a database transaction. This prevents
duplicate rows from a sequential resend; it does not establish safe ordering
for overlapping runs. The source upsert is outside the post-replacement
transaction, so the entire ingestion operation is not atomic.

Before any database access, supplied `eligibility_rules` must pass the runtime
checks in `src/schemas/eligibility-rules.ts`. Incorrect nested types, missing
fields, unexpected keys, and unknown education levels return HTTP 400.
Legacy producers may omit the object; storage then uses SQL NULL. These checks
verify structure, not whether the facts agree with the notification.

The numeric grounding check only searches for digits somewhere in the source.
It can catch some invented numbers but cannot prove a number belongs to the
correct age, role, or category. Relaxation checks are principally range checks.

The Prisma model now has a nullable `eligibilityRules` JSON column and the
ingestion mapping stores the Pydantic `eligibility_rules` object without
flattening its nested age/education conditions. Existing rows remain null
until their source is ingested again. This additive migration does not yet
make matching use the detailed rules; it preserves them for a follow-up slice.

### Match users

Matching is deterministic TypeScript, not an LLM decision. The current helper
loads posts and filters them using flat fields; it is not yet a comprehensive
SQL eligibility engine. Some missing fields are placed in manual-check results.

Gender/category combinations, subject-specific education alternatives, correct
age reference dates, and relaxation applicability need further work. The current
helper calculates age as of today and uses a simplified education ordering.
Do not describe these results as complete verification against every rule.

## 4. Why we chose these approaches

| Decision                                                         | Reason                                                                      | Cost or limitation                                             |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Python for raw-to-structured processing, TS for the app/database | Keep document work together and use the existing application stack          | Two runtimes and an API contract must agree                    |
| Extract once per changed notification                            | Many users can reuse the same facts without repeated inference              | Freshness depends on a reliable background run                 |
| LLM for language understanding, code for eligibility             | Messy text benefits from extraction; age/marks comparisons need exact logic | Complex conditions require explicit data modelling             |
| Structured output plus Pydantic                                  | Make output machine-readable and catch malformed responses                  | Correct shape does not establish correct facts                 |
| Null rather than guessed defaults                                | Avoid false confidence when a rule is unstated                              | UI and matching must preserve manual verification              |
| Detailed age rules and education alternatives                    | A single maximum age or degree cannot represent conditional eligibility     | Schema, ingestion, storage, and matching must evolve together  |
| Sections plus source context                                     | Preserve relevant rows and reduce ambiguity without a retrieval system      | Duplicate context costs tokens and can still contain conflicts |
| Small provider adapters and a Protocol                           | Keep extraction independent of provider-specific HTTP formats               | New adapters still need implementation and testing             |
| Hash-based skipping                                              | Reduce repeat LLM calls with little infrastructure                          | Current local cache does not cover all metadata changes        |
| One source at a time                                             | Fix actual layouts and failure modes before expanding                       | Coverage is intentionally limited                              |
| No speculative RAG, agents, vector DB, or queues                 | No demonstrated problem currently requires them                             | Reconsider only when a real requirement appears                |

The earlier TypeScript-only rule is superseded by the best-tool split. Some
project instructions describe the target state rather than today's code.
This document records those differences rather than silently claiming completion.

## 5. File map: where to look

Paths below are relative to the repository root.

| File                                                          | Responsibility                                                                    |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `services/ai/sources/sarkariresult.py`                        | RSS discovery, HTML requests, links, table/section parsing                        |
| `services/ai/hash_cache.py`                                   | Text hashes and local extraction cache                                            |
| `services/ai/pipeline.py`                                     | Connect fetch, skip check, extraction, age validation, JSON handoff, cache update |
| `services/ai/extract.py`                                      | Shared system/user prompts and extraction entry point                             |
| `services/ai/llm.py`                                          | Configured provider selection                                                     |
| `services/ai/providers/base.py`                               | Shared provider method contract and error type                                    |
| `services/ai/providers/openai.py`                             | OpenAI-compatible HTTP request, schema adaptation, retries                        |
| `services/ai/providers/gemini.py`                             | Gemini HTTP request and typed response parsing                                    |
| `services/ai/schema.py`                                       | Output models, conditional eligibility data, date parsing                         |
| `services/ai/age_extractor.py`                                | Parse explicit age facts from the notification section                            |
| `services/ai/validate.py`                                     | Compare extracted age facts with LLM rules and provide a smoke check              |
| `services/ai/main.py`                                         | Environment loading, trust-store setup, health and run endpoints                  |
| `services/ai/tests/test_sections.py`                          | Section boundaries, nested tables, cell alignment fixtures                        |
| `src/server.ts`                                               | HTTP route dispatch, home page, and server startup                                |
| `src/routes/match.ts`                                         | Candidate input checks, persistence, and matching response                        |
| `src/routes/explain.ts`                                       | Saved job summaries and deterministic candidate check explanations                |
| `src/routes/ingest.ts`                                        | Python payload checks, ingestion mapping, and database writes                     |
| `src/lib/http.ts`                                             | Shared request-body reading and JSON responses                                    |
| `src/schemas/eligibility-rules.ts`                            | Nested rule types and runtime ingestion shape checks                              |
| `scripts/eligibility-rules.test.ts`, `scripts/ingest.test.ts` | Rule validation and HTTP rejection regression tests                               |
| `scripts/validate-post.ts`                                    | Current basic numeric checks used during ingestion                                |
| `scripts/match.ts`                                            | Shared age/education/marks checks used by matching and explanations               |
| `prisma/schema.prisma`                                        | User, Education, Source, and Post storage models                                  |
| `docker-compose.yml`                                          | Current PostgreSQL container configuration                                        |

Older TypeScript extraction utilities also exist. Do not confuse their presence
with the currently reviewed Python SarkariResult flow.

The backend was split into plain route handlers while preserving the existing
URLs, response formats, and business logic. `server.ts` is now 70 lines.
Only the HTTP helpers are shared across routes; separate service/controller
layers were not added because they do not currently remove duplicated logic.

## 6. Evidence and unfinished work

At the last code change, four Python section tests, age-extractor smoke assertions,
simple age-validator checks, twelve TypeScript tests, lint, type checking, and
Python syntax checks passed. These are not proof of a fresh live LLM-to-database
run, deployment, or complete extraction accuracy. Earlier live experiments
discussed in chat exposed missed/misrepresented facts and motivated the sections
and richer schema. No extraction accuracy percentage has been established.

Next work, in small slices:

1. Test one live notification through age validation, storage, and read back its saved fields.
2. Add per-notification failure isolation and useful stage logs.
3. Protect ingestion and pipeline-trigger endpoints before public exposure.
4. Correct matching for conditional rules, age reference dates, and uncertainty.
5. Complete scheduling/deployment and test restart/concurrent-run behaviour.

The JSONB migration has been applied locally. A temporary notification sent
through the real ingestion handler saved nested rules intact. A malformed
request returned 400 and changed neither its source nor its posts. A separate
legacy fixture was preserved, and a payload omitting rules stored SQL NULL.
All temporary records were removed. The local database contained zero real
posts before migration, so preservation of existing real jobs was not measured.
This verification did not call an LLM or fetch a live notification.

Current safety/reliability gaps to remember:

- LLM or ingestion errors can terminate the remaining job loop.
- A successful response with zero/skipped posts can still advance the local cache.
- `/run` can report completed after job-list failure because that failure returns normally.
- No authentication check was observed in the reviewed ingestion or pipeline-run handlers.
  An "internal" URL name alone is not access control; deployment restrictions were not verified.
- Logs are basic prints/errors, not a full run/stage tracking system.
- PDF reading, UI redesign, AI job-search experiences, and broad source coverage remain
  future work, not completed features.

Before claiming a notification is correct, compare its extracted facts against
the source, verify the stored row, and test matching with boundary profiles.
Update this snapshot when those steps or the architecture change.
