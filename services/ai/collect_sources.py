"""Scheduled discovery/capture only; never calls an AI provider or publishes."""

import fcntl
import json
from pathlib import Path

from capture import capture
from capture_store import atomic_write, now, read_state
from sources.sarkariresult import RSS_URL, discover_feed
from sources.rajasthan_recruitment import LISTING_URL as RAJASTHAN_LISTING_URL

ACCEPTED = {'changed', 'identical', 'revalidated'}
LISTINGS = {'sarkariresult': (RSS_URL, None)}

# A public Rajasthan listing exists, but it does not expose stable public notice
# URLs. Keep it visible to operators without scheduling it for capture/extraction.
DISABLED_LISTINGS = {
    'rajasthan_recruitment': {
        'listing_url': RAJASTHAN_LISTING_URL,
        'reason': 'public_detail_url_not_verified',
    },
}


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
