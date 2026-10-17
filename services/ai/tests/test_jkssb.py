import unittest
from pathlib import Path

from sources.jkssb import discover_listings, official_pdf_url


class JkssbTests(unittest.TestCase):
    def test_discovers_official_advertisement_pdfs(self):
        fixture = Path(__file__).parent / 'fixtures' / 'jkssb_advertisement_listing.html'
        self.assertEqual(discover_listings(fixture.read_text()), [
            {'source': 'jkssb', 'url': 'https://jkssb.nic.in/Pdf/ADVT_09OF2026_01092026.pdf', 'title': 'JKSSB Advertisement 09 of 2026 -- (01/09/2026)', 'organization': 'Jammu and Kashmir Services Selection Board'},
            {'source': 'jkssb', 'url': 'https://jkssb.nic.in/Pdf/Advertisement_08OF2026_04082026.pdf', 'title': 'JKSSB Advertisement 08 of 2026 -- (04/08/2026)', 'organization': 'Jammu and Kashmir Services Selection Board'},
        ])

    def test_rejects_untrusted_document_links(self):
        self.assertIsNone(official_pdf_url('https://example.com/notice.pdf'))
        self.assertIsNone(official_pdf_url('/Results.pdf'))

    def test_layout_change_fails_closed(self):
        with self.assertRaisesRegex(ValueError, 'advertisement_heading_missing'):
            discover_listings('<main>no listings</main>')


if __name__ == '__main__':
    unittest.main()
