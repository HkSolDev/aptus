import unittest

from normalize_html import normalize_html


def block_texts(blocks):
    """Return visible text in block order without assuming a storage layout."""
    texts = []
    for block in blocks:
        if block["type"] in {"heading", "paragraph"}:
            texts.append(block["text"])
        elif block["type"] == "list":
            texts.extend(block["items"])
        elif block["type"] == "table":
            texts.extend(cell for row in block["rows"] for cell in row)
    return texts


class NormalizeHtmlTests(unittest.TestCase):
    def normalize(self, html, final_url="https://example.gov.in/jobs/notice.html"):
        return normalize_html(html.encode("utf-8"), final_url)

    def test_normal_recruitment_notice_has_exact_normalized_output(self):
        """The ordinary notice is the small, readable baseline contract."""
        result = self.normalize("""
            <html><head><title>SSC Notice 2026</title></head><body>
              <h1>Recruitment</h1>
              <p>Applications are invited.</p>
              <h2>Eligibility</h2>
              <ul><li>Graduate</li><li>Age 18–30</li></ul>
              <p><a href="/notice.pdf">Official notice</a></p>
            </body></html>
        """)

        self.assertEqual(
            result,
            {
                "format": "html",
                "title": "SSC Notice 2026",
                "blocks": [
                    {"type": "heading", "level": 1, "text": "Recruitment"},
                    {"type": "paragraph", "text": "Applications are invited."},
                    {"type": "heading", "level": 2, "text": "Eligibility"},
                    {
                        "type": "list",
                        "ordered": False,
                        "items": ["Graduate", "Age 18–30"],
                    },
                    {"type": "paragraph", "text": "Official notice"},
                ],
                "links": [
                    {
                        "text": "Official notice",
                        "url": "https://example.gov.in/notice.pdf",
                    }
                ],
                "warnings": [],
            },
        )

    def test_nested_wrappers_keep_loose_text_once_in_dom_order(self):
        """Source pages often put deadlines before and after child blocks."""
        result = self.normalize("""
            <div>
              Opening <span>date</span>: 1 October
              <p>Applications are invited.</p>
              Closing <strong>date</strong>: 31 October
            </div>
        """)

        self.assertIsNone(result["title"])
        texts = block_texts(result["blocks"])
        combined = "\n".join(texts)
        self.assertEqual(combined.count("Opening date: 1 October"), 1)
        self.assertEqual(combined.count("Applications are invited."), 1)
        self.assertEqual(combined.count("Closing date: 31 October"), 1)
        self.assertLess(combined.index("Opening date"), combined.index("Applications"))
        self.assertLess(combined.index("Applications"), combined.index("Closing date"))

    def test_ordered_list_preserves_item_order(self):
        """Application instructions depend on their original numbered sequence."""
        result = self.normalize("""
            <ol><li>Register</li><li>Upload documents</li><li>Pay the fee</li></ol>
        """)

        self.assertEqual(
            result["blocks"],
            [
                {
                    "type": "list",
                    "ordered": True,
                    "items": ["Register", "Upload documents", "Pay the fee"],
                }
            ],
        )

    def test_inline_markup_preserves_word_boundaries_without_duplication(self):
        """Inline tags must not split words or repeat their parent's text."""
        result = self.normalize("""
            <p>Recruit<strong>ment</strong> notice</p>
            <p>Applications <span>are</span> <a href="/apply">invited</a>.</p>
        """)

        self.assertEqual(
            result["blocks"],
            [
                {"type": "paragraph", "text": "Recruitment notice"},
                {"type": "paragraph", "text": "Applications are invited."},
            ],
        )
        self.assertEqual(
            result["links"],
            [{"text": "invited", "url": "https://example.gov.in/apply"}],
        )

    def test_meaningful_br_line_breaks_are_preserved(self):
        """Deadlines are commonly written as a label and value on separate lines."""
        result = self.normalize("""
            <p>Last date:<br>31 October 2026<br/>5:00 PM</p>
        """)

        self.assertEqual(
            result["blocks"],
            [{"type": "paragraph", "text": "Last date:\n31 October 2026\n5:00 PM"}],
        )

    def test_table_keeps_empty_cells_wrapped_text_and_links(self):
        """Vacancy tables lose meaning if cells are collapsed, reordered, or dropped."""
        result = self.normalize("""
            <h2>Vacancy Details</h2>
            <table>
              <tr><th>Post</th><th>Vacancies</th></tr>
              <tr><td>Engineer</td><td></td></tr>
              <tr><td>Hindi<br>Engineer</td><td><a href="/admit">120</a></td></tr>
            </table>
        """)

        table = result["blocks"][1]
        self.assertEqual(table["type"], "table")
        self.assertEqual(table["heading_context"], "Vacancy Details")
        self.assertEqual(
            table["rows"],
            [
                ["Post", "Vacancies"],
                ["Engineer", ""],
                ["Hindi\nEngineer", "120"],
            ],
        )
        self.assertEqual(
            result["links"],
            [{"text": "120", "url": "https://example.gov.in/admit"}],
        )

    def test_table_spans_keep_originating_cells_once_and_warn(self):
        """This prevents invented vacancy columns when the contract has no span model."""
        result = self.normalize("""
            <h2>Technical Posts</h2>
            <table>
              <tr><th colspan="2">Post and discipline</th><th>Vacancies</th></tr>
              <tr><td rowspan="2">Engineer</td><td>Electrical</td><td>80</td></tr>
              <tr><td>Mechanical</td><td>40</td></tr>
            </table>
        """)

        table = result["blocks"][1]
        self.assertEqual(
            table["rows"],
            [
                ["Post and discipline", "Vacancies"],
                ["Engineer", "Electrical", "80"],
                ["Mechanical", "40"],
            ],
        )
        self.assertIn("table_spans_present", result["warnings"])

    def test_malformed_unclosed_markup_does_not_crash_or_drop_notice_text(self):
        """Government notice markup is frequently incomplete in practice."""
        result = self.normalize("""
            <h1>Recruitment <strong>2026</h1>
            <p>Applications are invited<p>Last date: 31 October
            <a href="/apply">Apply now
        """)

        visible_text = "\n".join(block_texts(result["blocks"]))
        self.assertIn("Recruitment 2026", visible_text)
        self.assertIn("Applications are invited", visible_text)
        self.assertIn("Last date: 31 October", visible_text)
        self.assertIn(
            {"text": "Apply now", "url": "https://example.gov.in/apply"},
            result["links"],
        )

    def test_utf8_hindi_and_mixed_language_text_are_preserved(self):
        """Eligibility notices regularly mix Hindi, English, numerals, and punctuation."""
        result = self.normalize("""
            <html><head><meta charset="utf-8"><title>भर्ती सूचना</title></head>
            <body><p>तकनीकी सहायक / Technical Assistant — 120 पद</p></body></html>
        """)

        self.assertEqual(result["title"], "भर्ती सूचना")
        self.assertEqual(
            result["blocks"],
            [
                {
                    "type": "paragraph",
                    "text": "तकनीकी सहायक / Technical Assistant — 120 पद",
                }
            ],
        )

    def test_explicit_navigation_is_excluded_but_matching_main_content_remains(self):
        """Navigation labels can duplicate the actual notice title beside the content."""
        result = self.normalize("""
            <nav><a href="/jobs">Recruitment</a><a href="/results">Results</a></nav>
            <div role="navigation"><a href="/home">Home</a></div>
            <main>
              <h1>Recruitment</h1>
              <p>Applications are invited.</p>
              <a href="/apply">Apply online</a>
            </main>
        """)

        visible_text = "\n".join(block_texts(result["blocks"]))
        self.assertEqual(visible_text.count("Recruitment"), 1)
        self.assertNotIn("Results", visible_text)
        self.assertNotIn("Home", visible_text)
        self.assertEqual(
            result["links"],
            [{"text": "Apply online", "url": "https://example.gov.in/apply"}],
        )

    def test_header_footer_and_aside_content_are_retained(self):
        """Important notice facts are often placed outside the main element."""
        result = self.normalize("""
            <header><h1>UPSC Recruitment 2026</h1></header>
            <main><p>Applications are invited for 120 posts.</p></main>
            <aside><p>Deadline: 31 October 2026</p></aside>
            <footer><p>Signed: Secretary</p></footer>
        """)

        visible_text = "\n".join(block_texts(result["blocks"]))
        self.assertIn("UPSC Recruitment 2026", visible_text)
        self.assertIn("Applications are invited for 120 posts.", visible_text)
        self.assertIn("Deadline: 31 October 2026", visible_text)
        self.assertIn("Signed: Secretary", visible_text)

    def test_link_heavy_notice_index_and_duplicate_occurrences_are_retained(self):
        """A notice index is content, even when it contains many links and repeats one URL."""
        result = self.normalize("""
            <main>
              <h1>Recruitment notice index</h1>
              <p>Choose a notice before its deadline.</p>
              <ul>
                <li><a href="/assistant.pdf">Assistant notice</a> — 31 October</li>
                <li><a href="/engineer.pdf">Engineer notice</a> — 5 November</li>
                <li><a href="/assistant.pdf">Assistant notice</a> — mirror listing</li>
              </ul>
            </main>
        """)

        self.assertEqual(
            result["links"],
            [
                {
                    "text": "Assistant notice",
                    "url": "https://example.gov.in/assistant.pdf",
                },
                {
                    "text": "Engineer notice",
                    "url": "https://example.gov.in/engineer.pdf",
                },
                {
                    "text": "Assistant notice",
                    "url": "https://example.gov.in/assistant.pdf",
                },
            ],
        )
        visible_text = "\n".join(block_texts(result["blocks"]))
        self.assertIn("Recruitment notice index", visible_text)
        self.assertIn("31 October", visible_text)
        self.assertIn("5 November", visible_text)

    def test_first_valid_http_base_url_resolves_links(self):
        """A source may contain invalid or duplicate base tags before document links."""
        result = self.normalize("""
            <head>
              <base href="javascript:alert(1)">
              <base href="https://cdn.example.gov.in/notices/">
              <base href="https://ignored.example.gov.in/">
            </head>
            <p><a href="relative.pdf">Relative</a></p>
            <p><a href="/apply">Root relative</a></p>
            <p><a href="//files.example.gov.in/admit.pdf">Protocol relative</a></p>
            <p><a href="https://other.example.in/rules">Absolute</a></p>
        """)

        self.assertEqual(
            result["links"],
            [
                {
                    "text": "Relative",
                    "url": "https://cdn.example.gov.in/notices/relative.pdf",
                },
                {"text": "Root relative", "url": "https://cdn.example.gov.in/apply"},
                {
                    "text": "Protocol relative",
                    "url": "https://files.example.gov.in/admit.pdf",
                },
                {"text": "Absolute", "url": "https://other.example.in/rules"},
            ],
        )

    def test_unsafe_link_schemes_are_excluded(self):
        """Non-web schemes must not enter the link output consumed by later stages."""
        result = self.normalize("""
            <p><a href="javascript:alert(1)">Script</a></p>
            <p><a href="data:text/html,unsafe">Data</a></p>
            <p><a href="mailto:jobs@example.gov.in">Email</a></p>
            <p><a href="tel:+911234567890">Phone</a></p>
        """)

        self.assertEqual(result["links"], [])

    def test_missing_title_and_empty_document_return_empty_content_warning(self):
        """A fetch can succeed while yielding no usable HTML content."""
        result = self.normalize("""
            <html><head><script>ignored()</script><style>p { color: red }</style></head>
            <body><!-- ignored comment --><nav><a href="/jobs">Jobs</a></nav></body></html>
        """)

        self.assertEqual(
            result,
            {
                "format": "html",
                "title": None,
                "blocks": [],
                "links": [],
                "warnings": ["empty_content"],
            },
        )

    def test_same_input_produces_same_output(self):
        """Stable normalization prevents unnecessary downstream extraction work."""
        html = """
            <h1>Recruitment</h1>
            <p>Applications are invited for <strong>120</strong> posts.</p>
            <table><tr><td>Last date</td><td>31 October</td></tr></table>
        """

        self.assertEqual(self.normalize(html), self.normalize(html))


if __name__ == "__main__":
    unittest.main()
