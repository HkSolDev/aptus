import unittest
from unittest.mock import MagicMock

import httpx

from review_validation_worker import (
    claim_and_run_once,
    process_claimed_task,
    validate_revision_payload,
)
import test_validate_candidate


class ReviewValidationWorkerTests(unittest.TestCase):
    def test_deterministic_validation_success_without_model(self):
        result, source = test_validate_candidate.CandidateValidationTests().candidate()
        task = {
            'task_id': 'task_1',
            'bundle_id': source['bundle_id'],
            'facts': result['facts'],
            'source_evidence': source['documents'],
            'revision_hash': 'abc123hash',
            'claim_token': 'token123',
        }
        output = validate_revision_payload(task)
        self.assertEqual(output['status'], 'needs_review')
        self.assertEqual(output['disposition'], 'valid_recruitment_review_draft')
        self.assertEqual(output['errors'], [])
        self.assertEqual(output['revision_hash'], 'abc123hash')
        self.assertFalse(output['semantic_support_verified'])

    def test_deterministic_validation_reports_errors_for_invalid_facts(self):
        result, source = test_validate_candidate.CandidateValidationTests().candidate(
            min_age=45, max_age=25
        )
        task = {
            'task_id': 'task_2',
            'bundle_id': source['bundle_id'],
            'facts': result['facts'],
            'source_evidence': source['documents'],
            'revision_hash': 'badhash456',
            'claim_token': 'token456',
        }
        output = validate_revision_payload(task)
        self.assertEqual(output['status'], 'blocked')
        self.assertTrue(len(output['errors']) > 0)
        reasons = [e['reason'] for e in output['errors']]
        self.assertIn('minimum_exceeds_maximum', reasons)

    def test_process_claimed_task_submits_result_to_api(self):
        result, source = test_validate_candidate.CandidateValidationTests().candidate()
        task = {
            'task_id': 'task_claim_1',
            'bundle_id': source['bundle_id'],
            'facts': result['facts'],
            'source_evidence': source['documents'],
            'revision_hash': 'hash789',
            'claim_token': 'secret_claim_token',
        }

        mock_client = MagicMock(spec=httpx.Client)
        mock_response = MagicMock(spec=httpx.Response)
        mock_response.status_code = 200
        mock_response.raise_for_status.return_value = None
        mock_response.json.return_value = {'task_id': 'task_claim_1', 'status': 'completed'}
        mock_client.post.return_value = mock_response

        outcome = process_claimed_task(task, 'http://127.0.0.1:8081', 'test_ingest_token', client=mock_client)
        self.assertEqual(outcome['status'], 'completed')
        self.assertEqual(outcome['task_id'], 'task_claim_1')

        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        self.assertIn('/api/internal/review-tasks/task_claim_1/result', call_args[0][0])
        payload = call_args[1]['json']
        self.assertEqual(payload['claim_token'], 'secret_claim_token')
        self.assertEqual(payload['revision_hash'], 'hash789')
        self.assertEqual(payload['result']['status'], 'needs_review')

    def test_claim_and_run_once_when_no_task_available(self):
        mock_client = MagicMock(spec=httpx.Client)
        mock_response = MagicMock(spec=httpx.Response)
        mock_response.status_code = 200
        mock_response.raise_for_status.return_value = None
        mock_response.json.return_value = {'task': None}
        mock_client.post.return_value = mock_response

        outcome = claim_and_run_once('http://127.0.0.1:8081', 'token', client=mock_client)
        self.assertIsNone(outcome)


if __name__ == '__main__':
    unittest.main()
