import json
import tempfile
import unittest
from pathlib import Path

from collect_sources import collect
from source_registry import load_sources


class SourceRegistryTests(unittest.TestCase):
    def test_disabling_or_removing_source_stops_fetches_and_preserves_history(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / 'sources.json'
            history = root / 'store' / 'sarkariresult' / 'discovered.json'
            history.parent.mkdir(parents=True)
            history.write_text('[{"url":"https://example.gov.in/notice"}]')
            for entries in ([{'id': 'sarkariresult', 'url': 'https://example.org/feed',
                              'enabled': False, 'kind': 'third_party', 'reason': None}], []):
                config.write_text(json.dumps(entries))
                result = collect(root / 'store',
                                 lambda *args: self.fail('Disabled source was fetched'),
                                 sources_path=config)
                self.assertEqual(result['sources'], {})
                self.assertTrue(history.exists())

    def test_custom_file_drives_fetch_instead_of_hardcoded_listing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / 'sources.json'
            url = 'https://example.org/recruitment-feed'
            config.write_text(json.dumps([{'id': 'sarkariresult', 'url': url,
                                          'enabled': True, 'kind': 'third_party', 'reason': None}]))
            feed = root / 'feed.xml'
            feed.write_text('<rss><channel></channel></rss>')
            calls = []

            def capture(destination, storage):
                calls.append(destination)
                return {'outcome': 'changed', 'body_path': str(feed),
                        'snapshot': {'document_kind': 'xml'}}

            result = collect(root / 'store', capture, sources_path=config)
            self.assertEqual(calls, [url])
            self.assertEqual(result['status'], 'completed')

    def test_invalid_registry_fails_before_any_fetch_or_state_write(self):
        entry = {'id': 'ssc', 'url': 'https://example.gov.in/', 'enabled': True,
                 'kind': 'official', 'reason': None}
        invalid = [None, [entry, entry], [{**entry, 'id': '../escape'}],
                   [{**entry, 'enabled': 'false'}], [{**entry, 'url': 'file:///tmp/x'}],
                   [{**entry, 'url': 'https://user:password@example.org/'}],
                   [{**entry, 'url': 'http://localhost/'}],
                   [{**entry, 'kind': 'trusted'}]]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / 'sources.json'
            for value in invalid:
                with self.subTest(value=value):
                    config.write_text(json.dumps(value))
                    with self.assertRaises(ValueError):
                        collect(root / 'store', lambda *args: self.fail('Invalid config fetched'),
                                sources_path=config)
                    self.assertFalse((root / 'store').exists())

    def test_default_registry_preserves_existing_source_selection(self):
        sources = load_sources()
        self.assertEqual({row['id'] for row in sources if row['enabled']},
                         {'sarkariresult', 'ssc', 'upsc', 'uppsc', 'hssc', 'jkssb', 'mysarkarinaukri'})
        self.assertEqual(sum(not row['enabled'] for row in sources), 25)

    def test_new_source_reports_missing_discovery_without_fetching(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / 'sources.json'
            config.write_text(json.dumps([{'id': 'new_board', 'url': 'https://example.gov.in/',
                                          'enabled': True, 'kind': 'official', 'reason': None}]))
            result = collect(root / 'store', lambda *args: self.fail('Unconnected source fetched'),
                             sources_path=config)
            self.assertEqual(result['status'], 'partial_failure')
            self.assertEqual(result['sources']['new_board']['reason'], 'discovery_not_connected')


if __name__ == '__main__':
    unittest.main()
