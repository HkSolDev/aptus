"""Stage 3 contract tests, authored before reading the Stage 3 implementation.

Synthetic evidence exercises grouping and the real preparation boundary offline.
Only crawling is replaced in pipeline tests; grouping and input preparation run.
"""
import copy
import hashlib
import itertools
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from verify_bundle import verify_bundles
from shared_pipeline import prepare_source
from build_extraction_input import prepare_extraction
from notice_state import compute_evidence_fingerprint

HOSTS = {'Example Commission': ['jobs.example.gov.in'],
         'Other Commission': ['other.example.gov.in']}
BASE = 'https://jobs.example.gov.in/'


def notice(identifier, *, kind='html', title='Recruitment Notice',
           issuer='Example Commission', ad='EC/01/2026', campaign='Engineers',
           year='2026', extra='', links=()):
    lines = [title]
    for label, value in [('Issuer', issuer), ('Advertisement No', ad),
                         ('Campaign', campaign), ('Recruitment Year', year)]:
        if value:
            lines.append(f'{label}: {value}')
    lines.append('Post: Engineer. Age limit: 18 to 30 years. Bachelor degree required.')
    if extra:
        lines.append(extra)
    url = BASE + identifier + ('.pdf' if kind == 'pdf' else '')
    content = {'source_url': url, 'format': kind, 'title': title,
               'links': [{'url': target, 'text': 'Detailed recruitment notice',
                          'owner': {'block': 0}} for target in links]}
    text = '\n'.join(lines)
    if kind == 'html':
        content['blocks'] = [{'type': 'paragraph', 'text': text}]
    else:
        content['sections'] = [{'text': text, 'evidence': [{'page': 1,
                                'block_id': 'p1', 'line_range': [1, len(lines)]}]}]
    return {'document_id': identifier, 'source_url': url, 'format': kind, 'content': content}


def grouped(documents, edges=()):
    return verify_bundles(copy.deepcopy(documents), issuer_hosts=HOSTS,
                          edges=list(edges))['bundles']


def membership(bundles):
    return {frozenset(d['document_id'] for d in b['documents']) for b in bundles}


def prepared(documents, edges=(), hosts=HOSTS):
    source = {'id': 'example', 'url': BASE, 'kind': 'official',
              'enabled': True, 'reason': None}
    crawl = {'status': 'scanned', 'pages': [], 'documents': copy.deepcopy(documents),
             'edges': list(edges), 'unchecked': []}
    with tempfile.TemporaryDirectory() as directory:
        with patch('shared_pipeline.crawl_source', return_value=crawl):
            result = prepare_source(source, directory, issuer_hosts=hosts)
        return [json.loads(Path(path).read_text()) for path in result['prepared_paths']]


class IdentityMatchingTests(unittest.TestCase):
    def test_same_identity_groups_html_pdf_and_amendment(self):
        docs = [notice('html'), notice('pdf', kind='pdf'),
                notice('update', title='Corrigendum', extra='Last date is extended for the post of Engineer.')]
        self.assertEqual(membership(grouped(docs)), {frozenset(['html', 'pdf', 'update'])})

    def test_explicit_identifiers_keep_recruitments_separate(self):
        alternatives = [dict(ad='EC/02/2026'), dict(issuer='Other Commission'),
                        dict(year='2027'), dict(campaign='Nurses')]
        for alternative in alternatives:
            with self.subTest(alternative=alternative):
                self.assertEqual(len(grouped([notice('a'), notice('b', **alternative)])), 2)

    def test_missing_year_does_not_split_same_ad(self):
        self.assertEqual(len(grouped([notice('a'), notice('b', year=None, kind='pdf')])), 1)

    def test_campaign_only_attaches_to_unique_candidate(self):
        self.assertEqual(len(grouped([notice('a'), notice('b', ad=None, kind='pdf')])), 1)

    def test_weak_identity_cannot_bridge_two_advertisements(self):
        bundles = grouped([notice('a'), notice('b', ad='EC/02/2026'),
                           notice('weak', ad=None, kind='pdf')])
        self.assertEqual(membership(bundles), {frozenset(['a']), frozenset(['b']), frozenset(['weak'])})
        weak = next(b for b in bundles if b['documents'][0]['document_id'] == 'weak')
        self.assertEqual(weak['status'], 'needs_review')

    def test_campaign_editions_and_years_remain_separate(self):
        for change in [dict(year='2027'), dict(campaign='CRP RRBs XVI')]:
            with self.subTest(change=change):
                self.assertEqual(len(grouped([notice('a', ad=None, campaign='CRP RRBs XV'),
                    notice('b', ad=None, **({'campaign': 'CRP RRBs XV'} | change))])), 2)

    def test_multiple_advertisements_in_one_document_remain_review_only(self):
        docs = [notice('a'), notice('b', ad='EC/02/2026'), notice('update', title='Corrigendum',
                extra='Advertisement No: EC/02/2026')]
        update = next(b for b in grouped(docs) if any(d['document_id'] == 'update' for d in b['documents']))
        self.assertEqual(len(update['documents']), 1)
        self.assertEqual(update['status'], 'needs_review')


