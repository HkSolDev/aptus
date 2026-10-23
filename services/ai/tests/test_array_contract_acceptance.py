"""Unknown arrays stay empty; nullable scalar requirements remain enforced."""
import copy
import unittest

from build_extraction_input import BundleFacts, prepare_extraction
from compact_inline import decode_compact, MissingFactsError
from test_extraction_input import sample_bundle
from test_inline_extraction import compact_response, response, fact


class ArrayContractAcceptanceTests(unittest.TestCase):
    def setUp(self):
        self.source = prepare_extraction(sample_bundle())['llm_input']['input']
        self.schema = BundleFacts.model_json_schema()

    def test_unsupported_arrays_stay_empty_and_unknown_scalar_stays_null(self):
        wire = compact_response(response())
        before = copy.deepcopy(wire)
        facts, _ = decode_compact(wire, self.source, self.schema)
        post = facts['posts'][0]
        for field in ('locations', 'selection_process', 'language_requirements', 'other_requirements'):
            self.assertEqual(post[field], [])
        self.assertEqual(post['eligibility_rules']['category_requirement'], [])
        self.assertIsNone(post['min_age'])
        self.assertTrue(any(item['field_path'] == 'posts.0.min_age' for item in facts['missing_fields']))
        self.assertEqual(wire, before)

    def test_original_null_array_placeholders_remain_invalid(self):
        fields = ('locations.0', 'selection_process.0', 'language_requirements.0',
                  'other_requirements.0', 'eligibility_rules.category_requirement.0')
        for field in fields:
            with self.subTest(field=field):
                wire = compact_response(response())
                wire['posts'][0]['facts'].append({'field': field, **fact(None)})
                with self.assertRaises(ValueError):
                    decode_compact(wire, self.source, self.schema)

    def test_supported_string_item_and_citation_survive(self):
        wire = response()
        self.source['documents'][0]['sections'][0]['text'] += '\nPlace of posting: New Delhi'
        wire['posts'][0]['locations'] = [fact('New Delhi', quote='Place of posting: New Delhi')]
        facts, _ = decode_compact(compact_response(wire), self.source, self.schema)
        self.assertEqual(facts['posts'][0]['locations'], ['New Delhi'])
        self.assertIn({'field_path': 'posts.0.locations.0', 'evidence_id': 'main:unit-0',
                       'quote': 'Place of posting: New Delhi'}, facts['evidence'])

    def test_empty_array_rule_does_not_allow_missing_scalar_facts(self):
        wire = compact_response(response())
        wire['posts'][0]['facts'] = [item for item in wire['posts'][0]['facts'] if item['field'] != 'min_age']
        with self.assertRaises(MissingFactsError):
            decode_compact(wire, self.source, self.schema)

    def category_rows(self):
        wire = response()
        wire['posts'][0]['eligibility_rules']['age_rules'] = [
            {key: fact(None) for key in ('category', 'gender', 'min_age', 'max_age',
                                        'relaxation_years', 'conditions')}]
        wire['posts'][0]['vacancy_breakdown'] = [
            {key: fact(None) for key in ('category', 'region_or_organisation', 'count')}]
        wire['posts'][0]['eligibility_rules']['age_rules'][0]['max_age'] = fact(
            30, quote='Age limit: 21–30 years')
        wire['posts'][0]['vacancy_breakdown'][0]['count'] = fact(12, quote='Vacancies: 12')
        self.source['documents'][0]['sections'][0]['text'] += '\nVacancies: 12'
        return wire

    def test_known_row_values_do_not_make_unknown_categories_found(self):
        wire = self.category_rows()
        facts, _ = decode_compact(compact_response(wire), self.source, self.schema)
        post = facts['posts'][0]
        self.assertEqual(post['eligibility_rules']['age_rules'][0]['max_age'], 30)
        self.assertEqual(post['vacancy_breakdown'][0]['count'], 12)
        for path in ('posts.0.eligibility_rules.age_rules.0.category',
                     'posts.0.vacancy_breakdown.0.category'):
            self.assertTrue(any(item['field_path'] == path and item['reason'].startswith('not_located:')
                                for item in facts['missing_fields']))

    def test_found_null_category_is_rejected_even_with_a_valid_row_quote(self):
        for parent in ('age_rules', 'vacancy_breakdown'):
            with self.subTest(parent=parent):
                wire = self.category_rows()
                row = (wire['posts'][0]['eligibility_rules']['age_rules'][0]
                       if parent == 'age_rules' else wire['posts'][0]['vacancy_breakdown'][0])
                row['category'] = fact(None)
                row['category'].update(status='found', evidence=[{
                    'evidence_id': 'main:unit-0', 'quote': 'Engineer'}])
                with self.assertRaisesRegex(ValueError, 'Found fact needs a value and evidence'):
                    decode_compact(compact_response(wire), self.source, self.schema)


if __name__ == '__main__':
    unittest.main()
