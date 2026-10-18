import fcntl
import json
import tempfile
import unittest
from pathlib import Path

from collect_sources import DISABLED_LISTINGS, LISTINGS, collect
from sources.ssc import NOTICE_BOARD_URL as SSC_NOTICE_BOARD_URL
from sources.upsc import LISTING_URL as UPSC_LISTING_URL
from sources.uppsc import LISTING_URL as UPPSC_LISTING_URL
from sources.hssc import LISTING_URL as HSSC_LISTING_URL
from sources.jkssb import LISTING_URL as JKSSB_LISTING_URL
from sources.mysarkarinaukri import LISTING_URL as MYSARKARINAUKRI_LISTING_URL


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
                if url == SSC_NOTICE_BOARD_URL:
                    listing = Path(directory) / 'ssc.json'
                    listing.write_text(json.dumps({'statusCode': '200', 'data': [{
                        'headline': 'Notification for recruitment of officers',
                        'attachments': [{'type': 'application/pdf',
                                         'path': 'uploads\\masterData\\NoticeBoards\\notice.pdf'}],
                    }]}))
                    return {'outcome': 'changed', 'body_path': str(listing),
                            'snapshot': {'document_kind': 'json'}}
                if 'ssc.gov.in/api/attachment/' in url:
                    pdf = Path(directory) / 'ssc.pdf'
                    pdf.write_bytes(b'%PDF-1.4 fixture')
                    return {'outcome': 'changed', 'body_path': str(pdf),
                            'snapshot': {'document_kind': 'pdf'}}
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
                if url == UPPSC_LISTING_URL:
                    listing = Path(directory) / 'uppsc.html'
                    listing.write_text(
                        '<table id="ctl00_MainContent_GridView1"><tr><td>'
                        '<span id="x_Lbl_Adv_number">D-1/E-1/2026</span>'
                        '<a href="../OuterPages/View_Advertisement.aspx?ID=1&amp;flag=E">'
                        'View Advertisement</a></td></tr></table>'
                    )
                    return {'outcome': 'changed', 'body_path': str(listing),
                            'snapshot': {'document_kind': 'html'}}
                if 'uppsc.up.nic.in/OuterPages/View_Advertisement.aspx' in url:
                    notice = Path(directory) / 'uppsc-notice.html'
                    notice.write_text('<html><body>Official recruitment notice</body></html>')
                    return {'outcome': 'changed', 'body_path': str(notice),
                            'snapshot': {'document_kind': 'html'}}
                if url == HSSC_LISTING_URL:
                    listing = Path(directory) / 'hssc.html'
                    listing.write_text(
                        '<table id="advertisementsTable"><tbody><tr><td>Advt. No. 06/2026</td>'
                        '<td>2026-06-22</td><td><a href="/file/notice-id/advertisements">PDF</a>'
                        '</td></tr></tbody></table>'
                    )
                    return {'outcome': 'changed', 'body_path': str(listing),
                            'snapshot': {'document_kind': 'html'}}
                if 'hssc.gov.in/file/notice-id/advertisements' in url:
                    pdf = Path(directory) / 'hssc.pdf'
                    pdf.write_bytes(b'%PDF-1.4 fixture')
                    return {'outcome': 'changed', 'body_path': str(pdf),
                            'snapshot': {'document_kind': 'pdf'}}
                if url == JKSSB_LISTING_URL:
                    listing = Path(directory) / 'jkssb.html'
                    listing.write_text(
                        '<div class="wrapper-content"><h1>Advertisement</h1><table><tbody><tr><td>'
                        '<a href="../Pdf/Advertisement_01OF2026.pdf">01 of 2026</a>'
                        '</td></tr></tbody></table></div>'
                    )
                    return {'outcome': 'changed', 'body_path': str(listing),
                            'snapshot': {'document_kind': 'html'}}
                if 'jkssb.nic.in/Pdf/Advertisement_01OF2026.pdf' in url:
                    pdf = Path(directory) / 'jkssb.pdf'
                    pdf.write_bytes(b'%PDF-1.4 fixture')
                    return {'outcome': 'changed', 'body_path': str(pdf),
                            'snapshot': {'document_kind': 'pdf'}}
                if url == MYSARKARINAUKRI_LISTING_URL:
                    listing = Path(directory) / 'mysarkarinaukri.html'
                    listing.write_text(
                        '<article class="msn-job-card"><h3 class="job-title">Court Recruitment</h3>'
                        '<a title="Official Notification" href="https://example.gov.in/notice.pdf">PDF</a>'
                        '</article>'
                    )
                    return {'outcome': 'changed', 'body_path': str(listing),
                            'snapshot': {'document_kind': 'html'}}
                if 'example.gov.in/notice.pdf' in url:
                    pdf = Path(directory) / 'mysarkarinaukri.pdf'
                    pdf.write_bytes(b'%PDF-1.4 fixture')
                    return {'outcome': 'changed', 'body_path': str(pdf),
                            'snapshot': {'document_kind': 'pdf'}}
                self.fail(f'unexpected active source: {url}')
            result = collect(Path(directory) / 'store', capture)
            self.assertEqual(result['status'], 'partial_failure')
            for source in ('ncs', 'employment_news', 'ibps', 'india_post', 'drdo', 'isro'):
                self.assertEqual(result['sources'][source], {
                    'status': 'blocked', 'reason': 'discovery_not_connected',
                })
            self.assertEqual(result['sources']['sarkariresult']['discovered'], 1)
            self.assertEqual(result['sources']['sarkariresult']['captured'], 1)
            self.assertEqual(result['sources']['ssc']['discovered'], 1)
            self.assertEqual(result['sources']['ssc']['captured'], 1)
            self.assertEqual(result['sources']['upsc']['discovered'], 1)
            self.assertEqual(result['sources']['upsc']['captured'], 1)
            self.assertEqual(result['sources']['uppsc']['discovered'], 1)
            self.assertEqual(result['sources']['uppsc']['captured'], 1)
            self.assertEqual(result['sources']['hssc']['discovered'], 1)
            self.assertEqual(result['sources']['hssc']['captured'], 1)
            self.assertEqual(result['sources']['jkssb']['discovered'], 1)
            self.assertEqual(result['sources']['jkssb']['captured'], 1)
            self.assertEqual(result['sources']['mysarkarinaukri']['discovered'], 1)
            self.assertEqual(result['sources']['mysarkarinaukri']['captured'], 1)
            self.assertEqual(len(calls), 14)
            self.assertEqual(set(LISTINGS), {'sarkariresult', 'ssc', 'upsc', 'uppsc', 'hssc', 'jkssb', 'mysarkarinaukri',
                          'ncs', 'employment_news', 'ibps', 'india_post', 'drdo', 'isro'})
            self.assertEqual(len(DISABLED_LISTINGS), 25)
            self.assertTrue({
                'hpsc', 'dsssb',
                'rajasthan_recruitment', 'times_of_india_jobs',
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
