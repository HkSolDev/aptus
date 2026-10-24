"""Stage 4 acceptance: source readiness, provider boundaries, and reuse outcomes.

Requirements are fixed independently of the Stage 4 implementation. Network and
post-extraction services are replaced; evidence preparation and gating are real.
"""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from build_extraction_input import is_extraction_approved, prepare_extraction
from extract_bundle import extract_bundle
from generic_pipeline import run_pipeline
from recovery_queue import RecoveryQueue
from shared_pipeline import prepare_source


BASE = 'https://board.example.gov.in'
TEXT = 'Post: Engineer. Applicants require professional registration.'


def notice():
    return {
        'bundle_id': 'stage4-engineers', 'status': 'candidate_for_extraction',
        'identity': {'issuer': 'Example Board', 'campaign': 'Engineers',
                     'advertisement_number': 'EB/01/2026', 'year': '2026'},
        'review_reasons': [],
        'documents': [{
            'document_id': 'main', 'source_url': BASE + '/main.pdf',
            'format': 'pdf', 'role': 'main_notice',
            'authority': 'official_host_candidate', 'review_reasons': [],
            'content': {'title': 'Recruitment Notice', 'sections': [
                {'text': TEXT, 'evidence': [{'page': 1}]}], 'coverage': {}},
        }],
    }


def with_dependency():
    bundle = notice()
    quote = 'Eligibility requirements are in Annexure I.'
    bundle['documents'][0]['content']['sections'][0]['text'] += '\n' + quote
    bundle['documents'][0]['content']['links'] = [
        {'url': BASE + '/annexure.pdf', 'text': 'Annexure I', 'page': 1}]
    gap = {'url': BASE + '/annexure.pdf', 'source_document_id': 'main',
           'quote': quote, 'fields': ['education']}
    return bundle, gap


class GateAssertions(unittest.TestCase):
    def assert_blocked(self, prepared, reason=None, status='needs_review'):
        self.assertEqual(prepared['coverage']['status'], status)
        self.assertIsNone(prepared['llm_input'])
        self.assertTrue(prepared['coverage']['review_reasons'])
        if reason:
            self.assertIn(reason, prepared['coverage']['review_reasons'])
        with patch('extract_bundle.request_structured') as provider:
            with self.assertRaises(ValueError):
                extract_bundle(prepared)
            self.assertEqual(provider.call_count, 0)


