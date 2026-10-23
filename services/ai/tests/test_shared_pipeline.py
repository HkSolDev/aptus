import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from recover_documents import capture_and_normalize
from shared_pipeline import prepare_source, prepare_sources


def pdf_bytes(lines):
    # A real, small selectable-text PDF; exercise pdfplumber, not a fake reader.
    stream = b'BT /F1 12 Tf 40 750 Td 15 TL\n'
    for line in lines:
        escaped = line.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
        stream += b'(' + escaped.encode('ascii') + b') Tj T*\n'
    stream += b'ET'
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>',
               b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
               b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] '
               b'/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
               b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
               b'<< /Length ' + str(len(stream)).encode() + b' >>\nstream\n' + stream + b'\nendstream']
    body, offsets = b'%PDF-1.4\n', []
    for index, value in enumerate(objects, 1):
        offsets.append(len(body))
        body += f'{index} 0 obj\n'.encode() + value + b'\nendobj\n'
    xref = len(body)
    body += b'xref\n0 6\n0000000000 65535 f \n'
    body += b''.join(f'{offset:010} 00000 n \n'.encode() for offset in offsets)
    return body + b'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + str(xref).encode() + b'\n%%EOF'


class SharedPipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.base = 'https://example.gov.in'
        self.identity = ['Recruitment Notice', 'Issuer: Example Board',
                         'Campaign: Engineers', 'Advertisement No: EB/01/2026']
        self.pages = {
            '/': ('html', '<html><a href="/careers">Careers</a></html>'),
            '/careers': ('html', '<html><h1>Recruitment</h1><a href="/notice">Recruitment notice</a>'
                        '<a href="/result">Result</a></html>'),
            '/notice': ('html', '<html><h1>Recruitment Notice</h1>'
                        + ''.join(f'<p>{line}</p>' for line in self.identity[1:])
                        + '<p>Last date: 30 November 2026</p>'
                        '<a href="/files/details">Detailed recruitment advertisement PDF</a>'
                        '<a href="/files/details#page=1">Download recruitment notice</a></html>'),
            '/files/details': ('pdf', pdf_bytes(self.identity + [
                'EDUCATIONAL QUALIFICATIONS', 'Bachelor degree required.',
                'AGE LIMIT', 'Minimum age 18 years. Maximum age 27 years.'])),
        }
        self.fetched = []

    def process(self, url, root):
        def capture(destination, storage):
            self.fetched.append(destination)
            path = destination.removeprefix(self.base)
            kind, value = self.pages[path]
            body = value.encode() if isinstance(value, str) else value
            file = self.root / f'body-{len(self.fetched)}'
            file.write_bytes(body)
            return {'outcome': 'changed', 'body_path': str(file), 'final_url': destination,
                    'snapshot_id': f'snapshot-{len(self.fetched)}', 'sha256': str(len(body)),
                    'snapshot': {'document_kind': kind}}
        return capture_and_normalize(url, root, capture_document=capture)

    def run_source(self, **options):
        return prepare_source({'id': 'new_board', 'url': self.base + '/', 'enabled': True,
                               'kind': 'official', 'reason': None}, self.root / 'run',
                              process=self.process, **options)

    def test_multihop_real_html_and_pdf_reach_same_evidence_input(self):
        report = self.run_source()
        self.assertEqual(len(self.fetched), 4)
        self.assertNotIn(self.base + '/result', self.fetched)
        bundles = json.loads(Path(report['bundles_path']).read_text())['bundles']
        combined = next(bundle for bundle in bundles if len(bundle['documents']) == 2)
        self.assertEqual({doc['format'] for doc in combined['documents']}, {'html', 'pdf'})
        prepared = json.loads((Path(report['output_dir']) / f"{combined['bundle_id']}.prepared.json").read_text())
        payload = prepared['llm_input']['input']
        self.assertEqual({doc['format'] for doc in payload['documents']}, {'html', 'pdf'})
        text = json.dumps(payload)
        self.assertIn('30 November 2026', text)
        self.assertIn('Bachelor degree required', text)
        pdf = next(doc for doc in payload['documents'] if doc['format'] == 'pdf')
        self.assertTrue(any(unit['locations'][0].get('page') == 1 for unit in pdf['sections']))
        self.assertNotIn('%PDF-', text)
        crawl = json.loads(Path(report['crawl_path']).read_text())
        self.assertEqual(len([edge for edge in crawl['edges'] if edge['url'].endswith('/files/details')]), 1)
        self.assertEqual(len(next(edge for edge in crawl['edges']
                                  if edge['url'].endswith('/files/details'))['occurrences']), 2)

    def test_budget_and_depth_limits_report_unchecked_links(self):
        report = self.run_source(max_fetches=2)
        self.assertEqual(report['status'], 'partial')
        self.assertEqual(len(self.fetched), 2)
        crawl = json.loads(Path(report['crawl_path']).read_text())
        self.assertIn(self.base + '/notice', [item['url'] for item in crawl['unchecked']])
        self.fetched.clear()
        report = self.run_source(max_depth=1)
        self.assertEqual(report['status'], 'partial')
        self.assertEqual(len(self.fetched), 2)

    def test_corrupt_pdf_is_not_fed_to_html_or_ai_preparation(self):
        self.pages['/files/details'] = ('pdf', b'%PDF-1.4 broken')
        report = self.run_source()
        crawl = json.loads(Path(report['crawl_path']).read_text())
        self.assertEqual(report['status'], 'partial')
        self.assertTrue(any(item.get('reason') == 'pdf_requires_review' for item in crawl['pages']))
        bundles = json.loads(Path(report['bundles_path']).read_text())['bundles']
        self.assertFalse(any(doc['format'] == 'pdf' for bundle in bundles for doc in bundle['documents']))

    def test_distinct_campaigns_do_not_merge_and_failure_does_not_stop_sibling(self):
        self.pages['/careers'] = ('html', '<html><h1>Recruitment</h1>'
            '<a href="/notice">Recruitment notice</a>'
            '<a href="/second">Recruitment advertisement</a>'
            '<a href="/broken">Recruitment notification</a></html>')
        self.pages['/second'] = ('html', self.pages['/notice'][1].replace('EB/01/2026', 'EB/02/2026')
                                .replace('href="/files/details"', 'href="/unused"'))
        report = self.run_source()
        bundles = json.loads(Path(report['bundles_path']).read_text())['bundles']
        identities = [bundle['identity']['advertisement_number'] for bundle in bundles]
        self.assertIn('EB/01/2026', identities)
        self.assertIn('EB/02/2026', identities)
        self.assertEqual(report['status'], 'partial')

    def test_disabled_source_and_invalid_limits_do_no_work(self):
        source = {'id': 'new_board', 'url': self.base + '/', 'enabled': False,
                  'kind': 'official', 'reason': None}
        self.assertEqual(prepare_source(source, self.root / 'off', process=self.process)['status'], 'disabled')
        self.assertFalse(self.fetched)
        for options in ({'max_fetches': 0}, {'max_depth': 9}, {'max_fetches': True}):
            with self.assertRaises(ValueError):
                self.run_source(**options)

    def test_registry_adds_new_source_without_adapter_and_disables_next_run(self):
        config = self.root / 'sources.json'
        source = {'id': 'new_board', 'url': self.base + '/', 'enabled': True,
                  'kind': 'official', 'reason': None}
        config.write_text(json.dumps([source]))
        reports = prepare_sources(self.root / 'registered', sources_path=config, process=self.process)
        self.assertEqual(reports[0]['source'], 'new_board')
        self.assertGreater(reports[0]['prepared_inputs'], 0)
        source['enabled'] = False
        config.write_text(json.dumps([source]))
        before = len(self.fetched)
        self.assertEqual(prepare_sources(self.root / 'registered', sources_path=config,
                                        process=self.process)[0]['status'], 'disabled')
        self.assertEqual(len(self.fetched), before)
        self.assertTrue(Path(reports[0]['crawl_path']).exists())

    def test_worker_prepare_only_uses_registry_from_another_working_directory(self):
        config = self.root / 'sources.json'
        config.write_text(json.dumps([{'id': 'new_board', 'url': self.base + '/',
                                      'enabled': False, 'kind': 'official', 'reason': None}]))
        worker = Path(__file__).resolve().parents[1] / 'worker_schedule.py'
        result = subprocess.run([sys.executable, str(worker), '--once', '--prepare-only',
                                 '--sources', str(config), '--storage-dir', str(self.root / 'worker')],
                                cwd=self.root, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.loads(result.stdout)
        self.assertEqual(output['route'], 'generic_shared_crawl')
        self.assertEqual(output['sources']['new_board']['crawl_status'], 'disabled')
        self.assertEqual(output['sources']['new_board']['extracted'], 0)

    def test_unsupported_json_listing_does_not_produce_evidence(self):
        self.pages['/'] = ('json', '{"items":[]}')
        report = self.run_source()
        crawl = json.loads(Path(report['crawl_path']).read_text())
        self.assertEqual(crawl['pages'][0]['status'], 'failed')
        self.assertEqual(crawl['pages'][0]['reason'], 'unsupported_listing_format')
        self.assertNotEqual(crawl['status'], 'scanned')
        self.assertEqual(crawl['documents'], [])
        self.assertEqual(report['prepared_inputs'], 0)

    def test_empty_rss_listing_is_scanned_without_preparing_job_evidence(self):
        self.pages['/'] = ('xml', '<rss version="2.0"><channel><title>Jobs</title></channel></rss>')
        report = self.run_source()
        crawl = json.loads(Path(report['crawl_path']).read_text())
        self.assertEqual(crawl['status'], 'scanned')
        self.assertEqual(crawl['documents'], [])
        self.assertEqual(report['prepared_inputs'], 0)


if __name__ == '__main__':
    unittest.main()
