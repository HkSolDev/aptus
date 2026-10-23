"""A source crawl budget is distinct from the completeness of one notice."""
import unittest

from build_extraction_input import is_extraction_approved, prepare_extraction
from test_extraction_input import sample_bundle, gap


class NoticeCrawlReadinessTests(unittest.TestCase):
    def test_unvisited_sibling_notices_do_not_block_complete_evidence(self):
        crawl = {'status': 'partial', 'unchecked': [
            {'url': 'https://example.gov.in/other-job', 'reason': 'fetch_budget'}]}
        prepared = prepare_extraction(sample_bundle(), crawl=crawl)
        self.assertTrue(is_extraction_approved(prepared))
        self.assertIn('source_crawl_partial', prepared['coverage']['review_reasons'])

    def test_unrelated_fetch_failure_does_not_block_notice(self):
        prepared = prepare_extraction(sample_bundle(), crawl={
            'status': 'partial', 'pages': [{'url': 'https://example.gov.in/other-job',
                                         'status': 'failed'}]})
        self.assertTrue(is_extraction_approved(prepared))

    def test_missing_required_document_still_waits_then_blocks(self):
        for attempt, expected in ((0, 'waiting_for_document'), (1, 'needs_review')):
            prepared = prepare_extraction(sample_bundle(linked=True), crawl_status='partial',
                                          missing_documents=[gap()], recovery_pass=attempt)
            self.assertEqual(prepared['coverage']['status'], expected)
            self.assertIsNone(prepared['llm_input'])

    def test_blocked_source_is_not_a_budget_warning(self):
        prepared = prepare_extraction(sample_bundle(), crawl_status='blocked')
        self.assertFalse(is_extraction_approved(prepared))
        self.assertIn('crawl_incomplete', prepared['coverage']['review_reasons'])


if __name__ == '__main__':
    unittest.main()
