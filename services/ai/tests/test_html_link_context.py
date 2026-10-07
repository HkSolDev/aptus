import unittest

from normalize_html import normalize_html


class HtmlLinkContextTests(unittest.TestCase):
    def read(self, html):
        return normalize_html(html.encode(), "https://example.gov.in/notices/",
                              include_link_context=True)

    def test_icon_pdf_is_attached_to_its_own_row_and_cell(self):
        doc = self.read('<h2>Recruitment</h2><table><tr><td>01/10/2026</td>'
            '<td>Engineer</td><td><a href="a.pdf"><img src="pdf.png"></a></td></tr>'
            '<tr><td>02/10/2026</td><td>Teacher</td><td><a href="b.pdf">PDF</a></td>'
            '</tr></table>')
        a, b = doc["links"]
        self.assertEqual(a["owner"], {"block": 1, "row": 0, "cell": 2})
        self.assertEqual(a["context"]["row"], ["01/10/2026", "Engineer", ""])
        self.assertEqual(b["owner"]["row"], 1)
        self.assertNotIn("Teacher", a["context"]["row"])
        self.assertEqual(doc["blocks"][a["owner"]["block"]]["rows"][0][1], "Engineer")

    def test_click_here_preserves_heading_inside_its_table_cell(self):
        doc = self.read('<table><tr><td><h2>Download Updated Vacancy Details</h2>'
            '<a href="vacancies.pdf">Click Here</a></td></tr></table>')
        link = doc["links"][0]
        self.assertEqual(link["text"], "Click Here")
        self.assertIn("Download Updated Vacancy Details", link["context"]["text"])
        self.assertEqual(link["owner"], {"block": 0, "row": 0, "cell": 0})

    def test_paragraph_list_heading_and_standalone_icon_ownership(self):
        doc = self.read('<h2><a href="/job">Notice</a></h2><p><a href="a.pdf">A</a></p>'
            '<ul><li><a href="b.pdf">B</a></li></ul>'
            '<div><a href="c.pdf"><img src="icon"></a></div>')
        self.assertEqual([link["owner"]["block"] for link in doc["links"]], [0, 1, 2, 3])
        self.assertEqual(doc["links"][2]["owner"]["item"], 0)
        self.assertNotIn("unattached_link", doc["warnings"])


if __name__ == "__main__":
    unittest.main()
