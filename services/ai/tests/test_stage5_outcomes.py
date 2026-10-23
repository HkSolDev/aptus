"""Stage 5 contract boundaries, independent of live provider availability."""
import copy
import unittest
import json
import tempfile
from pathlib import Path
from unittest.mock import Mock

from build_extraction_input import prepare_extraction
from notice_state import verify_cached_citations
from test_extraction_input import sample_bundle
from validate_candidate import validate_candidate
from generic_pipeline import run_pipeline


class PurposeValidationTests(unittest.TestCase):
    def setUp(self):
        self.source = prepare_extraction(sample_bundle())['llm_input']['input']
        unit = self.source['documents'][0]['sections'][0]
        self.citation = {'evidence_id': unit['evidence_id'], 'quote': unit['text']}
        self.facts = dict(purpose='non_job', purpose_evidence=[self.citation],
                          document_purposes=[dict(document_id=doc['document_id'], purpose='non_job',
                              evidence=[dict(evidence_id=doc['sections'][0]['evidence_id'],
                                             quote=doc['sections'][0]['text'])])
                              for doc in self.source['documents']], amendment=None, posts=[],
                          evidence=[], missing_fields=[])

    def report(self):
        return validate_candidate({'facts': self.facts}, self.source)

    def test_grounded_non_job_is_valid_and_reusable(self):
        self.assertEqual(self.report()['disposition'], 'valid_non_job_classification')
        self.assertTrue(verify_cached_citations({'facts': self.facts}, self.source))

    def test_unclear_requires_evidence_and_cannot_cache_an_empty_claim(self):
        self.facts.update(purpose='unclear', purpose_evidence=[])
        self.assertEqual(self.report()['status'], 'blocked')
        self.assertFalse(verify_cached_citations({'facts': self.facts}, self.source))

    def test_document_purpose_citation_must_belong_to_named_document(self):
        self.facts['document_purposes'] = [dict(
            document_id=self.source['documents'][1]['document_id'],
            purpose='non_job', evidence=[self.citation])]
        self.assertEqual(self.report()['status'], 'blocked')
        self.assertFalse(verify_cached_citations({'facts': self.facts}, self.source))

    def test_amendment_invalid_date_and_unsupported_target_are_blocked(self):
        self.facts.update(purpose='amendment', amendment=dict(
            amendment_type='deadline_extension', effective_date='2026-99-99',
            target_advertisement_number='INVENTED-999', target_campaign_name=None,
            target_post_names=[], changes_description=None, evidence=[self.citation]))
        reasons = {issue['reason'] for issue in self.report()['errors']}
        self.assertIn('invalid_iso_date', reasons)
        self.assertIn('amendment_target_not_in_citation', reasons)
        self.assertFalse(verify_cached_citations({'facts': self.facts}, self.source))

    def test_non_recruitment_purposes_cannot_hide_posts(self):
        for purpose in ('unclear', 'amendment', 'exam_update'):
            self.facts.update(purpose=purpose, posts=[{}])
            self.assertEqual(self.report()['status'], 'blocked')

    def test_invalid_location_is_not_grounding(self):
        self.source['documents'][0]['sections'][0]['locations'] = [{'page': True}]
        self.assertEqual(self.report()['status'], 'blocked')

    def test_each_review_outcome_is_saved_reused_and_never_published(self):
        cases = [('non_job', 'non_jobs', 'valid_non_job_classification'),
                 ('unclear', 'unclear', 'unclear_purpose_review'),
                 ('amendment', 'amendments', 'amendment_pending_review')]
        for purpose, folder, disposition in cases:
            with self.subTest(purpose=purpose), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                prepared = prepare_extraction(sample_bundle())
                self.facts['purpose'] = purpose
                if purpose == 'amendment':
                    self.facts['amendment'] = dict(amendment_type=None, effective_date=None,
                        target_advertisement_number=None, target_campaign_name=None,
                        target_post_names=[], changes_description=None, evidence=[self.citation])
                path = root / 'prepared.json'
                path.write_text(json.dumps(prepared))
                bundle_id = self.source['bundle_id']
                extract = Mock(return_value={'bundle_id': bundle_id, 'facts': copy.deepcopy(self.facts)})
                publish = Mock()
                def prepare(*args, **kwargs):
                    return [dict(source='example', status='prepared_for_review',
                                 prepared_inputs=1, prepared_paths=[str(path)])]
                first = run_pipeline(root, prepare=prepare, extract=extract, persist=publish)
                saved = json.loads((root / folder / f'{bundle_id}.json').read_text())
                self.assertEqual(saved['disposition'], disposition)
                self.assertEqual(saved['source_evidence'], self.source['documents'])
                second = run_pipeline(root, prepare=prepare, extract=extract, persist=publish)
                self.assertEqual(extract.call_count, 1)
                self.assertEqual(second['sources']['example']['reused'], 1)
                self.assertEqual(first['sources']['example']['drafts'], 0)
                publish.assert_not_called()

    def test_invalid_outcome_retains_findings_without_success_state(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            prepared = prepare_extraction(sample_bundle())
            path = root / 'prepared.json'
            path.write_text(json.dumps(prepared))
            bundle_id = self.source['bundle_id']
            self.facts['purpose_evidence'] = []
            report = run_pipeline(root,
                prepare=lambda *a, **k: [dict(source='example', status='prepared_for_review',
                    prepared_inputs=1, prepared_paths=[str(path)])],
                extract=lambda _: dict(bundle_id=bundle_id, facts=self.facts))
            self.assertEqual(report['sources']['example']['blocked'], 1)
            rejected = json.loads((root / 'validation' / f'{bundle_id}.json').read_text())
            self.assertTrue(rejected['validation']['errors'])
            self.assertFalse((root / 'state' / 'notices' / f'{bundle_id}.json').exists())


if __name__ == '__main__':
    unittest.main()
