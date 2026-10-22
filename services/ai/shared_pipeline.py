"""Shared source-to-evidence pilot. Saves review artifacts; never calls AI or ingestion."""

import fcntl
import json
from pathlib import Path

from build_extraction_input import prepare_extraction
from capture_store import atomic_write
from shared_crawl import crawl_source
from source_registry import DEFAULT_SOURCES_PATH, load_sources, validate_sources
from verify_bundle import verify_bundles


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
        crawl = crawl_source(source['url'], root, **crawl_options)
        verified = verify_bundles(crawl['documents'])
        bundles_path = root / 'bundles.json'
        atomic_write(bundles_path, json.dumps(verified, ensure_ascii=False, indent=2).encode())
        prepared_count = 0
        prepared_paths = []
        for bundle in verified['bundles']:
            prepared = prepare_extraction(bundle)
            reasons = set()
            if crawl['status'] != 'scanned':
                reasons.add('crawl_incomplete')
            if 'insufficient_campaign_identity' in bundle['review_reasons']:
                reasons.add('insufficient_campaign_identity')
            if 'missing_main_notice' in bundle['review_reasons']:
                reasons.add('missing_main_notice')
            for doc in bundle['documents']:
                if doc['format'] == 'pdf' and (
                    doc['content'].get('coverage', {}).get('unreadable_pages')
                    or not doc['content'].get('sections')
                ):
                    reasons.add('pdf_requires_review')
            if reasons:
                prepared['llm_input'] = None
                prepared['coverage']['status'] = 'needs_review'
                prepared['coverage']['review_reasons'] = sorted(
                    set(prepared['coverage']['review_reasons']) | reasons)
            prepared_count += prepared['llm_input'] is not None
            path = root / f"{bundle['bundle_id']}.prepared.json"
            prepared_paths.append(str(path.resolve()))
            atomic_write(path,
                         json.dumps(prepared, ensure_ascii=False, indent=2).encode())
        status = ('blocked' if crawl['status'] == 'blocked' else
                  'partial' if crawl['status'] == 'partial' else 'prepared_for_review')
        summary = {'source': source['id'], 'status': status, 'pages': len(crawl['pages']),
                   'documents': len(crawl['documents']), 'bundles': len(verified['bundles']),
                   'prepared_inputs': prepared_count, 'unchecked': len(crawl['unchecked']),
                   'output_dir': str(root.resolve()), 'crawl_path': str((root / 'crawl.json').resolve()),
                   'bundles_path': str(bundles_path.resolve()), 'ai_called': False, 'published': False}
        if status == 'blocked':
            summary['reason'] = 'unsupported_seed_type'
        summary['prepared_paths'] = prepared_paths
        atomic_write(root / 'summary.json', json.dumps(summary, indent=2).encode())
        return summary


def prepare_sources(root, *, sources_path=DEFAULT_SOURCES_PATH, source_id=None, **crawl_options):
    sources = load_sources(sources_path)
    if source_id is not None:
        sources = [row for row in sources if row['id'] == source_id]
        if not sources:
            raise ValueError('unknown_source_id')
    return [prepare_source(source, Path(root) / source['id'], **crawl_options) for source in sources]


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
