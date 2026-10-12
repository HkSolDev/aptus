import copy
import json
import unittest
from pathlib import Path

from store_candidate import prepare_storage, storage_schema
from services.ai.tests import test_validate_candidate as validation_tests


class StoragePreparationTests(unittest.TestCase):
    def test_draft_preserves_full_facts_evidence_locations_and_review(self):
        result, source = validation_tests.CandidateValidationTests().candidate()
        result['bundle_id'] = source['bundle_id']
        before = copy.deepcopy(result)
        draft = prepare_storage(result, source, source_name='Fictional notice')
        self.assertEqual(draft['facts'], result['facts'])
        self.assertTrue(draft['evidence_units'][0]['locations'])
        self.assertFalse(draft['review']['publication_allowed'])
        self.assertEqual(draft['review']['field_checks'], result['inline_check']['fields'])
        self.assertEqual(draft['review']['bundle_identity'], source['identity'])
        self.assertEqual(result, before)

    def test_blocked_or_mismatched_candidates_cannot_be_prepared(self):
        result, source = validation_tests.CandidateValidationTests().candidate()
        for candidate in [{}, {**result, 'bundle_id': 'wrong-bundle'}]:
            with self.assertRaises(ValueError):
                prepare_storage(candidate, source, source_name='Fictional notice')

    def test_generated_storage_schema_stays_in_sync(self):
        path = Path(__file__).resolve().parents[1] / 'candidate-storage.schema.json'
        self.assertEqual(json.loads(path.read_text()), storage_schema())


if __name__ == '__main__':
    unittest.main()
