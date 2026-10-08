import copy
import json
import tempfile
import unittest
from pathlib import Path

from build_extraction_input import prepare_extraction
from check_coverage import check_coverage
from recovery_queue import RecoveryQueue
from verify_bundle import verify_bundles


MAIN_URL = 'https://jobs.example.gov.in/main.pdf'
UPDATE_URL = 'https://jobs.example.gov.in/annexure.pdf'
QUOTE = 'Vacancies have been updated in Annexure I.'


def sample_bundle(*, linked=False):
    documents = [{'document_id': 'main', 'source_url': MAIN_URL, 'format': 'pdf',
        'content': {'source_url': MAIN_URL, 'sections': [{
            'text': 'Recruitment Notice\nIssuer: Example\nCampaign: Engineers\nRecruitment Year: 2026\n'
                    'Post: Engineer\nAge limit: 21–30 years\nCandidates must possess professional registration.',
            'evidence': [{'page': 2, 'block_id': 'page-2-native', 'line_range': [1, 7]}]}]}},
        {'document_id': 'update', 'source_url': 'https://jobs.example.gov.in/update', 'format': 'html',
         'content': {'title': 'Corrigendum', 'blocks': [{'type': 'paragraph',
             'text': 'Issuer: Example\nCampaign: Engineers\nRecruitment Year: 2026\n' + QUOTE}],
             'links': [{'url': UPDATE_URL, 'text': 'Updated Annexure I'}] if linked else []}}]
    return verify_bundles(documents, issuer_hosts={'Example': ['jobs.example.gov.in']})['bundles'][0]


def gap():
    return {'url': UPDATE_URL, 'source_document_id': 'update',
            'quote': QUOTE, 'fields': ['vacancies']}


