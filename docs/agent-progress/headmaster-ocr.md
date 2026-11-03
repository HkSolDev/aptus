# Headmaster page OCR — 2 November 2026

- Objective: bounded, traceable Linux text recovery, not translation, Hindi
  selection, model extraction, semantic verification or publication.
- Base/initial HEAD: `93a99368da9cc1de2b248444e7f9a170a34ab50b` (isolated identity commit).
- Worktree: `/private/var/folders/td/j1hpygvj2hd4vtbh_g2slst80000gn/T/opencode/aptus-next-ocr-20261102`.
- Branch: `codex/headmaster-ocr-20261102`. No subagents.
- Owned repository path: this record only. Runtime/test/dependency files were NOT
  changed: the required experiment failed, so integration stopped before editing.
  Docker recipe and experiment scripts are retained with external artifacts.
- Current path: `shared_crawl` → `capture_and_normalize` → `normalize_pdf` →
  `select_pdf_sections` → `complete_pdf_sections` → verification/input preparation.
  Native alternatives are retained; selection currently accepts native candidates
  only. No existing OCR renderer wrapper; pdfplumber already depends on PDFium.
- Saved official PDF: `/tmp/aptus-headmaster-identity-pristine/notice.pdf`,
  3,134,210 bytes; SHA-256
  `3b8a4c84dcca1fdc895fb471a5fe238a4ed988cdd148e7c7d7cff585bae7e901`.
  Physical page 6 is printed page 5. Generic CID font names evade the existing
  font-only heuristic; native text contains repeated legacy sequences.
- Experiment artifacts/commands:
  `/private/var/folders/td/j1hpygvj2hd4vtbh_g2slst80000gn/T/opencode/aptus-headmaster-20261102/`.
  Build a disposable Linux image from existing `aptus-worker:document-check` plus
  Tesseract Hindi/English packages. Do not modify any running worker.
- Integration is conditional on page-image comparison of four-year duration,
  permitted alternatives, classes 9–12 and certification conditions on page 6.
  Later pages are outside this check. Experiment **FAILED**, integration stopped.
- No installs on laptop, paid calls, push, merge, deployment, migration or publication.

## Real Linux result and review

Tesseract 5.5.0 / Leptonica 1.84.1, `hin+eng`, PSM 3, 300 DPI;
PDFium renderer 5.14.0 (already installed via pdfplumber). Disposable image:
`aptus-headmaster-ocr:20261102`, ID
`sha256:15c072d9d91d21f20163e603940b5c87fd30e2104a520580df8ef9217c18cb4d`,
Linux/amd64. Added Debian Tesseract CLI and Hindi/English traineddata in that
image only. No Python OCR wrapper or alternative engine installed. Base image
was existing local `aptus-worker:document-check`, digest
`sha256:f75868e51fbf3955332070b446e9f760451266be4bc49630046fe8a4e5863edf`.

Manually compared the original render/crop with unedited OCR:
- Both `कम से कम 4 वर्ष` clauses survived.
- `प्रवक्ता अथवा सहायक अध्यापक` and the alternative
  `जूनियर हाईस्कूल में प्रधानाध्यापक` survived (OCR adds an invisible joiner in
  प्रवक्ता). No alternative is described as “non-teaching”.
- The visible issue/countersign conditions survived: जनपदीय अधिकारी,
  मण्डलीय अधिकारी, the केन्द्रीय विद्यालयों regional-authority note, and
  retention of the experience certificate by the relevant office.
- **Required check failed:** image `कक्षा 9 से 12` → OCR `कक्षा 9 से 42`.
  Additional observed errors: `01 जुलाई` → `04 जुलाई`, `लेवल-10` → `लेवल-40`,
  `56,100.00` → `56,400.00`, `1,77,500.00` → `4,77,500.00`,
  `18 अप्रैल` → `48 अप्रैल`, `10 दिन` → `40 दिन`, `120` questions → `20`.
  This is a bounded reading comparison, NOT semantic verification of the page
  or eligibility requirements. No later-page requirement was checked.

Actionable findings (likelihood × impact, 1–5; observed failures, not guesses):
1. **5 × 5 = 25, reproduced:** this OCR configuration corrupts the class limit
   and other numbers. Do not integrate; acceptance `classes_9_to_12` fails.
2. **5 × 4 = 20, reproduced on unchanged identity base:** generic CID fonts let
   garbled native text become `usable_candidate` in `normalize_pdf.native_quality`.
   A bounded text-based unreadability trigger remains unimplemented because the
   OCR experiment did not pass. Do not substitute “no Devanagari” as the trigger.
3. **5 × 4 = 20, reproduced diagnostic:** `topics_for` returns `[]` for the
   readable OCR text. Hindi selection is a separate task, not fixed here.

## Reproduction and artifacts

