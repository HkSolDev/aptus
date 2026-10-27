"""Missing facts remain invalid while diagnostics identify every affected post."""
import copy
import json
import io
import runpy
import tempfile
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import Mock, patch

import httpx
import unittest

from build_extraction_input import BundleFacts, prepare_extraction
from compact_inline import MissingFactsError, decode_compact
from extract_bundle import FactDecodingError
from extraction_checkpoint import extract_or_resume
from stage_retry import StageRetries
from services.ai.tests.test_extraction_input import sample_bundle
from services.ai.tests.test_inline_extraction import compact_response, response


class MissingFactLocationTests(unittest.TestCase):
    def setUp(self):
        self.schema = BundleFacts.model_json_schema()
        self.source = prepare_extraction(sample_bundle())['llm_input']['input']
        self.wire = compact_response(response())
        self.wire['posts'].append(copy.deepcopy(self.wire['posts'][0]))

    def diagnose(self, wire):
        with self.assertRaises(MissingFactsError) as caught:
            decode_compact(wire, self.source, self.schema)
        error = FactDecodingError(caught.exception, self.schema)
        return {**error.details, **error.location_details}

    def test_either_or_both_posts_report_absolute_locations_without_changing_bytes(self):
        for indices in ((0,), (1,), (0, 1)):
            with self.subTest(indices=indices):
                wire = copy.deepcopy(self.wire)
                for index in indices:
                    wire['posts'][index]['facts'] = [f for f in wire['posts'][index]['facts']
                        if f['field'] != 'category_relaxation_rules']
                before = json.dumps(wire).encode()
                details = self.diagnose(wire)
                self.assertEqual(details['field_paths'], ['category_relaxation_rules'])
                self.assertEqual(details['location_count'], len(indices))
                self.assertEqual(details['field_locations'], [
                    f'posts.{index}.category_relaxation_rules' for index in indices])
                self.assertEqual(json.dumps(wire).encode(), before)

    def test_diagnostics_are_bounded_and_keep_total_location_count(self):
        wire = copy.deepcopy(self.wire)
        post = wire['posts'][0]
        post['facts'] = [f for f in post['facts'] if f['field'] != 'category_relaxation_rules']
        wire['posts'] = [copy.deepcopy(post) for _ in range(30)]
        details = self.diagnose(wire)
        self.assertEqual(details['location_count'], 30)
        self.assertEqual(len(details['field_locations']), 20)
        self.assertEqual(details['field_count'], 1)

    def test_locations_are_schema_filtered_and_do_not_echo_arbitrary_paths(self):
        error = MissingFactsError(['category_relaxation_rules'], locations=[
            'posts.0.category_relaxation_rules', 'posts.01.category_relaxation_rules',
            'posts.0.private-response-value', 'private-response-value'])
        error = FactDecodingError(error, self.schema)
        details = {**error.details, **error.location_details}
        self.assertEqual(details['field_locations'], ['posts.0.category_relaxation_rules'])
        self.assertEqual(details['location_count'], 1)
        self.assertNotIn('private-response-value', json.dumps(details))

    def test_multiple_fields_on_later_posts_are_not_hidden(self):
        wire = copy.deepcopy(self.wire)
        wire['posts'][0]['facts'] = [f for f in wire['posts'][0]['facts']
                                    if f['field'] != 'category_relaxation_rules']
        wire['posts'][1]['facts'] = [f for f in wire['posts'][1]['facts'] if f['field'] != 'pay']
        details = self.diagnose(wire)
        self.assertEqual(details['field_paths'], ['category_relaxation_rules', 'pay'])
        self.assertEqual(details['field_locations'],
                         ['posts.0.category_relaxation_rules', 'posts.1.pay'])

    def test_cli_emits_locations_and_no_candidate_for_incomplete_response(self):
        wire = copy.deepcopy(self.wire)
        for post in wire['posts']:
            post['facts'] = [f for f in post['facts'] if f['field'] != 'category_relaxation_rules']
        envelope = {'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps(wire)}}]}
        prepared = prepare_extraction(sample_bundle(), recovery_pass=1)
        with tempfile.TemporaryDirectory(prefix='agent2-cli-') as directory:
            source, target = Path(directory) / 'prepared.json', Path(directory) / 'result.json'
            source.write_text(json.dumps(prepared))
            before = source.read_bytes()
            output = io.StringIO()
            with patch.dict('os.environ', {'OPENAI_API_KEY': 'illustrative-test-key'}, clear=True), \
                    patch('httpx.post', return_value=httpx.Response(200, json=envelope)), \
                    patch('sys.argv', ['extract_bundle.py', str(source), str(target), '--provider', 'openai']), \
                    redirect_stdout(output):
                with self.assertRaises(SystemExit) as caught:
                    runpy.run_path('services/ai/extract_bundle.py', run_name='__main__')
            self.assertEqual(caught.exception.code, 1)
            self.assertFalse(target.exists())
            self.assertEqual(source.read_bytes(), before)
        failure = json.loads(output.getvalue())
        self.assertEqual(failure['reason'], 'provider_fact_decoding_failed')
        self.assertEqual(failure['details'], {'check': 'unreported_scalar_fields',
                         'field_count': 1, 'field_paths': ['category_relaxation_rules']})
        self.assertEqual(failure['missing_fact_locations'], {'location_count': 2,
                         'field_locations': ['posts.0.category_relaxation_rules',
                                             'posts.1.category_relaxation_rules']})

    def test_missing_fact_failure_still_holds_without_repeating_extraction(self):
        error = FactDecodingError(MissingFactsError(['category_relaxation_rules'],
            locations=['posts.0.category_relaxation_rules']), self.schema)
        extract = Mock(side_effect=error)
        prepared = {'llm_input': {'input': {'bundle_id': 'synthetic-missing-fact'}}}
        with tempfile.TemporaryDirectory(prefix='agent2-hold-') as directory:
            retries = StageRetries(directory, lambda: 1000)
            with self.assertRaises(FactDecodingError):
                extract_or_resume(retries, 'synthetic-fingerprint', prepared, extract)
            state = retries.read('extraction', 'synthetic-fingerprint')
            self.assertEqual(state['status'], 'needs_review')
            self.assertEqual(state['reason'], 'provider_fact_decoding_failed')
            self.assertEqual(state['next_at'], 0)
            self.assertEqual(extract_or_resume(retries, 'synthetic-fingerprint', prepared, extract),
                             (None, False))
            self.assertEqual(extract.call_count, 1)
