import json
import tempfile
import unittest
from pathlib import Path

from generic_pipeline import run_pipeline
from services.ai.tests import test_shared_pipeline


class GenericPipelineTests(unittest.TestCase):
    def setUp(self):
        self.fixture = test_shared_pipeline.SharedPipelineTests(
            'test_multihop_real_html_and_pdf_reach_same_evidence_input')
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root = Path(self.fixture.temp.name)
        self.source = {'id': 'new_board', 'url': self.fixture.base + '/', 'enabled': True,
                       'kind': 'official', 'reason': None}

    def prepare(self, root, **_options):
        return [self.fixture.run_source()]

    def test_ready_html_pdf_bundle_reaches_injected_extract_validate_and_persist(self):
        calls, pushed = [], []
        def extract(prepared):
            calls.append('extract')
            self.assertEqual({document['format'] for document in prepared['llm_input']['input']['documents']},
                             {'html', 'pdf'})
            return {'bundle_id': prepared['llm_input']['input']['bundle_id'], 'facts': {'posts': []}}
        def validate(result, source):
            calls.append('validate')
            return {'status': 'needs_review'}
        def draft(result, source, *, source_name):
            calls.append('draft')
            return {'bundle_id': result['bundle_id'], 'source_name': source_name}
        report = run_pipeline(self.root / 'pipeline', prepare=self.prepare, extract=extract,
                              validate=validate, draft=draft, persist=pushed.append)
        counts = report['sources']['new_board']
        self.assertGreaterEqual(counts['extracted'], 1)
        self.assertEqual(counts['published'], 1)
        self.assertEqual(calls, ['extract', 'validate', 'draft'])
        self.assertEqual(len(pushed), 1)

    def test_partial_or_ambiguous_input_never_calls_model_or_persistence(self):
        called = []
        def prepare(_root, **_options):
            path = self.root / 'blocked.prepared.json'
            path.write_text(json.dumps({'coverage': {'status': 'needs_review'}, 'llm_input': None}))
            return [{'source': 'new_board', 'status': 'partial', 'prepared_inputs': 0,
                     'prepared_paths': [str(path)]}]
        report = run_pipeline(self.root / 'pipeline', prepare=prepare,
                              extract=lambda _: called.append('extract'),
                              persist=lambda _: called.append('persist'))
        self.assertEqual(called, [])
        self.assertEqual(report['sources']['new_board']['blocked'], 1)

    def test_unsupported_seed_is_explicitly_blocked_without_model_or_persistence(self):
        called = []
        def prepare(_root, **_options):
            return [{'source': 'rss_seed', 'status': 'blocked', 'prepared_inputs': 0,
                     'prepared_paths': []}]
        report = run_pipeline(self.root / 'pipeline', prepare=prepare,
                              extract=lambda _: called.append('extract'),
                              persist=lambda _: called.append('persist'))
        self.assertEqual(called, [])
        self.assertEqual(report['sources']['rss_seed']['reason'], 'unsupported_seed_type')


if __name__ == '__main__':
    unittest.main()
