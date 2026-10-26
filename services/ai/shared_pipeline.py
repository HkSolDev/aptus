"""Shared source-to-evidence pilot. Saves review artifacts; never calls AI or ingestion."""

import fcntl
import json
import hashlib
from pathlib import Path

from build_extraction_input import prepare_extraction
from capture_store import atomic_write
from shared_crawl import crawl_source
from source_registry import DEFAULT_SOURCES_PATH, load_sources, validate_sources
from verify_bundle import verify_bundles
from recovery_queue import RecoveryQueue
from recover_documents import recover_one


def prepare_source(source, root, **crawl_options):
    # The same registry validation protects direct Python callers and the CLI.
    validate_sources([source])
    if not source.get('enabled'):
        return {'source': source['id'], 'status': 'disabled'}
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    with (root / 'shared.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {'source': source['id'], 'status': 'already_running'}
        crawl_opts = dict(crawl_options)
        crawl_opts.setdefault('source_id', source.get('id'))
        issuer_hosts = crawl_opts.pop('issuer_hosts', None) or source.get('issuer_hosts') or {}
        recovery = RecoveryQueue(root / 'recovery.sqlite3')
        for _ in range(5):
            if recover_one(recovery, root / 'recovery').get('status') == 'no_due_task':
                break
        crawl = crawl_source(source['url'], root, **crawl_opts)
        verified = verify_bundles(crawl['documents'], issuer_hosts=issuer_hosts, edges=crawl.get('edges'))
        # Only dependencies of notices in this crawl can contribute evidence.
        recovered = []
        for bundle in verified['bundles']:
            for task in recovery.bundle(bundle['bundle_id'])['tasks']:
                result = task.get('result')
                if task['status'] != 'done' or not result or result.get('is_listing'):
                    continue
                try:
                    recovered.append({'document_id': hashlib.sha256(result['final_url'].encode()).hexdigest()[:24],
                                      'source_url': result['final_url'], 'format': result['document_kind'],
                                      'content': json.loads(Path(result['content_path']).read_text())})
                except (OSError, ValueError, KeyError):
                    continue  # Missing local recovery artifacts cannot grant approval.
        if recovered:
            documents = {doc['document_id']: doc for doc in recovered + crawl['documents']}
            verified = verify_bundles(list(documents.values()), issuer_hosts=issuer_hosts, edges=crawl.get('edges'))
        bundles_path = root / 'bundles.json'
        atomic_write(bundles_path, json.dumps(verified, ensure_ascii=False, indent=2).encode())
        prepared_count = 0
        prepared_paths = []
        for bundle in verified['bundles']:
            prepared = prepare_extraction(bundle, crawl=crawl, recovery_queue=recovery)
            prepared_count += prepared.get('llm_input') is not None
            path = root / f"{bundle['bundle_id']}.prepared.json"
            prepared_paths.append(str(path.resolve()))
            atomic_write(path,
                         json.dumps(prepared, ensure_ascii=False, indent=2).encode())
        status = ('blocked' if crawl['status'] == 'blocked' else
                  'failed' if crawl['status'] == 'failed' else
                  'partial' if crawl['status'] == 'partial' else 'prepared_for_review')
        summary = {'source': source['id'], 'status': status, 'pages': len(crawl['pages']),
                   'documents': len(crawl['documents']), 'bundles': len(verified['bundles']),
                   'prepared_inputs': prepared_count, 'unchecked': len(crawl['unchecked']),
                   'output_dir': str(root.resolve()), 'crawl_path': str((root / 'crawl.json').resolve()),
                   'bundles_path': str(bundles_path.resolve()), 'ai_called': False, 'published': False,
                   'capture_attempts': crawl.get('capture_attempts', 0),
                   'cooldown_skips': crawl.get('cooldown_skips', 0)}
        if status == 'blocked':
            summary['reason'] = 'unsupported_seed_type'
        elif status == 'failed':
            summary['reason'] = crawl.get('reason') or 'crawl_failed'
            if crawl.get('errors'):
                summary['errors'] = list(crawl['errors'])
        elif crawl.get('errors'):
            summary['errors'] = list(crawl['errors'])
        summary['prepared_paths'] = prepared_paths
        atomic_write(root / 'summary.json', json.dumps(summary, indent=2).encode())
        return summary


def prepare_sources(root, *, sources_path=DEFAULT_SOURCES_PATH, source_id=None, issuer_hosts=None, **crawl_options):
    sources = load_sources(sources_path)
    if source_id is not None:
        sources = [row for row in sources if row['id'] == source_id]
        if not sources:
            raise ValueError('unknown_source_id')
    opts = dict(crawl_options)
    if issuer_hosts is not None:
        opts['issuer_hosts'] = issuer_hosts
    return [prepare_source(source, Path(root) / source['id'], **opts) for source in sources]


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Prepare a source through shared discovery; no AI/publication')
    parser.add_argument('source_id')
    parser.add_argument('storage_dir', type=Path)
    parser.add_argument('--sources', type=Path, default=DEFAULT_SOURCES_PATH)
    parser.add_argument('--max-fetches', type=int, default=12)
    parser.add_argument('--max-depth', type=int, default=3)
    args = parser.parse_args()
    result = prepare_sources(args.storage_dir, sources_path=args.sources, source_id=args.source_id,
                             max_fetches=args.max_fetches, max_depth=args.max_depth)
    print(json.dumps(result))
