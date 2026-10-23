"""DeepSeek uses JSON mode; Aptus still owns schema and evidence validation."""
import json
import unittest
from unittest.mock import Mock, patch

import httpx
from extract_bundle import request_structured


class DeepSeekTransportTests(unittest.TestCase):
    def request(self, response):
        client = Mock()
        client.post.return_value = response
        with patch.dict('os.environ', {'DEEPSEEK_API_KEY': 'illustrative-key'}, clear=True):
            result = request_structured({'bundle_id': 'notice'}, {'type': 'object'},
                                        'Return facts.', provider='deepseek', client=client)
        return result, client

    def test_direct_endpoint_json_mode_and_schema_without_openai_credentials(self):
        (wire, metadata), client = self.request(httpx.Response(200, json={
            'choices': [{'finish_reason': 'stop', 'message': {'content': '{"purpose":"non_job"}'}}],
            'usage': {'total_tokens': 20}}))
        self.assertEqual(wire['purpose'], 'non_job')
        self.assertEqual(metadata['provider'], 'deepseek')
        self.assertEqual(client.post.call_count, 1)
        self.assertEqual(client.post.call_args.args[0], 'https://api.deepseek.com/chat/completions')
        payload = client.post.call_args.kwargs['json']
        self.assertEqual(payload['model'], 'deepseek-flash')
        self.assertEqual(payload['response_format'], {'type': 'json_object'})
        self.assertEqual(payload['max_tokens'], 32768)
        self.assertEqual(json.loads(payload['messages'][1]['content'])['output_schema'], {'type': 'object'})
        self.assertNotIn('illustrative-key', json.dumps(metadata))

    def test_truncated_output_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError, 'provider_incomplete_or_refused'):
            self.request(httpx.Response(200, json={'choices': [
                {'finish_reason': 'length', 'message': {'content': '{}'}}]}))

    def test_quota_failure_does_not_retry(self):
        with self.assertRaisesRegex(RuntimeError, 'provider_http_429'):
            self.request(httpx.Response(429))


if __name__ == '__main__':
    unittest.main()
