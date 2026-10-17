import fcntl
import json
import tempfile
import unittest
from pathlib import Path

from collect_sources import DISABLED_LISTINGS, LISTINGS, collect
from sources.upsc import LISTING_URL as UPSC_LISTING_URL


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
                if url == UPSC_LISTING_URL:
                    listing = Path(directory) / 'upsc.html'
                    listing.write_text(
                        '<div class="views-field-field-advertisement-number"><ul><li>'
                        'Advertisement No.52 - 2026 <a href="https://www.upsc.gov.in/'
                        'sites/default/files/notice.pdf">PDF</a></li></ul></div>'
                    )
                    return {'outcome': 'changed', 'body_path': str(listing),
                            'snapshot': {'document_kind': 'html'}}
                if 'www.upsc.gov.in/sites/default/files/' in url:
                    pdf = Path(directory) / 'upsc.pdf'
                    pdf.write_bytes(b'%PDF-1.4 fixture')
                    return {'outcome': 'changed', 'body_path': str(pdf),
                            'snapshot': {'document_kind': 'pdf'}}
                self.fail(f'unexpected active source: {url}')
            result = collect(Path(directory) / 'store', capture)
            self.assertEqual(result['status'], 'completed')
            self.assertEqual(result['sources']['sarkariresult']['discovered'], 1)
            self.assertEqual(result['sources']['sarkariresult']['captured'], 1)
            self.assertEqual(result['sources']['upsc']['discovered'], 1)
            self.assertEqual(result['sources']['upsc']['captured'], 1)
            self.assertEqual(len(calls), 4)
            self.assertEqual(set(LISTINGS), {'sarkariresult', 'upsc'})
            self.assertEqual(len(DISABLED_LISTINGS), 30)
            self.assertTrue({
                'uppsc', 'hpsc', 'dsssb', 'jkssb',
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
