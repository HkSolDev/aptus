import copy
import unittest

from build_extraction_input import prepare_extraction
from inline_extraction import decode_inline
from validate_candidate import validate_candidate
from services.ai.tests.test_extraction_input import sample_bundle
from services.ai.tests.test_inline_extraction import fact, response


class CandidateValidationTests(unittest.TestCase):
    def candidate(self, **values):
        source = prepare_extraction(sample_bundle())['llm_input']['input']
        wire = response()
        wire['posts'][0].update({key: fact(value) for key, value in values.items()})
        facts, audit = decode_inline(wire, source)
        return {'facts': facts, 'inline_check': audit, 'review_reasons': []}, source

    def test_explained_missing_details_continue_to_review_without_persistence(self):
        result, source = self.candidate()
        before = copy.deepcopy(result)
        report = validate_candidate(result, source)
        self.assertEqual(report['status'], 'needs_review')
        self.assertEqual(report['errors'], [])
        self.assertFalse(report['persistence_allowed'])
        self.assertEqual(report['validated_facts']['posts'][0]['min_age'], None)
        self.assertIn('array_coverage_unconfirmed', {w['reason'] for w in report['warnings']})
        self.assertEqual(result, before)

    def test_strict_types_and_bad_dates_are_blocked_before_null_conversion(self):
        for field, value in [('vacancies', '50'), ('vacancies', True),
                             ('application_last_date', '2026-02-30'),
                             ('application_start_date', 'next Tuesday')]:
            with self.subTest(field=field, value=value):
                result, source = self.candidate()
                result['facts']['posts'][0][field] = value
                self.assertEqual(validate_candidate(result, source)['status'], 'blocked')

    def test_negative_out_of_range_and_nonfinite_numbers_are_blocked(self):
        for field, value in [('vacancies', -1), ('min_age', -1),
                             ('min_marks_percent', 101), ('min_marks_percent', float('nan'))]:
            result, source = self.candidate()
            result['facts']['posts'][0][field] = value
            self.assertEqual(validate_candidate(result, source)['status'], 'blocked')

    def test_inverted_ages_and_application_dates_are_blocked(self):
        for values in [{'min_age': 40, 'max_age': 20},
                       {'application_start_date': '2026-09-30', 'application_last_date': '2026-09-01'}]:
            result, source = self.candidate(**values)
            report = validate_candidate(result, source)
            self.assertEqual(report['status'], 'blocked')
            self.assertIsNone(report['validated_facts'])

    def test_missing_or_invented_citations_block_even_if_old_check_claimed_success(self):
        for citations in [[], [{'field_path': 'posts.0.post_name',
                               'evidence_id': 'invented', 'quote': 'Engineer'}]]:
            result, source = self.candidate()
            result['evidence_check'] = {'status': 'quotes_located', 'errors': []}
            result['facts']['evidence'] = citations
            self.assertEqual(validate_candidate(result, source)['status'], 'blocked')

    def test_source_review_flags_survive_and_no_facts_cannot_pass(self):
        result, source = self.candidate()
        source['coverage']['review_reasons'] = ['authority_needs_review']
        report = validate_candidate(result, source)
        self.assertIn('authority_needs_review', {w['reason'] for w in report['warnings']})
        blocked = validate_candidate({'status': 'invalid_post_output'}, source)
        self.assertEqual(blocked['status'], 'blocked')
        self.assertIn('authority_needs_review', {w['reason'] for w in blocked['warnings']})
        result['facts'] = {'posts': [], 'evidence': [], 'missing_fields': []}
        self.assertEqual(validate_candidate(result, source)['status'], 'blocked')


if __name__ == '__main__':
    unittest.main()
