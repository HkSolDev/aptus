import unittest

from sources.sarkariresult import discover_feed


class SarkariResultFeedTests(unittest.TestCase):
    def test_keeps_only_unique_recruitment_links_on_the_source_host(self):
        xml = '''<rss><channel>
          <item><title>Railway Online Form 2026</title>
            <link>https://www.sarkariresult.com/2026/railway-form/</link></item>
          <item><title>Railway Online Form 2026 duplicate</title>
            <link>https://www.sarkariresult.com/2026/railway-form/</link></item>
          <item><title>SSC Result 2026</title>
            <link>https://www.sarkariresult.com/ssc/result/</link></item>
          <item><title>External Recruitment</title>
            <link>https://example.com/recruitment/</link></item>
        </channel></rss>'''
        self.assertEqual(discover_feed(xml), [{
            'url': 'https://www.sarkariresult.com/2026/railway-form/',
            'title': 'Railway Online Form 2026',
            'source': 'sarkariresult',
        }])

    def test_rejects_a_non_rss_document(self):
        with self.assertRaisesRegex(ValueError, 'rss_root_missing'):
            discover_feed('<jobs />')


if __name__ == '__main__':
    unittest.main()
