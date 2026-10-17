import unittest
from pathlib import Path

from sources.uppsc import discover_listings, official_advertisement_url


class UppscTests(unittest.TestCase):
    def test_discovers_public_advertisement_and_deadline(self):
        fixture = Path(__file__).parent / 'fixtures' / 'uppsc_notifications.html'
        self.assertEqual(discover_listings(fixture.read_text()), [{
            'source': 'uppsc',
            'url': 'https://uppsc.up.nic.in/OuterPages/View_Advertisement.aspx?ID=558&flag=E',
            'title': 'Direct Recruitment — Advertisement D-6/E-1/2025',
            'deadline': '21/10/2026',
        }])

    def test_rejects_non_public_or_wrong_detail_links(self):
        self.assertIsNone(official_advertisement_url('https://example.com/notice.pdf'))
        self.assertIsNone(official_advertisement_url('../CandidatePages/Notifications.aspx'))

    def test_layout_change_fails_closed(self):
        with self.assertRaisesRegex(ValueError, 'notification_table_missing'):
            discover_listings('<main>no table</main>')


if __name__ == '__main__':
    unittest.main()
