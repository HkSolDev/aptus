"""Identity/link regressions only: no OCR, provider, network or publication."""

import copy
import json
import unittest
from pathlib import Path

from build_extraction_input import prepare_extraction
from normalize_html import normalize_html
from select_pdf_sections import complete_pdf_sections, select_pdf_sections
from verify_bundle import describe_document, verify_bundles


FIXTURES = Path(__file__).parent / 'fixtures'
SUMMARY = 'https://www.sarkariresult.com/2026/upessc-up-headmaster-09-2026/'
HOSTS = {'UPESSC': ['upessc.up.gov.in']}


def summary_document():
    return {'document_id': 'summary', 'source_url': SUMMARY, 'format': 'html',
            'content': normalize_html((FIXTURES / 'headmaster-summary-identity.html').read_bytes(), SUMMARY)}


def parent_pdf():
    return json.loads((FIXTURES / 'headmaster-native-pages.json').read_text())


def selected_document(source):
    content = complete_pdf_sections(select_pdf_sections(source), source)
    return {'document_id': 'notification', 'source_url': source['source_url'],
            'format': 'pdf', 'content': content}


class HeadmasterIdentityTests(unittest.TestCase):
    def test_midline_advertisement_excludes_summary_heading_suffix(self):
        doc = describe_document(summary_document(), HOSTS)
        self.assertEqual(doc['identity']['advertisement_number'], '09/2026')
        evidence = next(item for item in doc['identity_evidence']
                        if item['field'] == 'advertisement_number')
        self.assertEqual(evidence['quote'], 'Advt No 09/2026')
        self.assertEqual(evidence['locations'], [{'block': 0}])

    def test_midline_conflicting_advertisements_remain_ambiguous(self):
        doc = summary_document()
        doc['content']['blocks'].append({'type': 'paragraph',
            'text': 'Another notice Advt No 10/2026 | Short Details'})
        unit = describe_document(doc, HOSTS)
        self.assertIsNone(unit['identity']['advertisement_number'])
        self.assertIn('ambiguous_advertisement_number', unit['review_reasons'])

    def test_page_artifact_keeps_own_parent_header_not_a_fabricated_page_identity(self):
        source = parent_pdf()
        original = copy.deepcopy(source)
        doc = selected_document(source)
        context = doc['content']['identity_context']
        self.assertEqual(context['text'], source['blocks'][0]['alternatives'][0]['text'])
        self.assertIn('foKkiu la[;k& 09@2026', context['text'])
        self.assertEqual(context['evidence'][0]['block_id'], 'page-1-native')
        self.assertEqual(context['evidence'][0]['page'], 1)
        self.assertEqual(context['evidence'][0]['line_range'], [1, 8])
        self.assertEqual(doc['content']['page_index'][1]['block_id'], 'page-6-native')
        self.assertNotIn('09@2026', source['blocks'][1]['alternatives'][0]['text'])
        self.assertEqual(source, original)
        # Preserving identity does not make unreadable Hindi selectable.
        self.assertEqual(doc['content']['sections'], [])

    def test_exact_notification_link_groups_parent_with_summary_not_unrelated_notice(self):
        summary = summary_document()
        pdf = selected_document(parent_pdf())
        unrelated = copy.deepcopy(summary)
        unrelated['document_id'] = 'unrelated'
        unrelated['source_url'] = SUMMARY + 'other'
        unrelated['content'] = {'blocks': [{'type': 'paragraph',
            'text': 'UPESSC Other Recruitment Advt No 10/2026 | Short Details'}]}
        documents = [summary, pdf, unrelated]
        original = copy.deepcopy(documents)
        for order in (documents, list(reversed(documents))):
            bundles = verify_bundles(order, issuer_hosts=HOSTS)['bundles']
            members = {frozenset(d['document_id'] for d in b['documents']) for b in bundles}
            self.assertEqual(members, {frozenset(['summary', 'notification']), frozenset(['unrelated'])})
            bundle = next(b for b in bundles if len(b['documents']) == 2)
            self.assertEqual(bundle['identity']['advertisement_number'], '09/2026')
            self.assertEqual(bundle['identity']['year'], '2026')
            self.assertIn('authority_needs_review', bundle['review_reasons'])
            self.assertIsNone(prepare_extraction(bundle)['llm_input'])
        self.assertEqual(documents, original)

    def test_domain_only_link_does_not_establish_document_membership(self):
        summary = summary_document()
        summary['content']['links'] = [{'url': 'https://upessc.up.gov.in/'}]
        bundles = verify_bundles([summary, selected_document(parent_pdf())], issuer_hosts=HOSTS)['bundles']
        self.assertEqual(len(bundles), 2)

    def test_parent_identity_cannot_leak_between_pdf_sources(self):
        source = parent_pdf()
        candidate = select_pdf_sections(source)
        other = copy.deepcopy(source)
        other['source_url'] = 'https://upessc.up.gov.in/Notice/unrelated.pdf'
        with self.assertRaises(ValueError):
            complete_pdf_sections(candidate, other)

    def test_readable_parent_identity_is_inherited_with_parent_page_location(self):
        # Synthetic readable header isolates inheritance from legacy-font decoding.
        source = parent_pdf()
        source['blocks'][0]['alternatives'][0]['text'] = 'UPESSC Recruitment Notice\nAdvertisement No: 09/2026'
        doc = describe_document(selected_document(source), HOSTS)
        self.assertEqual(doc['identity']['advertisement_number'], '09/2026')
        evidence = next(item for item in doc['identity_evidence']
                        if item['field'] == 'advertisement_number')
        self.assertEqual(evidence['locations'][0]['page'], 1)
        self.assertEqual(evidence['locations'][0]['block_id'], 'page-1-native')
        source['pages'] = source['pages'][1:]
        source['blocks'] = source['blocks'][1:]
        self.assertIsNone(describe_document(selected_document(source), HOSTS)['identity']['advertisement_number'])

    def test_inline_prose_or_embedded_word_is_not_an_identifier(self):
        for text in ['UPESSC recruitment advertisement number of posts is unknown',
                     'UPESSC notadvt No 09/2026 | Short Details']:
            with self.subTest(text=text):
                doc = summary_document()
                doc['content']['blocks'] = [{'type': 'paragraph', 'text': text}]
                self.assertIsNone(describe_document(doc, HOSTS)['identity']['advertisement_number'])


if __name__ == '__main__':
    unittest.main()
