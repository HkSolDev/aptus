import copy
import json
import unittest
from unittest.mock import Mock, patch

import httpx

from build_extraction_input import BundleFacts, CandidatePost, prepare_extraction
from extract_bundle import check_evidence, extract_bundle
from inline_extraction import InlineFactError, decode_inline, inline_schema
from compact_inline import compact_schema, decode_compact
from services.ai.tests.test_extraction_input import sample_bundle


def fact(value, *, quote='Engineer', scope='post'):
    citation = {'evidence_id': 'main:unit-0', 'quote': quote}
    return {'value': value, 'status': 'found' if value is not None else 'not_located',
            'evidence': [citation] if value is not None else [],
            'reason': None if value is not None else 'Not located in supplied evidence.',
            'scope': scope, 'scope_evidence': [citation] if value is not None else []}


def response():
    post = {name: fact(None) for name in CandidatePost.model_fields}
    for name in ('exam_dates', 'locations', 'vacancy_breakdown', 'experience_rules',
                 'fee_rules', 'selection_process', 'application_steps',
                 'documents_required', 'language_requirements', 'other_requirements'):
        post[name] = []
    post['eligibility_rules'] = {'gender_requirement': fact(None),
        'category_requirement': [], 'education_options': [], 'age_rules': [],
        'relaxation_combination_rule': fact(None)}
    post['post_name'] = fact('Engineer')
    return {'posts': [post]}


def compact_response(wire):
    def collect(node, path):
        if isinstance(node, dict) and 'value' in node:
            yield {'field': path, **node}
        elif isinstance(node, dict):
            for key, value in node.items():
                yield from collect(value, f'{path}.{key}' if path else key)
        elif isinstance(node, list):
            for index, value in enumerate(node):
                yield from collect(value, f'{path}.{index}')
    return {'posts': [{'facts': list(collect(post, ''))} for post in wire['posts']]}


