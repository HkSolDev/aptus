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
        self.assertEqual(output['output_format'], 'compact-inline-facts-v1')
        self.assertEqual(set(output['output_schema']['properties']),
                         {'purpose', 'purpose_evidence', 'document_purposes', 'amendment', 'posts'})

    def test_initial_dependency_waits_and_queues_once(self):
        with tempfile.TemporaryDirectory() as root:
            queue = RecoveryQueue(Path(root) / 'queue.db')
            for _ in range(2):
                result = prepare_extraction(sample_bundle(linked=True), missing_documents=[gap()], recovery_queue=queue)
                self.assertEqual(result['coverage']['status'], 'waiting_for_document')
                self.assertIsNone(result['llm_input'])
            self.assertEqual(len(queue.bundle(sample_bundle()['bundle_id'])['tasks']), 1)

    def test_second_pass_unresolved_gap_blocks_without_third_request(self):
        with tempfile.TemporaryDirectory() as root:
            queue = RecoveryQueue(Path(root) / 'queue.db')
            bundle = sample_bundle(linked=True)
            prepare_extraction(bundle, missing_documents=[gap()], recovery_queue=queue)
            task = queue.claim_next()
            queue.finish(task, reason='login_required')
            result = prepare_extraction(bundle, missing_documents=[gap()], recovery_queue=queue)
            self.assertEqual(result['coverage']['status'], 'needs_review')
            self.assertIn('vacancies', result['coverage']['coverage_focus'])
            self.assertIn('document_recovery_failed', result['coverage']['review_reasons'])
            self.assertIsNone(result['llm_input'])
            self.assertEqual(result['coverage']['missing_document_urls'], [UPDATE_URL])
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
        prepared = prepare_extraction(bundle)
        self.assertIsNone(prepared['llm_input'])
        self.assertEqual(prepared['coverage']['status'], 'needs_review')
        reasons = prepared['coverage']['review_reasons']
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


SUMMARY_URL = 'https://www.sarkariresult.example/2026/upessc-headmaster-09-2026/'
OFFICIAL_URL = 'https://upessc.example/Notice/headmaster-09-2026.pdf'
OCR_SENTINEL = 'OCR-FIXTURE-SENTINEL classes 9 to 42'


def html_main_with_pdf_link():
    return {'document_id': 'summary', 'source_url': SUMMARY_URL, 'format': 'html',
        'content': {'title': 'Headmaster Recruitment Notification',
            'blocks': [{'type': 'paragraph',
                'text': 'Issuer: Example\nAdvertisement No: 09/2026\nRecruitment Year: 2026\n'
                        'Post: Headmaster requires 4 Year Experience.'}],
            'links': [{'url': OFFICIAL_URL, 'text': 'Download Full Notification'}]}}


def linked_pdf(*, sections=True):
    """Linked PDF with no self-identity or notice title, so its role stays unknown.

    The diagnostic block carries a fake OCR alternative that must never reach the model.
    """
    content = {'source_url': OFFICIAL_URL,
        'pages': [{'number': 6, 'native_status': 'usable_candidate' if sections else 'image_only_or_scan_candidate'}],
        'blocks': [{'id': 'page-6-native', 'type': 'unclassified', 'page': 6,
            'alternatives': [{'id': 'page-6-ocr-a2', 'method': 'ocr_test',
                              'status': 'candidate', 'text': OCR_SENTINEL}]}]}
    if sections:
        content['sections'] = [{'text': 'Teaching experience: classes 9 to 12 under a certified authority.',
            'evidence': [{'page': 6, 'block_id': 'page-6-native', 'line_range': [1, 1]}]}]
    else:
        content['sections'] = []
    return {'document_id': 'notification', 'source_url': OFFICIAL_URL, 'format': 'pdf', 'content': content}


