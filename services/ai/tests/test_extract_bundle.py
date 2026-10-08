import copy
import json
import unittest
from unittest.mock import Mock, patch

import httpx

from build_extraction_input import BundleFacts, prepare_extraction
from extract_bundle import check_evidence, extract_bundle, provider_keys
from normalize_candidate_facts import normalize_candidate_facts
from services.ai.tests.test_extraction_input import sample_bundle


class BundleExtractionTests(unittest.TestCase):
    def candidate(self, qualification='Passed C.A. Examination from ICAI'):
        return {'posts': [{'min_education_level': 'BACHELORS', 'eligibility_rules': {
            'education_options': [{'minimum_level': 'BACHELORS', 'qualification': qualification,
                                  'subject_requirement': None, 'conditions': None}]},
            'selection_process': ['Pre Exam Training PET', 'Physical efficiency test PET', 'Interview'],
            'other_requirements': [], 'application_start_date': '01/09/2026',
            'fee_payment_last_date': '27/09/2026',
            'exam_dates': ['12/10/2026', 'November 2026', 'December 2026 to January 2027']}],
            'evidence': [{'field_path': 'posts.0.selection_process.0', 'evidence_id': 'training', 'quote': 'training'},
                         {'field_path': 'posts.0.selection_process.2', 'evidence_id': 'interview', 'quote': 'Interview'}],
            'missing_fields': []}

    def test_ca_stays_professional_without_inferred_degree(self):
        original = self.candidate()
        before = copy.deepcopy(original)
        facts, corrections = normalize_candidate_facts(original)
        self.assertEqual(original, before)
        self.assertIsNone(facts['posts'][0]['min_education_level'])
        option = facts['posts'][0]['eligibility_rules']['education_options'][0]
        self.assertIsNone(option['minimum_level'])
        self.assertEqual(option['qualification'], 'Passed C.A. Examination from ICAI')
        self.assertTrue(any(item['previous'] == 'BACHELORS' for item in corrections))
        self.assertEqual(len(facts['missing_fields']), 2)
        self.assertEqual(normalize_candidate_facts(facts)[1], [])

    def test_explicit_degree_route_is_not_removed(self):
        for text in ('Bachelor degree and Chartered Accountant', 'B.Com with C.A.', 'Graduate with CA'):
            facts, _ = normalize_candidate_facts(self.candidate(text))
            self.assertEqual(facts['posts'][0]['min_education_level'], 'BACHELORS')

    def test_training_moves_with_citations_but_physical_test_stays(self):
        facts, _ = normalize_candidate_facts(self.candidate())
        self.assertEqual(facts['posts'][0]['selection_process'], ['Physical efficiency test PET', 'Interview'])
        self.assertEqual(facts['posts'][0]['other_requirements'], ['Pre Exam Training PET'])
        self.assertEqual([item['field_path'] for item in facts['evidence']],
                         ['posts.0.other_requirements.0', 'posts.0.selection_process.1'])

    def test_dates_normalize_without_inventing_partial_dates(self):
        facts, _ = normalize_candidate_facts(self.candidate())
        post = facts['posts'][0]
        self.assertEqual(post['application_start_date'], '2026-09-01')
        self.assertEqual(post['fee_payment_last_date'], '2026-09-27')
        self.assertEqual(post['exam_dates'], ['2026-10-12', 'November 2026', 'December 2026 to January 2027'])

    def prepared(self):
        return prepare_extraction(sample_bundle(), recovery_pass=1)

    def test_openai_structured_transport_not_model_accuracy(self):
        response = httpx.Response(200, json={'choices': [{'finish_reason': 'stop',
            'message': {'content': json.dumps({'posts': [], 'evidence': [], 'missing_fields': []})}}],
            'usage': {'prompt_tokens': 20, 'completion_tokens': 10}})
        client = Mock()
        client.post.return_value = response
        prepared = self.prepared()
        before = copy.deepcopy(prepared)
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'illustrative-test-key'}):
            result = extract_bundle(prepared, provider='openai', model='gpt-4o-mini', client=client)
        self.assertEqual(prepared, before)
        self.assertEqual(result['usage']['completion_tokens'], 10)
        self.assertEqual(result['status'], 'candidate_needs_review')
        payload = client.post.call_args.kwargs['json']
        self.assertTrue(payload['response_format']['json_schema']['strict'])
        self.assertIn('coverage_focus', payload['messages'][1]['content'])
        self.assertEqual(client.post.call_count, 1)

    def test_missing_credential_fails_before_network(self):
        client = Mock()
        with patch.dict('os.environ', {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, 'provider_credential_unavailable'):
                extract_bundle(self.prepared(), provider='openai', client=client)
        client.post.assert_not_called()

    def test_http_failure_does_not_echo_provider_body(self):
        client = Mock()
        client.post.return_value = httpx.Response(401, text='sensitive-provider-diagnostic')
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'illustrative-test-key'}):
            with self.assertRaisesRegex(RuntimeError, '^provider_http_401$'):
                extract_bundle(self.prepared(), provider='openai', client=client)
        self.assertEqual(client.post.call_count, 1)

    def test_truncated_generation_is_not_accepted(self):
        client = Mock()
        client.post.return_value = httpx.Response(200, json={'choices': [
            {'finish_reason': 'length', 'message': {'content': '{}'}}]})
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'illustrative-test-key'}):
            with self.assertRaisesRegex(RuntimeError, 'provider_incomplete_or_refused'):
                extract_bundle(self.prepared(), provider='openai', client=client)

    def test_quote_existence_and_leaf_coverage(self):
        source = {'documents': [{'sections': [{'evidence_id': 'main:unit-0',
                   'text': 'Engineer age limit: 30 years', 'locations': [{'page': 2}]}]}]}
        facts = {'posts': [{'post_name': 'Engineer', 'max_age': 30, 'vacancies': None}],
                 'evidence': [{'field_path': 'posts.0.post_name', 'evidence_id': 'main:unit-0',
                               'quote': 'Engineer'}], 'missing_fields': []}
        errors = check_evidence(facts, source)['errors']
        self.assertIn({'field_path': 'posts.0.max_age', 'reason': 'missing_valid_citation'}, errors)
        self.assertIn({'field_path': 'posts.0.vacancies', 'reason': 'missing_null_explanation'}, errors)
        facts['evidence'].append({'field_path': 'posts.0.max_age', 'evidence_id': 'main:unit-0',
                                 'quote': 'Age limit 40'})
        self.assertIn('quote_not_in_cited_evidence',
                      [item['reason'] for item in check_evidence(facts, source)['errors']])

    def test_trial_schema_has_candidate_facts(self):
        schema = BundleFacts.model_json_schema()
        fields = schema['$defs']['CandidatePost']['properties']
        self.assertTrue({'fee_rules', 'pay', 'selection_process', 'apply_url',
                         'experience_rules', 'vacancy_breakdown'} <= set(fields))

    def test_actual_link_attribute_has_citable_owner(self):
        bundle = sample_bundle()
        bundle['documents'][1]['content']['links'] = [{'url': 'https://jobs.example.gov.in/apply',
            'text': 'Apply online', 'owner': {'block': 0}}]
        sections = prepare_extraction(bundle)['llm_input']['input']['documents'][1]['sections']
        link = next(unit for unit in sections if unit['evidence_id'] == 'update:link-0')
        self.assertIn('/apply', link['text'])
        self.assertEqual(link['locations'][0]['block'], 0)

    def test_gemini_structured_transport(self):
        client = Mock()
        client.post.return_value = httpx.Response(200, json={'candidates': [{
            'finishReason': 'STOP', 'content': {'parts': [{'text': json.dumps({
                'posts': [], 'evidence': [], 'missing_fields': []})}]}}],
            'usageMetadata': {'totalTokenCount': 20}})
        with patch.dict('os.environ', {'GEMINI_API_KEY': 'illustrative-test-key'}):
            result = extract_bundle(self.prepared(), provider='gemini',
                                    model='gemini-2.5-flash-lite', client=client)
        self.assertEqual(result['usage']['totalTokenCount'], 20)
        self.assertIn('responseJsonSchema', client.post.call_args.kwargs['json']['generationConfig'])

    def success(self):
        return httpx.Response(200, json={'candidates': [{'finishReason': 'STOP',
            'content': {'parts': [{'text': json.dumps({'posts': [], 'evidence': [],
                                                     'missing_fields': []})}]}}]})

    def test_numbered_keys_sort_numerically_and_deduplicate(self):
        with patch.dict('os.environ', {'GEMINI_API_KEY_10': 'placeholder-ten',
            'GEMINI_API_KEY_2': 'placeholder-two', 'GEMINI_API_KEY_1': 'placeholder-one',
            'GEMINI_API_KEY_3': 'placeholder-two', 'GEMINI_API_KEY_4': ''}, clear=True):
            self.assertEqual(provider_keys('gemini'),
                             ['placeholder-one', 'placeholder-two', 'placeholder-ten'])

    def test_rejected_key_fails_over_without_logging_key(self):
        client = Mock()
        client.post.side_effect = [httpx.Response(400, json={'error': {'details': [
            {'reason': 'API_KEY_INVALID'}]}}), self.success()]
        with patch.dict('os.environ', {'GEMINI_API_KEY_1': 'placeholder-one',
                                     'GEMINI_API_KEY_2': 'placeholder-two'}, clear=True):
            result = extract_bundle(self.prepared(), provider='gemini', client=client)
        self.assertEqual(result['credential_attempts'], 2)
        self.assertNotIn('placeholder', json.dumps(result))

    def test_quota_bad_request_and_permission_errors_do_not_rotate(self):
        for status in (429, 400, 403, 503):
            client = Mock()
            client.post.return_value = httpx.Response(status, json={'error': {
                'status': 'RESOURCE_EXHAUSTED' if status == 429 else 'INVALID_ARGUMENT'}})
            with patch.dict('os.environ', {'GEMINI_API_KEY_1': 'placeholder-one',
                                         'GEMINI_API_KEY_2': 'placeholder-two'}, clear=True):
                with self.assertRaisesRegex(RuntimeError, f'provider_http_{status}'):
                    extract_bundle(self.prepared(), provider='gemini', client=client)
            self.assertEqual(client.post.call_count, 1)

    def test_timeout_does_not_repeat_potentially_consumed_request(self):
        client = Mock()
        client.post.side_effect = httpx.ReadTimeout('illustrative timeout')
        with patch.dict('os.environ', {'GEMINI_API_KEY_1': 'placeholder-one',
                                     'GEMINI_API_KEY_2': 'placeholder-two'}, clear=True):
            with self.assertRaisesRegex(RuntimeError, 'provider_network_failed'):
                extract_bundle(self.prepared(), provider='gemini', client=client)
        self.assertEqual(client.post.call_count, 1)

    def test_all_rejected_keys_stop_after_configured_list(self):
        client = Mock()
        client.post.return_value = httpx.Response(401)
        with patch.dict('os.environ', {'GEMINI_API_KEY_1': 'placeholder-one',
                                     'GEMINI_API_KEY_2': 'placeholder-two'}, clear=True):
            with self.assertRaisesRegex(RuntimeError, '^provider_credentials_rejected$'):
                extract_bundle(self.prepared(), provider='gemini', client=client)
        self.assertEqual(client.post.call_count, 2)


if __name__ == '__main__':
    unittest.main()