class EvidenceReadinessTests(GateAssertions):
    def test_unstated_age_dates_and_salary_do_not_block(self):
        prepared = prepare_extraction(notice())
        self.assertEqual(prepared['coverage']['status'], 'ready_for_extraction')
        self.assertIsNotNone(prepared['llm_input'])
        self.assertIn('age', prepared['coverage']['coverage_focus'])
        self.assertIn(TEXT, json.dumps(prepared['llm_input']))

    def test_grouping_blockers_apply_to_direct_preparation(self):
        for reason in ('conflicting_campaign', 'ambiguous_amendment_target',
                       'multiple_main_documents_need_comparison', 'missing_main_notice'):
            with self.subTest(reason=reason):
                bundle = notice()
                bundle['review_reasons'] = [reason]
                if reason == 'missing_main_notice':
                    extra = copy.deepcopy(bundle['documents'][0])
                    extra['document_id'] = 'support'
                    extra['source_url'] += '?support=1'
                    bundle['documents'].append(extra)
                self.assert_blocked(prepare_extraction(bundle), reason)

    def test_existing_review_decision_without_reason_is_not_upgraded(self):
        bundle = notice()
        bundle['status'] = 'needs_review'
        self.assert_blocked(prepare_extraction(bundle))

    def test_each_explicit_content_gap_blocks(self):
        for key, value in (('unreadable_pages', [2]), ('unavailable_blocks', ['b2']),
                           ('omitted_sections', [{'id': 's2', 'reason': 'character_budget_exceeded'}])):
            with self.subTest(key=key):
                bundle = notice()
                bundle['documents'][0]['content']['coverage'][key] = value
                self.assert_blocked(prepare_extraction(bundle), 'content_coverage_gap')

    def test_selection_budget_exceeded_blocks_even_with_readable_text(self):
        bundle = notice()
        bundle['documents'][0]['content']['status'] = 'budget_exceeded'
        self.assert_blocked(prepare_extraction(bundle), 'content_budget_exceeded')

    def test_amendment_cannot_replace_substantive_main_evidence(self):
        for mode in ('empty', 'identity_only', 'link_only', 'unlocated'):
            with self.subTest(mode=mode):
                bundle = notice()
                main = bundle['documents'][0]
                support = copy.deepcopy(main)
                support.update(document_id='update', role='corrigendum', source_url=BASE + '/update.pdf')
                bundle['documents'].append(support)
                main['content']['sections'] = []
                if mode == 'identity_only':
                    main['content']['identity_context'] = {'text': 'Example Board Engineers', 'evidence': [{'page': 1}]}
                elif mode == 'link_only':
                    main['content']['links'] = [{'url': BASE + '/apply', 'text': 'Apply', 'page': 1}]
                elif mode == 'unlocated':
                    main['content']['sections'] = [{'text': TEXT, 'evidence': []}]
                self.assert_blocked(prepare_extraction(bundle), 'main_notice_unreadable')

    def test_readable_html_main_and_pdf_can_be_complementary(self):
        bundle = notice()
        html = copy.deepcopy(bundle['documents'][0])
        html.update(document_id='html', source_url=BASE + '/notice', format='html')
        html['content'] = {'title': 'Recruitment Notice', 'blocks': [{'type': 'paragraph', 'text': TEXT}]}
        bundle['documents'].append(html)
        self.assertIsNotNone(prepare_extraction(bundle)['llm_input'])

    def test_authority_warning_and_generic_reference_are_not_new_blockers(self):
        bundle = notice()
        bundle['review_reasons'] = ['authority_needs_review']
        bundle['documents'][0]['content']['coverage']['unresolved_references'] = ['Appendix II']
        self.assertIsNotNone(prepare_extraction(bundle)['llm_input'])

    def test_preparation_preserves_text_tables_and_locations(self):
        bundle = notice()
        table = {'document_id': 'table', 'format': 'html', 'source_url': BASE + '/annexure',
                 'role': 'vacancy_annexure', 'content': {'blocks': [
                     {'type': 'table', 'rows': [['Category', 'Posts'], ['SC', '3'], ['General', '7']]}]}}
        bundle['documents'].append(table)
        before = copy.deepcopy(bundle)
        prepared = prepare_extraction(bundle)
        self.assertEqual(bundle, before)
        docs = {doc['document_id']: doc for doc in prepared['llm_input']['input']['documents']}
        self.assertEqual(docs['main']['sections'][0]['text'], TEXT)
        self.assertEqual(docs['main']['sections'][0]['locations'], [{'page': 1}])
        self.assertEqual(docs['table']['sections'][0]['rows'], table['content']['blocks'][0]['rows'])


