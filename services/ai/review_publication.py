"""Explicit operator approval and retryable delivery of immutable review drafts."""
import hashlib
import json
from pathlib import Path

import httpx

from capture_store import atomic_write, now
from stage_retry import StageRetries
from store_candidate import StorageCandidate
from validate_candidate import validate_candidate


def reviewed_draft(path):
    raw = Path(path).read_bytes()
    if len(raw) > 1_000_000:
        raise ValueError('Draft too large')
    draft = StorageCandidate.model_validate_json(raw).model_dump(mode='json')
    source = {'bundle_id': draft['bundle_id'], 'documents': draft['source_evidence']}
    report = validate_candidate({'bundle_id': draft['bundle_id'], 'facts': draft['facts']}, source)
    if (draft['disposition'] != 'valid_recruitment_review_draft'
            or report['disposition'] != 'valid_recruitment_review_draft'):
        raise ValueError('Only grounded recruitment drafts can be approved')
    return raw.decode('utf-8'), hashlib.sha256(raw).hexdigest(), draft


def validate_review(reviewer, note):
    if (not isinstance(reviewer, str) or not 1 <= len(reviewer.strip()) <= 100
            or not isinstance(note, str) or not 1 <= len(note.strip()) <= 1500
            or any(ord(c) < 32 or ord(c) == 127 for c in reviewer + note)):
        raise ValueError('Identified review and note required')


def approve(root, path, reviewer, note):
    validate_review(reviewer, note)
    _, digest, draft = reviewed_draft(path)
    approval = {'draft_sha256': digest, 'reviewed_by': reviewer.strip(),
                'note': note.strip(), 'bundle_id': draft['bundle_id'], 'approved_at': now()}
    # The operator approves exact bytes, not a mutable bundle ID or filename.
    target = Path(root) / 'publication' / 'approvals' / f'{digest}.json'
    atomic_write(target, json.dumps(approval, ensure_ascii=False).encode())
    return approval


def publish(root, path, *, send=None, clock=None):
    raw, digest, draft = reviewed_draft(path)
    root = Path(root)
    approval = json.loads((root / 'publication' / 'approvals' / f'{digest}.json').read_text())
    if (not isinstance(approval, dict) or approval.get('draft_sha256') != digest
            or approval.get('bundle_id') != draft['bundle_id']):
        raise ValueError('Draft approval mismatch')
    validate_review(approval.get('reviewed_by'), approval.get('note'))
    retries = StageRetries(root, clock)
    receipt_path = root / 'publication' / 'receipts' / f'{digest}.json'
    with retries.lock('publication', digest):
        if receipt_path.exists():
            payload = receipt_path.read_bytes()
            if hashlib.sha256(payload).hexdigest() != retries.read('publication', digest).get('receipt_sha256'):
                raise ValueError('Publication receipt integrity mismatch')
            receipt = json.loads(payload)
            _validate_receipt(receipt, digest, len(draft['facts']['posts']))
            return receipt
        if not retries.begin('publication', digest):
            return retries.read('publication', digest)
        if send is None:
            from pipeline import push_to_ts
            send = push_to_ts
        try:
            receipt = send({'reviewed_candidate_json': raw, 'approval': approval})
            _validate_receipt(receipt, digest, len(draft['facts']['posts']))
            payload = json.dumps(receipt).encode()
            atomic_write(receipt_path, payload)
            retries.success('publication', digest, receipt_sha256=hashlib.sha256(payload).hexdigest())
            return receipt
        except httpx.HTTPStatusError as error:
            code = error.response.status_code
            retries.failure('publication', digest, f'ingest_http_{code}',
                            retryable=code in {408, 429, 500, 502, 503, 504})
            raise RuntimeError('publication_failed') from None
        except httpx.HTTPError:
            # Delivery is idempotent on the server, including a lost response
            # after commit. Retrying these bytes never requires another AI call.
            retries.failure('publication', digest, 'ingest_network_failed', retryable=True)
            raise RuntimeError('publication_failed') from None
        except (OSError, ValueError, TypeError):
            retries.failure('publication', digest, 'invalid_publication_receipt')
            raise RuntimeError('publication_failed') from None
        except RuntimeError:
            retries.failure('publication', digest, 'ingest_configuration_failed')
            raise RuntimeError('publication_failed') from None


def _validate_receipt(receipt, digest, count):
    if (not isinstance(receipt, dict) or receipt.get('draft_sha256') != digest
            or not isinstance(receipt.get('candidate_id'), str) or not receipt['candidate_id']
            or not isinstance(receipt.get('content_hash'), str)
            or len(receipt['content_hash']) != 64
            or any(c not in '0123456789abcdef' for c in receipt['content_hash'])
            or not isinstance(receipt.get('post_ids'), list)
            or len(receipt['post_ids']) != count
            or any(not isinstance(item, str) or not item for item in receipt['post_ids'])
            or len(set(receipt['post_ids'])) != count):
        raise ValueError('Invalid publication receipt')


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Approve or publish one reviewed recruitment draft')
    parser.add_argument('action', choices=['approve', 'publish'])
    parser.add_argument('root', type=Path)
    parser.add_argument('draft', type=Path)
    parser.add_argument('--reviewer')
    parser.add_argument('--note')
    args = parser.parse_args()
    try:
        result = (approve(args.root, args.draft, args.reviewer, args.note)
                  if args.action == 'approve' else publish(args.root, args.draft))
        print(json.dumps(result))
    except (OSError, ValueError, RuntimeError, KeyError):
        print(json.dumps({'status': 'blocked', 'reason': 'reviewed_publication_failed'}))
        raise SystemExit(1)