def html_plus_pdf_bundle(*, pdf_first=False, sections=True):
    documents = [html_main_with_pdf_link(), linked_pdf(sections=sections)]
    if pdf_first:
        documents.reverse()
    return verify_bundles(documents, issuer_hosts={'Example': ['sarkariresult.example']})['bundles'][0]


class EvidenceOrderingTests(unittest.TestCase):
    def test_fixture_roles_prove_intended_ordering_case(self):
        roles = {document['document_id']: document['role'] for document in html_plus_pdf_bundle()['documents']}
        self.assertEqual(roles, {'summary': 'main_notice', 'notification': 'unknown'})

    def test_html_main_notice_first_and_linked_pdf_supporting(self):
        # Both bundle orders must give the same reading order.
        for pdf_first in (False, True):
            bundle = html_plus_pdf_bundle(pdf_first=pdf_first)
            before = copy.deepcopy(bundle)
            result = prepare_extraction(bundle)
            self.assertEqual(result['coverage']['status'], 'ready_for_extraction')
            documents = result['llm_input']['input']['documents']
            self.assertEqual(bundle, before)
            self.assertEqual([(d['document_id'], d['format'], d['label']) for d in documents],
                             [('summary', 'html', 'primary'), ('notification', 'pdf', 'supporting')])

    def test_pdf_main_notice_stays_first_with_supporting_html(self):
        bundle = sample_bundle()
        bundle['documents'].reverse()
        documents = prepare_extraction(bundle)['llm_input']['input']['documents']
        self.assertEqual([(d['document_id'], d['format'], d['role'], d['label']) for d in documents],
                         [('main', 'pdf', 'main_notice', 'primary'),
                          ('update', 'html', 'corrigendum', 'supporting')])

    def test_supporting_pdf_only_condition_keeps_page_provenance(self):
        documents = prepare_extraction(html_plus_pdf_bundle())['llm_input']['input']['documents']
        primary, supporting = documents
        self.assertNotIn('classes 9 to 12', json.dumps(primary))
        section = supporting['sections'][0]
        self.assertEqual(section['text'], 'Teaching experience: classes 9 to 12 under a certified authority.')
        self.assertEqual(section['locations'], [{'page': 6, 'block_id': 'page-6-native', 'line_range': [1, 1]}])
        self.assertEqual(section['evidence_id'], 'notification:unit-0')

    def test_unreadable_linked_pdf_still_blocks_extraction(self):
        result = prepare_extraction(html_plus_pdf_bundle(sections=False))
        self.assertIsNone(result['llm_input'])
        self.assertEqual(result['coverage']['status'], 'needs_review')
        self.assertIn('pdf_requires_review', result['coverage']['review_reasons'])

    def test_ocr_alternatives_never_reach_the_model_payload(self):
        llm_input = prepare_extraction(html_plus_pdf_bundle())['llm_input']
        wire = json.dumps(llm_input, ensure_ascii=False)
        self.assertNotIn('ocr_sections', wire)
        self.assertNotIn('OCR-FIXTURE-SENTINEL', wire)
        self.assertNotIn('ocr', llm_input['instructions'].lower())

    def test_instructions_describe_order_without_claiming_authority_or_printed_pages(self):
        text = ' '.join(prepare_extraction(sample_bundle())['llm_input']['instructions'].split())
        for required in ('first document as the concise starting point',
                         'inspect every supporting section',
                         'non-conflicting facts found only in a supporting document',
                         'quote both sources',
                         'does not make one document more authoritative',
                         'physical PDF page numbers, not printed page labels',
                         'Extract requirements separately for every named post/role.',
                         'A requirement belongs to a post only when its evidence names that post or clearly binds it.',
                         'Preserve post-specific qualification, experience, age, category, vacancy, certificate, and date conditions with source quotations.',
                         'Never copy a condition from one post to another.',
                         'Never decide whether a candidate is eligible.'):
            self.assertIn(required, text)


if __name__ == '__main__':
    unittest.main()
