"""Process one due recovery task; callers can continue other pipeline work."""

import hashlib
import fcntl
import json
from pathlib import Path
from uuid import uuid4
from concurrent.futures import ProcessPoolExecutor

from capture import capture
from capture_store import atomic_write
from normalize_html import normalize_html
from normalize_pdf import normalize_pdf
from stage_retry import is_transient_capture_error
from select_pdf_sections import complete_pdf_sections, select_pdf_sections
from source_transport import read_listing


def capture_and_normalize(url, root, *, capture_document=None, source_id=None):
    # Separate URL stores avoid races in capture's shared attempts/state files.
    root = Path(root) / hashlib.sha256(url.encode()).hexdigest()
    root.mkdir(parents=True, exist_ok=True)
    with (root / 'capture.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        result = (capture_document or capture)(url, root)
    if result['outcome'] not in {'changed', 'identical', 'revalidated'}:
        reason = result.get('reason', 'capture_failed')
        http_status = result.get('http_status')
        if reason == 'HTTPStatusError' and http_status:
            reason = f'http_{http_status}'
        retryable = is_transient_capture_error(reason, http_status=http_status)
        return None, reason, retryable
    body = Path(result['body_path']).read_bytes()
    kind = result['snapshot']['document_kind']
    if kind == 'pdf':
        full = normalize_pdf(body, result['final_url'], max_pages=100)
        if not full['pages']:
            return None, 'pdf_requires_review', False
        content = complete_pdf_sections(select_pdf_sections(full), full)
    elif kind == 'html':
        full = normalize_html(body, result['final_url'], include_link_context=True)
        content = full
    elif kind in {'xml', 'json'}:
        try:
            listing = read_listing(
                body,
                result['final_url'],
                content_type=result['snapshot'].get('content_type', ''),
                document_kind=kind,
                source_id=source_id,
            )
        except ValueError as error:
            reason = str(error) if str(error) in {
                'invalid_rss_xml', 'rss_root_missing', 'rss_channel_missing',
                'invalid_ssc_response', 'ssc_records_missing', 'unsupported_listing_format',
                'invalid_json', 'empty_rss_content'
            } else 'invalid_listing_response'
            return None, reason, False
        output = root / 'normalized-runs' / uuid4().hex
        atomic_write(output / 'listing.json', json.dumps(listing, ensure_ascii=False, indent=2).encode())
        return {
            'source_url': url,
            'final_url': result['final_url'],
            'sha256': result['sha256'],
            'snapshot_id': result['snapshot_id'],
            'body_path': result['body_path'],
            'document_kind': kind,
            'is_listing': True,
            'listing': listing,
            'listing_path': str((output / 'listing.json').resolve()),
        }, None, False
    else:
        return None, 'unsupported_document_type', False
    # Preserve the full normalized source for local coverage recovery.
    output = root / 'normalized-runs' / uuid4().hex
    for name, value in (('normalized', full), ('selected', content)):
        atomic_write(output / f'{name}.json', json.dumps(value, ensure_ascii=False).encode())
    return {'source_url': url, 'final_url': result['final_url'],
            'sha256': result['sha256'], 'snapshot_id': result['snapshot_id'],
            'body_path': result['body_path'], 'document_kind': full['format'],
            'normalized_path': str((output / 'normalized.json').resolve()),
            'content_path': str((output / 'selected.json').resolve())}, None, False


def recover_one(queue, root, *, process=capture_and_normalize):
    task = queue.claim_next()
    if task is None:
        return {'status': 'no_due_task'}
    try:
        result, reason, retryable = process(task['url'], root)
    except Exception:
        # Unexpected errors require review; do not persist exception strings/URLs.
        result, reason, retryable = None, 'processing_failed', False
    accepted = queue.finish(task, result=result, reason=reason, retryable=retryable)
    return {'url': task['url'], 'attempt': task['attempts'],
            'completion_accepted': accepted, 'reason': reason}


def recover_due(queue, root, *, workers=2, limit=10):
    if not 1 <= workers <= 4 or not 1 <= limit <= 50:
        raise ValueError('Use 1–4 workers and 1–50 tasks per run')
    # Separate processes keep CPU-heavy PDF parsing out of the caller's work.
    with ProcessPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(recover_one, queue, root) for _ in range(limit)]
        return [result for future in futures
                if (result := future.result()).get('status') != 'no_due_task']


if __name__ == '__main__':
    import argparse
    from recovery_queue import RecoveryQueue
    parser = argparse.ArgumentParser(description='Recover due public documents without an LLM call')
    parser.add_argument('queue_db')
    parser.add_argument('storage_dir')
    parser.add_argument('--request', help='JSON file containing bundle_id and missing_urls')
    parser.add_argument('--bundle', help='Show durable bundle recovery status')
    parser.add_argument('--workers', type=int, default=2)
    parser.add_argument('--limit', type=int, default=10)
    args = parser.parse_args()
    queue = RecoveryQueue(args.queue_db)
    if args.request:
        request = json.loads(Path(args.request).read_text())
        print(json.dumps(queue.request(request['bundle_id'], request['missing_urls'])))
    else:
        print(json.dumps(recover_due(queue, args.storage_dir, workers=args.workers, limit=args.limit)))
    if args.bundle:
        print(json.dumps(queue.bundle(args.bundle)))
