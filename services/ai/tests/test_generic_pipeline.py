import json
import tempfile
import unittest
from pathlib import Path

from generic_pipeline import run_pipeline
from services.ai.tests import test_shared_pipeline


class GenericPipelineTests(unittest.TestCase):
    def setUp(self):
        self.fixture = test_shared_pipeline.SharedPipelineTests(
            'test_multihop_real_html_and_pdf_reach_same_evidence_input')
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root = Path(self.fixture.temp.name)
        self.source = {'id': 'new_board', 'url': self.fixture.base + '/', 'enabled': True,
                       'kind': 'official', 'reason': None}

    def prepare(self, root, **_options):
        return [self.fixture.run_source()]

    def test_ready_html_pdf_bundle_creates_draft_without_bypassing_review(self):
        calls, pushed = [], []
        def extract(prepared):
            calls.append('extract')
            self.assertEqual({document['format'] for document in prepared['llm_input']['input']['documents']},
                             {'html', 'pdf'})
            return {'bundle_id': prepared['llm_input']['input']['bundle_id'], 'facts': {'posts': []}}
        def validate(result, source):
            calls.append('validate')
            return {'status': 'needs_review', 'disposition': 'valid_recruitment_review_draft'}
        def draft(result, source, *, source_name):
            calls.append('draft')
            return {'bundle_id': result['bundle_id'], 'source_name': source_name}
        report = run_pipeline(self.root / 'pipeline', prepare=self.prepare, extract=extract,
                              validate=validate, draft=draft, persist=pushed.append)
        counts = report['sources']['new_board']
        self.assertGreaterEqual(counts['extracted'], 1)
        self.assertEqual(counts['published'], 0)
        self.assertEqual(calls, ['extract', 'validate', 'draft'])
        self.assertEqual(len(pushed), 0)

    def test_partial_or_ambiguous_input_never_calls_model_or_persistence(self):
        called = []
        def prepare(_root, **_options):
            path = self.root / 'blocked.prepared.json'
            path.write_text(json.dumps({'coverage': {'status': 'needs_review'}, 'llm_input': None}))
            return [{'source': 'new_board', 'status': 'partial', 'prepared_inputs': 0,
                     'prepared_paths': [str(path)]}]
        report = run_pipeline(self.root / 'pipeline', prepare=prepare,
                              extract=lambda _: called.append('extract'),
                              persist=lambda _: called.append('persist'))
        self.assertEqual(called, [])
        self.assertEqual(report['sources']['new_board']['blocked'], 1)

    def test_unsupported_seed_is_explicitly_blocked_without_model_or_persistence(self):
        called = []
        def prepare(_root, **_options):
            return [{'source': 'rss_seed', 'status': 'blocked', 'prepared_inputs': 0,
                     'prepared_paths': []}]
        report = run_pipeline(self.root / 'pipeline', prepare=prepare,
                              extract=lambda _: called.append('extract'),
                              persist=lambda _: called.append('persist'))
        self.assertEqual(called, [])
        self.assertEqual(report['sources']['rss_seed']['reason'], 'unsupported_seed_type')

    def test_worker_unusable_pdf_runs_vision_rebuilds_input_and_reaches_autonomous_ingest(self):
        from unittest.mock import Mock
        from build_extraction_input import is_extraction_approved, prepare_extraction
        from verify_bundle import verify_bundles

        summary_url = 'https://upessc.example.gov.in/notices/headmaster-09-2026.html'
        pdf_url = 'https://upessc.example.gov.in/notices/headmaster-09-2026.pdf'
        html_doc = {
            'document_id': 'summary-html',
            'source_url': summary_url,
            'format': 'html',
            'content': {
                'title': 'UPESSC Headmaster Recruitment Notification',
                'blocks': [
                    {
                        'type': 'paragraph',
                        'text': (
                            'Issuer: UPESSC\nAdvertisement No: 09/2026\nRecruitment Year: 2026\n'
                            'Post: Headmaster | Vacancies: 120 | Age limit: 21 to 40 years | '
                            'Application last date: 2026-12-15 | Qualification: Postgraduate with B.Ed.'
                        ),
                    }
                ],
                'links': [{'url': pdf_url, 'text': 'Download Official Notification PDF'}],
            },
        }
        pdf_doc = {
            'document_id': 'official-pdf',
            'source_url': pdf_url,
            'format': 'pdf',
            'content': {
                'source_url': pdf_url,
                'pages': [{'number': 6, 'native_status': 'suspicious_or_unusable'}],
                'blocks': [
                    {
                        'id': 'page-6-native',
                        'type': 'unclassified',
                        'page': 6,
                        'alternatives': [
                            {
                                'id': 'page-6-native-a1',
                                'method': 'native_text',
                                'status': 'rejected',
                                'text': 'mojibake-unreadable-text',
                            }
                        ],
                    }
                ],
                'sections': [],
                'coverage': {'unreadable_pages': [6]},
            },
        }
        bundle = verify_bundles(
            [html_doc, pdf_doc],
            issuer_hosts={'UPESSC': ['upessc.example.gov.in']},
        )['bundles'][0]
        bundle_id = bundle['bundle_id']

        initial_prepared = prepare_extraction(bundle, crawl_status='scanned')
        self.assertIsNone(initial_prepared['llm_input'])
        self.assertFalse(is_extraction_approved(initial_prepared))

        source_dir = self.root / 'unusable_pdf_source'
        source_dir.mkdir(parents=True, exist_ok=True)
        bundles_path = source_dir / 'bundles.json'
        bundles_path.write_text(json.dumps({'bundles': [bundle]}), encoding='utf-8')
        prep_path = source_dir / f'{bundle_id}.prepared.json'
        prep_path.write_text(json.dumps(initial_prepared), encoding='utf-8')

        def prepare(_root, **_options):
            return [
                {
                    'source': 'upessc_board',
                    'status': 'scanned',
                    'prepared_inputs': 0,
                    'bundles_path': str(bundles_path),
                    'prepared_paths': [str(prep_path)],
                }
            ]

        vision_page_text = (
            'Issuer: UPESSC Advertisement No: 09/2026 Post: Headmaster. '
            'Minimum qualification: Postgraduate with B.Ed. '
            'Age limit: 21 to 40 years. Total vacancies: 120. '
            'Application last date: 2026-12-15.'
        )
        vision_provider = Mock()
        vision_provider.model = 'gemini-2.5-flash'
        vision_provider.recover_pdf_page.return_value = {
            'status': 'ok',
            'retryable': False,
            'reason': None,
            'data': {
                'physical_pdf_page': 6,
                'visible_issuer': 'UPESSC',
                'visible_advertisement_number': '09/2026',
                'page_text_quote': vision_page_text,
                'posts': [
                    {
                        'post_name': 'Headmaster',
                        'post_binding_quote': 'Post: Headmaster.',
                        'candidate_facts': [
                            {
                                'field_path': 'education_required',
                                'value': 'Postgraduate with B.Ed.',
                                'exact_quote': 'Minimum qualification: Postgraduate with B.Ed.',
                                'physical_pdf_page': 6,
                                'section_locator': 'official-pdf:page-6:edu',
                                'conditions': None,
                            },
                            {
                                'field_path': 'application_last_date',
                                'value': '2026-12-15',
                                'exact_quote': 'Application last date: 2026-12-15.',
                                'physical_pdf_page': 6,
                                'section_locator': 'official-pdf:page-6:dates',
                                'conditions': None,
                            },
                        ],
                        'experience_alternatives': [],
                    }
                ],
            },
            'raw_text': '{}',
        }

        def extract(prepared):
            from test_autonomous_pipeline import _make_extracted

            self.assertIsNotNone(prepared['llm_input'])
            self.assertTrue(is_extraction_approved(prepared))
            docs = prepared['llm_input']['input']['documents']
            pdf_doc_in = next(d for d in docs if d['format'] == 'pdf')
            ev_id = pdf_doc_in['sections'][0]['evidence_id']
            candidate = _make_extracted(
                bundle_id=prepared['llm_input']['input']['bundle_id'],
                include_education=False,
                application_last_date=None,
            )
            candidate['facts']['posts'][0]['recruiting_body'] = 'UPESSC'
            candidate['facts']['posts'][0]['advertisement_number'] = '09/2026'
            candidate['facts']['purpose_evidence'] = [
                {'evidence_id': ev_id, 'quote': 'Post: Headmaster.'}
            ]
            candidate['facts']['document_purposes'] = [
                {
                    'document_id': d['document_id'],
                    'purpose': 'recruitment',
                    'evidence': [
                        {
                            'evidence_id': d['sections'][0]['evidence_id'],
                            'quote': 'Post: Headmaster',
                        }
                    ],
                }
                for d in docs
            ]
            candidate['facts']['evidence'] = [
                {'field_path': 'posts.0.post_name', 'evidence_id': ev_id, 'quote': 'Post: Headmaster.'},
                {'field_path': 'posts.0.recruiting_body', 'evidence_id': ev_id, 'quote': 'Issuer: UPESSC'},
                {'field_path': 'posts.0.advertisement_number', 'evidence_id': ev_id, 'quote': 'Advertisement No: 09/2026'},
                {'field_path': 'posts.0.vacancies', 'evidence_id': ev_id, 'quote': 'Total vacancies: 120.'},
                {'field_path': 'posts.0.min_age', 'evidence_id': ev_id, 'quote': 'Age limit: 21 to 40 years.'},
                {'field_path': 'posts.0.max_age', 'evidence_id': ev_id, 'quote': 'Age limit: 21 to 40 years.'},
            ]
            return candidate

        pushed = []
        report = run_pipeline(
            self.root / 'pipeline_vision',
            prepare=prepare,
            extract=extract,
            persist=pushed.append,
            vision_provider=vision_provider,
            pdf_bytes_by_doc={'official-pdf': b'%PDF-1.4'},
            page_images_by_doc={'official-pdf': {6: b'\x89PNG\r\n\x1a\n'}},
        )
        counts = report['sources']['upessc_board']
        self.assertEqual(counts.get('vision_called'), 1)
        self.assertEqual(counts['extracted'], 1)
        self.assertEqual(counts['drafts'], 1)
        self.assertEqual(counts['published'], 1)
        self.assertEqual(len(pushed), 1)
        payload = pushed[0]
        self.assertEqual(payload['kind'], 'autonomous_notice')
        self.assertEqual(payload['decision'], 'accepted')
        self.assertIsNotNone(payload['draftEnvelope'])
        self.assertEqual(
            payload['draftEnvelope']['review']['automated_decision']['decision'],
            'accepted',
        )
        self.assertEqual(payload['posts'][0]['minEducation'], 'Postgraduate with B.Ed.')
        self.assertEqual(payload['posts'][0]['applicationLastDate'], '2026-12-15')


if __name__ == '__main__':
    unittest.main()
