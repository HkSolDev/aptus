import copy
import unittest
from unittest.mock import patch

from staged_extraction import extract_staged, expand_quotes
from services.ai.tests.test_extraction_input import sample_bundle
from build_extraction_input import prepare_extraction
from services.ai.tests.test_inline_extraction import compact_response, response


class StagedExtractionTests(unittest.TestCase):
    def prepared(self):
        prepared = prepare_extraction(sample_bundle())
        prepared['llm_input']['input']['documents'][0]['sections'][0]['text'] += '\nTechnician'
        return prepared

    def roster(self):
        return {'posts': [{'post_name': name, 'evidence': [
            {'evidence_id': 'main:unit-0', 'quote': name}]} for name in ('Engineer', 'Technician')]}

    def batch(self, identifiers):
        records = compact_response(response())['posts'][0]['facts']
        records = [item for item in records if item['field'] != 'post_name']
        for item in records:
            item['evidence'] = []
            item['scope_evidence'] = []
        return {'quotes': [], 'posts': [{'post_id': key, 'facts': copy.deepcopy(records)} for key in identifiers]}

    def metadata(self):
        return {'provider': 'gemini', 'model': 'illustrative', 'credential_attempts': 1,
                'usage': {'promptTokenCount': 10, 'candidatesTokenCount': 5, 'totalTokenCount': 15}}

    def run_with(self, responses):
        with patch('staged_extraction.request_structured', side_effect=[
                (item, self.metadata()) for item in responses]) as call:
            result = extract_staged(self.prepared(), provider='gemini')
        return result, call

    def test_all_posts_are_reassembled_in_roster_order(self):
        result, call = self.run_with([self.roster(), {'quotes': [], 'facts': []}, self.batch(['post-1', 'post-0'])])
        self.assertEqual([post['post_name'] for post in result['facts']['posts']], ['Engineer', 'Technician'])
        self.assertEqual(result['coverage']['accepted_posts'], 2)
        self.assertEqual(result['coverage']['missing_posts'], {})
        self.assertEqual(result['evidence_check']['errors'], [])
        self.assertEqual(result['usage']['totalTokenCount'], 45)
        self.assertEqual(call.call_count, 3)

    def test_only_missing_post_is_retried_once(self):
        result, call = self.run_with([self.roster(), {'quotes': [], 'facts': []},
                                     self.batch(['post-0']), self.batch([])])
        self.assertEqual(result['coverage']['missing_posts'], {'post-1': 'missing_post_output'})
        retry = call.call_args_list[-1].args[0]['target_posts']
        self.assertEqual([post['post_id'] for post in retry], ['post-1'])
        self.assertEqual(call.call_count, 4)
        self.assertIn('post_coverage_incomplete', result['review_reasons'])

    def test_unexpected_post_is_rejected(self):
        with self.assertRaises(ValueError):
            self.run_with([self.roster(), {'quotes': [], 'facts': []}, self.batch(['post-99'])])

    def test_shared_rule_applies_only_to_explicit_target(self):
        shared = {'quotes': [{'id': 'q1', 'evidence_id': 'main:unit-0', 'quote': 'Engineer'}],
            'facts': [{'field': 'recruiting_body', 'value': 'Example', 'status': 'found',
                'evidence': ['q1'], 'reason': None, 'scope': 'shared',
                'scope_evidence': ['q1'], 'applies_to': ['post-0']}]}
        batch = self.batch(['post-0', 'post-1'])
        batch['posts'][0]['facts'] = [item for item in batch['posts'][0]['facts'] if item['field'] != 'recruiting_body']
        result, _ = self.run_with([self.roster(), shared, batch])
        self.assertEqual(result['facts']['posts'][0]['recruiting_body'], 'Example')
        self.assertIsNone(result['facts']['posts'][1]['recruiting_body'])
        self.assertFalse(result['inline_check']['semantic_support_verified'])

    def test_quote_pool_reuses_exact_quote_and_rejects_unknown_id(self):
        wire = {'quotes': [{'id': 'q', 'evidence_id': 'main:unit-0', 'quote': 'Engineer'}]}
        records = [{'evidence': ['q'], 'scope_evidence': ['q']}]
        result = expand_quotes(wire, records)
        self.assertEqual(result[0]['evidence'], result[0]['scope_evidence'])
        self.assertEqual(records[0]['evidence'], ['q'])
        with self.assertRaises(ValueError):
            expand_quotes(wire, [{'evidence': ['invented'], 'scope_evidence': []}])

    def test_original_unit_reference_resolves_without_inventing_a_span(self):
        units = {'main:unit-0': {'text': 'Engineer: 12 vacancies', 'locations': [{'page': 2}]}}
        records = [{'evidence': ['main:unit-0'], 'scope_evidence': []}]
        expanded = expand_quotes({'quotes': []}, records, units)
        self.assertEqual(expanded[0]['evidence'][0],
                         {'evidence_id': 'main:unit-0', 'quote': 'Engineer: 12 vacancies'})
        with self.assertRaises(ValueError):
            expand_quotes({'quotes': []}, [{'evidence': ['unknown'], 'scope_evidence': []}], units)


if __name__ == '__main__':
    unittest.main()
