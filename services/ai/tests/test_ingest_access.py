import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pipeline import push_to_ts

TOKEN = "fictional-ingest-credential-for-tests-only"


class IngestAccessTest(unittest.TestCase):
    def test_missing_credential_refuses_before_http(self):
        with patch.dict(os.environ, {}, clear=True), patch("pipeline.httpx.post") as post:
            with self.assertRaises(RuntimeError):
                push_to_ts({})
            post.assert_not_called()

    def test_credential_header_and_no_redirect(self):
        with patch.dict(os.environ, {"INGEST_TOKEN": TOKEN}, clear=True), patch("pipeline.httpx.post") as post:
            post.return_value.json.return_value = {"created": 1}
            self.assertEqual(push_to_ts({"posts": []}), {"created": 1})
            self.assertEqual(post.call_args.kwargs["headers"], {"Authorization": f"Bearer {TOKEN}"})
            self.assertFalse(post.call_args.kwargs["follow_redirects"])
            post.return_value.raise_for_status.assert_called_once()

    def test_mounted_credential_and_conflicting_sources(self):
        with tempfile.TemporaryDirectory(prefix="aptus-ingest-fixture-") as directory:
            path = Path(directory) / "credential"
            path.write_text(f"{TOKEN}\n", encoding="utf-8")
            with patch.dict(os.environ, {"INGEST_TOKEN_FILE": str(path)}, clear=True), patch("pipeline.httpx.post") as post:
                push_to_ts({})
                self.assertEqual(post.call_args.kwargs["headers"]["Authorization"], f"Bearer {TOKEN}")
            with patch.dict(os.environ, {"INGEST_TOKEN_FILE": str(path), "INGEST_TOKEN": TOKEN}, clear=True), patch("pipeline.httpx.post") as post:
                with self.assertRaises(RuntimeError):
                    push_to_ts({})
                post.assert_not_called()
