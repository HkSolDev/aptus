# WB-v1: worker ↔ backend

Scope and provenance: [README](README.md). Endpoint:
POST `/api/internal/ingest`. Python `pipeline.push_to_ts` is the delivery client;
Fastify `src/routes/ingest.ts` provides two distinct branches. Presence of either
`reviewed_candidate_json` or `approval` selects reviewed handling, even when
legacy fields also exist. Never fall back to legacy on a rejected approval.

## Shared transport

Exactly one credential source: INGEST_TOKEN or INGEST_TOKEN_FILE. Credential
length is 32–512 from `[A-Za-z0-9_-]`; client refuses invalid configuration before
sending. Backend compares hashed credentials in constant time. Header is
`Authorization: Bearer ...`; never put credentials in the body, URL, logs or
fixtures. Missing backend configuration returns 503; absent/wrong caller token
returns 401 before ingestion. Redirect following is disabled in Python.

BASE_URL defaults to localhost:8080 for this delivery client; production must
configure the correct backend address. Legacy client timeout is 30 seconds;
reviewed delivery uses 90 seconds total timeout configuration / 10 second connect
timeout to accommodate the bounded 60-second publication transaction. These do
not override server/proxy limits. `raise_for_status` is followed by JSON parsing;
successful transport alone is not a validated publication receipt.

## A. Legacy post delivery

The formal **current Python producer** schema is
`contracts/legacy-post.schema.json`, generated once from `schema.Post` and pinned
for review. The suite compares it against the current model, without rewriting
the snapshot. It is stricter than legacy API runtime validation. Do not claim
that the schema is installed as middleware on this route.

Envelope: source_url, source_name and posts are required; raw_hash, discovered
notification_pdf_url/official_site_url/apply_url, source_text are optional.
The current Python producer sends all of them. Python `model_dump(mode='json')`
emits date strings, never Python date objects. A Post has these required keys:

| Fields                                                    | Value contract                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| post_name, recruiting_body, education_required, pay_level | String or null; recruiting body <=200 chars, single-line, trimmed                           |
| vacancies, min_age, max_age                               | Integer or null                                                                             |
| application_last_date, age_as_on_date                     | Calendar date or null; legacy Python normalizes supported dates and nulls unparseable dates |
| post_group                                                | A/B/C/D/null                                                                                |
| min_education_level                                       | TENTH/TWELFTH/DIPLOMA/BACHELORS/MASTERS/PHD/null                                            |
| min_marks_percent                                         | Number or null, percentage unit                                                             |
| category_relaxation_applies                               | Boolean or null, per post                                                                   |
| category_relaxation_rules                                 | Null or SC/ST/OBC/EWS/PwBD object with required integer-or-null values                      |
| eligibility_rules                                         | Required object with required fields; arrays are real arrays, not nullable placeholders     |

Nested age rules preserve category/gender/conditions and integer-or-null ages /
relaxation years. Education alternatives preserve level, marks, qualification,
subject and conditions. Unknown arrays are empty; null string-array items are
invalid. The nested TypeScript validator rejects missing/extra keys, wrong
types and noninteger ages. Pydantic's regular model coercion is not the same as
strict JSON validation; do not silently broaden the wire contract because the
Python constructor accepts a stringified number.

Legacy runtime behavior that callers must understand:

- Missing source name/URL or non-array posts: 400. Malformed nested rules or bad
  recruiting_body: 400 before DB access. Older clients may omit recruiting_body
  and eligibility_rules; the current producer still emits them.
- Source upsert happens separately before post replacement. Empty posts never
  deletes existing posts. An unchanged raw_hash plus empty posts can return
  `skippedAsUnchanged:true`. Empty changed posts can still update source metadata.
- Missing/blank post_name is skipped. Ages/marks are range-checked and checked
  against source text; suspicious fields become null. This is not full factual
  proof. Organization persists only when the trimmed text occurs in source_text.
- Nonempty batches atomically delete and replace that source's posts. Retrying
  is count-idempotent, but does **not** promise stable post IDs. With SavedJob's
  cascading foreign key, replacement can remove saved associations. This needs
  an explicit decision before treating legacy re-extraction as harmless refresh.
