"""Bounded static discovery using shared capture/normalization; no extraction calls."""

import hashlib
import json
from pathlib import Path

from capture_store import atomic_write
from link_discovery import discover_links, url_identity
from recover_documents import capture_and_normalize


def crawl_source(url, root, *, process=capture_and_normalize, max_fetches=12, max_depth=3):
    if (type(max_fetches) is not int or not 1 <= max_fetches <= 30
            or type(max_depth) is not int or not 0 <= max_depth <= 4):
        raise ValueError('Use 1–30 fetches and 0–4 link levels')
    seed = url_identity(url, url)
    if not seed:
        raise ValueError('Invalid source URL')
    root = Path(root)
    report = {'seed_url': seed, 'status': 'scanning', 'pages': [], 'edges': [],
              'unchecked': [], 'documents': [], 'seed_status': 'pending'}
    queue = [{'url': seed, 'depth': 0, 'priority': 100}]
    visited = set()
    queued = {seed}

    def save():
        atomic_write(root / 'crawl.json', json.dumps(report, ensure_ascii=False, indent=2).encode())

    while queue and len(report['pages']) < max_fetches:
        queue.sort(key=lambda item: (-item['priority'], item['depth']))
        item = queue.pop(0)
        if item['url'] in visited:
            continue
        visited.add(item['url'])
        page = {**item, 'status': 'failed'}
        report['pages'].append(page)
        try:
            result, reason, retryable = process(item['url'], root / 'capture')
            if result is None:
                page.update(reason=reason, retryable=retryable)
                if item['depth'] == 0 and reason == 'unsupported_document_type':
                    report['seed_status'] = 'unsupported_document_type'
                save()
                continue
            page.update(status='normalized', result=result)
            if item['depth'] == 0:
                report['seed_status'] = 'normalized'
            final_url = result['final_url']
            visited.add(url_identity(final_url, final_url))
            content = json.loads(Path(result['content_path']).read_text())
            kind = result['document_kind']
            identifier = hashlib.sha256(final_url.encode()).hexdigest()[:24]
            if not any(doc['document_id'] == identifier for doc in report['documents']):
                report['documents'].append({'document_id': identifier, 'source_url': final_url,
                                            'format': kind, 'content': content})
            if kind == 'html':
                # Use normalized content for evidence and captured HTML for existing link scoring.
                html = Path(result['body_path']).read_bytes()
                links = discover_links(html.decode('utf-8', errors='replace'), final_url)['destinations']
                for link in links:
                    report['edges'].append({'parent_url': final_url, **link})
                    if link['priority'] <= 0 or link['url'] in queued or link['url'] in visited:
                        continue
                    child = {'url': link['url'], 'depth': item['depth'] + 1,
                             'priority': link['priority']}
                    queued.add(link['url'])
                    if child['depth'] > max_depth or len(queued) > 1000:
                        report['unchecked'].append({**child, 'reason': 'discovery_limit'})
                    else:
                        queue.append(child)
        except Exception:
            # Source content and network exception messages must not enter operator logs.
            page.update(status='failed', reason='document_processing_failed')
        save()
    report['unchecked'].extend({**item, 'reason': 'fetch_budget'} for item in queue
                                if item['url'] not in visited)
    failed = any(page['status'] == 'failed' for page in report['pages'])
    if report['seed_status'] == 'unsupported_document_type':
        report['status'] = 'blocked'
    else:
        report['status'] = 'partial' if report['unchecked'] or failed else 'scanned'
    # 'scanned' means the bounded positive-score frontier, never complete site coverage.
    save()
    return report
