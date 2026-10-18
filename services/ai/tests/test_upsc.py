import unittest
from pathlib import Path

from sources.upsc import ORGANIZATION, discover_listings, official_pdf_url


class UpscTests(unittest.TestCase):
    def test_discovers_only_official_recruitment_advertisement_pdfs(self):
        fixture = Path(__file__).parent / 'fixtures' / 'upsc_recruitment_listing.html'
        self.assertEqual(discover_listings(fixture.read_text()), [
            {'source': 'upsc', 'url': 'https://www.upsc.gov.in/sites/default/files/AdvtNo-52-2026-Special-Engl-210826.pdf',
             'title': 'Advertisement No.52 - 2026 (Special)', 'organization': ORGANIZATION},
            {'source': 'upsc', 'url': 'https://www.upsc.gov.in/sites/default/files/AdvtNo-51-2026-Engl-200826.pdf',
             'title': 'Advertisement No.51 - 2026', 'organization': ORGANIZATION},
        ])

    def test_rejects_non_official_or_unsafe_pdf_urls(self):
        self.assertIsNone(official_pdf_url('https://example.com/notice.pdf'))
        self.assertIsNone(official_pdf_url('https://www.upsc.gov.in/sites/default/files/notice.pdf?x=1'))
        self.assertIsNone(official_pdf_url('http://www.upsc.gov.in/sites/default/files/notice.pdf'))

    def test_layout_change_fails_closed(self):
        with self.assertRaisesRegex(ValueError, 'advertisement_rows_missing'):
            discover_listings('<main>Recruitment advertisements</main>')


if __name__ == '__main__':
    unittest.main()
