import unittest

from link_discovery import discover_links, url_identity


class DiscoveryTests(unittest.TestCase):
    def test_live_page_failure_cases(self):
        report = discover_links('''<a href="/advertisements">Recruitment Advertisements</a>
          <a href="/scholarship">Scholarship Online Form 2026</a>
          <a href="/schedule">PET Online Form 2026 New Exam Schedule</a>''',
          "https://example.gov.in/")
        targets = {item["url"]: item for item in report["destinations"]}
        self.assertEqual(targets["https://example.gov.in/advertisements"]["occurrences"][0]["score"]["label"], "bridge")
        self.assertEqual(targets["https://example.gov.in/scholarship"]["priority"], 0)
        self.assertEqual(targets["https://example.gov.in/schedule"]["priority"], 0)

    def test_duplicate_destinations_keep_stronger_occurrence(self):
        report = discover_links('''<body><a href="/notice#top">Download</a>
          <table><tr><td>Recruitment advertisement — Advertisement No. 04/2026</td>
          <td><a href="/notice">Click here</a></td></tr></table></body>''',
          "https://example.gov.in/")
        self.assertEqual(report["unique_destinations"], 1)
        self.assertEqual(report["duplicate_occurrences"], 1)
        target = report["destinations"][0]
        self.assertEqual(len(target["occurrences"]), 2)
        self.assertEqual(target["priority"], 8)
        self.assertEqual(target["best_occurrence_id"], 1)

    def test_multi_link_row_does_not_share_anchor_negatives(self):
        report = discover_links('''<table><tr><td>Technical Assistant</td>
          <td><a href="/notice">Recruitment advertisement</a></td>
          <td><a href="/result">Result</a><a href="/admit">Admit card</a></td>
          </tr></table>''', "https://example.gov.in/")
        scores = {item["url"]: item["priority"] for item in report["destinations"]}
        self.assertEqual(scores["https://example.gov.in/notice"], 6)
        self.assertEqual(scores["https://example.gov.in/result"], 0)
        self.assertEqual(scores["https://example.gov.in/admit"], 0)

    def test_hindi_notice_bridge_and_pdf_reference(self):
        report = discover_links('''<body><a href="/careers">Careers</a>
          <section><h2>भर्ती</h2><table><tr>
          <td>तकनीकी सहायक की भर्ती हेतु विज्ञापन — विज्ञापन संख्या 04/2026</td>
          <td><a href="/file.pdf">यहाँ क्लिक करें</a></td></tr></table></section>
          </body>''', "https://example.gov.in/")
        pdf = report["destinations"][0]
        self.assertEqual(pdf["target_kind"], "document_reference")
        self.assertEqual(pdf["priority"], 9)
        self.assertEqual(report["destinations"][1]["occurrences"][0]["score"]["label"], "bridge")

    def test_base_queries_and_invalid_links(self):
        report = discover_links('''<base href="https://example.gov.in/board/">
          <a href="notice?id=12">One</a><a href="notice?id=13">Two</a>
          <a href="mailto:example@example.invalid">Email</a>
          <a href="javascript:void(0)">JS</a><a href="">Empty</a>''',
          "https://example.gov.in/")
        self.assertEqual(report["unique_destinations"], 2)
        self.assertEqual(report["skipped_links"], 3)
        self.assertEqual(report["destinations"][0]["url"], "https://example.gov.in/board/notice?id=12")
        self.assertEqual(url_identity("https://EXAMPLE.gov.in:443/", "/Notice#x"),
                         "https://example.gov.in/Notice")
        self.assertIsNone(url_identity("https://example.gov.in/", "https://user:pass@example.gov.in/"))

    def test_context_does_not_cross_sections_or_repeated_words(self):
        report = discover_links('''<body><section><h2>Recruitment</h2></section>
          <section><a href="/opaque">Click here</a></section>
          <p>Recruitment recruitment recruitment <a href="/single">Recruitment</a></p>
          </body>''', "https://example.gov.in/")
        targets = {item["url"]: item for item in report["destinations"]}
        self.assertEqual(targets["https://example.gov.in/opaque"]["priority"], 0)
        self.assertEqual(targets["https://example.gov.in/single"]["priority"], 6)


if __name__ == "__main__":
    unittest.main()
