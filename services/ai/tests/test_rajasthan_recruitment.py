import unittest
from pathlib import Path

from sources.rajasthan_recruitment import LISTING_URL, discover_listings


class RajasthanRecruitmentTests(unittest.TestCase):
    def test_discovers_only_distinct_public_vacancy_cards(self):
        fixture = Path(__file__).parent / 'fixtures' / 'rajasthan_recruitment_listing.html'
        self.assertEqual(discover_listings(fixture.read_text()), [{
            'source': 'rajasthan_recruitment',
            'listing_url': LISTING_URL,
            'detail_id': '4686',
            'title': 'CONTRACTUAL SAFAI KARAMCHARI - 2026',
            'organization': '(LSG)',
            'deadline': '28-Oct-2026',
        }])

    def test_layout_change_fails_closed(self):
        with self.assertRaisesRegex(ValueError, 'vacancy_section_missing'):
            discover_listings('<html><body>no listings</body></html>')


if __name__ == '__main__':
    unittest.main()
