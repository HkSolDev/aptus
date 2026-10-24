"""Shared purpose checks for fresh responses and durable outcome reuse."""
from datetime import date


def purpose_errors(facts, source):
    errors = []
    units = {unit['evidence_id']: (document, unit) for document in source['documents']
             for unit in document['sections']}

    def issue(path, reason):
        errors.append({'field_path': path, 'reason': reason})

    def citations(items, path, document_id=None):
        if not items:
            issue(path, 'missing_purpose_evidence')
        for citation in items:
            document, unit = units.get(citation['evidence_id'], ({}, {}))
            key = 'page' if document.get('format') == 'pdf' else 'block'
            minimum = 1 if key == 'page' else 0
            located = any(type(loc.get(key)) is int and loc[key] >= minimum
                          for loc in unit.get('locations', []) if isinstance(loc, dict))
            quote = citation['quote']
            if (not quote.strip() or quote not in unit.get('text', '') or not located
                    or (document_id is not None and document.get('document_id') != document_id)):
                issue(path, 'purpose_quote_not_located')

    citations(facts['purpose_evidence'], 'purpose_evidence')
    seen = set()
    document_ids = {doc['document_id'] for doc in source['documents']}
    for index, item in enumerate(facts['document_purposes']):
        path = f'document_purposes.{index}'
        if item['document_id'] not in document_ids or item['document_id'] in seen:
            issue(path, 'unknown_or_duplicate_document_id')
        seen.add(item['document_id'])
        citations(item['evidence'], path, item['document_id'])
    # A decision about a bundle must account for each document in that bundle.
    if len(document_ids) > 1 and seen != document_ids:
        issue('document_purposes', 'incomplete_document_purposes')
    if facts['purpose'] != 'recruitment' and facts['posts']:
        issue('posts', 'non_recruitment_has_posts')
    amendment = facts['amendment']
    if (facts['purpose'] == 'amendment' or any(
            item['purpose'] == 'amendment' for item in facts['document_purposes'])) and amendment is None:
        issue('amendment', 'missing_amendment_details')
    if amendment is not None:
        citations(amendment['evidence'], 'amendment.evidence')
        quotes = '\n'.join(c['quote'] for c in amendment['evidence'])
        for field in ('target_advertisement_number', 'target_campaign_name', 'target_post_names'):
            values = amendment[field] if isinstance(amendment[field], list) else [amendment[field]]
            for value in values:
                if value is not None and (not value.strip() or value not in quotes):
                    issue(f'amendment.{field}', 'amendment_target_not_in_citation')
        if amendment['effective_date'] is not None:
            try:
                if date.fromisoformat(amendment['effective_date']).isoformat() != amendment['effective_date']:
                    raise ValueError
            except (TypeError, ValueError):
                issue('amendment.effective_date', 'invalid_iso_date')
    return errors
