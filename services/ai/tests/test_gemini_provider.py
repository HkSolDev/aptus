import json
import os
import unittest
from unittest.mock import Mock, patch

import httpx

from extract_bundle import provider_keys
from providers.gemini import GeminiProvider, gemini_api_key, gemini_api_keys


class GeminiProviderTests(unittest.TestCase):
    def test_numbered_key_is_supported_without_exposing_it(self):
        with patch.dict(os.environ, {'GEMINI_API_KEY_1': 'illustrative-key'}, clear=True):
            self.assertEqual(gemini_api_key(), 'illustrative-key')

    def test_missing_key_fails_closed(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, 'provider_credential_unavailable'):
                gemini_api_key()

    def test_gemini_api_keys_trims_orders_and_deduplicates_across_env_vars(self):
        env = {
            'GEMINI_API_KEYS': ' key-a , key-b , , key-a ',
            'GEMINI_API_KEY': 'key-b, key-c ',
            'GEMINI_API_KEY_2': 'key-e',
            'GEMINI_API_KEY_1': 'key-c, key-d',
        }
        with patch.dict(os.environ, env, clear=True):
            self.assertEqual(gemini_api_keys(), ['key-a', 'key-b', 'key-c', 'key-d', 'key-e'])
            self.assertEqual(provider_keys('gemini'), ['key-a', 'key-b', 'key-c', 'key-d', 'key-e'])

    def test_429_resource_exhausted_rotates_once_per_key_without_logging_keys(self):
        r429 = httpx.Response(429, json={'error': {'status': 'RESOURCE_EXHAUSTED'}})
        r200 = httpx.Response(200, json={
            'candidates': [{'finishReason': 'STOP', 'content': {'parts': [{'text': '{"ok": true}'}]}}],
            'usageMetadata': {'totalTokenCount': 12},
        })
        client = Mock()
        client.post.side_effect = [r429, r200]
        provider = GeminiProvider(keys=['secret-key-1', 'secret-key-2', 'secret-key-3'], client=client)
        result = provider.request_json(
            system_prompt='Return JSON',
            parts=[{'text': 'hello'}],
            response_schema={'type': 'object'},
        )
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(result['data'], {'ok': True})
        self.assertEqual(result['attempt_count'], 2)
        self.assertEqual(result['used_key_index'], 2)
        self.assertEqual(client.post.call_count, 2)
        serialized = json.dumps(result)
        self.assertNotIn('secret-key-1', serialized)
        self.assertNotIn('secret-key-2', serialized)

    def test_non_429_errors_and_invalid_json_do_not_rotate(self):
        for status in (400, 401, 403, 500):
            client = Mock()
            client.post.return_value = httpx.Response(
                status, json={'error': {'status': 'INVALID_ARGUMENT'}}
            )
            provider = GeminiProvider(keys=['secret-key-1', 'secret-key-2'], client=client)
            result = provider.request_json(
                system_prompt='Return JSON',
                parts=[{'text': 'hello'}],
            )
            self.assertEqual(result['status'], 'unresolved')
            self.assertEqual(result['reason'], f'gemini_http_{status}')
            self.assertEqual(result['attempt_count'], 1)
            self.assertEqual(client.post.call_count, 1)

        bad_json_client = Mock()
        bad_json_client.post.return_value = httpx.Response(200, json={
            'candidates': [{'finishReason': 'STOP', 'content': {'parts': [{'text': '{not-json'}]}}],
        })
        provider = GeminiProvider(keys=['secret-key-1', 'secret-key-2'], client=bad_json_client)
        bad_json_result = provider.request_json(
            system_prompt='Return JSON',
            parts=[{'text': 'hello'}],
        )
        self.assertEqual(bad_json_result['status'], 'unresolved')
        self.assertFalse(bad_json_result['retryable'])
        self.assertEqual(bad_json_result['reason'], 'gemini_json_invalid')
        self.assertEqual(bad_json_client.post.call_count, 1)

    def test_exhausted_key_pool_stops_safely_with_retryable_unresolved_result(self):
        client = Mock()
        client.post.return_value = httpx.Response(
            429, json={'error': {'status': 'RESOURCE_EXHAUSTED'}}
        )
        provider = GeminiProvider(keys=['secret-key-1', 'secret-key-2', 'secret-key-3'], client=client)
        result = provider.request_json(
            system_prompt='Return JSON',
            parts=[{'text': 'hello'}],
        )
        self.assertEqual(result['status'], 'unresolved')
        self.assertTrue(result['retryable'])
        self.assertEqual(result['reason'], 'gemini_quota_exhausted')
        self.assertIsNone(result['data'])
        self.assertEqual(result['attempt_count'], 3)
        self.assertEqual(client.post.call_count, 3)


if __name__ == '__main__':
    unittest.main()
