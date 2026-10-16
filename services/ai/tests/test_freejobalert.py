import unittest
from datetime import date

from sources.freejobalert import discover


class DiscoveryTests(unittest.TestCase):
    def test_ssc_does_not_collect_other_sections_and_deduplicates(self):
        html = '''<h4>UPSC</h4><table><a href="/articles/upsc">Other</a></table>
        <h4>SSC</h4><table><tr><th>Exam / Post Name</th><th>Last Date</th><th>Info</th></tr>
        <tr><td>Example post</td><td>20-10-2026</td><td>
        <a href="/articles/ssc-example">Details</a><a href="/articles/ssc-example">Again</a>
        <a href="https://evil.example/articles/ssc">Wrong host</a></td></tr></table>
        <h4>Other All India</h4><table><a href="/articles/other">Other</a></table>'''
        jobs = discover(html, 'ssc', date(2026, 10, 12))
        self.assertEqual([job['url'] for job in jobs],
                         ['https://www.freejobalert.com/articles/ssc-example'])

    def test_empty_ssc_is_success(self):
        self.assertEqual(discover('''<h4>SSC</h4><table><tr><th>Exam / Post Name</th>
        <th>Last Date</th></tr><tr><td colspan="2">No jobs available</td></tr></table>''',
                                  'ssc'), [])

    def test_expired_skipped_unknown_deadline_retained(self):
        html = '''<h2>Latest Government Jobs in Rajasthan</h2><table>
        <tr><th>Job Title</th><th>Last Date</th></tr>
        <tr><td><a href="/articles/expired">Old</a></td><td>01-10-2026</td></tr>
        <tr><td><a href="/articles/unknown">Review</a></td><td>One Month</td></tr></table>'''
        self.assertEqual([job['title'] for job in discover(html, 'rajasthan', date(2026, 10, 12))],
                         ['Review'])

    def test_layout_change_fails_instead_of_using_unrelated_table(self):
        with self.assertRaisesRegex(ValueError, 'listing_table_missing'):
            discover('<h4>SSC</h4><h4>UPSC</h4><table></table>', 'ssc')


if __name__ == '__main__':
    unittest.main()
