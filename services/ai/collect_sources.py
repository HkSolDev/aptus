"""Scheduled discovery/capture only; never calls an AI provider or publishes."""

import fcntl
import json
from pathlib import Path

from capture import capture
from capture_store import atomic_write, now, read_state
from sources.catalog import DISABLED_SOURCES
from sources.sarkariresult import RSS_URL, discover_feed
from sources.ssc import NOTICE_BOARD_URL as SSC_NOTICE_BOARD_URL, discover_listings as discover_ssc_listings
from sources.upsc import LISTING_URL as UPSC_LISTING_URL, discover_listings as discover_upsc_listings
from sources.uppsc import LISTING_URL as UPPSC_LISTING_URL, discover_listings as discover_uppsc_listings

ACCEPTED = {'changed', 'identical', 'revalidated'}
LISTINGS = {
    'sarkariresult': (RSS_URL, None),
    'ssc': (SSC_NOTICE_BOARD_URL, None),
    'upsc': (UPSC_LISTING_URL, None),
    'uppsc': (UPPSC_LISTING_URL, None),
}

DISABLED_LISTINGS = DISABLED_SOURCES


def collect(root, capture_document=capture):
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    with (root / 'collection.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {'status': 'already_running'}
        report = {'checked_at': now(), 'status': 'completed', 'sources': {}}
        for source, (url, _) in LISTINGS.items():
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
    args = parser.parse_args()
    result = collect(args.storage_dir)
    print(json.dumps(result))
    raise SystemExit(1 if result['status'] == 'partial_failure' else 0)
