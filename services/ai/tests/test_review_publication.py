"""Stage 7: approval binds bytes, and delivery resumes without model work."""
import json
import tempfile
import unittest
from pathlib import Path

import httpx

from review_publication import approve, publish
from store_candidate import prepare_storage
import test_validate_candidate


def fixture(path):
    result, source = test_validate_candidate.CandidateValidationTests().candidate()
    result['bundle_id'] = source['bundle_id']
    draft = prepare_storage(result, source, source_name='Illustrative recruitment')
    draft['source_evidence'] = source['documents']
    path.write_text(json.dumps(draft))
    return draft


class ReviewedPublicationTests(unittest.TestCase):
    def test_non_job_and_ungrounded_drafts_cannot_be_approved(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / 'draft.json'
            draft = fixture(path)
            draft['facts']['purpose'] = 'result'
            path.write_text(json.dumps(draft))
            with self.assertRaises(ValueError):
                approve(root, path, 'Fixture reviewer', 'Checked')
            draft = fixture(path)
            draft['facts']['purpose_evidence'][0]['quote'] = 'Invented evidence'
            path.write_text(json.dumps(draft))
            with self.assertRaises(ValueError):
                approve(root, path, 'Fixture reviewer', 'Checked')
            self.assertFalse((root / 'publication').exists())

    def test_unapproved_or_changed_draft_never_sends(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / 'draft.json'
            fixture(path)
            calls = []
            with self.assertRaises(OSError):
                publish(root, path, send=calls.append)
            approve(root, path, 'Test reviewer', 'Checked original evidence')
            path.write_text(path.read_text() + ' ')
            with self.assertRaises(OSError):
                publish(root, path, send=calls.append)
            self.assertEqual(calls, [])

    def test_network_failure_retries_only_delivery_then_reuses_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / 'draft.json'
            draft = fixture(path)
            approval = approve(root, path, 'Test reviewer', 'Checked original evidence')
            clock = [1000]
            calls = []
            def send(body):
                calls.append(body)
                if len(calls) == 1:
                    raise httpx.ReadTimeout('Illustrative lost response')
                return {'draft_sha256': approval['draft_sha256'], 'candidate_id': 'candidate1',
                        'content_hash': 'a' * 64,
                        'post_ids': [f'post{i}' for i in range(len(draft['facts']['posts']))]}
            with self.assertRaises(RuntimeError):
                publish(root, path, send=send, clock=lambda: clock[0])
            self.assertEqual(publish(root, path, send=send, clock=lambda: clock[0])['status'], 'retry_wait')
            clock[0] += 31
            receipt = publish(root, path, send=send, clock=lambda: clock[0])
            self.assertEqual(publish(root, path, send=send), receipt)
            self.assertEqual(len(calls), 2)
            self.assertEqual(calls[0], calls[1])


if __name__ == '__main__':
    unittest.main()
