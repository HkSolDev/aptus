"""Independent acceptance cases for fingerprint stability and draft integrity."""

import copy
import json
import tempfile
import unittest
from pathlib import Path

from normalize_html import normalize_html
from notice_state import NoticeStateManager, compute_evidence_fingerprint


def notice(sections=None):
    return {
        "bundle_id": "example-notice-2026",
        "identity": {"issuer": "Example Board", "advertisement_number": "01/2026"},
        "documents": [{
            "document_id": "main", "role": "main_notice", "format": "html",
            "authority": "official", "title": "Recruitment",
            "sections": sections if sections is not None else [
                {"evidence_id": "main:unit-0", "text": "Maximum age 30 years"}],
        }],
    }


class FingerprintAcceptanceTests(unittest.TestCase):
    def test_json_key_order_does_not_change_fingerprint(self):
        original = notice()
        reordered = json.loads(json.dumps(original, sort_keys=True))
        self.assertEqual(compute_evidence_fingerprint(original),
                         compute_evidence_fingerprint(reordered))

    def test_html_indentation_spaces_and_style_do_not_change_fingerprint(self):
        versions = [
            b"<body><p>Maximum age 30 years</p></body>",
            b"<body>\n  <style>p {color: red}</style>\n"
            b"  <p>Maximum   age 30 years</p>\n</body>",
        ]
        inputs = [notice(normalize_html(html, "https://example.gov.in/notice")["blocks"])
                  for html in versions]
        self.assertEqual(compute_evidence_fingerprint(inputs[0]),
                         compute_evidence_fingerprint(inputs[1]))

    def test_repeated_horizontal_spaces_in_prepared_text_do_not_change_fingerprint(self):
        original = notice()
        reformatted = copy.deepcopy(original)
        reformatted["documents"][0]["sections"][0]["text"] = "Maximum   age 30 years"
        self.assertEqual(compute_evidence_fingerprint(original),
                         compute_evidence_fingerprint(reformatted))

    def test_real_age_change_changes_fingerprint(self):
        original = notice()
        revised = copy.deepcopy(original)
        revised["documents"][0]["sections"][0]["text"] = "Maximum age 35 years"
        self.assertNotEqual(compute_evidence_fingerprint(original),
                            compute_evidence_fingerprint(revised))

    def test_table_column_changes_are_not_hidden_by_normalization(self):
        original = notice([{"text": "Category Age", "rows": [["General", "30"], ["SC", "35"]]}])
        revised = copy.deepcopy(original)
        revised["documents"][0]["sections"][0]["rows"] = [["General", "35"], ["SC", "30"]]
        self.assertNotEqual(compute_evidence_fingerprint(original),
                            compute_evidence_fingerprint(revised))


class DraftIntegrityAcceptanceTests(unittest.TestCase):
    def test_unchanged_saved_draft_can_be_reused_after_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            draft = root / "draft.json"
            envelope = {"bundle_id": "example-notice-2026", "facts": {"max_age": 30}}
            draft.write_text(json.dumps(envelope), encoding="utf-8")
            NoticeStateManager(root).record_success(envelope["bundle_id"], "evidence-a", "v1", draft)
            self.assertEqual(NoticeStateManager(root).get_reusable_draft(
                envelope["bundle_id"], "evidence-a", "v1"), envelope)

    def test_replaced_valid_json_draft_with_same_notice_id_is_not_reused(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            draft = root / "draft.json"
            envelope = {"bundle_id": "example-notice-2026", "facts": {"max_age": 30}}
            draft.write_text(json.dumps(envelope), encoding="utf-8")
            NoticeStateManager(root).record_success(envelope["bundle_id"], "evidence-a", "v1", draft)
            # Simulate an older draft replacing the file without changing its notice ID.
            envelope["facts"]["max_age"] = 25
            draft.write_text(json.dumps(envelope), encoding="utf-8")
            self.assertIsNone(NoticeStateManager(root).get_reusable_draft(
                envelope["bundle_id"], "evidence-a", "v1"))
