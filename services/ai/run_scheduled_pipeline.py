"""Collect, extract, validate and ingest public jobs with durable retry state."""

import fcntl
import hashlib
import json
from pathlib import Path

from capture_store import atomic_write, now, read_state, usable_snapshot
from collect_sources import collect
from extract import extract_posts
from pipeline import push_to_ts, validate_extracted_posts
from sources.sarkariresult import parse_page

MAX_EXTRACTION_ATTEMPTS = 3


def read_json(path, default):
    return json.loads(path.read_text()) if path.exists() else default


def save_state(path, state):
    atomic_write(path, json.dumps(state, ensure_ascii=False, indent=2).encode())


def pending_path(root, url, digest):
    key = hashlib.sha256(url.encode()).hexdigest()
    return root / 'pending' / f'{key}-{digest}.json'


def counts(report, source):
    return report['sources'].setdefault(source, {
        'published': 0, 'unchanged': 0, 'pending': 0, 'failed': 0, 'blocked': 0,
    })


def accepted_ingest(result):
    return isinstance(result, dict) and isinstance(result.get('created'), int) \
        and result['created'] > 0


def run_pipeline(root, *, collect_documents=collect, parse_document=parse_page,
                 extract_document=extract_posts, push=push_to_ts):
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    with (root / 'pipeline.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {'status': 'already_running'}

        collection = collect_documents(root)
        report = {'checked_at': now(), 'status': 'completed', 'sources': {}}
        state_path = root / 'pipeline-state.json'
        state = read_json(state_path, {'items': {}})

        for path in sorted((root / 'pending').glob('*.json')) if (root / 'pending').exists() else []:
            item = read_json(path, {})
            source = item.get('source', 'unknown')
            try:
                result = push(item['payload'])
                if not accepted_ingest(result):
                    raise RuntimeError('ingest_created_no_posts')
                state['items'][item['url']] = {
                    'sha256': item['sha256'], 'status': 'published', 'updated_at': now(),
                }
                save_state(state_path, state)
                path.unlink()
                counts(report, source)['published'] += 1
            except (KeyError, OSError, RuntimeError, ValueError):
                counts(report, source)['pending'] += 1
                report['status'] = 'partial_failure'

        for source, source_result in collection.get('sources', {}).items():
            if source_result.get('status') != 'completed':
                counts(report, source)['failed'] += 1
                report['status'] = 'partial_failure'
                continue
            discovered_path = root / source / 'discovered.json'
            try:
                jobs = read_json(discovered_path, [])
            except (OSError, ValueError):
                counts(report, source)['failed'] += 1
                report['status'] = 'partial_failure'
                continue
            for job in jobs:
                previous = {}
                digest = None
                job_url = ''
                try:
                    if not isinstance(job, dict):
                        raise ValueError('invalid_discovered_job')
                    job_url = job['url']
                    _, capture_state = read_state(root / source / 'documents', job_url)
                    if not usable_snapshot(capture_state):
                        continue
                    snapshot = capture_state['snapshot']
                    digest = snapshot['sha256']
                    previous = state['items'].get(job_url, {})
                    if previous.get('sha256') == digest and previous.get('status') == 'published':
                        counts(report, source)['unchanged'] += 1
                        continue
                    pending = pending_path(root, job_url, digest)
                    if pending.exists():
                        continue
                    if (previous.get('sha256') == digest
                            and previous.get('attempts', 0) >= MAX_EXTRACTION_ATTEMPTS):
                        counts(report, source)['blocked'] += 1
                        continue

                    html = Path(snapshot['body_path']).read_text(encoding='utf-8', errors='replace')
                    page = parse_document(html)
                    posts = validate_extracted_posts(
                        page, extract_document(page.text, sections=page.sections)
                    )
                    if not posts or any(not (post.post_name or '').strip() for post in posts):
                        raise ValueError('empty_or_unnamed_posts')
                    payload = {
                        'source_url': job_url,
                        'source_name': f"{source}: {job['title']}",
                        'raw_hash': digest,
                        'notification_pdf_url': page.links.get('notification_pdf_url'),
                        'official_site_url': page.links.get('official_site_url'),
                        'apply_url': page.links.get('apply_url'),
                        'source_text': page.text,
                        'posts': [post.model_dump(mode='json') for post in posts],
                    }
                    try:
                        result = push(payload)
                        if not accepted_ingest(result):
                            raise RuntimeError('ingest_created_no_posts')
                    except Exception:
                        atomic_write(pending, json.dumps({
                            'source': source, 'url': job_url, 'sha256': digest,
                            'payload': payload,
                        }, ensure_ascii=False).encode())
                        state['items'][job_url] = {
                            'sha256': digest, 'status': 'pending', 'updated_at': now(),
                        }
                        save_state(state_path, state)
                        counts(report, source)['pending'] += 1
                        report['status'] = 'partial_failure'
                        continue
                    state['items'][job_url] = {
                        'sha256': digest, 'status': 'published', 'updated_at': now(),
                    }
                    save_state(state_path, state)
                    counts(report, source)['published'] += 1
                except (KeyError, OSError, RuntimeError, TypeError, ValueError):
                    attempts = (previous.get('attempts', 0) + 1
                                if previous.get('sha256') == digest else 1)
                    if job_url:
                        state['items'][job_url] = {
                            'sha256': digest, 'status': 'failed',
                            'attempts': attempts, 'updated_at': now(),
                        }
                        save_state(state_path, state)
                    counts(report, source)['failed'] += 1
                    report['status'] = 'partial_failure'

        atomic_write(root / 'latest-pipeline-run.json', json.dumps(report).encode())
        return report


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Run the bounded Aptus job pipeline once')
    parser.add_argument('storage_dir')
    args = parser.parse_args()
    result = run_pipeline(args.storage_dir)
    print(json.dumps(result))
    raise SystemExit(1 if result['status'] == 'partial_failure' else 0)
