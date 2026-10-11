import copy
import json
import unittest
from unittest.mock import Mock, patch

import httpx

from build_extraction_input import BundleFacts, prepare_extraction
from extract_bundle import FactDecodingError, check_evidence, extract_bundle, provider_keys
from compact_inline import MissingFactsError
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

    def test_invalid_provider_envelope_and_json_have_distinct_safe_errors(self):
        for body, reason in (
                ({'private_diagnostic': 'illustrative-sensitive-text'}, 'provider_response_invalid'),
                ({'choices': [{'finish_reason': 'stop', 'message': {
                    'content': 'illustrative-sensitive-text'}}]}, 'provider_json_invalid')):
            with self.subTest(reason=reason):
                client = Mock()
                client.post.return_value = httpx.Response(200, json=body)
                with patch.dict('os.environ', {'OPENAI_API_KEY': 'illustrative-test-key'}, clear=True):
                    with self.assertRaisesRegex(RuntimeError, f'^{reason}$'):
                        extract_bundle(self.prepared(), provider='openai', client=client)
                self.assertEqual(client.post.call_count, 1)

    def test_invalid_facts_fail_before_normalization(self):
        with patch('extract_bundle.request_structured', return_value=({'posts': 'invalid'}, {})), \
                patch('extract_bundle.normalize_candidate_facts') as normalize:
            with self.assertRaisesRegex(RuntimeError, '^provider_fact_decoding_failed$'):
                extract_bundle(self.prepared())
        normalize.assert_not_called()

    def test_normalization_failure_has_safe_stage_error(self):
        with patch('extract_bundle.request_structured', return_value=({'posts': []}, {})), \
                patch('extract_bundle.normalize_candidate_facts',
                      side_effect=ValueError('illustrative-sensitive-text')):
            with self.assertRaisesRegex(RuntimeError, '^candidate_normalization_failed$'):
                extract_bundle(self.prepared())

    def test_decoding_reports_missing_fields_and_accepts_explained_nulls(self):
        from services.ai.tests.test_inline_extraction import compact_response, response
        wire = compact_response(response())
        wire['posts'][0]['facts'] = [f for f in wire['posts'][0]['facts'] if f['field'] != 'vacancies']
        with patch('extract_bundle.request_structured', return_value=(wire, {})):
            with self.assertRaises(FactDecodingError) as caught:
                extract_bundle(self.prepared())
        self.assertEqual(caught.exception.details, {'check': 'unreported_scalar_fields',
                         'field_count': 1, 'field_paths': ['vacancies']})
        with patch('extract_bundle.request_structured', return_value=(compact_response(response()), {})):
            result = extract_bundle(self.prepared())
        self.assertIsNone(result['facts']['posts'][0]['vacancies'])
        self.assertEqual(result['validation']['errors'], [])

    def test_decoding_reports_wrong_types_without_response_values(self):
        from services.ai.tests.test_inline_extraction import compact_response, fact, response
        wire = response()
        wire['posts'][0]['vacancies'] = fact('illustrative-sensitive-value')
        with patch('extract_bundle.request_structured', return_value=(compact_response(wire), {})):
            with self.assertRaises(FactDecodingError) as caught:
                extract_bundle(self.prepared())
        self.assertEqual(caught.exception.details['check'], 'invalid_field_value')
        self.assertEqual(caught.exception.details['field_paths'], ['vacancies'])
        self.assertNotIn('illustrative-sensitive', json.dumps(caught.exception.details))

    def test_decoding_check_codes_do_not_echo_invalid_paths_or_unknown_errors(self):
        wire = {'posts': [{'facts': [{'field': 'illustrative-sensitive-path'}]}]}
        with patch('extract_bundle.request_structured', return_value=(wire, {})):
            with self.assertRaises(FactDecodingError) as caught:
                extract_bundle(self.prepared())
        self.assertEqual(caught.exception.details['check'], 'unknown_field_path')
        self.assertNotIn('illustrative-sensitive', json.dumps(caught.exception.details))
        error = FactDecodingError(ValueError('illustrative-sensitive-message'), BundleFacts.model_json_schema())
        self.assertEqual(error.details['check'], 'unclassified_decoding_error')
        self.assertNotIn('illustrative-sensitive', json.dumps(error.details))

    def test_missing_field_diagnostics_are_schema_filtered_and_bounded(self):
        paths = [f'application_steps.{i}' for i in range(30)] + ['illustrative-sensitive-path']
        error = FactDecodingError(MissingFactsError(paths), BundleFacts.model_json_schema())
        self.assertEqual(error.details['field_count'], 30)
        self.assertEqual(len(error.details['field_paths']), 20)
        self.assertNotIn('illustrative-sensitive', json.dumps(error.details))

    def test_duplicate_array_parent_and_unexplained_null_have_distinct_checks(self):
        from services.ai.tests.test_inline_extraction import compact_response, response
        for mode, check in (('duplicate', 'duplicate_or_overlapping_path'),
                            ('array_parent', 'non_scalar_fact'),
                            ('unexplained_null', 'unresolved_explanation_missing')):
            with self.subTest(mode=mode):
                wire = compact_response(response())
                records = wire['posts'][0]['facts']
                if mode == 'duplicate':
                    records.append(copy.deepcopy(records[0]))
                elif mode == 'array_parent':
                    records[0]['field'] = 'application_steps'
                else:
                    next(f for f in records if f['field'] == 'vacancies')['reason'] = None
                with patch('extract_bundle.request_structured', return_value=(wire, {})):
                    with self.assertRaises(FactDecodingError) as caught:
                        extract_bundle(self.prepared())
                self.assertEqual(caught.exception.details['check'], check)
                if mode == 'unexplained_null':
                    self.assertEqual(caught.exception.details['field_paths'], ['vacancies'])
                elif mode == 'array_parent':
                    self.assertEqual(caught.exception.details['field_paths'], ['application_steps'])

    def test_container_diagnostics_only_report_schema_owned_paths(self):
        from compact_inline import CompactPathError
        schema = BundleFacts.model_json_schema()
        for path, expected in (('eligibility_rules', ['eligibility_rules']),
                               ('documents_required', ['documents_required']),
                               ('private-made-up-path', [])):
            error = FactDecodingError(CompactPathError(
                'Fact must address a scalar or a nullable object', path), schema)
            self.assertEqual(error.details['field_paths'], expected)

    def test_cli_prints_safe_decoding_details_and_saves_no_candidate(self):
        import io
        import runpy
        import tempfile
        from contextlib import redirect_stdout
        from pathlib import Path
        client_response = httpx.Response(200, json={'candidates': [{'finishReason': 'STOP',
            'content': {'parts': [{'text': json.dumps({'posts': 'illustrative-sensitive-value'})}]}}]})
        with tempfile.TemporaryDirectory() as directory:
            prepared, output = Path(directory) / 'prepared.json', Path(directory) / 'result.json'
            prepared.write_text(json.dumps(self.prepared()))
            captured = io.StringIO()
            with patch.dict('os.environ', {'GEMINI_API_KEY': 'illustrative-test-key'}, clear=True), \
                    patch('httpx.post', return_value=client_response), \
                    patch('sys.argv', ['extract_bundle.py', str(prepared), str(output), '--provider', 'gemini']), \
                    redirect_stdout(captured):
                with self.assertRaises(SystemExit) as caught:
                    runpy.run_path('services/ai/extract_bundle.py', run_name='__main__')
            self.assertEqual(caught.exception.code, 1)
            self.assertFalse(output.exists())
        failure = json.loads(captured.getvalue())
        self.assertEqual(failure['details']['check'], 'invalid_response_root')
        self.assertNotIn('illustrative-sensitive', captured.getvalue())

    def test_openai_structured_transport_not_model_accuracy(self):
        response = httpx.Response(200, json={'choices': [{'finish_reason': 'stop',
            'message': {'content': json.dumps({'posts': []})}}],
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
                'posts': []})}]}}],
            'usageMetadata': {'totalTokenCount': 20}})
        with patch.dict('os.environ', {'GEMINI_API_KEY': 'illustrative-test-key'}):
            result = extract_bundle(self.prepared(), provider='gemini',
                                    model='gemini-2.5-flash-lite', client=client)
        self.assertEqual(result['usage']['totalTokenCount'], 20)
        self.assertIn('responseJsonSchema', client.post.call_args.kwargs['json']['generationConfig'])

    def success(self):
        return httpx.Response(200, json={'candidates': [{'finishReason': 'STOP',
            'content': {'parts': [{'text': json.dumps({'posts': []})}]}}]})

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
