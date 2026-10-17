import unittest
from pathlib import Path

from sources.hssc import discover_listings, official_pdf_url


class HsscTests(unittest.TestCase):
    def test_discovers_original_advertisements_only(self):
        fixture = Path(__file__).parent / 'fixtures' / 'hssc_advertisement_listing.html'
        self.assertEqual(discover_listings(fixture.read_text()), [
            {'source': 'hssc', 'url': 'https://hssc.gov.in/file/ac1f23cd-9d9c-1328-819e-ef25fa0a0061/advertisements', 'title': 'Advt. No. 06/2026 (Group-C)', 'organization': 'Haryana Staff Selection Commission'},
            {'source': 'hssc', 'url': 'https://hssc.gov.in/file/ac1f23cd-99c4-13a6-819c-32aaa1600063/advertisements', 'title': 'Advt. No. 04/2026', 'organization': 'Haryana Staff Selection Commission'},
        ])

    def test_rejects_non_hssc_or_wrong_document_routes(self):
        self.assertIsNone(official_pdf_url('https://example.com/file/id/advertisements'))
        self.assertIsNone(official_pdf_url('/result'))

    def test_layout_change_fails_closed(self):
        with self.assertRaisesRegex(ValueError, 'advertisement_table_missing'):
            discover_listings('<main>no listings</main>')


if __name__ == '__main__':
    unittest.main()
