"""Stage 2 acceptance: source listings discover URLs, never job evidence."""

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from xml.sax.saxutils import escape

from recover_documents import capture_and_normalize
from shared_crawl import crawl_source
from shared_pipeline import prepare_source
from source_transport import read_listing
from services.ai.tests.test_shared_pipeline import pdf_bytes


RSS_URL = "https://www.sarkariresult.com/feed/"
SSC_URL = "https://ssc.gov.in/api/general-website/portal/notice-boards"


def rss(items):
    return ("<rss><channel>" + "".join(
        "<item><title>" + escape(title) + "</title><link>" + escape(url)
        + "</link><pubDate>Fri, 23 Oct 2026 10:00:00 GMT</pubDate></item>"
        for title, url in items) + "</channel></rss>").encode()


def ssc_record(title, *paths):
    return {"headline": title, "createdAt": "2026-10-23",
            "attachments": [{"type": "application/pdf", "path": path} for path in paths]}


def ssc(records):
    return json.dumps({"statusCode": "200", "data": records}).encode()


class SourceTransportAcceptanceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.responses = {}
        self.fetched = []

    def process(self, url, root, **options):
        def capture(destination, storage):
            self.fetched.append(destination)
            kind, body = self.responses[destination]
            digest = hashlib.sha256(body).hexdigest()
            path = self.root / (digest + ".body")
            path.write_bytes(body)
            return {"outcome": "changed", "body_path": str(path),
                    "final_url": destination, "snapshot_id": digest, "sha256": digest,
                    "snapshot": {"document_kind": kind}}
        return capture_and_normalize(url, root, capture_document=capture, **options)

    def listing(self, body, *, source="sarkariresult"):
        return read_listing(body, RSS_URL if source == "sarkariresult" else SSC_URL,
                            document_kind="xml" if source == "sarkariresult" else "json",
                            source_id=source)

    def crawl(self, body, *, source="sarkariresult", **limits):
        seed = RSS_URL if source == "sarkariresult" else SSC_URL
        self.responses[seed] = ("xml" if source == "sarkariresult" else "json", body)
        return crawl_source(seed, self.root / "crawl", process=self.process,
                            source_id=source, **limits)

    def test_rss_filters_results_external_and_unsafe_urls_and_keeps_metadata(self):
        body = rss([
            ("Railway Online Form 2026", "/2026/railway-form/"),
            ("Teacher Recruitment 2026", "/2026/teacher/"),
            ("SSC Admit Card 2026", "/admit/"),
            ("External Recruitment", "https://example.org/recruitment/"),
            ("Recruitment", "https://www.sarkariresult.com.evil.example/job"),
            ("Recruitment", "https://user:password@www.sarkariresult.com/job"),
            ("Recruitment", "javascript:alert(1)"),
        ])
        result = self.listing(body)
        self.assertEqual({item["url"] for item in result["destinations"]}, {
            "https://www.sarkariresult.com/2026/railway-form/",
            "https://www.sarkariresult.com/2026/teacher/"})
        for item in result["destinations"]:
            self.assertTrue(item["title"])
            self.assertEqual(item["date"], "Fri, 23 Oct 2026 10:00:00 GMT")
            self.assertEqual(item["parent_url"], RSS_URL)

    def test_ssc_preserves_corrigenda_extensions_and_valid_siblings(self):
        result = self.listing(ssc([
            ssc_record("Recruitment notification", "notice.pdf"),
            ssc_record("Corrigendum", "correction.pdf"),
            ssc_record("Deadline extension", "extension.pdf"),
            ssc_record("Unsafe attachment", "../escape.pdf"), None,
        ]), source="ssc")
        self.assertEqual({item["url"] for item in result["destinations"]}, {
            "https://ssc.gov.in/api/attachment/notice.pdf",
            "https://ssc.gov.in/api/attachment/correction.pdf",
            "https://ssc.gov.in/api/attachment/extension.pdf"})
        self.assertGreater(result["skipped_entries"], 0)
        self.assertTrue(all(item["date"] == "2026-10-23" for item in result["destinations"]))

    def test_duplicate_feed_urls_are_fetched_once_and_listing_is_not_evidence(self):
        url = "https://www.sarkariresult.com/2026/railway/"
        self.responses[url] = ("html", b"<h1>Recruitment notification</h1>")
        result = self.crawl(rss([("Railway Online Form", url), ("Railway Online Form", url + "#top")]))
        self.assertEqual(self.fetched, [RSS_URL, url])
        self.assertEqual([doc["source_url"] for doc in result["documents"]], [url])
        edge = next(edge for edge in result["edges"] if edge["url"] == url)
        self.assertEqual(edge["parent_url"], RSS_URL)
        self.assertTrue(edge["title"])
        self.assertTrue(edge["date"])

    def test_ssc_listing_reaches_real_pdf_normalizer(self):
        url = "https://ssc.gov.in/api/attachment/notice.pdf"
        self.responses[url] = ("pdf", pdf_bytes([
            "Recruitment Notice", "SSC", "Advertisement No: 01/2026",
            "AGE LIMIT", "Maximum age 30 years."]))
        result = self.crawl(ssc([ssc_record("Recruitment notification", "notice.pdf")]), source="ssc")
        self.assertEqual(self.fetched, [SSC_URL, url])
        self.assertEqual([doc["format"] for doc in result["documents"]], ["pdf"])
        self.assertNotIn(SSC_URL, [doc["source_url"] for doc in result["documents"]])

    def test_valid_empty_listings_complete_without_evidence(self):
        for source, body in [("sarkariresult", rss([])), ("ssc", ssc([]))]:
            with self.subTest(source=source):
                result = self.crawl(body, source=source)
                self.assertEqual(result["status"], "scanned")
                self.assertEqual(result["documents"], [])

    def test_malformed_top_level_listings_do_not_claim_success(self):
        for source, body in [
            ("sarkariresult", b"<rss><channel>"),
            ("sarkariresult", b"<rss/>"),
            ("sarkariresult", b"<feed/>"),
            ("ssc", b'{"statusCode":"500","data":[]}'),
            ("ssc", b'{"statusCode":"200","data":{}}'),
            ("ssc", b'{"items":[]}'), ("ssc", b"not-json"),
        ]:
            with self.subTest(source=source, body=body):
                result = self.crawl(body, source=source)
                self.assertNotEqual(result["status"], "scanned")
                self.assertEqual(result["documents"], [])

    def test_large_listings_are_bounded_and_mark_incomplete(self):
        for source, body in [
            ("sarkariresult", rss([(f"Recruitment Online Form {i}", f"/2026/job-{i}/") for i in range(120)])),
            ("ssc", ssc([ssc_record("Recruitment notification", f"{i}.pdf") for i in range(120)])),
        ]:
            with self.subTest(source=source):
                listing = self.listing(body, source=source)
                self.assertLessEqual(len(listing["destinations"]), 100)
                self.assertTrue(listing["truncated"])
                result = self.crawl(body, source=source, max_fetches=1)
                self.assertEqual(result["status"], "partial")
                self.assertIn("listing_truncated", {item["reason"] for item in result["unchecked"]})

    def test_attachment_fanout_cannot_bypass_destination_limit(self):
        result = self.listing(ssc([ssc_record("Recruitment notification", *[f"{i}.pdf" for i in range(120)])]), source="ssc")
        self.assertEqual(len(result["destinations"]), 100)
        self.assertTrue(result["truncated"])

    def test_exact_listing_limit_is_not_reported_as_truncation(self):
        for source, body in [
            ("sarkariresult", rss([("Recruitment Online Form", f"/2026/job-{i}/") for i in range(100)])),
            ("ssc", ssc([ssc_record("Recruitment notification", f"{i}.pdf") for i in range(100)])),
        ]:
            with self.subTest(source=source):
                result = self.listing(body, source=source)
                self.assertEqual(len(result["destinations"]), 100)
                self.assertFalse(result["truncated"])

    def test_malformed_rss_entries_do_not_drop_valid_item_without_date(self):
        body = (b"<rss><channel><item><title>Recruitment</title></item>"
                b"<item><link>/2026/no-title/</link></item>"
                b"<item><title>Railway Online Form</title>"
                b"<link>/2026/valid/</link></item></channel></rss>")
        result = self.listing(body)
        self.assertEqual([item["url"] for item in result["destinations"]],
                         ["https://www.sarkariresult.com/2026/valid/"])
        self.assertIsNone(result["destinations"][0]["date"])
        self.assertGreaterEqual(result["skipped_entries"], 2)

    def test_ssc_rejects_wrong_attachment_types_and_retains_valid_sibling(self):
        record = ssc_record("Recruitment notification", "valid.pdf")
        record["attachments"].extend([
            None, {"type": "text/html", "path": "wrong.pdf"},
            {"type": "application/pdf", "path": "../escape.pdf"},
            {"type": "application/pdf", "path": "malware.exe"},
        ])
        result = self.listing(ssc([record]), source="ssc")
        self.assertEqual([item["url"] for item in result["destinations"]],
                         ["https://ssc.gov.in/api/attachment/valid.pdf"])

    def test_fetch_and_depth_limits_include_listing_hop(self):
        url = "https://www.sarkariresult.com/2026/railway/"
        body = rss([("Railway Online Form", url)])
        for limits in [{"max_fetches": 1}, {"max_depth": 0}]:
            with self.subTest(limits=limits):
                self.fetched.clear()
                result = self.crawl(body, **limits)
                self.assertEqual(self.fetched, [RSS_URL])
                self.assertEqual(result["status"], "partial")
                self.assertIn(url, [item["url"] for item in result["unchecked"]])

    def test_bad_child_does_not_stop_valid_sibling(self):
        good = "https://www.sarkariresult.com/2026/good/"
        bad = "https://www.sarkariresult.com/2026/broken/"
        self.responses[good] = ("html", b"<h1>Recruitment</h1>")
        result = self.crawl(rss([("Recruitment Online Form", bad), ("Recruitment Online Form", good)]))
        self.assertEqual(result["status"], "partial")
        self.assertIn(good, [doc["source_url"] for doc in result["documents"]])

    def test_source_configuration_reaches_ssc_transport_without_feed_evidence(self):
        self.responses[SSC_URL] = ("json", ssc([]))
        result = prepare_source({"id": "ssc", "url": SSC_URL, "enabled": True,
                                 "kind": "official", "reason": None},
                                self.root / "prepared", process=self.process)
        crawl = json.loads(Path(result["crawl_path"]).read_text())
        self.assertEqual(crawl["status"], "scanned")
        self.assertEqual(crawl["documents"], [])
        self.assertEqual(result["prepared_inputs"], 0)
