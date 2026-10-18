import os
import unittest
from unittest.mock import patch

from providers.gemini import gemini_api_key


class GeminiProviderTests(unittest.TestCase):
    def test_numbered_key_is_supported_without_exposing_it(self):
        with patch.dict(os.environ, {'GEMINI_API_KEY_1': 'illustrative-key'}, clear=True):
            self.assertEqual(gemini_api_key(), 'illustrative-key')

    def test_missing_key_fails_closed(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, 'provider_credential_unavailable'):
                gemini_api_key()


if __name__ == '__main__':
    unittest.main()