Use these shell variables in the OCR worktree:
```sh
E=/private/var/folders/td/j1hpygvj2hd4vtbh_g2slst80000gn/T/opencode/aptus-headmaster-20261102
W=/private/var/folders/td/j1hpygvj2hd4vtbh_g2slst80000gn/T/opencode/aptus-next-ocr-20261102
P=/Users/mrblackghost/Work/Projects/aptus-next/services/ai/.venv/bin/python
docker build -t aptus-headmaster-ocr:20261102 -f "$E/Dockerfile" "$E"
docker run --rm --network none --memory 1g --cpus 2 --cap-drop ALL --security-opt no-new-privileges --mount "type=bind,source=$W,target=/src,readonly" --mount "type=bind,source=$E,target=/evidence" aptus-headmaster-ocr:20261102 /evidence/experiment.py
python3 "$E/evaluate-experiment.py"
docker run --rm --network none --memory 1g --cpus 2 --cap-drop ALL --security-opt no-new-privileges --mount "type=bind,source=$W,target=/src,readonly" --mount "type=bind,source=$E,target=/evidence" aptus-headmaster-ocr:20261102 /evidence/check-pipeline.py
```
Build/recognition exited 0; acceptance evaluation exited **1**, exact failing
check **`classes_9_to_12`**, other three checks true. Pipeline replay exited 0.
No tuning, second OCR engine, benchmark expansion or correction of raw output.

In `$E`: `notice.pdf` (unchanged copy), `page-6-native.txt`,
`baseline-normalized.json`, `page-6.png`, `page-6-qualification.png`,
`page-6-tesseract.txt`, `experiment.json` (source URL, PDF hash, physical page,
engine/configuration, renderer version, traineddata hashes), `comparison.json`,
`mirror-byte-equality.json`, `headmaster-summary.html`, `baseline-selected.json`,
`baseline-bundle.json`, `baseline-prepared.json`, `pipeline-result.json`.
OCR text SHA-256: `541236e9d4a10176c98305862ab95763618d2b8b7ad7842180c24a2d7e8d8ca2`.
Original artifacts were not modified. Local evidence needs retention outside
temporary storage before relying on it across machine cleanup.

## Checks and remaining boundary

In this worktree:
```sh
PYTHONPATH=services/ai "$P" -m unittest discover -s services/ai/tests -p 'test_pdf*.py' -v
PYTHONPATH=services/ai "$P" -m unittest discover -s services/ai/tests -p 'test_extraction_input.py' -v
pnpm typecheck
pnpm lint
git diff --check
git diff 93a99368da9cc1de2b248444e7f9a170a34ab50b -- services/ai deployment
```
25 PDF tests + 14 input tests passed; typecheck/lint/diff check passed; runtime
diff empty. Existing ignored node_modules and a temporary generated-client link
reused installed dependencies, no installs/config copied. Only our generated
links were removed afterward. Check logs/commands: `$E/checks.json`,
`extraction-input.log`, `typecheck.log`, `lint.log`, `diff-check.log`.
Isolated identity worktree previously passed 8 identity tests and all 378 Python
tests, typecheck/lint (see `headmaster-identity.md`). No unit-test failures.

Stage input → output: saved PDF physical page 6 → PDFium PNG → Tesseract text
with separate native/engine/page provenance, but **rejected for integration**.
No cache, routing/failure fallback or its four behavioural tests were implemented;
they are conditional on a passing real experiment, not silently marked complete.

Unchanged selector/preparation replay uses the full parent document and actual
summary link to the byte-identical mirror: one UPESSC / 09/2026 / 2026 bundle,
0 PDF sections, `llm_input: null`. OCR output is not inserted as native evidence
or sent to an AI. Blocking reasons include `empty_content`, `content_coverage_gap`,
`pdf_requires_review`, and aggregate `grouping_needs_review`. The actual report
also retains `document_role_needs_review` and `authority_needs_review`; those two
are advisory for extraction in current code, not independent blocking gates.

Original `aptus-next` complete staged/unstaged diffs and status were compared
byte-for-byte with pre-task snapshots: unchanged. Identity worktree is committed;
this OCR worktree remains at the base SHA with this record **uncommitted**.
Local experiment/checks only; CI and production not verified. No runtime worker
was changed or restarted. Smallest next step: user review of `comparison.json`
and decision whether to authorize one targeted Tesseract configuration retry;
do not resume integration automatically.

## PaddleOCR candidate experiment — 3 November 2026 (FAILED)

One candidate, one page, no integration. Same saved PDF (hash above, verified
copy), same physical page 6, byte-identical render. Disposable image built from
`aptus-worker:document-check` inside evidence dir
`/private/var/folders/td/j1hpygvj2hd4vtbh_g2slst80000gn/T/opencode/aptus-headmaster-ocr-paddle-20261103/`:
pinned `paddlepaddle==3.2.2` (3.3.x has the PIR-format bug),
`paddleocr==3.5.0`, `paddlex==3.5.2`; models
`PP-OCRv5_mobile_det` + `devanagari_PP-OCRv5_mobile_rec` (per official docs the
rec model covers Hindi + English), doc preprocessing and textline orientation
disabled; image extra apt packages `libgl1 libglib2.0-0 libgomp1` (cv2 + libpaddle).
Image `aptus-headmaster-ocr-paddle:20261103`, tagged, models warm-baked.

