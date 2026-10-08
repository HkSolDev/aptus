"""Heuristic evidence hints, not proof that a recruitment field is absent."""

import json
import re

from link_discovery import url_identity
from verify_bundle import content_units


FIELD_HINTS = {
    'posts': r'\b(?:posts?|designation|cadre)\b',
    'vacancies': r'\b(?:vacanc(?:y|ies)|number of posts)\b',
    'education': r'\b(?:educational? qualifications?|essential qualifications?|degree|diploma)\b',
    'age': r'\b(?:age limit|minimum age|maximum age|age relaxation|years of age)\b',
    'category_relaxation': r'\b(?:reservation|relaxation|SC|ST|OBC|EWS|PwBD)\b',
    'dates': r'\b(?:last date|closing date|deadline|application dates?|registration)\b',
    'fee': r'\b(?:application fees?|examination fees?|intimation charges|payment of fees?)\b',
}


def linked_amendment_gaps(bundle):
    """Only follow one unambiguous labelled link for an explicit amendment target."""
    fields = {'qualification': 'education', 'reservation': 'category_relaxation',
              'deadline': 'dates'}
    gaps = []
    for document in bundle['documents']:
        scope = document.get('amendment_scope') or {}
        for item in scope.get('evidence', []):
            for target in item.get('applies_to', []):
                if not re.match(r'^(Annexure|Appendix)\b', target, re.I):
                    continue
                pattern = r'\b' + re.escape(target).replace(r'\ ', r'\s*[-–]?\s*') + r'\b'
                urls = {link['url'] for link in document['content'].get('links', [])
                        if re.search(pattern, link.get('text', '') + ' ' +
                                     json.dumps(link.get('context', {}), ensure_ascii=False), re.I)}
                if len(urls) == 1:
                    affected = [fields.get(field, field) for field in item['changes']
                                if fields.get(field, field) in FIELD_HINTS]
                    gaps.append({'source_document_id': document['document_id'],
                                 'url': urls.pop(), 'quote': item['quote'], 'fields': affected})
    return gaps


def bundle_units(bundle):
    if not isinstance(bundle, dict) or not isinstance(bundle.get('bundle_id'), str):
        raise ValueError('A verified bundle with bundle_id is required')
    documents = bundle.get('documents')
    if not isinstance(documents, list) or not documents:
        raise ValueError('Bundle needs documents')
    units, seen = [], set()
    for document in documents:
        if not isinstance(document, dict):
            raise ValueError('Every document must be an object')
        identifier = document.get('document_id')
        if not isinstance(identifier, str) or not identifier or identifier in seen:
            raise ValueError('Document IDs must be nonempty and unique')
        if document.get('format') not in {'html', 'pdf'} or not isinstance(document.get('content'), dict):
            raise ValueError('Document needs normalized HTML/PDF content')
        source_url = document.get('source_url')
        if not isinstance(source_url, str) or not url_identity(source_url, source_url):
            raise ValueError('Document needs a valid public-document URL')
        seen.add(identifier)
        for index, (text, locations) in enumerate(content_units(document['content'], document['format'])):
            if not isinstance(text, str) or not isinstance(locations, list):
                raise ValueError('Sections need source text and locations')
            units.append({'document_id': identifier, 'evidence_id': f'{identifier}:unit-{index}',
                          'text': text, 'locations': locations})
        context = document['content'].get('identity_context')
        if context:
            if not isinstance(context.get('text'), str) or not isinstance(context.get('evidence'), list):
                raise ValueError('Identity context needs source text and evidence')
            units.append({'document_id': identifier, 'evidence_id': f'{identifier}:identity',
                          'text': context['text'], 'locations': context['evidence']})
    return units


def check_coverage(bundle, *, missing_documents=None, recovery_pass=0):
    """A missing keyword is a focus hint. Only explicit linked gaps request capture."""
    if type(recovery_pass) is not int or recovery_pass not in {0, 1}:
        raise ValueError('Only initial and post-recovery coverage passes are supported')
    units = bundle_units(bundle)
    evidence = {}
    for field, pattern in FIELD_HINTS.items():
        hits = [{key: unit[key] for key in ('document_id', 'evidence_id', 'locations')}
                for unit in units if re.search(pattern, unit['text'], re.I)]
        evidence[field] = {'status': 'candidate_found' if hits else 'not_located', 'matches': hits}
    focus = [field for field, item in evidence.items() if item['status'] == 'not_located']
    changes_to_fields = {'qualification': 'education', 'reservation': 'category_relaxation',
                         'deadline': 'dates'}
    for document in bundle['documents']:
        for change in (document.get('amendment_scope') or {}).get('changes', []):
            field = changes_to_fields.get(change, change)
            if field in FIELD_HINTS and field not in focus:
                focus.append(field)
    reasons = set(bundle.get('review_reasons', []))
    for document in bundle['documents']:
        reasons.update(document.get('review_reasons', []))
        coverage = document['content'].get('coverage', {})
        if any(coverage.get(key) for key in ('unreadable_pages', 'unavailable_blocks', 'omitted_sections')):
            reasons.add('content_coverage_gap')
        if coverage.get('unresolved_references'):
            reasons.add('unresolved_document_references')
    present = {url_identity(url, url) for document in bundle['documents']
               for url in (document['source_url'], document.get('final_url', document['source_url']))}
    documents = {item['document_id']: item for item in bundle['documents']}
    missing = []
    if missing_documents is not None and not isinstance(missing_documents, list):
        raise ValueError('Missing documents must be an array')
    dependencies = linked_amendment_gaps(bundle) if missing_documents is None else missing_documents
    if not isinstance(dependencies, list) or len(dependencies) > 50:
        raise ValueError('Provide at most 50 evidence-backed missing documents')
    for gap in dependencies:
        if not isinstance(gap, dict):
            raise ValueError('Missing document entries must be objects')
        source = documents.get(gap.get('source_document_id'))
        url = gap.get('url')
        url = url_identity(url, url) if isinstance(url, str) and len(url) <= 4096 else None
        quote, fields = gap.get('quote'), gap.get('fields', [])
        if not source or not url or not isinstance(quote, str) or not quote.strip():
            raise ValueError('Missing document needs source_document_id, URL and source quote')
        if not isinstance(fields, list) or any(field not in FIELD_HINTS for field in fields):
            raise ValueError('Dependency fields must use known coverage field names')
        matches = [unit for unit in units if unit['document_id'] == source['document_id']
                   and quote in unit['text']]
        links = {url_identity(link['url'], link['url']) for link in source['content'].get('links', [])}
        if not matches or (url not in links and url not in quote):
            raise ValueError('Dependency must have an actual source quote and linked URL')
        if url in present:
            continue
        missing.append({'url': url, 'source_document_id': source['document_id'], 'quote': quote,
                        'fields': fields, 'evidence_ids': [unit['evidence_id'] for unit in matches]})
        focus.extend(field for field in fields if field not in focus)
    if missing:
        reasons.add('missing_referenced_document')
    usable = any(unit['text'].strip() and unit['locations'] for unit in units)
    status = ('needs_review' if not usable else 'waiting_for_document'
              if missing and recovery_pass == 0 else 'ready_for_extraction')
    if not usable:
        reasons.add('no_usable_evidence')
    return {'coverage_version': 'coverage-hints-v1', 'status': status,
            'recovery_pass': recovery_pass, 'evidence': evidence, 'coverage_focus': focus,
            'missing_documents': missing,
            'missing_document_urls': sorted({item['url'] for item in missing}),
            'review_reasons': sorted(reasons), 'coverage_complete': False}