class ExtractionInputTests(unittest.TestCase):
    def test_missing_keyword_is_focus_not_forced_null(self):
        result = prepare_extraction(sample_bundle())
        coverage = result['coverage']
        self.assertEqual(coverage['status'], 'ready_for_extraction')
        self.assertEqual(coverage['evidence']['education']['status'], 'not_located')
        self.assertIn('education', coverage['coverage_focus'])
        payload = result['llm_input']
        self.assertIn('professional registration', json.dumps(payload))
        self.assertIn('unusual wording', payload['instructions'])
        self.assertFalse(coverage['coverage_complete'])

    def test_mixed_documents_separate_with_page_evidence(self):
        bundle = sample_bundle()
        before = copy.deepcopy(bundle)
        output = prepare_extraction(bundle)['llm_input']['input']
        self.assertEqual(bundle, before)
        self.assertEqual(len(output['documents']), 2)
        self.assertEqual(output['documents'][0]['sections'][0]['locations'][0]['page'], 2)
        self.assertEqual(output['documents'][0]['sections'][0]['evidence_id'], 'main:unit-0')
        self.assertEqual(output['documents'][1]['role'], 'corrigendum')
        self.assertIn('amendment_or_cancellation_scope_needs_review', output['coverage']['review_reasons'])
        self.assertIn('evidence', output['output_schema']['properties'])

    def test_initial_dependency_waits_and_queues_once(self):
        with tempfile.TemporaryDirectory() as root:
            queue = RecoveryQueue(Path(root) / 'queue.db')
            for _ in range(2):
                result = prepare_extraction(sample_bundle(linked=True), missing_documents=[gap()], recovery_queue=queue)
                self.assertEqual(result['coverage']['status'], 'waiting_for_document')
                self.assertIsNone(result['llm_input'])
            self.assertEqual(len(queue.bundle(sample_bundle()['bundle_id'])['tasks']), 1)

    def test_second_pass_unresolved_gap_is_focus_not_third_request(self):
        with tempfile.TemporaryDirectory() as root:
            queue = RecoveryQueue(Path(root) / 'queue.db')
            bundle = sample_bundle(linked=True)
            prepare_extraction(bundle, missing_documents=[gap()], recovery_queue=queue)
            task = queue.claim_next()
            queue.finish(task, reason='login_required')
            result = prepare_extraction(bundle, missing_documents=[gap()], recovery_queue=queue)
            self.assertEqual(result['coverage']['status'], 'ready_for_extraction')
            self.assertIn('vacancies', result['coverage']['coverage_focus'])
            self.assertIn('document_recovery_failed', result['coverage']['review_reasons'])
            self.assertIsNotNone(result['llm_input'])
            self.assertIsNone(queue.claim_next())

    def test_recovered_document_in_expanded_bundle_resolves_url_gap(self):
        bundle = sample_bundle(linked=True)
        bundle['documents'].append({'document_id': 'annexure', 'source_url': UPDATE_URL,
            'format': 'html', 'role': 'vacancy_annexure', 'authority': 'official_host_candidate',
            'content': {'blocks': [{'type': 'table', 'rows': [
                ['Post', 'Vacancies'], ['Engineer', '12']]}]}})
        result = prepare_extraction(bundle, missing_documents=[gap()], recovery_pass=1)
        self.assertEqual(result['coverage']['missing_documents'], [])
        table = result['llm_input']['input']['documents'][2]['sections'][0]
        self.assertEqual(table['rows'][1], ['Engineer', '12'])
        self.assertEqual(table['locations'], [{'block': 0}])

    def test_unreadable_omitted_and_authority_flags_survive(self):
        bundle = sample_bundle()
        bundle['review_reasons'].append('authority_needs_review')
        bundle['documents'][0]['content']['coverage'] = {'unreadable_pages': [3],
            'omitted_sections': [{'page': 4}], 'unresolved_references': ['Appendix II']}
        reasons = prepare_extraction(bundle)['llm_input']['input']['coverage']['review_reasons']
        self.assertTrue({'authority_needs_review', 'content_coverage_gap',
                         'unresolved_document_references'} <= set(reasons))

    def test_budget_blocks_without_silent_truncation(self):
        bundle = sample_bundle()
        before = copy.deepcopy(bundle)
        result = prepare_extraction(bundle, max_characters=20)
        self.assertIsNone(result['llm_input'])
        self.assertIn('llm_input_budget_exceeded', result['coverage']['review_reasons'])
        self.assertEqual(bundle, before)

    def test_empty_content_does_not_send_llm_payload(self):
        bundle = sample_bundle()
        for document in bundle['documents']:
            document['content'] = {}
        result = prepare_extraction(bundle)
        self.assertEqual(result['coverage']['status'], 'needs_review')
        self.assertIsNone(result['llm_input'])

    def test_ungrounded_dependency_cannot_enqueue(self):
        for bad in [dict(gap(), quote='Invented source statement'),
                    dict(gap(), url='https://other.example.org/file.pdf'),
                    dict(gap(), url='file:///tmp/notice.pdf'),
                    dict(gap(), fields=['invented'])]:
            with self.assertRaises(ValueError):
                check_coverage(sample_bundle(linked=True), missing_documents=[bad])

    def test_third_pass_rejected(self):
        with self.assertRaises(ValueError):
            check_coverage(sample_bundle(), recovery_pass=2)

    def test_keyword_does_not_certify_complete_field(self):
        evidence = check_coverage(sample_bundle())['evidence']['vacancies']
        self.assertEqual(evidence['status'], 'candidate_found')
        # Mentioning vacancies in a corrigendum does not supply their actual counts.
        self.assertEqual(evidence['matches'][0]['document_id'], 'update')

    def test_identity_text_has_citable_source_evidence(self):
        bundle = sample_bundle()
        bundle['documents'][0]['content']['identity_context'] = {
            'text': 'Recruitment of Engineers', 'evidence': [{'page': 1}]}
        sections = prepare_extraction(bundle)['llm_input']['input']['documents'][0]['sections']
        self.assertEqual(sections[-1]['evidence_id'], 'main:identity')
        self.assertEqual(sections[-1]['locations'], [{'page': 1}])

    def test_explicit_amendment_link_automatically_requests_recovery(self):
        result = prepare_extraction(sample_bundle(linked=True))
        self.assertEqual(result['coverage']['status'], 'waiting_for_document')
        self.assertEqual(result['coverage']['missing_document_urls'], [UPDATE_URL])
        self.assertIsNone(result['llm_input'])

    def test_ambiguous_link_does_not_guess_destination(self):
        bundle = sample_bundle(linked=True)
        bundle['documents'][1]['content']['links'].append({
            'url': 'https://jobs.example.gov.in/another.pdf', 'text': 'Updated Annexure I'})
        result = prepare_extraction(bundle)
        self.assertEqual(result['coverage']['missing_document_urls'], [])
        self.assertIn('amendment_or_cancellation_scope_needs_review', result['coverage']['review_reasons'])


if __name__ == '__main__':
    unittest.main()
