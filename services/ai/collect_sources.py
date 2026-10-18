"""Scheduled discovery/capture only; never calls an AI provider or publishes."""

import fcntl
import json
from pathlib import Path

from capture import capture
from capture_store import atomic_write, now, read_state
from source_registry import DEFAULT_SOURCES_PATH, load_sources
from sources.sarkariresult import discover_feed
from sources.ssc import discover_listings as discover_ssc_listings
from sources.upsc import discover_listings as discover_upsc_listings
from sources.uppsc import discover_listings as discover_uppsc_listings
from sources.hssc import discover_listings as discover_hssc_listings
from sources.jkssb import discover_listings as discover_jkssb_listings
from sources.mysarkarinaukri import discover_listings as discover_mysarkarinaukri_listings

ACCEPTED = {'changed', 'identical', 'revalidated'}
CONNECTED_DISCOVERY = {'sarkariresult', 'ssc', 'upsc', 'uppsc', 'hssc', 'jkssb', 'mysarkarinaukri'}
# Compatibility views for callers inspecting the default configuration.
LISTINGS = {row['id']: (row['url'], None) for row in load_sources() if row['enabled']}
DISABLED_LISTINGS = {row['id']: {'listing_url': row['url'], 'kind': row['kind'],
                                'reason': row['reason']}
                     for row in load_sources() if not row['enabled']}


def collect(root, capture_document=capture, *, sources_path=DEFAULT_SOURCES_PATH):
    sources = load_sources(sources_path)
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    with (root / 'collection.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {'status': 'already_running'}
        report = {'checked_at': now(), 'status': 'completed', 'sources': {}}
        for entry in sources:
            if not entry['enabled']:
                continue
            source, url = entry['id'], entry['url']
            if source not in CONNECTED_DISCOVERY:
                report['sources'][source] = {'status': 'blocked', 'reason': 'discovery_not_connected'}
                report['status'] = 'partial_failure'
                continue
            source_root = root / source
            try:
                listing = capture_document(url, source_root / 'listing')
                if listing['outcome'] not in ACCEPTED:
                    raise ValueError('listing_capture_failed')
                kind = listing['snapshot']['document_kind']
                if source == 'sarkariresult':
                    if kind != 'xml':
                        raise ValueError('listing_not_xml')
                    jobs = discover_feed(Path(listing['body_path']).read_bytes())
                elif source == 'upsc':
                    if kind != 'html':
                        raise ValueError('listing_not_html')
                    jobs = discover_upsc_listings(
                        Path(listing['body_path']).read_text(encoding='utf-8', errors='replace')
                    )
                elif source == 'ssc':
                    if kind != 'json':
                        raise ValueError('listing_not_json')
                    jobs = discover_ssc_listings(json.loads(
                        Path(listing['body_path']).read_text(encoding='utf-8')
                    ))
                elif source == 'uppsc':
                    if kind != 'html':
                        raise ValueError('listing_not_html')
                    jobs = discover_uppsc_listings(
                        Path(listing['body_path']).read_text(encoding='utf-8', errors='replace')
                    )
                elif source == 'hssc':
                    if kind != 'html':
                        raise ValueError('listing_not_html')
                    jobs = discover_hssc_listings(
                        Path(listing['body_path']).read_text(encoding='utf-8', errors='replace')
                    )
                elif source == 'jkssb':
                    if kind != 'html':
                        raise ValueError('listing_not_html')
                    jobs = discover_jkssb_listings(
                        Path(listing['body_path']).read_text(encoding='utf-8', errors='replace')
                    )
                elif source == 'mysarkarinaukri':
                    if kind != 'html':
                        raise ValueError('listing_not_html')
                    jobs = discover_mysarkarinaukri_listings(
                        Path(listing['body_path']).read_text(encoding='utf-8', errors='replace')
                    )
                else:
                    raise ValueError('source_dispatch_missing')
                atomic_write(source_root / 'discovered.json', json.dumps(jobs).encode())
                documents = source_root / 'documents'
                # Revisit least recently attempted URLs first; one failure cannot starve others.
                def checked_at(job):
                    _, state = read_state(documents, job['url'])
                    return state.get('last_attempt', {}).get('checked_at', '')
                selected = sorted(jobs, key=checked_at)[:3]
                captured = failed = 0
                for job in selected:
                    result = capture_document(job['url'], documents)
                    if result['outcome'] in ACCEPTED:
                        captured += 1
                    else:
                        failed += 1
                report['sources'][source] = {'status': 'completed', 'discovered': len(jobs),
                                             'captured': captured, 'failed': failed}
                if failed:
                    report['status'] = 'partial_failure'
            except (ValueError, OSError, UnicodeError, KeyError):
                report['sources'][source] = {'status': 'blocked', 'reason': 'source_collection_failed'}
                report['status'] = 'partial_failure'
        atomic_write(root / 'latest-run.json', json.dumps(report).encode())
        return report


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(
        description='Collect active public job documents, without AI calls'
    )
    parser.add_argument('storage_dir')
    parser.add_argument('--sources', type=Path, default=DEFAULT_SOURCES_PATH)
    args = parser.parse_args()
    result = collect(args.storage_dir, sources_path=args.sources)
    print(json.dumps(result))
    raise SystemExit(1 if result['status'] == 'partial_failure' else 0)
