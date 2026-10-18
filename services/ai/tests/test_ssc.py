import json
import unittest
from pathlib import Path

from sources.ssc import discover_listings, official_attachment_url, recruitment_notice


class SscTests(unittest.TestCase):
    def test_discovers_only_original_recruitment_notices(self):
        fixture = Path(__file__).parent / 'fixtures' / 'ssc_notice_board.json'
        self.assertEqual(discover_listings(json.loads(fixture.read_text())), [{
            'source': 'ssc',
            'url': 'https://ssc.gov.in/api/attachment/uploads/masterData/NoticeBoards/advertisement.pdf',
            'title': 'NOTIFICATION FOR RECRUITMENT OF ENROLLED PERSONS IN THE INDIAN COAST GUARD',
        }])

    def test_filters_results_and_exam_updates(self):
        self.assertFalse(recruitment_notice('Combined Graduate Level Examination, 2026: Declaration of Final Result'))
        self.assertFalse(recruitment_notice('Tentative Vacancies of Junior Engineer Examination, 2026'))
        self.assertTrue(recruitment_notice('Advertisement for recruitment of technical officers'))

    def test_rejects_unsafe_attachment_paths_and_bad_responses(self):
        self.assertIsNone(official_attachment_url('../notice.pdf'))
        self.assertIsNone(official_attachment_url('uploads/notice.pdf?next=x'))
        with self.assertRaisesRegex(ValueError, 'notice_api_response_invalid'):
            discover_listings({'statusCode': '203', 'data': []})


if __name__ == '__main__':
    unittest.main()