class InlineExtractionTests(unittest.TestCase):
    def source(self):
        return prepare_extraction(sample_bundle())['llm_input']['input']

    def test_schema_preserves_numeric_types_and_separate_education_routes(self):
        schema = inline_schema(BundleFacts.model_json_schema())
        fields = schema['$defs']['CandidatePost']['properties']
        vacancy_fact = schema['$defs'][fields['vacancies']['$ref'].rsplit('/', 1)[1]]
        self.assertEqual(vacancy_fact['properties']['value']['anyOf'][0]['type'], 'integer')
        options = schema['$defs']['EligibilityRules']['properties']['education_options']
        self.assertEqual(options['type'], 'array')
        self.assertEqual(options['items']['$ref'], '#/$defs/EducationOption')
        qualification = schema['$defs']['EducationOption']['properties']['qualification']
        self.assertIn('evidence', schema['$defs'][qualification['$ref'].rsplit('/', 1)[1]]['properties'])

    def test_conversion_generates_paths_and_missing_reasons_without_mutating_input(self):
        wire = response()
        before = copy.deepcopy(wire)
        facts, audit = decode_inline(wire, self.source())
        self.assertEqual(wire, before)
        self.assertEqual(facts['posts'][0]['post_name'], 'Engineer')
        self.assertEqual(facts['evidence'][0]['field_path'], 'posts.0.post_name')
        self.assertEqual(audit['errors'], [])
        self.assertFalse(audit['semantic_support_verified'])
        self.assertEqual(check_evidence(facts, self.source())['errors'], [])

    def test_null_without_reason_and_found_without_evidence_are_rejected(self):
        for key, value in (('reason', None), ('status', 'found')):
            wire = response()
            wire['posts'][0]['vacancies'][key] = value
            with self.assertRaises(ValueError):
                decode_inline(wire, self.source())
        wire = response()
        wire['posts'][0]['post_name']['evidence'] = []
        with self.assertRaises(ValueError):
            decode_inline(wire, self.source())

    def test_unknown_scope_and_invented_quotes_are_reviewed_not_certified(self):
        wire = response()
        wire['posts'][0]['post_name'] = fact('Engineer', quote='Invented heading', scope='unknown')
        facts, audit = decode_inline(wire, self.source())
        reasons = {item['reason'] for item in audit['errors']}
        self.assertTrue({'fact_quote_not_located', 'scope_quote_not_located', 'scope_needs_review'} <= reasons)
        self.assertEqual(facts['evidence'], [])
        self.assertEqual(check_evidence(facts, self.source())['status'], 'citation_errors')

    def test_missing_document_differs_from_not_located(self):
        wire = response()
        wire['posts'][0]['vacancies'].update(status='missing_document', reason='Referenced annexure unavailable.')
        facts, _ = decode_inline(wire, self.source())
        reason = next(item['reason'] for item in facts['missing_fields'] if item['field_path'] == 'posts.0.vacancies')
        self.assertTrue(reason.startswith('missing_document:'))

    def test_unresolved_errors_identify_field_and_condition_without_values(self):
        for value, reason, check in ((12, 'Not located.', 'unresolved_value_not_null'),
                                    (None, None, 'unresolved_explanation_missing')):
            with self.subTest(check=check):
                wire = response()
                wire['posts'][0]['vacancies'].update(value=value, reason=reason)
                before = copy.deepcopy(wire)
                with self.assertRaises(InlineFactError) as caught:
                    decode_inline(wire, self.source())
                self.assertEqual(caught.exception.field_path, 'posts.0.vacancies')
                self.assertEqual(caught.exception.check, check)
                self.assertEqual(wire, before)

    def test_numeric_string_is_not_silently_accepted(self):
        wire = response()
        wire['posts'][0]['vacancies'] = fact('12')
        with self.assertRaises(ValueError):
            decode_inline(wire, self.source())

    def test_alternative_routes_keep_their_own_quotes(self):
        source = self.source()
        source['documents'][0]['sections'][0]['text'] += '\nCA with one year experience OR MBA Finance.'
        wire = response()
        for qualification in ('CA with one year experience', 'MBA Finance'):
            wire['posts'][0]['eligibility_rules']['education_options'].append({
                'minimum_level': fact(None), 'minimum_marks_percent': fact(None),
                'qualification': fact(qualification, quote=qualification),
                'subject_requirement': fact(None), 'conditions': fact(None)})
        facts, _ = decode_inline(wire, source)
        routes = facts['posts'][0]['eligibility_rules']['education_options']
        self.assertEqual([route['qualification'] for route in routes], ['CA with one year experience', 'MBA Finance'])
        citations = [item for item in facts['evidence'] if item['field_path'].endswith('.qualification')]
        self.assertEqual(len(citations), 2)
        self.assertNotEqual(citations[0]['field_path'], citations[1]['field_path'])

    def test_real_runner_decodes_nonempty_mocked_provider_response(self):
        client = Mock()
        client.post.return_value = httpx.Response(200, json={'candidates': [{'finishReason': 'STOP',
            'content': {'parts': [{'text': json.dumps(compact_response(response()))}]}}]})
        with patch.dict('os.environ', {'GEMINI_API_KEY': 'illustrative-test-key'}, clear=True):
            result = extract_bundle(prepare_extraction(sample_bundle()), provider='gemini', client=client)
        self.assertEqual(result['facts']['posts'][0]['post_name'], 'Engineer')
        self.assertEqual(result['evidence_check']['errors'], [])
        self.assertEqual(result['output_format'], 'compact-inline-facts-v1')
        self.assertEqual(result['status'], 'candidate_needs_review')

    def test_email_application_and_document_limits_keep_separate_citations(self):
        bundle = sample_bundle()
        instruction = 'Email a resume to recruitment@example.gov.in by 12 October 2026.'
        statement = 'Include relevant experience and a 600-word contribution statement on one page.'
        bundle['documents'][0]['content']['sections'][0]['text'] += '\n' + instruction + '\n' + statement
        wire = response()
        steps = [instruction]
        documents = ['Resume', statement]
        wire['posts'][0]['application_steps'] = [fact(instruction, quote=instruction)]
        wire['posts'][0]['documents_required'] = [
            fact('Resume', quote=instruction), fact(statement, quote=statement)]
        with patch('extract_bundle.request_structured', return_value=(compact_response(wire), {})):
            result = extract_bundle(prepare_extraction(bundle))
        post = result['facts']['posts'][0]
        self.assertIsNone(post['apply_url'])
        self.assertEqual(post['application_steps'], steps)
        self.assertEqual(post['documents_required'], documents)
        paths = {entry['field_path'] for entry in result['facts']['evidence']}
        self.assertTrue({'posts.0.application_steps.0', 'posts.0.documents_required.0',
                         'posts.0.documents_required.1'} <= paths)
        self.assertEqual(result['validation']['errors'], [])

    def test_compact_converter_matches_nested_facts_without_loosening_types(self):
        wire = response()
        expected, _ = decode_inline(wire, self.source())
        actual, _ = decode_compact(compact_response(wire), self.source(), BundleFacts.model_json_schema())
        self.assertEqual(actual, expected)
        wire['posts'][0]['vacancies'] = fact('12')
        with self.assertRaises(ValueError):
            decode_compact(compact_response(wire), self.source(), BundleFacts.model_json_schema())

    def test_compact_rejects_unknown_duplicate_and_unreported_fields(self):
        for mode in ('unknown', 'duplicate', 'missing', 'global_path'):
            wire = compact_response(response())
            records = wire['posts'][0]['facts']
            if mode == 'unknown':
                records[0]['field'] = 'invented_field'
            elif mode == 'duplicate':
                records.append(copy.deepcopy(records[0]))
            elif mode == 'global_path':
                records[0]['field'] = 'posts.1.post_name'
            else:
                records.pop(0)
            with self.assertRaises(ValueError):
                decode_compact(wire, self.source(), BundleFacts.model_json_schema())

    def test_compact_preserves_separate_routes_and_rejects_sparse_indices(self):
        source = self.source()
        source['documents'][0]['sections'][0]['text'] += '\nCA OR MBA Finance.'
        wire = response()
        for qualification in ('CA', 'MBA Finance'):
            wire['posts'][0]['eligibility_rules']['education_options'].append({
                'minimum_level': fact(None), 'minimum_marks_percent': fact(None),
                'qualification': fact(qualification, quote=qualification),
                'subject_requirement': fact(None), 'conditions': fact(None)})
        compact = compact_response(wire)
        facts, _ = decode_compact(compact, source, BundleFacts.model_json_schema())
        self.assertEqual(len(facts['posts'][0]['eligibility_rules']['education_options']), 2)
        record = next(item for item in compact['posts'][0]['facts'] if '.education_options.0.' in item['field'])
        record['field'] = record['field'].replace('.0.', '.99.')
        with self.assertRaises(ValueError):
            decode_compact(compact, source, BundleFacts.model_json_schema())

    def test_compact_provider_schema_does_not_expand_all_post_fields(self):
        schema = compact_schema()
        self.assertNotIn('$defs', schema)
        self.assertLess(len(json.dumps(schema)), 2500)


if __name__ == '__main__':
    unittest.main()
