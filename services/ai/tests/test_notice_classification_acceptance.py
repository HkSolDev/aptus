"""Slice 1: notice purpose and readable evidence before identity extraction."""
import unittest
from unittest.mock import patch

from build_extraction_input import is_extraction_approved, prepare_extraction
from extract_bundle import extract_bundle
from verify_bundle import verify_bundles


def page(title, text, *, prefix=0, identifier='notice'):
    return {'document_id': identifier, 'source_url': f'https://example.gov.in/{identifier}',
            'format': 'html', 'content': {'title': title, 'blocks': [
                *[{'type': 'paragraph', 'text': 'Navigation'} for _ in range(prefix)],
                {'type': 'paragraph', 'text': text}]}}


def prepare(document, **options):
    bundle = verify_bundles([document])['bundles'][0]
    return bundle, prepare_extraction(bundle, **options)


class NoticeClassificationAcceptanceTests(unittest.TestCase):
    def assert_rejected(self, document):
        bundle, prepared = prepare(document)
        self.assertFalse(is_extraction_approved(prepared))
        self.assertIsNone(prepared['llm_input'])
        with patch('extract_bundle.request_structured') as provider:
            with self.assertRaises(ValueError):
                extract_bundle(prepared)
            self.assertEqual(provider.call_count, 0)
        return bundle

    def test_notice_specific_online_form_does_not_require_regex_identity(self):
        bundle, prepared = prepare(page('University of Example Assistant Online Form 2026',
                                        'Vacancies: 126. Bachelor degree required.'))
        self.assertEqual(bundle['documents'][0]['role'], 'main_notice')
        self.assertIn('insufficient_campaign_identity', prepared['coverage']['review_reasons'])
        self.assertTrue(is_extraction_approved(prepared))

    def test_recruitment_word_does_not_override_login_or_directory_purpose(self):
        for title in ('Candidate Recruitment Login', 'Latest Recruitment Notifications',
                      'Recruitment', 'Job Directory', 'All Jobs', 'Recruitment Advertisements',
                      'Recruitment Contact Us'):
            with self.subTest(title=title):
                self.assert_rejected(page(title, 'Browse eligibility instructions and recruitment links.'))

    def test_login_stays_rejected_even_when_it_repeats_job_facts(self):
        self.assert_rejected(page('Engineer Recruitment Candidate Login',
                                  'Post: Engineer. Vacancies: 12. Bachelor degree required. Sign in.'))

    def test_recruitment_title_alone_is_not_substantive_evidence(self):
        # Readable but vague notice text is now classified by the single AI call.
        _, prepared = prepare(page('Engineer Recruitment 2026', 'Please check eligibility and important dates.'))
        self.assertTrue(is_extraction_approved(prepared))

    def test_supporting_evidence_after_twenty_units_is_considered(self):
        _, prepared = prepare(page('Assistant Online Form 2026',
                                   'Post: Assistant. Vacancies: 12. Bachelor degree required.', prefix=30))
        self.assertTrue(is_extraction_approved(prepared))
        self.assertIn('Vacancies: 12', str(prepared['llm_input']))

    def test_results_admit_cards_and_exam_stage_updates_are_not_new_jobs(self):
        for title in ('Recruitment Examination Result', 'Recruitment Admit Card',
                      'Engineer Recruitment Interview Schedule',
                      'Engineer Document Verification Schedule',
                      'Constable Examination — Shortlisting of candidates for PET/PST',
                      'Engineer Examination Answer Key'):
            with self.subTest(title=title):
                bundle, prepared = prepare(page(title, 'Vacancies: 12. Candidates shortlisted for the next stage.'))
                self.assertTrue(is_extraction_approved(prepared))
                self.assertIn('non_recruitment_document', bundle['review_reasons'])

    def test_scholarship_and_student_admission_are_not_jobs(self):
        for title in ('UP Scholarship Online Form 2026', 'University Entrance Admission Online Form 2026'):
            with self.subTest(title=title):
                bundle, prepared = prepare(page(title, 'Bachelor degree courses. Application fee: 100. Last date: 30/11/2026.'))
                self.assertTrue(is_extraction_approved(prepared))
                self.assertIn('non_recruitment_document', bundle['review_reasons'])

    def test_job_notice_can_mention_other_programs_and_selection_updates_in_body(self):
        _, prepared = prepare(page('University Assistant Recruitment 2026',
            'Post: Assistant. Vacancies: 12. Bachelor degree required. '
            'Admit cards and interview schedules will be published later. '
            'The university also provides scholarships and entrance admissions.'))
        self.assertTrue(is_extraction_approved(prepared))

    def test_pdf_job_facts_before_selection_details_remain_a_notice(self):
        text = ('University Assistant Recruitment 2026\nPost: Assistant. Vacancies: 12.\n'
                'Admit cards and interview schedules will be published later.')
        doc = {'document_id': 'pdf-main', 'source_url': 'https://example.gov.in/main.pdf',
               'format': 'pdf', 'content': {'sections': [
                   {'text': text, 'evidence': [{'page': 1}]}]}}
        _, prepared = prepare(doc)
        self.assertTrue(is_extraction_approved(prepared))

    def test_scholarship_officer_and_admissions_officer_are_job_titles(self):
        for title in ('Scholarship Officer Recruitment 2026', 'Admissions Officer Online Form 2026'):
            with self.subTest(title=title):
                _, prepared = prepare(page(title, 'Post: Officer. Vacancies: 2. Bachelor degree required.'))
                self.assertTrue(is_extraction_approved(prepared))

    def test_pdf_shortlisting_subject_after_header_is_rejected(self):
        text = ('Government of Example\nSelection Board\nHeadquarters\nAddress\nOffice\n'
                'Reference\nNotice\nConstable Examination 2026\n'
                'Shortlisting of candidates to appear in PET/PST\n'
                'The recruitment is made for the following posts. Post: Constable.')
        doc = {'document_id': 'pdf', 'source_url': 'https://example.gov.in/notice.pdf', 'format': 'pdf',
               'content': {'sections': [{'text': text, 'evidence': [{'page': 1}]}]}}
        _, prepared = prepare(doc)
        self.assertTrue(is_extraction_approved(prepared))

    def test_unidentified_notices_stay_separate_and_stable(self):
        docs = [page('Assistant Online Form 2026', 'Post: Assistant. Vacancies: 2.', identifier='a'),
                page('Engineer Online Form 2026', 'Post: Engineer. Vacancies: 3.', identifier='b')]
        first = verify_bundles(docs)['bundles']
        again = verify_bundles(list(reversed(docs)))['bundles']
        self.assertEqual(len(first), 2)
        self.assertEqual({b['bundle_id'] for b in first}, {b['bundle_id'] for b in again})
        self.assertTrue(all(len(b['documents']) == 1 for b in first))

    def test_partial_source_crawl_does_not_block_complete_notice(self):
        _, prepared = prepare(page('Assistant Online Form 2026', 'Post: Assistant. Vacancies: 2.'),
                              crawl_status='partial')
        self.assertTrue(is_extraction_approved(prepared))
        self.assertIn('source_crawl_partial', prepared['coverage']['review_reasons'])


if __name__ == '__main__':
    unittest.main()
