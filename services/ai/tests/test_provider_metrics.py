import unittest
from unittest.mock import Mock, patch
import httpx

from extract_bundle import request_structured
from provider_metrics import track_provider_requests
from provider_schedule import ProviderDeferred


class ProviderMetricsTests(unittest.TestCase):
    def test_missing_credentials_do_not_count_a_request(self):
        with track_provider_requests() as counts:
            with patch('extract_bundle.provider_keys', return_value=[]), patch('extract_bundle.provider_off_peak_delay', return_value=0):
                with self.assertRaisesRegex(RuntimeError, 'provider_credential_unavailable'):
                    request_structured({}, {}, '', provider='deepseek')
        self.assertEqual(counts, {'attempted': 0, 'succeeded': 0, 'failed': 0})

    def test_off_peak_deferral_does_not_count_a_request(self):
        with track_provider_requests() as counts:
            with patch('extract_bundle.provider_off_peak_delay', return_value=60):
                with self.assertRaises(ProviderDeferred):
                    request_structured({}, {}, '', provider='deepseek')
        self.assertEqual(counts['attempted'], 0)

    def test_successful_http_with_invalid_json_still_counts_http_success(self):
        client = Mock()
        client.post.return_value = httpx.Response(200, json={'choices': [{'finish_reason': 'stop', 'message': {'content': 'invalid json'}}]})
        with track_provider_requests() as counts:
            with patch('extract_bundle.provider_keys', return_value=['fixture']), patch('extract_bundle.provider_off_peak_delay', return_value=0):
                with self.assertRaisesRegex(RuntimeError, 'provider_json_invalid'):
                    request_structured({}, {}, '', provider='deepseek', client=client)
        self.assertEqual(counts, {'attempted': 1, 'succeeded': 1, 'failed': 0})

    def test_transport_failure_counts_one_attempt(self):
        client = Mock()
        client.post.side_effect = httpx.ConnectError('fixture')
        with track_provider_requests() as counts:
            with patch('extract_bundle.provider_keys', return_value=['fixture']), patch('extract_bundle.provider_off_peak_delay', return_value=0):
                with self.assertRaises(RuntimeError):
                    request_structured({}, {}, '', provider='deepseek', client=client)
        self.assertEqual(counts, {'attempted': 1, 'succeeded': 0, 'failed': 1})

    def test_pipeline_reports_preflight_failure_without_http_requests(self):
        import json
        from pathlib import Path
        from tempfile import TemporaryDirectory
        from generic_pipeline import run_pipeline
        from test_worker_recovery_and_reporting import WorkerRecoveryAndReportingTests
        with TemporaryDirectory() as directory:
            root = Path(directory)
            prepared = WorkerRecoveryAndReportingTests()._sample_prepared_bundle()
            path = root / 'fixture.prepared.json'
            path.write_text(json.dumps(prepared))
            sources = [{'source': 'fixture', 'status': 'prepared_for_review',
                        'prepared_inputs': 1, 'prepared_paths': [str(path)]}]
            def extract(_):
                return request_structured({}, {}, '', provider='deepseek')
            with patch('extract_bundle.provider_keys', return_value=[]), patch('extract_bundle.provider_off_peak_delay', return_value=0):
                report = run_pipeline(root, prepare=lambda *args, **kwargs: sources, extract=extract)
            self.assertEqual(report['summary']['provider_requests'],
                             {'attempted': 0, 'succeeded': 0, 'failed': 0})
            self.assertEqual(report['summary']['extractions']['failed'], 1)
