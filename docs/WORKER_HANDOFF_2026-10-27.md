# Agent 2 diagnostic-only implementation handoff

Status: implemented and verified offline; not integrated or deployed. This
supersedes the earlier pending worker handoff. The retained-response diagnosis
remains in WORKER_LOCAL_DIAGNOSIS_2026-10-27.md.

## Exact base and commit

Worktree: /private/tmp/aptus-worker-extraction-20261027.
Branch: codex/worker-extraction-offline-20261027.
Actual clean implementation base: ed6a3698653250e90bb43e4bd73417f94eb32d75.
Focused implementation commit: 1dec58e82114758cca66c85dc8eebccda309e4a5.
Original dirty aptus-next checkout was preserved.

Production revision in Agent 1's handoff is 7e974cc098f405475f7093567bcf26cde4c40a4a.
The local decoder/schema/instructions matched that revision before this change;
extract_bundle.py also has production metrics/scheduling changes absent from this
older implementation base. Review/apply the focused diff rather than replacing
production files with this checkout. Combined integration is not verified here.

## Problem and changed files

The retained two-post response omitted category_relaxation_rules on both posts.
The old decoder stopped at post 0, so diagnostics concealed the second omission.

- services/ai/compact_inline.py: collect required-field omissions across posts;
  raise the same MissingFactsError before inline decoding; keep relative fields
  and carry absolute post locations on the exception.
- services/ai/extract_bundle.py: filter locations against schema-owned scalar or
  nullable-object paths, deduplicate, count and cap reported locations at 20.
  FactDecodingError.location_details contains location_count and field_locations.
  Existing details retains its exact shape. CLI adds missing_fact_locations as
  a separate key, retaining exit 1/blocked and producing no candidate file.
- services/ai/tests/test_missing_fact_locations.py: six focused tests for either/
  both post omissions, multiple distinct fields across posts, location bounds,
  schema filtering/privacy, actual CLI output/no candidate/input preservation,
  and terminal hold/no repeated extraction.

No schema, prompt, retry implementation, protected contract/fixture/lock/audit,
existing assertion, sources.json or dependency changed. The archive investigation
was not expanded during implementation.

## Before and after — same retained response

Reason remains provider_fact_decoding_failed. Legacy details remains:

```json
{"check":"unreported_scalar_fields","field_count":1,"field_paths":["category_relaxation_rules"]}
```

Before: no post locations; decoder stopped at the first post.
After: separate location diagnostics:

```json
{"location_count":2,"field_locations":["posts.0.category_relaxation_rules","posts.1.category_relaxation_rules"]}
```

Original response remains rejected. No null facts or relaxation years are added.
Unknown values require explicit fact records and reasons. Explicit unknowns and
numeric values retain existing behavior, covered by the unchanged omission
regression and existing decoder tests. Review holds and completed checkpoint
reuse remain enforced. There is no claim of improved extraction success.

## Verification

RED: new location tests failed before runtime edits (missing location diagnostics;
second-post missing pay was hidden). An initial additive details implementation
failed an existing exact-shape assertion. That implementation was corrected by
keeping details unchanged and adding a separate location_details property/CLI
key; no existing assertion was changed.

GREEN commands from Agent 2 worktree:

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=services/ai:services/ai/tests services/ai/.venv/bin/python -m unittest test_missing_fact_locations test_relaxation_omission test_extract_bundle test_inline_extraction test_stage_recovery test_staged_extraction -q
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=services/ai services/ai/.venv/bin/python -m unittest discover -s services/ai/tests -q
git diff --check
```

Results: focused 67 passed; full Python discovery 383 passed; diff check passed.
Full-suite log: /private/tmp/agent2-worker-implementation-full-tests-final.log.
The previously reported registry failure belonged to another dirty snapshot;
no registry failure occurred in this isolated tree, and expectations were not
changed. Six new tests plus existing tests exercise strict rejection, explicit
unknowns, numeric preservation, unchanged bytes and no repeated extraction.

Retained evidence replay (request function replaced with saved bytes only):

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=services/ai services/ai/.venv/bin/python - <<'PY'
import json
from pathlib import Path
from unittest.mock import patch
from extract_bundle import extract_bundle, FactDecodingError
root = Path('/private/tmp/aptus-server-audit-20261027')
prepared = json.loads((root / 'representative-prepared.json').read_text())
saved = json.loads((root / 'representative-response.json').read_text())
with patch('extract_bundle.request_structured', return_value=(saved['response'], saved['metadata'])):
    try:
        extract_bundle(prepared)
    except FactDecodingError as error:
        print(json.dumps({'reason': str(error), 'details': error.details,
                          'missing_fact_locations': error.location_details}))
PY
```

Agent 1's manifest hashes for prepared input, response, diagnostic and saved runs
were rechecked unchanged. The copied existing Python environment is private to
this lane, with bytecode writes disabled. No downloads or upgrades were made.

## Limits and remaining work

- Output is capped at 20 schema-filtered locations, with a full unique location
  count; it does not print provider values, quotes, credentials or arbitrary paths.
- Aggregation covers missing-required-field failures. Other malformed compact
  records can still stop decoding first; this is not an all-errors validator.
- Generic scheduler/retry files still persist the stable failure reason only.
  New post locations are available on the exception and CLI; durable scheduler
  diagnostics would require separately approved scope.
- No semantic repair of incomplete responses, model experiment or additional
  archive investigation was performed. The original provider omission remains.
- Not run: combined contract/Node tests, CI, production replay, deployment or
  production recovery. The two edited runtime modules were verified through the
  Python suite, not a claim of whole-product integration.
- No production SSH/change, network/provider call, paid retry, live pipeline,
  retry-state modification, hold clearing, approval/publication, DB write, push,
  merge or deployment occurred. Synthetic tests use private temporary state.