- HTTP 200 is `{sourceId,created,skipped}` with optional skippedAsUnchanged;
  partial skipped posts remain possible. Storage failure returns 500. The
  Python hash cache is updated after delivery succeeds, not before.

WB-LEGACY-VALIDATION: raw scalar/date/enums and unknown keys are not fully
validated at runtime as they are in the reviewed branch. Wrong values can reach
Prisma or numeric guards. This is a known gap, not permission for consumers to
depend on permissiveness. No stricter rejection policy was silently deployed.

## B. Reviewed draft publication

The actual shared schema is already
`services/ai/candidate-storage.schema.json`, generated by
`store_candidate.storage_schema()`. Keep it canonical. Do not create another
handwritten copy of its hundreds of fields. Python and TypeScript compare against
that schema, with coercion, defaults and silent extra-key removal disabled in
the TypeScript checker. Existing Python tests check generator/file parity.

Envelope identity: bundle_id (1–256), source_url (1–2048, HTTP(S), no embedded
credentials), source_name (1–256). `facts` contains purpose, posts, evidence,
missing-fields and purpose/amendment information. `review` carries needs_review,
warnings, semantic_support_verified:false, publication_allowed:false,
bundle_identity and field_checks. `evidence_units` maps citations to source
documents/locations. Optional envelope metadata/source_evidence/fingerprint/
version fields must follow the canonical schema, not be dropped by an agent.

CandidatePost extends the legacy Post with advertisement number, start/fee/
exam dates, nationality, locations, employment type, vacancy breakdown,
experience rules, fees, pay, selection/application/document/language/other
requirements and official/apply links. All exact fields, required keys, nulls,
enums and bounds live in the generated schema. Numbers are nonnegative; marks
<=100; arrays contain their declared item type; reviewed date strings have
calendar-date validation. Nonempty posts and a nonblank post name are required
for storage. Unsupported purpose is not a job to publish.

The generic scheduler currently calls `generic_pipeline.run_pipeline`, which
saves drafts and does not publish, even if a legacy persist callback is supplied.
`review_publication` is the separate explicit approval/delivery route. A valid
schema and located citations do not prove all semantics correct or grant approval.

## Approval, immutable identity and receipts

1. Revalidate the source-grounded recruitment draft. SHA-256 covers its **exact
   UTF-8 bytes**. Even whitespace changes invalidate that approval.
2. Approval identifies draft_sha256, bundle_id, reviewer and review note.
   Reviewer/note are nonblank single-line text within 100/1500 chars. The worker
   adds approved_at; backend currently does not use it as an expiry policy.
3. Submit `{reviewed_candidate_json: exact string, approval: object}`. Backend
   enforces the one-million-byte draft limit, checks the hash, bundle, purpose,
   disposition and storage schema before persistence. Bad review submission:400.
4. Candidate storage computes a second, canonical **content_hash** over only
   bundle_id/source_url/source_name/facts/review/evidence_units. It is not the
   exact-byte approval digest. Metadata is not part of persisted content identity.
5. Publication checks candidate status/hash and reconstructed contents. It
   refuses replacement of posts from another draft on the same source (409).
   Atomic Serializable publication uses `(candidateId,postIndex)` uniqueness;
   delivery replay reuses posts instead of duplicating or deleting them.
6. Return `{candidate_id,content_hash,draft_sha256,post_ids}`. Python requires
   nonempty candidate ID, matching expected draft digest, valid lowercase
   64-hex content hash and the expected number of unique nonempty post IDs.
   A mismatched/invalid receipt cannot mean success.

Delivery state persists receipt integrity and retry information. A lost network
response can be retried with the same saved approved bytes; do not rerun paid
extraction. 408/429/500/502/503/504 and transport errors are delivery-retry cases.
Malformed receipts/configuration and nonretryable HTTP failures require a hold.
Cached receipts must pass both integrity and content checks. Existence of a file
or an `ok` response is insufficient. Local cached receipt checks are not a live
database reconciliation endpoint.

The candidate remains a needs_review draft row even after explicit publication
in the current implementation; public Post rows carry reviewedAt/reviewNote.
Do not infer publication state from candidate.status alone. Source-level links
are not all populated by reviewed publication; approved per-post links stay in
reviewedDetails. See the triangular mapping for display behavior and limits.