class RecoveryGateTests(GateAssertions):
    def test_initial_dependency_waits_and_second_pass_stays_blocked(self):
        bundle, gap = with_dependency()
        self.assert_blocked(prepare_extraction(bundle, missing_documents=[gap]),
                            'missing_referenced_document', 'waiting_for_document')
        self.assert_blocked(prepare_extraction(bundle, missing_documents=[gap], recovery_pass=1),
                            'missing_referenced_document')

    def test_failed_recovery_keeps_dependency_details_without_third_request(self):
        bundle, gap = with_dependency()
        with tempfile.TemporaryDirectory() as root:
            queue = RecoveryQueue(Path(root) / 'queue.db')
            prepare_extraction(bundle, missing_documents=[gap], recovery_queue=queue)
            task = queue.claim_next()
            self.assertIsNotNone(task)
            queue.finish(task, reason='login_required')
            prepared = prepare_extraction(bundle, missing_documents=[gap], recovery_queue=queue)
            self.assert_blocked(prepared, 'document_recovery_failed')
            dependency = prepared['coverage']['missing_documents'][0]
            for field in ('url', 'quote', 'fields', 'source_document_id'):
                self.assertEqual(dependency[field], gap[field])
            self.assertIsNone(queue.claim_next())

    def test_grouping_block_takes_precedence_over_waiting(self):
        bundle, gap = with_dependency()
        bundle['review_reasons'] = ['conflicting_campaign']
        self.assert_blocked(prepare_extraction(bundle, missing_documents=[gap]), 'conflicting_campaign')

    def test_usable_recovered_dependency_clears_missing_blocker(self):
        bundle, gap = with_dependency()
        recovered = copy.deepcopy(bundle['documents'][0])
        recovered.update(document_id='annexure', role='vacancy_annexure', source_url=gap['url'])
        recovered['content'] = {'sections': [{'text': 'Education: professional registration.', 'evidence': [{'page': 1}]}]}
        bundle['documents'].append(recovered)
        prepared = prepare_extraction(bundle, missing_documents=[gap], recovery_pass=1)
        self.assertEqual(prepared['coverage']['missing_documents'], [])
        self.assertIsNotNone(prepared['llm_input'])


class CrawlAndBudgetTests(GateAssertions):
    def test_partial_crawl_warns_and_offline_preparation_remains_supported(self):
        partial = prepare_extraction(notice(), crawl={'status': 'partial'})
        self.assertTrue(is_extraction_approved(partial))
        self.assertIn('source_crawl_partial', partial['coverage']['review_reasons'])
        self.assertIsNotNone(prepare_extraction(notice())['llm_input'])
        self.assertIsNotNone(prepare_extraction(notice(), crawl={'status': 'scanned'})['llm_input'])

    def test_malformed_or_conflicting_crawl_context_cannot_approve(self):
        for context in ({'crawl': []}, {'crawl': {}}, {'crawl_status': 123},
                        {'crawl': {'status': 'partial'}, 'crawl_status': 'scanned'}):
            with self.subTest(context=context):
                try:
                    prepared = prepare_extraction(notice(), **context)
                except ValueError:
                    continue
                self.assert_blocked(prepared)

    def test_complete_envelope_budget_boundary_without_mutation(self):
        bundle = notice()
        before = copy.deepcopy(bundle)
        size = prepare_extraction(bundle)['input_characters']
        self.assertIsNotNone(prepare_extraction(bundle, max_characters=size)['llm_input'])
        self.assert_blocked(prepare_extraction(bundle, max_characters=size - 1), 'llm_input_budget_exceeded')
        self.assertEqual(bundle, before)

    def test_shared_worker_forwards_real_crawl_status(self):
        source = {'id': 'stage4_board', 'url': BASE, 'enabled': True, 'kind': 'official', 'reason': None}
        bundle = notice()
        text = 'Recruitment Notice\nIssuer: Example Board\nCampaign: Engineers\nAdvertisement No: EB/01/2026\n' + TEXT
        bundle['documents'][0]['content']['sections'][0]['text'] = text
        crawl = {'status': 'partial', 'documents': bundle['documents'], 'pages': [], 'edges': [], 'unchecked': []}
        with tempfile.TemporaryDirectory() as root, patch('shared_pipeline.crawl_source', return_value=crawl):
            result = prepare_source(source, root, issuer_hosts={'Example Board': ['board.example.gov.in']})
            self.assertTrue(result['prepared_paths'])
            for path in result['prepared_paths']:
                prepared = json.loads(Path(path).read_text())
                self.assertTrue(is_extraction_approved(prepared))
                self.assertIn('source_crawl_partial', prepared['coverage']['review_reasons'])


