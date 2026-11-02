# Headmaster identity regression — 2 November 2026

- Summary: https://www.sarkariresult.com/2026/upessc-up-headmaster-09-2026/
- Its **Download Notification** link:
  https://doc.sarkariresults.org.in/UPESSC_Head_Master_Notification_2026.pdf
- Official PDF: https://upessc.up.gov.in/Notice/12ec-b52c-447c-2cb9-f041.pdf
- Both saved captures are byte-identical: 3,134,210 bytes, SHA-256
  `3b8a4c84dcca1fdc895fb471a5fe238a4ed988cdd148e7c7d7cff585bae7e901`.

`headmaster-summary-identity.html` contains only the saved title, issuer,
mid-line advertisement heading and notification-link excerpts, not the full page.
`headmaster-native-pages.json` contains the saved native alternatives and page
geometry for physical pages 1 and 6; nonessential diagnostics are omitted.
The text has **not** been decoded, OCR-replaced or corrected. Physical page 6 is
printed page 5. The cover is physical page 1 (no printed number).

The native alternatives were checked verbatim against the saved normalizer JSON
(SHA-256 `977d426426eaf432413d77794fa182c010b103a6606c7f9b0876332cb39c477d`).
That JSON used the official URL. The fixture uses the exact summary-linked URL
because its independently downloaded bytes were verified equal, not because a
similar title or shared domain was assumed to establish membership.

## Scope and invariants

The only runtime change recognizes bounded mid-line advertisement identifiers
without swallowing `| Short Details of Notification`. Existing direct-link
grouping then associates summary and linked PDF. The existing `identity_context`
retains the parent header and page-1 locators independently of page selection.
A page is not wrapped as a new anonymous document and no identity is inserted
into its text. A separate synthetic-readable-header test proves field inheritance
from parent context without claiming legacy-font decoding works.

No new provenance schema or hash-alias grouping mechanism is introduced. The
official/mirror hash relationship is verified in the offline replay, not an
automatic production URL-alias feature. Mirror authority remains `needs_review`.
The real native PDF still selects zero sections; input preparation stays blocked.
This slice proves source/document/page membership, not OCR or model extraction.

Focused check:
`PYTHONPATH=services/ai services/ai/.venv/bin/python -m unittest discover -s services/ai/tests -p 'test_headmaster_identity.py' -v`

Full saved-capture replay and evidence: `/tmp/aptus-headmaster-identity-result/`
(`replay.py`, `relationship.json`, `crawl/crawl.json`, `bundles.json`, `prepared.json`).
The replay checks actual link discovery, byte equality, fixture fidelity,
one related bundle and a separate illustrative unrelated notice, without network
or paid calls. Original container artifacts remain untouched; host copies are
`/tmp/aptus-headmaster-identity-pristine/` and
`/tmp/aptus-headmaster-identity-saved/`.

Verification: the original code failed three focused regressions; all eight now
pass. Full Python suite: 378 passed, one failure in
`test_source_registry.test_default_registry_preserves_existing_source_selection`
(existing source-registry working changes). That same failure reproduces with
the HEAD version of `verify_bundle` loaded instead of the modified module.
`pnpm typecheck`, `pnpm lint` and scoped `git diff --check` pass.