class DocumentRelationshipTests(unittest.TestCase):
    def test_direct_notice_link_associates_compatible_pdf(self):
        pdf = notice('pdf', kind='pdf', ad=None, campaign=None, year=None)
        html = notice('html', links=[pdf['source_url']])
        self.assertEqual(len(grouped([html, pdf])), 1)

    def test_shared_host_or_listing_parent_is_not_identity(self):
        docs = [notice('a', ad=None, campaign=None, year=None),
                notice('b', kind='pdf', ad=None, campaign=None, year=None)]
        edges = [{'parent_url': BASE + 'board', 'url': d['source_url'],
                  'title': 'Recruitment notice'} for d in docs]
        self.assertEqual(len(grouped(docs, edges)), 2)

    def test_link_cannot_override_conflicting_identifier(self):
        pdf = notice('pdf', kind='pdf', ad='EC/02/2026')
        html = notice('html', links=[pdf['source_url']])
        self.assertEqual(len(grouped([html, pdf])), 2)

    def test_hub_cannot_bridge_distinct_recruitments(self):
        a, b = notice('a'), notice('b', ad='EC/02/2026', campaign='Nurses')
        hub = notice('hub', title='Recruitment Notice Board', ad=None, campaign=None,
                     year=None, links=[a['source_url'], b['source_url']])
        groups = membership(grouped([hub, a, b]))
        self.assertFalse(any({'a', 'b'} <= group for group in groups))
        self.assertTrue(frozenset(['hub']) in groups)

    def test_repeated_edges_do_not_duplicate_members(self):
        pdf = notice('pdf', kind='pdf')
        html = notice('html', links=[pdf['source_url']])
        edge = {'parent_url': html['source_url'], 'url': pdf['source_url'], 'title': 'Detailed notice'}
        bundles = grouped([html, pdf], [edge, edge])
        self.assertEqual(membership(bundles), {frozenset(['html', 'pdf'])})
        self.assertEqual(len(bundles[0]['documents']), 2)

    def test_original_evidence_and_locations_are_preserved(self):
        docs = [notice('html'), notice('pdf', kind='pdf')]
        before = copy.deepcopy(docs)
        bundles = grouped(docs)
        for doc in bundles[0]['documents']:
            original = next(d for d in before if d['document_id'] == doc['document_id'])
            self.assertEqual(doc['content'], original['content'])
        self.assertEqual(docs, before)


class AmendmentTests(unittest.TestCase):
    def test_extensions_are_corrigenda_not_main_notices(self):
        for title in ['Extension of last date for recruitment',
                      'Recruitment closing date extension']:
            with self.subTest(title=title):
                bundles = grouped([notice('main'), notice('update', title=title,
                           extra='Last date is extended for the post of Engineer.')])
                update = next(d for b in bundles for d in b['documents'] if d['document_id'] == 'update')
                self.assertEqual(update['role'], 'corrigendum')
                self.assertIn('deadline', update['amendment_scope']['changes'])

    def test_ordinary_deadline_is_not_an_amendment(self):
        main = grouped([notice('main', extra='Application closing date: 30 November 2026.')])[0]
        self.assertEqual(main['documents'][0]['role'], 'main_notice')

    def test_cancellation_and_vacancy_update_preserve_scope(self):
        for title, text, role in [('Cancellation', 'Recruitment is cancelled.', 'cancellation'),
             ('Corrigendum', 'Vacancies have been revised for the post of Engineer.', 'corrigendum')]:
            with self.subTest(title=title):
                bundles = grouped([notice('main'), notice('update', title=title, extra=text)])
                self.assertEqual(len(bundles), 1)
                update = next(d for d in bundles[0]['documents'] if d['document_id'] == 'update')
                self.assertEqual(update['role'], role)
                self.assertIsNotNone(update['amendment_scope'])
                self.assertIn('amendment_or_cancellation_scope_needs_review', bundles[0]['review_reasons'])

    def test_unmatched_amendment_is_isolated_and_blocked(self):
        docs = [notice('main'), notice('update', title='Corrigendum', ad='EC/99/2026')]
        bundles = grouped(docs)
        update = next(b for b in bundles if any(d['document_id'] == 'update' for d in b['documents']))
        self.assertEqual(len(update['documents']), 1)
        self.assertEqual(update['status'], 'needs_review')
        self.assertTrue(all(p['llm_input'] is None for p in prepared([docs[1]])))

    def test_ambiguous_amendment_does_not_choose_first_main(self):
        docs = [notice('a'), notice('b', ad='EC/02/2026'),
                notice('update', title='Corrigendum', ad=None)]
        bundle = next(b for b in grouped(docs) if any(d['document_id'] == 'update' for d in b['documents']))
        self.assertEqual(len(bundle['documents']), 1)
        self.assertEqual(bundle['status'], 'needs_review')

    def test_results_and_admit_cards_are_not_main_recruitment_evidence(self):
        for title in ['Recruitment examination result', 'Recruitment admit card']:
            with self.subTest(title=title):
                outputs = prepared([notice('other', title=title)])
                self.assertTrue(all(p['llm_input'] is None for p in outputs))


