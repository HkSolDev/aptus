"""Heuristic evidence hints, not proof that a recruitment field is absent."""

import json
import re

from link_discovery import url_identity
from verify_bundle import content_units, grouping_blocking_reasons


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
        for index, link in enumerate(document['content'].get('links', [])):
            url = link.get('url')
            if not isinstance(url, str) or not url_identity(url, url):
                continue
            owner = link.get('owner')
            locations = ([{**owner, 'method': 'html_link_attribute'}] if isinstance(owner, dict)
                         else [{'page': link['page'], 'bbox': link.get('bbox'),
                                'method': 'pdf_link_attribute'}] if link.get('page') else [])
            units.append({'document_id': identifier, 'evidence_id': f'{identifier}:link-{index}',
                          'text': json.dumps({'url': url, 'text': link.get('text', ''),
                                             'context': link.get('context', {})}, ensure_ascii=False),
                          'locations': locations})
    return units


VALID_CRAWL_STATUSES = {'scanned', 'partial', 'blocked'}
ADVISORY_REVIEW_REASONS = {
    'authority_needs_review',
    'amendment_or_cancellation_scope_needs_review',
    'unresolved_document_references',
}


def validate_crawl_status(crawl=None, crawl_status=None):
    """Normalize and validate crawl readiness context.

    Why omitted offline context differs from explicitly malformed crawl context:
    Direct offline testing and document preparation operate without crawl infrastructure,
    which is an approved mode. However, when a caller explicitly passes crawl context,
    passing non-dictionaries, missing status fields, or conflicting statuses signals
    pipeline corruption or misconfiguration and must fail loudly rather than silently
    granting or withholding approval.
    """
    if crawl is None and crawl_status is None:
        return None
    status_from_crawl = None
    if crawl is not None:
        if not isinstance(crawl, dict) or crawl.get('status') not in VALID_CRAWL_STATUSES:
            raise ValueError('Invalid crawl context')
        status_from_crawl = crawl['status']
    status_from_arg = None
    if crawl_status is not None:
        if not isinstance(crawl_status, str) or crawl_status not in VALID_CRAWL_STATUSES:
            raise ValueError('Invalid crawl status')
        status_from_arg = crawl_status
    if status_from_crawl and status_from_arg and status_from_crawl != status_from_arg:
        raise ValueError('Contradictory crawl context')
    return status_from_crawl or status_from_arg


def _has_substantive_content(doc):
    content = doc.get('content')
    kind = doc.get('format')
    if not isinstance(content, dict) or kind not in {'html', 'pdf'}:
        return False
    for text, locations in content_units(content, kind):
        if isinstance(text, str) and text.strip() and isinstance(locations, list) and locations:
            return True
    return False


def check_coverage(bundle, *, missing_documents=None, recovery_pass=0, crawl=None, crawl_status=None):
    """A missing keyword is a focus hint. Only explicit linked gaps request capture."""
    if type(recovery_pass) is not int or recovery_pass not in {0, 1}:
        raise ValueError('Only initial and post-recovery coverage passes are supported')
    validated_crawl_status = validate_crawl_status(crawl=crawl, crawl_status=crawl_status)
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

    # A. Enforce grouping blockers and respect existing needs_review decisions
    # Why a publication-review warning is not automatically an extraction blocker:
    # A bundle with advisory warnings (such as unverified authority or unconfirmed
    # amendment scope) requires human review before publication, but is safe to extract
    # if recruitment boundaries and evidence readability are sound. Conflating pre-publication
    # review with pre-extraction blocking prevents the worker from analyzing valid evidence.
    grouping_blockers = grouping_blocking_reasons(bundle)
    bundle_reasons = set(bundle.get('review_reasons', []))
    if grouping_blockers:
        reasons.update(grouping_blockers)
        grouping_blocked = True
    elif bundle.get('status') == 'needs_review':
        unclassified = bundle_reasons - ADVISORY_REVIEW_REASONS
        if unclassified or not bundle_reasons:
            reasons.add('grouping_needs_review')
            grouping_blocked = True
        else:
            grouping_blocked = False
    else:
        grouping_blocked = False

    # B. Content coverage gaps, unreadable PDFs, and selection budgets
    content_gap = False
    for document in bundle['documents']:
        reasons.update(document.get('review_reasons', []))
        content = document.get('content') or {}
        coverage = content.get('coverage', {}) if isinstance(content, dict) else {}
        if any(coverage.get(key) for key in ('unreadable_pages', 'unavailable_blocks', 'omitted_sections')):
            reasons.add('content_coverage_gap')
            content_gap = True
        if document.get('format') == 'pdf' and (
            coverage.get('unreadable_pages') or not content.get('sections')
        ):
            reasons.add('pdf_requires_review')
            content_gap = True
        if coverage.get('unresolved_references'):
            reasons.add('unresolved_document_references')
        if (
            (isinstance(content, dict) and content.get('status') == 'budget_exceeded')
            or 'content_budget_exceeded' in document.get('review_reasons', [])
        ):
            reasons.add('content_budget_exceeded')
            content_gap = True

    # C. Main-notice substantive evidence check
    main_documents = [doc for doc in bundle['documents'] if doc.get('role') == 'main_notice']
    has_readable_main = False
    if not main_documents:
        reasons.add('missing_main_notice')
    else:
        has_readable_main = any(_has_substantive_content(doc) for doc in main_documents)
        if not has_readable_main:
            reasons.add('main_notice_unreadable')

    # Usability across all units (link-only or identity-only evidence cannot satisfy this alone)
    usable = any(unit['text'].strip() and unit['locations'] for unit in units)
    if not usable:
        reasons.add('no_usable_evidence')

    # D. Missing referenced documents
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

    # E. Crawl completeness check
    crawl_blocked = False
    if validated_crawl_status in {'partial', 'blocked'}:
        reasons.add('crawl_incomplete')
        crawl_blocked = True

    # Precedence:
    # Explicit blocking reasons force needs_review immediately.
    # Initial recovery pass with missing documents waits.
    # Exhausted recovery pass (pass >= 1) with missing documents stays needs_review.
    has_blocking_condition = (
        not usable
        or not has_readable_main
        or grouping_blocked
        or content_gap
        or crawl_blocked
        or (bool(missing) and recovery_pass >= 1)
    )

    if has_blocking_condition:
        status = 'needs_review'
    elif missing and recovery_pass == 0:
        status = 'waiting_for_document'
    else:
        status = 'ready_for_extraction'

    return {'coverage_version': 'coverage-hints-v1', 'status': status,
            'recovery_pass': recovery_pass, 'evidence': evidence, 'coverage_focus': focus,
            'missing_documents': missing,
            'missing_document_urls': sorted({item['url'] for item in missing}),
            'review_reasons': sorted(reasons), 'coverage_complete': False}
