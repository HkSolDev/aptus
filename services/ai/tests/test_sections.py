import json
import unittest

from sources.sarkariresult import parse_page


class SectionTests(unittest.TestCase):
    def test_dates_exclude_neighbouring_fees(self):
        page = parse_page('''<table><tr>
            <td><h2>Important Dates</h2><ul><li>Last Date: 25/10/2026</li></ul></td>
            <td><h2>Application Fee</h2><ul><li>Fee: 100/-</li></ul></td>
            </tr></table>''')
        self.assertIn("25/10/2026", page.sections["important_dates"])
        self.assertNotIn("100/-", page.sections["important_dates"])
        self.assertIn("100/-", page.sections["application_fee"])

    def test_nested_rows_appear_once_and_keep_empty_cells(self):
        page = parse_page('''<table><tr><td>
            <h2>Subject Wise Vacancy Details</h2><table>
            <tr><th>Subject</th><th>UR</th><th>SC</th></tr>
            <tr><td>UniqueSubject</td><td></td><td>7</td></tr>
            </table></td></tr></table>''')
        self.assertEqual(page.text.count("UniqueSubject"), 1)
        rows = page.sections["subject_wise_vacancies"].splitlines()
        self.assertEqual(json.loads(rows[-1]), ["UniqueSubject", "", "7"])

    def test_table_page_excludes_unrelated_outside_text(self):
        page = parse_page('<p>Unrelated menu</p><table><tr><td>Job facts</td></tr></table>')
        self.assertIn("Job facts", page.text)
        self.assertNotIn("Unrelated menu", page.text)

    def test_exam_header_and_category_rows_stop_at_next_section(self):
        page = parse_page('''<table>
            <tr><td><b>Exam Name</b></td><td><b>Eligibility</b></td></tr>
            <tr><td>Library Exam</td><td>B.Lib</td></tr>
            <tr><td colspan="2"><h2>Category Wise Vacancy Details</h2></td></tr>
            <tr><td><b>Category</b></td><td><b>Total</b></td></tr>
            <tr><td>SC</td><td>7</td></tr>
            <tr><td colspan="2"><h2>How to Apply</h2></td></tr>
            </table>''')
        posts = page.sections["posts_and_qualifications"]
        self.assertIn("B.Lib", posts)
        self.assertNotIn("Category Wise", posts)
        categories = page.sections["category_wise_vacancies"]
        self.assertIn('["SC", "7"]', categories)
        self.assertNotIn("How to Apply", categories)


if __name__ == "__main__":
    unittest.main()