class ExtractionBoundaryTests(unittest.TestCase):
    def test_stale_or_malformed_approval_never_calls_provider(self):
        valid = prepare_extraction(notice())
        variants = []
        for status in ('needs_review', 'waiting_for_document'):
            item = copy.deepcopy(valid)
            item['coverage']['status'] = status
            item['llm_input']['input']['coverage']['status'] = status
            variants.append(item)
        item = copy.deepcopy(valid)
        item['llm_input']['input']['coverage']['status'] = 'needs_review'
        variants.append(item)
        for field in ('coverage', 'llm_input'):
            item = copy.deepcopy(valid)
            del item[field]
            variants.append(item)
        item = copy.deepcopy(valid)
        item['coverage']['missing_documents'] = [{'url': BASE + '/missing.pdf'}]
        item['llm_input']['input']['coverage'] = copy.deepcopy(item['coverage'])
        variants.append(item)
        item = copy.deepcopy(valid)
        item['llm_input']['input']['documents'] = []
        variants.append(item)
        for index, item in enumerate(variants):
            with self.subTest(index=index), patch('extract_bundle.request_structured') as provider:
                with self.assertRaises(ValueError):
                    extract_bundle(item)
                self.assertEqual(provider.call_count, 0)

    def test_all_coverage_fields_must_agree(self):
        prepared = prepare_extraction(notice())
        prepared['llm_input']['input']['coverage'] = copy.deepcopy(prepared['coverage'])
        prepared['llm_input']['input']['coverage']['recovery_pass'] = 1
        with patch('extract_bundle.request_structured') as provider:
            with self.assertRaises(ValueError):
                extract_bundle(prepared)
            self.assertEqual(provider.call_count, 0)

    def test_invalid_location_entries_never_reach_provider(self):
        for kind in ('html', 'pdf'):
            key = 'block' if kind == 'html' else 'page'
            bad_values = (None, {}, {key: None}, {key: True}, {key: -1},
                          {key: '1'}, {'unrelated': 1})
            if kind == 'pdf':
                bad_values += ({'page': 0},)
            for location in bad_values:
                with self.subTest(kind=kind, location=location):
                    prepared = prepare_extraction(notice())
                    doc = prepared['llm_input']['input']['documents'][0]
                    doc['format'] = kind
                    doc['sections'][0]['locations'] = [location]
                    with patch('extract_bundle.request_structured') as provider:
                        with self.assertRaises(ValueError):
                            extract_bundle(prepared)
                        self.assertEqual(provider.call_count, 0)

    def test_approved_input_reaches_provider_boundary(self):
        with patch('extract_bundle.request_structured', side_effect=RuntimeError('offline sentinel')) as provider:
            with self.assertRaisesRegex(RuntimeError, 'offline sentinel'):
                extract_bundle(prepare_extraction(notice()))
            provider.assert_called_once()


class WorkerReuseAndReportTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.extract_calls = Mock(side_effect=self.extract)

    def extract(self, prepared):
        source = prepared['llm_input']['input']
        unit = source['documents'][0]['sections'][0]
        from services.ai.tests.test_inline_extraction import response
        from inline_extraction import decode_inline
        wire = response()
        wire['document_purposes'] = []
        wire['amendment'] = None
        wire['purpose_evidence'] = [{'evidence_id': unit['evidence_id'], 'quote': 'Engineer'}]
        for value in wire['posts'][0].values():
            if isinstance(value, dict) and value.get('value') == 'Engineer':
                value['evidence'][0]['evidence_id'] = unit['evidence_id']
                value['scope_evidence'][0]['evidence_id'] = unit['evidence_id']
        facts, _ = decode_inline(wire, source)
        return {'bundle_id': source['bundle_id'], 'facts': facts}

    def run_input(self, prepared, **options):
        path = self.root / 'prepared.json'
        path.write_text(json.dumps(prepared))
        def prepare(_root, **_options):
            return [{'source': 'stage4_board', 'status': 'prepared_for_review',
                     'prepared_inputs': int(bool(prepared.get('llm_input'))), 'prepared_paths': [str(path)]}]
        report = run_pipeline(self.root, prepare=prepare, extract=self.extract_calls,
                              validate=lambda *_: {'status': 'needs_review', 'disposition': 'valid_recruitment_review_draft'},
                              draft=lambda result, _source, **_: result, **options)
        return report['sources']['stage4_board']

    def test_unchanged_reuses_and_changed_evidence_extracts_with_outcomes(self):
        prepared = prepare_extraction(notice())
        first = self.run_input(prepared)
        self.assertEqual(first['extracted'], 1)
        second = self.run_input(prepared)
        self.assertEqual(self.extract_calls.call_count, 1)
        self.assertEqual(second['reused'], 1)
        self.assertIn({'bundle_id': 'stage4-engineers', 'outcome': 'reused',
                       'disposition': 'valid_recruitment_review_draft',
                       'reasons': ['unchanged_evidence_fingerprint']}, second['bundle_outcomes'])
        bundle = notice()
        bundle['documents'][0]['content']['sections'][0]['text'] += ' Vacancies: 7.'
        third = self.run_input(prepare_extraction(bundle))
        self.assertEqual(self.extract_calls.call_count, 2)
        self.assertEqual(third['extracted'], 1)
        self.assertEqual(third['published'], 0)
        self.assertTrue(any(item['outcome'] == 'extracted' for item in third['bundle_outcomes']))

    def test_blocked_stale_payload_cannot_reuse_previous_success(self):
        prepared = prepare_extraction(notice())
        self.run_input(prepared)
        prepared['coverage']['status'] = 'needs_review'
        prepared['coverage']['review_reasons'] = ['content_coverage_gap']
        prepared['llm_input']['input']['coverage'] = copy.deepcopy(prepared['coverage'])
        counts = self.run_input(prepared)
        self.assertEqual(self.extract_calls.call_count, 1)
        self.assertEqual(counts['reused'], 0)
        self.assertEqual(counts['blocked'], 1)
        self.assertTrue(any(item['outcome'] == 'blocked' and 'content_coverage_gap' in item['reasons']
                            for item in counts['bundle_outcomes']))

    def test_malformed_artifact_records_failure_and_processes_valid_sibling(self):
        bad = self.root / 'bad.prepared.json'
        bad.write_text('[]')
        good = self.root / 'good.prepared.json'
        good.write_text(json.dumps(prepare_extraction(notice())))
        def prepare(_root, **_options):
            return [{'source': 'stage4_board', 'status': 'prepared_for_review',
                     'prepared_inputs': 1, 'prepared_paths': [str(bad), str(good)]}]
        report = run_pipeline(self.root, prepare=prepare, extract=self.extract_calls,
                              validate=lambda *_: {'status': 'needs_review', 'disposition': 'valid_recruitment_review_draft'},
                              draft=lambda result, _source, **_: result)
        counts = report['sources']['stage4_board']
        self.assertEqual(counts['failed'], 1)
        self.assertEqual(counts['extracted'], 1)
        self.assertEqual(self.extract_calls.call_count, 1)
        self.assertIn({'bundle_id': 'bad', 'outcome': 'failed',
                       'reasons': ['failed_at_prepared_input']}, counts['bundle_outcomes'])

    def test_prepare_only_never_extracts_or_creates_success_state(self):
        counts = self.run_input(prepare_extraction(notice()), prepare_only=True)
        self.extract_calls.assert_not_called()
        self.assertEqual(counts['published'], 0)
        self.assertEqual(list((self.root / 'drafts').glob('*.json')), [])
        self.assertEqual(list((self.root / 'state' / 'notices').glob('*.json')), [])

    def test_each_gate_failure_records_bundle_and_reason_without_extraction(self):
        for reason in ('conflicting_campaign', 'content_coverage_gap'):
            with self.subTest(reason=reason):
                bundle = notice()
                if reason == 'conflicting_campaign':
                    bundle['review_reasons'] = [reason]
                else:
                    bundle['documents'][0]['content']['coverage'] = {'unreadable_pages': [2]}
                counts = self.run_input(prepare_extraction(bundle))
                self.assertEqual(counts['blocked'], 1)
                self.assertTrue(any(item.get('bundle_id') == bundle['bundle_id'] and reason in item['reasons']
                                    for item in counts['bundle_outcomes']))
        self.extract_calls.assert_not_called()


if __name__ == '__main__':
    unittest.main()
