"""Stage 6: bounded attempts survive restarts and completed AI work is retained."""
import tempfile
import unittest
from pathlib import Path

from stage_retry import StageRetries
from extraction_checkpoint import extract_or_resume
from test_notice_state import sample_prepared
from generic_pipeline import run_pipeline
import json
import httpx
from unittest.mock import Mock, patch
from extract_bundle import request_structured, ProviderRequestError
from capture_retry import capture_with_retry
import test_shared_pipeline
from shared_pipeline import prepare_source
from recover_documents import recover_one


class StageRetryTests(unittest.TestCase):
    def test_recovered_annexure_rejoins_notice_on_later_scheduler_run(self):
        fixture = test_shared_pipeline.SharedPipelineTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        fixture.pages['/notice'] = ('html', '<html><h1>Recruitment Notice</h1>' +
            ''.join(f'<p>{line}</p>' for line in fixture.identity[1:]) +
            '<p>Qualification degree.</p><a href="/update">Corrigendum</a></html>')
        fixture.pages['/update'] = ('html', '<html><h1>Corrigendum</h1>' +
            ''.join(f'<p>{line}</p>' for line in fixture.identity[1:]) +
            '<p>Vacancies have been updated in Annexure I. All other terms remain unchanged.</p>' +
            '<a href="/files/details">Annexure I</a></html>')
        fixture.pages['/files/details'] = ('pdf', test_shared_pipeline.pdf_bytes(
            ['Vacancy Annexure I'] + fixture.identity[1:] + ['Vacancies 10. Qualification degree.']))
        source = {'id': 'board', 'url': fixture.base + '/notice', 'enabled': True,
                  'kind': 'official', 'reason': None}
        root = fixture.root / 'recovery-run'
        first = prepare_source(source, root, process=fixture.process, max_fetches=2)
        prepared = [json.loads(Path(p).read_text()) for p in first['prepared_paths']]
        self.assertTrue(any(p['coverage']['status'] == 'waiting_for_document' for p in prepared))
        def recover(queue, target):
            return recover_one(queue, target, process=fixture.process)
        with patch('shared_pipeline.recover_one', side_effect=recover):
            second = prepare_source(source, root, process=fixture.process, max_fetches=2)
        prepared = [json.loads(Path(p).read_text()) for p in second['prepared_paths']]
        ready = [p for p in prepared if p.get('llm_input')]
        self.assertEqual(len(ready), 1)
        self.assertEqual(len(ready[0]['llm_input']['input']['documents']), 3)

    def test_uncertain_generation_after_crash_requires_review(self):
        with tempfile.TemporaryDirectory() as directory:
            clock = [1000]
            retries = StageRetries(directory, lambda: clock[0])
            self.assertTrue(retries.begin('extraction', 'fp'))
            clock[0] += 301
            self.assertFalse(retries.begin('extraction', 'fp'))
            self.assertEqual(retries.read('extraction', 'fp')['reason'], 'provider_completion_uncertain')

    def test_capture_backoff_avoids_immediate_refetch(self):
        with tempfile.TemporaryDirectory() as directory:
            calls = []
            def fetch(*_args, **_kwargs):
                calls.append('HTTP')
                return None, 'ConnectTimeout', True
            capture_with_retry('https://example.invalid/notice', Path(directory), fetch, 'board')
            capture_with_retry('https://example.invalid/notice', Path(directory), fetch, 'board')
            self.assertEqual(calls, ['HTTP'])

    def test_provider_retry_after_and_network_uncertainty(self):
        with patch.dict('os.environ', {'DEEPSEEK_API_KEY': 'illustrative-test-key'}, clear=True):
            client = Mock()
            client.post.return_value = httpx.Response(429, headers={'retry-after': '120'})
            with self.assertRaises(ProviderRequestError) as caught:
                request_structured({}, {}, 'Extract only cited facts', provider='deepseek', client=client)
            self.assertTrue(caught.exception.retryable)
            self.assertEqual(caught.exception.retry_after, 120)
            for failure, expected in [(httpx.ConnectTimeout('fixture'), True), (httpx.ReadTimeout('fixture'), False)]:
                client.post.side_effect = failure
                with self.assertRaises(ProviderRequestError) as caught:
                    request_structured({}, {}, 'Extract only cited facts', provider='deepseek', client=client)
                self.assertEqual(caught.exception.retryable, expected)

    def test_successful_response_survives_draft_failure_without_second_ai_call(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / 'prepared.json'
            path.write_text(json.dumps(sample_prepared()))
            calls = []
            options = dict(
                prepare=lambda *_args, **_kwargs: [{'source': 'board', 'status': 'scanned',
                    'prepared_paths': [str(path)]}],
                extract=lambda _: calls.append('AI') or {'bundle_id': 'bnd_101', 'facts': {}},
                validate=lambda *_: {'status': 'needs_review', 'disposition': 'valid_recruitment_review_draft'})
            def broken(*_args, **_kwargs):
                raise OSError('Illustrative storage failure')
            first = run_pipeline(root, **options, draft=broken)
            self.assertEqual(first['sources']['board']['failed'], 1)
            second = run_pipeline(root, **options, draft=lambda *_args, **_kwargs: {'bundle_id': 'bnd_101'})
            self.assertEqual(second['sources']['board']['drafts'], 1)
            self.assertEqual(second['sources']['board']['checkpoint_reused'], 1)
            self.assertEqual(calls, ['AI'])

    def test_provider_backoff_and_corrupt_checkpoint_do_not_repeat_ai(self):
        with tempfile.TemporaryDirectory() as directory:
            clock = [1000]
            retries = StageRetries(directory, lambda: clock[0])
            calls = []
            def unavailable(_):
                calls.append('AI')
                raise RuntimeError('provider_http_503')
            with self.assertRaises(RuntimeError):
                extract_or_resume(retries, 'fp', sample_prepared(), unavailable)
            self.assertEqual(extract_or_resume(retries, 'fp', sample_prepared(), unavailable), (None, False))
            clock[0] += 31
            result, resumed = extract_or_resume(retries, 'fp', sample_prepared(),
                lambda _: {'bundle_id': 'bnd_101'})
            self.assertFalse(resumed)
            retries.path('extraction', 'fp').with_suffix('.response.json').write_text('{}')
            self.assertEqual(extract_or_resume(retries, 'fp', sample_prepared(), unavailable), (None, False))
            self.assertEqual(calls, ['AI'])

    def test_backoff_restart_and_exhaustion(self):
        with tempfile.TemporaryDirectory() as directory:
            clock = [1000]
            retries = StageRetries(directory, lambda: clock[0])
            for attempt in range(1, 4):
                self.assertTrue(retries.begin('extraction', 'fingerprint'))
                retries.failure('extraction', 'fingerprint', 'provider_http_503', retryable=True)
                restarted = StageRetries(directory, lambda: clock[0])
                self.assertFalse(restarted.begin('extraction', 'fingerprint'))
                self.assertEqual(restarted.read('extraction', 'fingerprint')['attempts'], attempt)
                clock[0] += 60 * attempt
            self.assertFalse(retries.begin('extraction', 'fingerprint'))
            self.assertTrue(retries.begin('extraction', 'new_evidence_fingerprint'))

    def test_permanent_failure_never_retries_and_success_restarts_capture_cycle(self):
        with tempfile.TemporaryDirectory() as directory:
            retries = StageRetries(directory)
            self.assertTrue(retries.begin('capture', 'notice'))
            retries.failure('capture', 'notice', 'invalid_pdf')
            self.assertFalse(retries.begin('capture', 'notice'))
            self.assertTrue(retries.begin('capture', 'other'))
            retries.success('capture', 'other')
            self.assertTrue(retries.begin('capture', 'other'))
            self.assertEqual(retries.read('capture', 'other')['attempts'], 1)


if __name__ == '__main__':
    unittest.main()