class ExtractionBoundaryTests(unittest.TestCase):
    def test_conflicting_campaign_blocks_ai_preparation(self):
        outputs = prepared([notice('a'), notice('b', campaign='Nurses')])
        self.assertTrue(outputs)
        self.assertTrue(all(p['llm_input'] is None for p in outputs))

    def test_two_unresolved_main_pdfs_block_preparation(self):
        outputs = prepared([notice('a', kind='pdf'), notice('b', kind='pdf')])
        self.assertTrue(all(p['llm_input'] is None for p in outputs))

    def test_compatible_html_pdf_pair_can_prepare(self):
        outputs = prepared([notice('a'), notice('b', kind='pdf')])
        self.assertEqual(len(outputs), 1)
        self.assertIsNotNone(outputs[0]['llm_input'])

    def test_issuer_host_mapping_is_forwarded_without_promoting_mirror(self):
        for base, expected in [(BASE, 'official_host_candidate'),
                               ('https://mirror.example/', 'needs_review')]:
            with self.subTest(base=base):
                doc = notice('main')
                doc['source_url'] = base + 'main'
                doc['content']['source_url'] = doc['source_url']
                outputs = prepared([doc])
                payload = outputs[0]['llm_input']
                if payload is not None:
                    self.assertEqual(payload['input']['documents'][0]['authority'], expected)
                else:
                    self.assertEqual(expected, 'needs_review')


class StableNoticeIdentityTests(unittest.TestCase):
    def test_existing_strong_identity_retains_legacy_id(self):
        expected = hashlib.sha256(json.dumps(('example commission', 'ad',
                                   'ec/01/2026', '2026')).encode()).hexdigest()[:24]
        self.assertEqual(grouped([notice('main')])[0]['bundle_id'], expected)

    def test_document_and_edge_order_do_not_change_membership_or_ids(self):
        docs = [notice('main'), notice('pdf', kind='pdf', ad=None),
                notice('update', title='Corrigendum', year=None)]
        edges = [{'parent_url': docs[0]['source_url'], 'url': d['source_url']} for d in docs[1:]]
        expected = None
        for order in itertools.permutations(docs):
            for edge_order in [edges, list(reversed(edges))]:
                result = {(b['bundle_id'], frozenset(d['document_id'] for d in b['documents']))
                          for b in grouped(list(order), edge_order)}
                if expected is None:
                    expected = result
                self.assertEqual(result, expected)

    def test_aggregate_identity_fills_missing_values_independent_of_order(self):
        docs = [notice('a', campaign=None), notice('b', kind='pdf')]
        first, second = grouped(docs)[0], grouped(list(reversed(docs)))[0]
        self.assertEqual(first['identity'], second['identity'])
        self.assertEqual(first['identity']['campaign'], 'Engineers')

    def test_amendment_keeps_notice_id_and_changes_fingerprint(self):
        main = notice('main')
        before = grouped([main])[0]
        after = grouped([main, notice('update', title='Corrigendum',
                        extra='Vacancies have been revised for the post of Engineer.')])[0]
        self.assertEqual(before['bundle_id'], after['bundle_id'])
        def fingerprint(bundle):
            # Reuse the real evidence conversion; compare fingerprints only when
            # coverage permits it. Grouping review does not erase source evidence.
            candidate = copy.deepcopy(bundle)
            candidate['review_reasons'] = []
            for doc in candidate['documents']:
                doc['review_reasons'] = []
            payload = prepare_extraction(candidate)['llm_input']['input']
            return compute_evidence_fingerprint(payload)
        self.assertNotEqual(fingerprint(before), fingerprint(after))


if __name__ == '__main__':
    unittest.main()
