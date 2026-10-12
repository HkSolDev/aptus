import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from recovery_queue import RecoveryQueue
from recover_documents import recover_one, capture_and_normalize, recover_due


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)
        self.queue = RecoveryQueue(self.path / 'queue.db')
        self.url = 'https://example.org/annexure.pdf'

    def test_shared_url_restart_and_resume(self):
        self.queue.request('A', [self.url + '#page=1', self.url])
        self.queue.request('B', [self.url])
        task = self.queue.claim_next(now=100)
        self.assertIsNone(self.queue.claim_next(now=101))
        self.assertTrue(self.queue.finish(task, result={'content_path': 'selected.json'}, now=102))
        reopened = RecoveryQueue(self.path / 'queue.db')
        for bundle in ['A', 'B']:
            result = reopened.bundle(bundle)
            self.assertEqual(result['status'], 'ready_for_coverage')
            self.assertEqual(len(result['tasks']), 1)
            self.assertEqual(result['tasks'][0]['attempts'], 1)

    def test_retry_does_not_hold_up_other_bundle(self):
        self.queue.request('A', [self.url])
        task = self.queue.claim_next(now=100)
        self.queue.finish(task, reason='ReadTimeout', retryable=True, now=101)
        self.queue.request('B', ['https://example.org/other.pdf'])
        other = self.queue.claim_next(now=102)
        self.assertNotEqual(task['url'], other['url'])
        self.queue.finish(other, result={'ok': True}, now=103)
        self.assertEqual(self.queue.bundle('B')['status'], 'ready_for_coverage')
        self.assertEqual(self.queue.bundle('A')['status'], 'waiting_for_document')
        self.assertIsNone(self.queue.claim_next(now=130))
        task = self.queue.claim_next(now=131)
        self.queue.finish(task, reason='ReadTimeout', retryable=True, now=132)
        task = self.queue.claim_next(now=192)
        self.queue.finish(task, reason='ReadTimeout', retryable=True, now=193)
        self.assertEqual(self.queue.bundle('A')['status'], 'needs_review')
        self.assertIsNone(self.queue.claim_next(now=9999))

    def test_crash_reclaim_and_stale_completion(self):
        self.queue.request('A', [self.url])
        first = self.queue.claim_next(now=100)
        second = self.queue.claim_next(now=400)
        self.assertEqual(second['attempts'], 2)
        self.assertFalse(self.queue.finish(first, result={'old': True}, now=401))
        self.assertTrue(self.queue.finish(second, result={'new': True}, now=402))

    def test_repeated_crashes_are_bounded(self):
        self.queue.request('A', [self.url])
        for now in [100, 400, 700]:
            self.assertIsNotNone(self.queue.claim_next(now=now))
        self.assertIsNone(self.queue.claim_next(now=1000))
        self.assertEqual(self.queue.bundle('A')['status'], 'needs_review')

    def test_concurrent_workers_claim_once(self):
        self.queue.request('A', [self.url])
        with ThreadPoolExecutor(max_workers=4) as pool:
            tasks = list(pool.map(lambda _: self.queue.claim_next(now=100), range(4)))
        self.assertEqual(sum(task is not None for task in tasks), 1)

    def test_query_identity_and_invalid_input(self):
        self.queue.request('A', [self.url + '?id=1', self.url + '?id=2'])
        self.assertEqual(len(self.queue.bundle('A')['tasks']), 2)
        for url in ['file:///tmp/notice.pdf', 'https://user:pass@example.org/a', None]:
            with self.assertRaises(ValueError):
                self.queue.request('B', [url])
        self.assertEqual(self.queue.bundle('B')['status'], 'not_requested')

    def test_permanent_failure_and_late_dependency(self):
        self.queue.request('A', [self.url])
        task = self.queue.claim_next(now=100)
        self.queue.finish(task, reason='login_required', now=101)
        self.queue.request('B', [self.url])
        self.assertEqual(self.queue.bundle('B')['status'], 'needs_review')
        self.assertIsNone(self.queue.claim_next(now=1000))

    def test_worker_failure_does_not_leak_exception(self):
        self.queue.request('A', [self.url])
        def broken(url, root):
            raise RuntimeError('sensitive diagnostic must not be saved')
        output = recover_one(self.queue, self.path, process=broken)
        self.assertEqual(output['reason'], 'processing_failed')
        self.assertEqual(self.queue.bundle('A')['status'], 'needs_review')

    def test_real_html_normalizer_handoff(self):
        body = self.path / 'body.html'
        body.write_bytes(b'<html><h1>Recruitment</h1><p>Qualifications: degree</p></html>')
        captured = {'outcome': 'changed', 'body_path': str(body), 'final_url': self.url,
                    'snapshot_id': 'sample', 'sha256': 'sample-hash',
                    'snapshot': {'document_kind': 'html'}}
        self.queue.request('A', [self.url])
        with patch('recover_documents.capture', return_value=captured):
            output = recover_one(self.queue, self.path)
        self.assertTrue(output['completion_accepted'])
        result = self.queue.bundle('A')['tasks'][0]['result']
        self.assertIn('Qualifications', Path(result['content_path']).read_text())
        self.assertTrue(Path(result['normalized_path']).is_file())

    def test_http_failure_classification(self):
        for status, retryable in [(503, True), (429, True), (404, False), (403, False)]:
            with patch('recover_documents.capture', return_value={
                    'outcome': 'failed', 'reason': 'HTTPStatusError', 'http_status': status}):
                result, reason, retry = capture_and_normalize(self.url, self.path)
            self.assertIsNone(result)
            self.assertEqual(retry, retryable)

    def test_empty_process_worker_batch(self):
        self.assertEqual(recover_due(self.queue, self.path, workers=2, limit=2), [])

    def test_pdf_retains_full_and_selected_evidence(self):
        import json
        body = self.path / 'body.pdf'
        body.write_bytes(b'%PDF-placeholder')
        captured = {'outcome': 'changed', 'body_path': str(body), 'final_url': self.url,
                    'snapshot_id': 'sample', 'sha256': 'sample-hash',
                    'snapshot': {'document_kind': 'pdf'}}
        full = {'format': 'pdf', 'pages': [{'number': 1, 'native_status': 'usable_candidate',
                    'block_ids': ['page-1-native']}], 'warnings': [], 'blocks': [{
                    'id': 'page-1-native', 'page': 1, 'bbox': [0, 0, 100, 100],
                    'tables': [], 'alternatives': [{'method': 'native_text', 'status': 'candidate',
                    'text': 'Recruitment\nEducational Qualifications\nDegree required'}]}]}
        with patch('recover_documents.capture', return_value=captured), \
                patch('recover_documents.normalize_pdf', return_value=full):
            result, reason, retry = capture_and_normalize(self.url, self.path)
        self.assertIsNone(reason)
        self.assertFalse(retry)
        self.assertEqual(json.loads(Path(result['normalized_path']).read_text()), full)
        selected = json.loads(Path(result['content_path']).read_text())
        self.assertIn('Degree required', json.dumps(selected))
        self.assertIn('coverage', selected)


if __name__ == '__main__':
    unittest.main()