Run: `docker run --rm --network none --memory 4g --cpus 2 --cap-drop ALL
--security-opt no-new-privileges --entrypoint python -e
PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True -v <evidence>:/evidence
aptus-headmaster-ocr-paddle:20261103 /evidence/paddle-experiment.py`
(memory 4g不是为了浪费 — engine peak ~2.2 GB; higher than Tesseract's 1g).
Exit 0; 63 text lines; raw text SHA-256
`235b944507046c8544a5c7daf89e62c43ac648627341893d00eff9f7bf53cfc5`;
render SHA-256 `ba797d5e5288374acce93842c3ba877b22ded902eae12fc31cbda1aaa6d7e42f`
— identical to the 2 November render (same PDFium 5.14.0).

Evaluation on RAW text (`evaluate-paddle.py`, checks unchanged from 2 November,
no repair): **FAILED, 2/5 checks false** (script exits 1):
1. `minimum_four_years_both_alternatives` — document shows ASCII `4` in both
   clauses; Paddle emitted Devanagari `४` twice (digit misrecognition, second
   instance also lost the space: `४ वर्षका`).
2. `visible_certification_conditions` — the whole टिप्पणी (तीन) line
   (`अनुभव प्रमाण-पत्र का रख-रखाव सम्बन्धित कार्यालय द्वारा किया जायेगा`) is
   dropped from the output, and `क्षेत्रीय` is mangled to `्षे्रीय`.
Passed: `permitted_role_alternatives`, `headmaster_alternative`,
`classes_9_to_12` (the check Tesseract failed — `कक्षा 9 से 12` is intact here;
also no `कक्षा 9 से 42`).
Other observed errors recorded in `comparison.json` `reading_errors`: `३0`/`६२`
(document `30`/`62`), `1० दिन`/`३ दिन` (document `10`/`3`), `एन०सी०्टी०्ई०`,
`द्वरा`, `अप्ैल`, `प्राविधान`, `प्रतिस्पधा`, `बशर्त`, `निध्धारित` (document
`निर्धारित`), `केन्र` (document `केन्द्र`), `जायेग` (document `जायेगा`), stray
glyph `ऱ`, `₹` emitted as `र`, plus the dropped ``उच्चतर कक्षाओं`` phrase.

Verdict per condition: **FAIL → preserve result and stop; no runtime change.**
Neither engine is acceptable as-is on numbers: Tesseract corrupts `9→42`
digits; Paddle swaps ASCII↔Devanagari digits and drops a line. Artifacts in
`…/aptus-headmaster-ocr-paddle-20261103/`: `Dockerfile` (exact reusable
config), `paddle-warmup.py`, `paddle-experiment.py`, `evaluate-paddle.py`,
`notice.pdf` (verified copy), `page-6-paddle-render.png`,
`page-6-paddle-raw.txt`, `page-6-paddle-lines.json`, `paddle-experiment.json`,
`comparison.json`. Prior 2 November artifacts untouched. Manual visual pass
recorded in `comparison.json` `image_comparison`. Worktree state unchanged
(base SHA, this record still the only modified/untracked path). No runtime
worker, scheduler, push, merge or publish touched. Smallest next step: user
review of both `comparison.json` files and decision whether to authorize a
controlled second configuration (e.g., Paddle server rec model, or layout-
ordered line assembly) — do not resume integration automatically.

## Evidence-path inspection after the verify replay — 3 November 2026 (READ-ONLY)

Objective: determine whether HTML evidence can reach the AI input with the
linked PDF + page provenance attached. Base SHA `93a9936…` verified on both
checkouts (see replay record in
`/tmp/opencode/aptus-headmaster-verify-20261103/`). **No code changed; all
claims below were read from saved stage artifacts, not re-executed.**

### Confirmed from saved artifacts

1. **`llm_input` is null for the real case.** `prepared.json`:
   `coverage.status = "needs_review"`, `review_reasons` = [authority_needs_review,
   document_role_needs_review, empty_content, grouping_needs_review,
   pdf_requires_review, source_crawl_partial]. `llm_input: null`.
2. **HTML + PDF join one bundle.** `bundles.json` bundle
   `898d23ceef9e4ca1c33c6747` (identity UPESSC / 09/2026 / 2026, carried entirely
   by the HTML's block-13 quotes "Advt No 09/2026") contains HTML
   `52e3e1e3…` (role `main_notice`) + PDF `ef9aa08d…` (role `unknown`, zero
   self-identity). Unrelated 10/2026 control is a separate bundle.
3. **Provenance preserved.** `pdf-content.json` page objects keep physical
   `number` (page 6: `native_status: usable_candidate`,
   `resolution_status: manual_review`, garbled Kruti-Dev). Printed "page 5"
   exists only in OCR-experiment metadata, never as a normalized field.
4. **First concrete blocker in the real path.** `verify_bundle.py:89`–91
   `content_units(content,'pdf')` reads only `content.get("sections")`; the
   normalized PDF never has sections ⇒ zero units ⇒ `describe_document`
   (verify_bundle.py:219) flags PDF `empty_content` (bundles.json per-document
   review_reasons confirm it on `ef9aa08d…` only). Then
   `check_coverage.py:178–181` Step A adds `grouping_needs_review`
   (`empty_content` is non-advisory per ADVISORY_REVIEW_REASONS:95–101), and
   Step B `check_coverage.py:191,199–202` adds `pdf_requires_review`
   (`format=='pdf'` and `not content.get('sections')`).
   `build_extraction_input.py:417–419` `prepare_extraction` then returns
   `llm_input: None`; `is_extraction_approved` (:295) requires
   `ready_for_extraction` regardless.
5. **Selection is genuinely empty too.** `selected.json`: `sections: []`,
   status `candidate_requires_review`; `select_pdf_sections.TOPICS` regexes are
   English-only and match nothing on garbled page text (all 55 pages
   `topics: []`). So merging selection output into content would NOT unblock:
   the missing sections have no readable content behind them.
6. **What the AI would have received (HTML blocks 4/13 only):** 1172 posts,
   09/2026, apply 23/10/2026–22/11/2026, age 30/62, fee 1500/-, B.Ed/B.PED,
   "4 Year Experience.", Headmaster (Balak) / (Balika). It would NOT receive:
   classes 9–12 clause, certification wording (सक्षम स्तर/प्रतिहस्ताक्षरित/
   रख-रखाव), or lecturer/JHS-principal alternatives — those exist only on PDF
   page 6 (garbled native; both OCR engines failed acceptance).
7. **OCR never consumed.** `report.json` `pipeline_consumes_ocr_artifacts =
   false`; replay touches OCR dir only in its diagnostic section; only
   `normalize_pdf.py` mentions OCR, to say "No OCR". Tesseract/Paddle outputs
   remain diagnostic-only.
8. **HTML ordering/labels in the would-be payload:** `prepare_extraction`
   (build_extraction_input.py:423–450) emits `documents` in bundle order with
   `role`/`authority`/`identity_context` per document and per-unit
   `{"block": n}` locations; there is no explicit primary/supporting/ocr-trust
   labeling in `bundle-extraction-input-v1`, and no OCR path exists structurally.
   HTML's role `main_notice` is its only de-facto "primary" marker.

### Unverified
- Anything downstream of the gate: payload ordering at runtime, budget,
  model behaviour — never reached for this case.
- Whether a future ocr_trust tier would change any existing test contract
  (no such change exists in `93a9936`).

### Exact blocking reason and stop decision
`llm_input` is null ⇒ per objective: identify the exact gate and stop.
Gate = `empty_content` on the PDF document (`verify_bundle.py:219`), hardened by
Step A + Step B above. No bypass, no manual document merge, no OCR repair,
no paid call, no code change. Smallest next task (requires user decision, same
as recorded above): authorize ONE bounded OCR retry (layout-ordered v5-mobile
assembly) or a Hindi-capable `topics_for`/content-units fix for sectioned PDFs —
both are separate, gate-relevant tasks; do not resume integration automatically.

## Follow-up rec-model experiment — 3 November 2026 (FAILED, worse)

Requested change was "server-tier Devanagari recognition model". Verified first
from official docs, Hugging Face and the installed paddlex 3.5.2 registry:
**no server-tier Devanagari rec model exists**. PP-OCRv5 multilingual ships
only `devanagari_PP-OCRv5_mobile_rec` (84.96%); `PP-OCRv5_server_rec` covers
Chinese/English/Japanese/pinyin only (HF repo absent). Tested instead the
official highest-accuracy Devanagari rec model — documentation substitution,
recorded in all metadata:
`devanagari_PP-OCRv3_mobile_rec` (96.44%, "Devanagari alphabet and numeric
characters", per official model table).

Everything else identical to baseline: same `PP-OCRv5_mobile_det`, same saved
PDF (hash verified in the new dir), same 300 DPI PDFium 5.14.0 render —
`page-6-v3rec-render.png` SHA-256 `ba797d5e…42f`, **byte-identical to baseline**
— same preprocessing-off settings, same pins. One change only:
`text_recognition_model_name="devanagari_PP-OCRv3_mobile_rec"`.

Commands (new dir `…/aptus-headmaster-ocr-paddle-20261103/followup-v3rec/`):
```sh
F=.../aptus-headmaster-ocr-paddle-20261103/followup-v3rec
docker build --platform linux/amd64 -t aptus-headmaster-ocr-paddle-v3rec:20261103 -f "$F/Dockerfile" "$F"
docker run --rm --network none --memory 4g --cpus 2 --cap-drop ALL \
  --security-opt no-new-privileges -e PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True \
  -v "$F":/evidence aptus-headmaster-ocr-paddle-v3rec:20261103 /evidence/paddle-experiment-v3rec.py
python3 "$F/evaluate-v3rec.py"
```
Build and run exited 0; 63 lines; raw SHA-256
`a16012c697631f2a94ba59fed3eaef2e0418738e0cb69528edd0d1e413ed6591`.

Same five acceptance checks on RAW text (first check additionally requires the
ASCII numeral `4` with spacing; certification check explicitly requires the
previously dropped टिप्पणी (तीन) core wording): **FAILED, 0/5 true** (exit 1) —
below the v5 mobile baseline of 3/5. Raw output collapses intra-word spaces,
misplaces Devanagari matra glyphs, breaks conjuncts (प्र→प, क्ष→भ), normalizes
numerals system-wide (`400 अंक`→`ऋठ`, `360`→`उ०`, `120`→`ल20`, `30 वर्ष`→`उ0 वषी`,
`62`→`२वषी`, office serial slashes destroyed) and still drops the टिप्पणी
(तीन) line. Ten grouped reading errors recorded in `v3rec-comparison.json`
`reading_errors`; honest manual visual note in `image_comparison` (render
verified byte-identical to baseline).

Verdict per condition: **FAIL — the server-model upgrade path does not exist,
and the highest-accuracy documented Devanagari rec model is much worse on this
page. Baseline v5 mobile stands, still FAILing 2/5.** No integration, no
runtime/worker/scheduler change; existing 12:25 artifacts untouched. Next step:
user review of all three `comparison.json`-grade files (Tesseract, v5 mobile,
v3 rec). Residual documented options if a further experiment is ever authorized:
the generic `PP-OCRv5_server_rec` (no Devanagari support — not promising) or a
layout-ordered line assembly over the v5 mobile output (fixes reading order,
not digit corruption). Smallest next step: authorize ONE of those or stop the
OCR experiments; do not resume integration automatically.


## Task A — evidence-input ordering for already-readable evidence — 3 November 2026

**Scope:** only `prepare_extraction` assembly in `services/ai/build_extraction_input.py`
and `services/ai/tests/test_extraction_input.py`. This supersedes the earlier "no
code changed" statements for the evidence-path section. No OCR engine, vision model,
OCR routing, paid call, PDF rendering, gate change, deployment or publication.
`verify_bundle.py`, `check_coverage.py`, `normalize_pdf.py` and
`select_pdf_sections.py` are untouched. Owned files: the two above plus this record.

**Decisions**
- Each prepared document gets `label`: `primary` iff its current verified role is
  `main_notice`, else `supporting`. The label controls reading order only; it does
  not rank a third-party HTML page above an official PDF.
- `documents.sort` on `label != 'primary'` is stable: the main notice goes first and
  supporting documents keep bundle order.
- Removed the partial diff's `ocr_sections_of()` and every instruction that mentioned
  OCR. Saved Tesseract and Paddle output corrupted or dropped critical text (see above),
  so OCR stays diagnostic-only and never enters the payload.
- `INSTRUCTIONS` now has a `DOCUMENT ORDER` block: use the first document as the concise
  starting point; inspect every supporting section; keep non-conflicting facts found only
  in a supporting document; report real conflicts as unresolved (null plus a
  `missing_fields` reason) quoting both sources; PDF locations are physical page numbers,
  not printed page labels (printed labels are not preserved in normalized data).
- Removed the partial diff's "prefer primary-document evidence" wording because it
  contradicted the order-only label.
- The partial fixture was wrong: the linked PDF's first lines (`Post: Headmaster ...`)
  satisfy `is_candidate_notice`, so both documents became `main_notice`. The new linked
  PDF has no notice title, so it gets role `unknown`. `test_fixture_roles_prove_intended_ordering_case`
  asserts this directly.
- `EXTRACTION_VERSION` (`extract-bundle-v4`) is NOT bumped. Instructions and document
  order changed, but the evidence fingerprint sorts documents by id and ignores labels.
  Cached notices therefore stay reusable until their evidence changes. Bumping would force
  paid re-extraction of every cached notice, so it needs a separate owner decision.

**Tests** (7 new in `EvidenceOrderingTests`): fixture roles; HTML main first with linked
PDF supporting, in both bundle orders, with the input bundle unmutated; PDF main stays
first over supporting HTML, from a reversed bundle; PDF-only condition kept with
`{page, block_id, line_range}` provenance and absent from the primary document; linked PDF
with no sections still gives `llm_input: None` / `needs_review` / `pdf_requires_review`;
fake OCR alternatives in the PDF content never appear in the payload (no `ocr_sections`,
no sentinel text, no "ocr" in the instructions); required instruction phrases present.

**Checks** (run in this worktree, `P` = the project venv python):
```sh
PYTHONPATH=services/ai "$P" -m unittest discover -s services/ai/tests -p 'test_extraction_input.py' -v   # 21 OK
PYTHONPATH=services/ai "$P" -m unittest discover -s services/ai/tests -p 'test_*.py'                     # 385 OK
git diff --check                                                                                          # clean
```
Mutation check: with the sort disabled, 3 ordering tests fail; the sort was restored and
the suite is green. The earlier failures (2 failures, 1 error) are fixed. `test_headmaster_identity`
still asserts `prepare_extraction(...)['llm_input'] is None` for the real Headmaster
shape, and it passes. System `python3` lacks `pdfplumber`, so use the venv.

**Remaining limitation:** this only improves inputs that already reach extraction. The
real Headmaster bundle is still blocked at the `empty_content` / `pdf_requires_review`
gate because page 6's native text is unusable. Separate next task: vision-based recovery of
unusable PDF pages. Not started here.


### Task A follow-up — extraction version bump (`extract-bundle-v5`) — 3 November 2026

**Scope & owned files:** `services/ai/notice_state.py`, `services/ai/tests/test_notice_state.py`, and this record (preserving existing uncommitted Task A changes in `services/ai/build_extraction_input.py` and `services/ai/tests/test_extraction_input.py`).

**Decisions**
- Updated `EXTRACTION_VERSION` from `extract-bundle-v4` to `extract-bundle-v5` because the Task A document-order instructions and supporting-document condition rules materially changed the prompt contract.
- Kept `compute_evidence_fingerprint`'s stable `document_id` sorting unchanged.
- Added `test_v5_extraction_version_invalidates_v4_draft_and_reuses_v5_draft` proving that identical evidence produces distinct fingerprints under `v4` and `v5`, a saved `v4` draft is not reused under `v5`, and a saved `v5` draft is reused when evidence is unchanged.

**Checks** (run in this worktree with project venv `$P`):
```sh
PYTHONPATH=services/ai "$P" -m unittest discover -s services/ai/tests -p 'test_notice_state*.py' -v   # 24 OK
PYTHONPATH=services/ai "$P" -m unittest discover -s services/ai/tests -p 'test_*.py'                  # 386 OK
git diff --check                                                                                      # clean
```

**Remaining boundary:** Bumping `EXTRACTION_VERSION` prepares cached `v4` notices for fresh extraction on a future deployed worker run, without making any provider call, publishing any job, pushing, merging, or deploying during this task.


## Gemini 2.5 Flash vision recovery experiment — 3 November 2026

**Objective & boundary:** One bounded, evidence-first visual-model experiment to test whether `gemini-2.5-flash` can accurately recover the known missing conditions from UPESSC Headmaster Advt No `09/2026` physical PDF page 6 (printed page 5) when supplied as a visual page image alongside the clearly labelled third-party HTML summary. Not an OCR/vision runtime integration; no worker, production config, Docker image, schema, gate, dependency, or deployment changed.

- **Base SHA:** `93a99368da9cc1de2b248444e7f9a170a34ab50b` on `codex/headmaster-ocr-20261102`.
- **Owned repository files in this worktree:** `docs/agent-progress/headmaster-ocr.md` (plus the preserved Task A uncommitted edits in `services/ai/build_extraction_input.py`, `services/ai/notice_state.py`, `services/ai/tests/test_extraction_input.py`, `services/ai/tests/test_notice_state.py`).
- **Dedicated experiment artifact directory:** `/private/var/folders/td/j1hpygvj2hd4vtbh_g2slst80000gn/T/opencode/aptus-headmaster-gemini-vision-20261103/` (`gemini-experiment.py`, `evaluate-gemini.py`, `request-spec.json`, `gemini-raw-response.json`, `gemini-experiment.json`, `comparison.json`). All prior Tesseract (`aptus-headmaster-20261102`) and PaddleOCR (`aptus-headmaster-ocr-paddle-20261103`) artifacts were verified untouched via SHA-256.

**Request method, model & source hashes**
- **Endpoint & model:** `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent` (`modelVersion: "gemini-2.5-flash"`, `temperature: 0.0`, `responseMimeType: "application/json"`, strict `responseJsonSchema`).
- **Credential handling:** Loaded via `python-dotenv` and `extract_bundle.provider_keys("gemini")` without inspecting or printing `.env` or secret values (`key_pool_size: 11`, succeeded on `used_key_index: 1`, HTTP `200`, `finishReason: "STOP"`).
- **Measured input size & token usage:**
  - `system_instruction`: `1,372` chars
  - `user_prompt` (instructions + third-party HTML summary blocks): `9,799` chars
  - `inlineData` (`page-6.png` `image/png`): `1,302,787` bytes (`1,737,052` base64 chars)
  - Total JSON wire payload: `1,751,293` bytes
  - Token usage (`usageMetadata`): `3,455` prompt tokens (`3,197` text + `258` image), `789` candidate tokens, `757` thought tokens, `5,001` total tokens.
- **Verified input & output SHA-256 hashes:**
  - `notice.pdf`: `3b8a4c84dcca1fdc895fb471a5fe238a4ed988cdd148e7c7d7cff585bae7e901` (unchanged)
  - `page-6.png`: `ba797d5e5288374acce93842c3ba877b22ded902eae12fc31cbda1aaa6d7e42f` (unchanged)
  - `headmaster-summary.html`: `2bdea49ab78aa5063ea3c3362645a6e2d71f5226042d11f29a76a71bc4d27c51` (unchanged)
  - `baseline-bundle.json`: `6c288539e5e161e78173f47a6ee8d73bbaf0d841fdd22d72dfa0fe7d81eaf5f2` (unchanged)
  - `page-6-native.txt`: `76121f1059d8cea3fe02b361968c53c8ef06799cd4558fc5622c63258ac05da3` (unchanged, never sent)
  - `page-6-tesseract.txt`: `541236e9d4a10176c98305862ab95763618d2b8b7ad7842180c24a2d7e8d8ca2` (unchanged, never sent)
  - `page-6-paddle-raw.txt`: `235b944507046c8544a5c7daf89e62c43ac648627341893d00eff9f7bf53cfc5` (unchanged, never sent)
  - `gemini-raw-response.json`: `acaec15e267f5a068688e4828916844da20f49c7f879d02a63cc6dd287353269`

**Result & deterministic comparison verdict against `page-6.png`**
1. **Both four-year alternatives present (`both_four_year_alternatives_present`): PASS**
   - Returned both official PDF clauses verbatim with ASCII `4` (never Devanagari `४`):
     - `"कम से कम 4 वर्ष का शिक्षण अनुभव"` (`value: "4 years"`, `source_type: "official_pdf_page"`, `physical_pdf_page: 6`, `confidence: "high"`)
     - `"कम से कम 4 वर्ष का कार्यानुभव"` (`value: "4 years"`, `source_type: "official_pdf_page"`, `physical_pdf_page: 6`, `confidence: "high"`)
   - Kept the third-party HTML summary entry separate: `"4 Year Experience."` (`value: "4 Year Experience"`, `source_type: "summary_html"`, `physical_pdf_page: null`, `confidence: "high"`).
2. **`कक्षा 9 से 12` exact, never `42` (`classes_9_to_12_exact_never_42`): PASS**
   - Returned `source_language_quote: "कक्षा 9 से 12"`, `value: "Class 9 to 12"`, `source_type: "official_pdf_page"`, `physical_pdf_page: 6`, `confidence: "high"`. `"42"` does not appear anywhere in the response.
3. **Permitted role alternatives (`permitted_role_alternatives`): PASS on role nouns (`permitted_role_alternatives_role_tokens: true`), FAIL/PARTIAL on institutional qualifier (`permitted_role_alternatives_with_jhs_qualifier: false`)**
   - Extracted all three role titles with verbatim Hindi quotes (`"प्रवक्ता"`, `"सहायक अध्यापक"`, `"प्रधानाध्यापक"`) and `physical_pdf_page: 6`.
   - **Observed gap:** Truncated the qualifying school level `"जूनियर हाईस्कूल में"` from the third role item (`value: "Headmaster"`, `source_language_quote: "प्रधानाध्यापक"` instead of `"जूनियर हाईस्कूल में प्रधानाध्यापक"`). On the page, `प्रवक्ता अथवा सहायक अध्यापक` applies to `उच्चतर कक्षाओं (कक्षा 9 से 12)` while `प्रधानाध्यापक` is specifically qualified by `जूनियर हाईस्कूल में`.
4. **Visible certificate / issuing-authority conditions (`visible_certificate_conditions_preserved`): PASS**
   - Preserved all three `टिप्पणी` clauses verbatim from `official_pdf_page` (`physical_pdf_page: 6`), including the `टिप्पणी (तीन)` line that both PaddleOCR configurations dropped:
     - `"सक्षम स्तर से निर्गत का तात्पर्य जनपदीय अधिकारी द्वारा निर्गत एवं मण्डलीय अधिकारी द्वारा प्रतिहस्ताक्षरित।"`
     - `"केन्द्रीय विद्यालयों के सम्बन्ध में सक्षम स्तर का तात्पर्य क्षेत्रीय अधिकारी से है।"`
     - `"निर्गत किये गये अनुभव प्रमाण-पत्र का रख-रखाव सम्बन्धित कार्यालय द्वारा किया जायेगा।"`
5. **Exact quotation and provenance on every non-null field (`every_non_null_field_exact_quote_and_provenance`): PASS (10/10 items)**
   - All 9 `official_pdf_page` items match exact substrings on physical page 6 with `physical_pdf_page: 6` (not confused with printed page `5`), and the 1 `summary_html` item matches the HTML summary with `physical_pdf_page: null`.

**Next recommended step:** Do not integrate into runtime yet from a single-page experiment. Before designing a vision-recovery stage for legacy-font PDFs, ensure the extraction prompt/schema requires role/experience rules to preserve their qualifying institution/scope clause (`जूनियर हाईस्कूल में प्रधानाध्यापक` vs `उच्चतर कक्षाओं (कक्षा 9 से 12) में प्रवक्ता अथवा सहायक अध्यापक`) as a complete condition rather than bare role nouns, and evaluate across the remaining unread pages (and a small multi-notice sample) with explicit cost/page-budget guards.


### Condition-level Gemini 2.5 Flash follow-up & dynamic post-binding instruction — 3 November 2026

**Objective & boundary:** Prove that `gemini-2.5-flash` keeps each complete post-scoped eligibility/experience condition together (preserving `प्रधानाध्यापक` + `जूनियर हाईस्कूल` + `4` years as a distinct alternative from `प्रवक्ता` / `सहायक अध्यापक` + `उच्चतर कक्षाओं (कक्षा 9 से 12)` + `4` years) without hard-coding post names, and add a generic post-scoped extraction instruction to `services/ai/build_extraction_input.py`. No worker, pipeline gate, database schema, Docker image, deployment, or publication behavior changed.

- **Base SHA:** `93a99368da9cc1de2b248444e7f9a170a34ab50b` on `codex/headmaster-ocr-20261102`.
- **Changed files in worktree:**
  - `services/ai/build_extraction_input.py`: added the generic post-binding instruction (`Extract requirements separately for every named post/role. A requirement belongs to a post only when its evidence names that post or clearly binds it. Preserve post-specific qualification, experience, age, category, vacancy, certificate, and date conditions with source quotations. Never copy a condition from one post to another. Never decide whether a candidate is eligible.`). Kept existing output schema, gates, HTML-first ordering, and `EXTRACTION_VERSION` (`extract-bundle-v5`) intact.
  - `services/ai/tests/test_extraction_input.py`: extended `test_instructions_describe_order_without_claiming_authority_or_printed_pages` to assert the new post-binding instruction sentences.
  - `docs/agent-progress/headmaster-ocr.md`: this section.
- **External experiment & evaluator artifacts (`/private/var/folders/td/j1hpygvj2hd4vtbh_g2slst80000gn/T/opencode/aptus-headmaster-gemini-vision-20261103/`):**
  - `gemini-condition-experiment.py`: post-scoped, condition-level request builder and quota-only rotation runner (`request_with_quota_only_rotation`). Does not read, search for, or load any `.env` file; uses only credentials already injected into the process environment (`provider_keys("gemini")`); rotates across configured keys only on HTTP `429` / `RESOURCE_EXHAUSTED`.
  - `run-condition-experiment.cjs`: Node launcher (`scripts/run-bundle-extraction.cjs` pattern) that injects the runtime environment and invokes the worktree venv Python for a single run without printing secrets.
  - `condition-request-spec.json`: sanitized request specification (`1,753,019` wire bytes, `4,108` prompt tokens = `3,850` text + `258` image, `1,591` candidate tokens, `4,557` thought tokens).
  - `gemini-condition-raw-response.json`: unedited condition-level JSON response from `gemini-2.5-flash`, SHA-256 `cdf64327b42898739dcf5464e51d6d24ba1d59b819958a00da539d0d880d9fa1` (prior flat response `gemini-raw-response.json` remains intact at `acaec15e267f5a068688e4828916844da20f49c7f879d02a63cc6dd287353269`).
  - `gemini-condition-experiment.json`: run metadata (`key_pool_size: 7`, `used_key_index: 1`, HTTP `200`, `finishReason: "STOP"`).
  - `evaluate-gemini-condition.py` & `condition-comparison.json`: deterministic evaluator comparing raw JSON against a `human-reviewed benchmark (not an automatically derived source truth)` and verifying SHA-256 immutability of all 9 prior artifacts.
  - `test_condition_experiment.py`: 8 focused unit tests covering `.env` non-loading, quota-only rotation, non-rotation on `400`/`401`/`403`/`500`, exhaustion stop, human-reviewed benchmark labeling, qualifier/class-42 rejection, and the saved real condition-level response.

**Commands & results**
```sh
E_GEM=/private/var/folders/td/j1hpygvj2hd4vtbh_g2slst80000gn/T/opencode/aptus-headmaster-gemini-vision-20261103
W=/private/var/folders/td/j1hpygvj2hd4vtbh_g2slst80000gn/T/opencode/aptus-next-ocr-20261102
node "$E_GEM/run-condition-experiment.cjs"                                                       # 1 call, HTTP 200
python3 "$E_GEM/evaluate-gemini-condition.py"                                                    # 5/5 checks PASS, exit 0
python3 -m unittest discover -s "$E_GEM" -p 'test_condition_experiment.py' -v                    # 8 OK
PYTHONPATH="$W/services/ai" python3 -m unittest discover -s "$W/services/ai/tests" -p 'test_extraction_input.py' -v  # 21 OK
git -C "$W" diff --check                                                                         # clean
```

**Acceptance check results (`condition-comparison.json`)**
1. `two_complete_headmaster_experience_alternatives`: **PASS** — Both identified posts (`Headmaster (Balak)` and `Headmaster (Balika)`, bound via section `9.(क) प्रधानाध्यापक, अशासकीय सहायता प्राप्त विद्यालयों (बालक/बालिका)` and the HTML summary) have two separate, unmerged `official_pdf_page` experience alternatives.
2. `second_alternative_retains_pradhanadhyapak_junior_high_school_and_4_years`: **PASS** — Alternative 2 explicitly retains `role_titles: ["प्रधानाध्यापक"]`, `institution_or_scope: "जूनियर हाईस्कूल"`, `class_scope: null`, `minimum_years: 4`, and its verbatim supporting quote.
3. `first_alternative_retains_classes_9_to_12_and_never_42`: **PASS** — Alternative 1 retains `role_titles: ["प्रवक्ता", "सहायक अध्यापक"]`, `institution_or_scope: "केन्द्र / राज्य सरकार द्वारा मान्यता प्राप्त संस्था"`, `class_scope: "उच्चतर कक्षाओं (कक्षा 9 से 12)"`, `minimum_years: 4`, and `"42"` never appears.
4. `certificate_wording_and_physical_page_provenance_present`: **PASS** — Both alternatives preserve all three `टिप्पणी` certificate conditions verbatim (`सक्षम स्तर`, `जनपदीय अधिकारी`, `मण्डलीय अधिकारी प्रतिहस्ताक्षरित`, `केन्द्रीय विद्यालयों / क्षेत्रीय अधिकारी`, `रख-रखाव सम्बन्धित कार्यालय`) with `source_type: "official_pdf_page"`, `physical_pdf_page: 6`, and `source_locator: "official_pdf:page-6:section-7(3)"`.
5. `every_structured_fact_has_verbatim_supporting_quote`: **PASS** — Every post and experience alternative has a verbatim supporting quote matching the human-reviewed benchmark.

**Remaining limits:** This remains a single-page offline experiment (`page-6.png`) plus an instruction improvement in `build_extraction_input.py`. The runtime pipeline still blocks the real UPESSC Headmaster PDF at `empty_content` / `pdf_requires_review` (`llm_input: None`), and no vision recovery is wired into the worker or production flow yet.
