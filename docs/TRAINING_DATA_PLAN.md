# Future local-model data

Updated: 11 October 2026. Data preservation now; model training and user-facing
AI remain future work. No new model, dependency, GPU job or live AI call added.

## Saved pairs

`outputs/training/extraction-v1/paired-candidates.jsonl` contains three local
examples: IIT Kanpur Project Assistant, Project Technician and Senior Research
Analyst. Each row stores allowlisted public source evidence beside the reviewed
structured output, a stable example ID, schema version/hash, source URL,
artifact hashes/references, provider/model, corrections and review limitations.
`target-schema.json` stores the BundleFacts target contract; `summary.json`
records the verification outcome.

The target is the reviewed canonical BundleFacts output, not the provider's
compact wire response. The archive is provider-neutral and is not directly a
fine-tuning chat dataset. Prompt/chat conversion will depend on the chosen model
and target task. Prepared inputs and original provider responses remain in their
original extraction directories; their hashes link them to each saved pair.

All three targets pass schema validation and current source validators with zero
errors. They remain **training candidates**, not certified gold examples:
source review was performed by the assistant, exhaustive completeness is not
proven, and unknown fields remain explicit. The Assistant's missing tenure field
is recorded as a known gap. Its malformed pay parent, unsupported monthly
inference and malformed scope quote are recorded as operator repairs. Original
mistakes are retained for debugging, not promoted to desired answers.

These files contain public recruitment material. No applicant profiles, DOBs,
categories, private chats, credentials, cookies or runtime configuration were
included. Public application contact details remain part of the official notice.
No dataset was uploaded or published. Normal source-use/retention review is still
needed before training or distributing a dataset.

## Future collection and evaluation

Automatic collection for future runs is **not enabled** by this export. Add a
small preservation hook at the extraction/review boundary later, coordinated
with the recovery queue: keep raw failed output separately and promote only
reviewed versions to candidate targets. Make captures repeat-safe, link each
repair to its original, and retain schema/pipeline versions.

Before training, review labels and coverage, collect varied notifications,
deduplicate source versions, and split by notification/campaign so related
examples cannot appear in both training and held-out evaluation. Compare the
local model with the current provider using the same held-out source documents,
checking numeric facts, dates, required qualifications, citations, explained
unknowns and inference cost. Three examples demonstrate storage, not readiness
to train a useful model or proof of superior accuracy.

User-facing AI is a separate future product task. These extraction examples do
not train a personal assistant. Eligibility remains deterministic code; an AI
must not invent jobs or make eligibility decisions. Do not collect private user
conversations as training data without a separately agreed purpose and consent.

## Verification

Offline export/readback: three distinct example IDs, three schema-valid targets,
zero current source-validator errors, original response references verified.
No database writes, live model calls or changes to production extraction code.
