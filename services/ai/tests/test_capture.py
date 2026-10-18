import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from capture import capture


class CaptureTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.url = "https://example.gov.in/notice"
        self.dns = patch("capture.socket.getaddrinfo", return_value=[(2, 1, 6, "", ("93.184.215.14", 443))])
        self.dns.start()
        self.addCleanup(self.dns.stop)

    def run_capture(self, responses, url=None, **options):
        requests = []
        def handle(request):
            requests.append(request)
            response = responses.pop(0)
            if isinstance(response, Exception):
                raise response
            return response
        with httpx.Client(transport=httpx.MockTransport(handle)) as client:
            result = capture(url or self.url, self.root, client, **options)
        return result, requests

    def html(self, body=b"<html><body>Notice</body></html>", **headers):
        return httpx.Response(200, content=body, headers={"content-type": "text/html", **headers})

    def test_first_html_then_identical_and_changed(self):
        first, _ = self.run_capture([self.html(etag='"v1"')])
        identical, requests = self.run_capture([self.html()])
        self.assertEqual(identical["outcome"], "identical")
        self.assertEqual(first["snapshot_id"], identical["snapshot_id"])
        self.assertEqual(requests[0].headers["if-none-match"], '"v1"')
        changed, requests = self.run_capture([self.html(b"<p>Updated</p>")])
        self.assertNotIn("if-none-match", requests[0].headers)
        self.assertEqual(changed["outcome"], "changed")
        self.assertNotEqual(first["snapshot_id"], changed["snapshot_id"])
        self.assertEqual(Path(first["body_path"]).read_bytes(), b"<html><body>Notice</body></html>")

    def test_304_weak_etag_and_date(self):
        date = "Wed, 07 Oct 2026 10:00:00 GMT"
        first, _ = self.run_capture([self.html(etag='W/"v1"', **{"last-modified": date})])
        result, requests = self.run_capture([httpx.Response(304)])
        self.assertEqual(result["outcome"], "revalidated")
        self.assertEqual(result["snapshot_id"], first["snapshot_id"])
        self.assertEqual(requests[0].headers["if-none-match"], 'W/"v1"')
        self.assertEqual(requests[0].headers["if-modified-since"], date)

    def test_pdf_replacement_and_html_disguised_as_pdf(self):
        url = self.url + ".pdf"
        first, _ = self.run_capture([httpx.Response(200, content=b"%PDF-1.7\noriginal", headers={"content-type": "application/pdf"})], url)
        updated, _ = self.run_capture([httpx.Response(200, content=b"%PDF-1.7\nupdated", headers={"content-type": "application/pdf"})], url)
        self.assertNotEqual(first["sha256"], updated["sha256"])
        rejected, _ = self.run_capture([self.html()], url)
        self.assertEqual(rejected["reason"], "invalid_pdf")
        self.assertEqual(rejected["snapshot_id"], updated["snapshot_id"])

    def test_rss_feed_is_stored_as_xml(self):
        body = b'<?xml version="1.0"?><rss version="2.0"><channel /></rss>'
        response = httpx.Response(
            200, content=body, headers={"content-type": "application/rss+xml"}
        )
        result, _ = self.run_capture([response])
        self.assertEqual(result["outcome"], "changed")
        self.assertEqual(result["snapshot"]["document_kind"], "xml")
        self.assertEqual(Path(result["body_path"]).read_bytes(), body)

    def test_non_rss_xml_is_rejected(self):
        response = httpx.Response(
            200, content=b'<jobs />', headers={"content-type": "application/xml"}
        )
        result, _ = self.run_capture([response])
        self.assertEqual(result["outcome"], "rejected")
        self.assertEqual(result["reason"], "invalid_xml")

    def test_json_listing_response_is_stored_for_source_adapters(self):
        response = httpx.Response(
            200, content=b'{"statusCode":"200","data":[]}',
            headers={"content-type": "application/json"},
        )
        result, _ = self.run_capture([response])
        self.assertEqual(result["snapshot"]["document_kind"], "json")

    def test_failures_keep_last_good(self):
        first, _ = self.run_capture([self.html()])
        for response in [httpx.Response(500), httpx.ReadTimeout("test timeout"),
                         self.html(b'<html><title>Login</title><input type="password"></html>'),
                         httpx.Response(200, content=b"", headers={"content-type": "text/html"}),
                         self.html(b"x" * (5 * 1024 * 1024 + 1))]:
            with self.subTest(response=type(response).__name__):
                result, _ = self.run_capture([response])
                self.assertIn(result["outcome"], {"failed", "rejected"})
                self.assertEqual(result["snapshot_id"], first["snapshot_id"])
                self.assertTrue(Path(first["body_path"]).exists())

    def test_missing_blob_304_recovers_unconditionally(self):
        first, _ = self.run_capture([self.html(etag='"v1"')])
        Path(first["body_path"]).unlink()
        result, requests = self.run_capture([httpx.Response(304), self.html()])
        self.assertEqual(result["outcome"], "changed")
        self.assertNotIn("if-none-match", requests[1].headers)
        self.assertTrue(Path(result["body_path"]).exists())

    def test_redirect_does_not_forward_old_validator(self):
        self.run_capture([self.html(etag='"v1"')])
        result, requests = self.run_capture([httpx.Response(302, headers={"location": "/new"}), self.html()])
        self.assertEqual(requests[0].headers["if-none-match"], '"v1"')
        self.assertNotIn("if-none-match", requests[1].headers)
        self.assertEqual(result["final_url"], "https://example.gov.in/new")

    def test_force_audit_and_hindi_bytes(self):
        body = "<html><body>भर्ती</body></html>".encode()
        first, _ = self.run_capture([self.html(body, etag='W/"v1"')])
        result, requests = self.run_capture([self.html(body)], force=True)
        self.assertNotIn("if-none-match", requests[0].headers)
        self.assertEqual(Path(first["body_path"]).read_bytes(), body)
        self.assertEqual(result["outcome"], "identical")

    def test_private_destination_is_not_requested(self):
        with patch("capture.socket.getaddrinfo", return_value=[(2, 1, 6, "", ("127.0.0.1", 80))]):
            result, requests = self.run_capture([])
        self.assertEqual(result["reason"], "non_public_destination")
        self.assertEqual(requests, [])

    def test_snapshots_and_attempts_are_separate(self):
        self.run_capture([self.html(etag='"v1"')])
        self.run_capture([httpx.Response(304)])
        self.assertEqual(len(list((self.root / "snapshots").glob("*.json"))), 1)
        attempts = [json.loads(line) for line in (self.root / "attempts.jsonl").read_text().splitlines()]
        self.assertEqual([a["outcome"] for a in attempts], ["changed", "revalidated"])

    def test_interrupted_body_preserves_last_good(self):
        class Interrupted(httpx.SyncByteStream):
            def __iter__(self):
                yield b"<html>partial"
                raise httpx.ReadError("interrupted")
        first, _ = self.run_capture([self.html()])
        result, _ = self.run_capture([httpx.Response(200, stream=Interrupted(), headers={"content-type": "text/html"})])
        self.assertEqual(result["outcome"], "failed")
        self.assertEqual(result["snapshot_id"], first["snapshot_id"])
        self.assertEqual(len(list((self.root / "snapshots").glob("*.json"))), 1)

    def test_date_only_and_timestamp_change(self):
        date = "Wed, 07 Oct 2026 10:00:00 GMT"
        first, _ = self.run_capture([self.html(b"<p>Updated 10:00</p>", **{"last-modified": date})])
        reused, requests = self.run_capture([httpx.Response(304)])
        self.assertEqual(requests[0].headers["if-modified-since"], date)
        self.assertNotIn("if-none-match", requests[0].headers)
        self.assertEqual(reused["snapshot_id"], first["snapshot_id"])
        changed, _ = self.run_capture([self.html(b"<p>Updated 10:01</p>")])
        self.assertEqual(changed["outcome"], "changed")

    def test_redirect_to_private_destination_is_blocked(self):
        with patch("capture.socket.getaddrinfo", side_effect=[
            [(2, 1, 6, "", ("93.184.215.14", 443))], [(2, 1, 6, "", ("127.0.0.1", 80))]]):
            result, requests = self.run_capture([httpx.Response(302, headers={"location": "http://127.0.0.1/"})])
        self.assertEqual(result["reason"], "non_public_destination")
        self.assertEqual(len(requests), 1)

    def test_partial_response_and_changed_encoding_metadata(self):
        first, _ = self.run_capture([self.html()])
        rejected, _ = self.run_capture([httpx.Response(206, content=b"partial")])
        self.assertEqual(rejected["snapshot_id"], first["snapshot_id"])
        changed, _ = self.run_capture([httpx.Response(200, content=Path(first["body_path"]).read_bytes(), headers={"content-type": "text/html; charset=latin-1"})])
        self.assertNotEqual(changed["snapshot_id"], first["snapshot_id"])
        self.assertEqual(changed["sha256"], first["sha256"])

    def test_snapshot_write_failure_keeps_last_good(self):
        from capture_store import atomic_write
        first, _ = self.run_capture([self.html()])
        def write(path, body):
            if path.parent.name == "snapshots":
                raise OSError("illustrative disk failure")
            return atomic_write(path, body)
        with patch("capture_store.atomic_write", side_effect=write):
            result, _ = self.run_capture([self.html(b"<p>Changed</p>")])
        self.assertEqual(result["outcome"], "failed")
        self.assertEqual(result["snapshot_id"], first["snapshot_id"])
        self.assertEqual(len(list((self.root / "snapshots").glob("*.json"))), 1)


if __name__ == "__main__":
    unittest.main()
