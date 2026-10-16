import fcntl
import json
import tempfile
import unittest
from pathlib import Path

from collect_sources import collect


class CollectionTests(unittest.TestCase):
    def test_failed_source_does_not_stop_other_source_and_caps_captures(self):
        with tempfile.TemporaryDirectory() as directory:
            html = Path(directory) / 'listing.html'
            rows = ''.join(f'<tr><td><a href="/articles/job-{i}">Post {i}</a></td>'
                           '<td>Unknown</td></tr>' for i in range(8))
            html.write_text('<h2>Latest Government Jobs in Rajasthan</h2><table>'
                            '<tr><th>Job Title</th><th>Last Date</th></tr>'+rows+'</table>')
            calls = []
            def capture(url, root):
                calls.append(url)
                if url.endswith('/government-jobs/'):
                    return {'outcome': 'failed'}
                if 'sarkariresult.com' in url:
                    rss = Path(directory) / 'feed.xml'
                    rss.write_text(
                        '<rss><channel><item><title>Railway Online Form 2026</title>'
                        '<link>https://www.sarkariresult.com/2026/railway-form/</link>'
                        '</item></channel></rss>'
                    )
                    return {'outcome': 'changed', 'body_path': str(rss),
                            'snapshot': {'document_kind': 'xml'}}
                return {'outcome': 'changed', 'body_path': str(html),
                        'snapshot': {'document_kind': 'html'}}
            result = collect(Path(directory) / 'store', capture)
            self.assertEqual(result['status'], 'partial_failure')
            self.assertEqual(result['sources']['rajasthan']['captured'], 3)
            self.assertEqual(result['sources']['sarkariresult']['discovered'], 1)
            self.assertEqual(result['sources']['sarkariresult']['captured'], 1)
            self.assertEqual(len(calls), 7)
            self.assertEqual(json.loads((Path(directory)/'store/latest-run.json').read_text()), result)

    def test_overlap_skips_without_fetching(self):
        with tempfile.TemporaryDirectory() as directory:
            with (Path(directory)/'collection.lock').open('a') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                def fail_if_called(*args):
                    self.fail('Overlapping worker fetched a source')
                self.assertEqual(collect(directory, fail_if_called), {'status': 'already_running'})


if __name__ == '__main__':
    unittest.main()
