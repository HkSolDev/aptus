"""Implementer checks; independent tests belong in test_normalize_html.py."""

import unittest

from normalize_html import normalize_html


def read(html, url="https://example.gov.in/jobs/notice"):
    return normalize_html(html.encode("utf-8"), url)


class NormalizeHtmlSmokeTests(unittest.TestCase):
    def test_order_inline_text_and_explicit_breaks(self):
        result = read("<title>Notice</title><div>Before<p>Eng<b>ineer</b> "
                      "<span>post</span><br>Apply now</p>After<h2>Fees</h2>"
                      "<ol><li>Free</li><li>Pay 100</li></ol></div>")
        self.assertEqual(result, {
            "format": "html", "title": "Notice", "links": [], "warnings": [],
            "blocks": [
                {"type": "paragraph", "text": "Before"},
                {"type": "paragraph", "text": "Engineer post\nApply now"},
                {"type": "paragraph", "text": "After"},
                {"type": "heading", "level": 2, "text": "Fees"},
                {"type": "list", "ordered": True, "items": ["Free", "Pay 100"]}]})

    def test_chrome_removal_keeps_identical_substantive_content(self):
        result = read('<nav><a href="/apply">Apply</a></nav>'
                      '<div role="navigation">Menu</div><script>bad()</script>'
                      '<style>body{}</style><!--hidden--><header>Recruitment</header>'
                      '<aside>Deadline</aside><footer>Signature</footer><p>Apply</p>')
        self.assertEqual([block["text"] for block in result["blocks"]],
                         ["Recruitment", "Deadline", "Signature", "Apply"])
        self.assertEqual(result["links"], [])

    def test_tables_preserve_cells_and_links_without_repetition(self):
        result = read('<h2>Vacancies</h2><table><caption>Posts</caption>'
                      '<tr><th colspan="2">Details</th></tr>'
                      '<tr><td>Engineer<br>Grade II</td><td></td></tr>'
                      '<tr><td rowspan="2">120</td><td><a href="notice.pdf">PDF</a>'
                      '</td></tr></table>')
        self.assertEqual(result["blocks"][-1], {
            "type": "table", "heading_context": "Vacancies",
            "rows": [["Details"], ["Engineer\nGrade II", ""], ["120", "PDF"]]})
        self.assertEqual(result["warnings"], ["table_spans_present"])
        self.assertEqual(result["links"], [{"text": "PDF",
                         "url": "https://example.gov.in/jobs/notice.pdf"}])

    def test_link_bases_schemes_and_occurrences(self):
        result = read('<base href="javascript:bad"><base href="/docs/">'
                      '<p><a href="notice.pdf">PDF</a> <a href="notice.pdf">PDF</a>'
                      '<a href="//other.gov.in/x">Other</a>'
                      '<a href="mailto:test@example.com">Mail</a>'
                      '<a href="javascript:alert(1)">JS</a>'
                      '<a href="data:text/plain,x">Data</a></p>')
        self.assertEqual([link["url"] for link in result["links"]], [
            "https://example.gov.in/docs/notice.pdf",
            "https://example.gov.in/docs/notice.pdf", "https://other.gov.in/x"])

    def test_hindi_and_source_whitespace(self):
        result = read('<meta charset="utf-8"><h1>भर्ती 2026</h1>'
                      '<p>योग्यता:   स्नातक\n  Age: 18–25</p>')
        self.assertEqual(result["blocks"][1]["text"], "योग्यता: स्नातक Age: 18–25")
        self.assertEqual(result, read('<meta charset="utf-8"><h1>भर्ती 2026</h1>'
                                     '<p>योग्यता:   स्नातक\n  Age: 18–25</p>'))

    def test_empty_and_invalid_input(self):
        self.assertEqual(read('<title>Empty</title><nav>Menu</nav>')["warnings"],
                         ["empty_content"])
        self.assertIsNone(read("")["title"])
        with self.assertRaises(ValueError):
            normalize_html(b"x", "file:///tmp/example")
        with self.assertRaises(TypeError):
            normalize_html("html", "https://example.gov.in")
        with self.assertRaises(ValueError):
            normalize_html(b"x" * (5 * 1024 * 1024 + 1), "https://example.gov.in")

    def test_nested_table_retains_text_once_and_warns(self):
        result = read('<table><tr><td>Outer<table><tr><td>Inner</td></tr>'
                      '</table>Tail</td></tr></table>')
        self.assertEqual(result["blocks"][0]["rows"], [["Outer\n\n\nInner\n\n\nTail"]])
        self.assertEqual(result["warnings"], ["nested_table_flattened"])

    def test_malformed_html_retains_words(self):
        result = read('<div>Before<p>First<b> notice</div><p>Second')
        self.assertEqual(" ".join(block["text"] for block in result["blocks"]),
                         "Before First notice Second")


if __name__ == "__main__":
    unittest.main()
