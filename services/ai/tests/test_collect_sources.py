import fcntl
import json
import tempfile
import unittest
from pathlib import Path

from collect_sources import DISABLED_LISTINGS, LISTINGS, collect


class CollectionTests(unittest.TestCase):
    def test_collects_only_active_sources_and_keeps_rajasthan_disabled(self):
        with tempfile.TemporaryDirectory() as directory:
            calls = []
            def capture(url, root):
                calls.append(url)
                if 'sarkariresult.com' in url:
                    rss = Path(directory) / 'feed.xml'
                    rss.write_text(
                        '<rss><channel><item><title>Railway Online Form 2026</title>'
                        '<link>https://www.sarkariresult.com/2026/railway-form/</link>'
                        '</item></channel></rss>'
                    )
                    return {'outcome': 'changed', 'body_path': str(rss),
                            'snapshot': {'document_kind': 'xml'}}
                self.fail(f'unexpected active source: {url}')
            result = collect(Path(directory) / 'store', capture)
            self.assertEqual(result['status'], 'completed')
            self.assertEqual(result['sources']['sarkariresult']['discovered'], 1)
            self.assertEqual(result['sources']['sarkariresult']['captured'], 1)
            self.assertEqual(len(calls), 2)
            self.assertEqual(set(LISTINGS), {'sarkariresult'})
            self.assertEqual(len(DISABLED_LISTINGS), 31)
            self.assertTrue({
                'upsc', 'uppsc', 'hpsc', 'dsssb', 'jkssb',
                'rajasthan_recruitment', 'mysarkarinaukri', 'times_of_india_jobs',
            }.issubset(DISABLED_LISTINGS))
            self.assertEqual(
                DISABLED_LISTINGS['rajasthan_recruitment']['reason'],
                'public_detail_url_not_verified',
            )
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
