import unittest
from pathlib import Path

from sources.mysarkarinaukri import discover_listings, official_pdf_url


class MySarkariNaukriTests(unittest.TestCase):
    def test_discovers_labelled_external_official_pdf(self):
        fixture = Path(__file__).parent / 'fixtures' / 'mysarkarinaukri_listing.html'
        self.assertEqual(discover_listings(fixture.read_text()), [{
            'source': 'mysarkarinaukri',
            'url': 'https://www.allahabadhighcourt.in/event/event_27288_16-10-2026.pdf',
            'title': 'Auraiya District Court Recruitment 2026',
            'deadline': '30 Oct 2026',
            'organization': 'Auraiya District Court',
        }])

    def test_rejects_publisher_or_non_pdf_links(self):
        self.assertIsNone(official_pdf_url('https://www.mysarkarinaukri.com/files/notice.pdf'))
        self.assertIsNone(official_pdf_url('https://example.gov.in/recruitment'))

    def test_layout_change_fails_closed(self):
        with self.assertRaisesRegex(ValueError, 'job_cards_missing'):
            discover_listings('<main>no jobs</main>')


if __name__ == '__main__':
    unittest.main()
