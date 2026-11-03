"""Prepare a validated draft for the local TypeScript storage command, without publishing."""

import json
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, JsonValue

from build_extraction_input import BundleFacts
from capture_store import atomic_write
from targeted_enrichment import (
    FieldEnrichmentCandidate,
    HistoricalCutoffCandidate,
    OfficialSyllabusCandidate,
    ReaderSummaryCandidate,
)
from validate_candidate import validate_candidate


class ReviewIssue(BaseModel):
    model_config = ConfigDict(extra='forbid')
    field_path: str
    reason: str


class AutomatedDecisionSummary(BaseModel):
    model_config = ConfigDict(extra='forbid')
    decision: Literal['accepted', 'blocked', 'retryable']
    reason_codes: list[str]
    evidence_fingerprint: str
    extraction_version: str


class DraftReview(BaseModel):
    model_config = ConfigDict(extra='forbid')
    status: Literal['needs_review']
    warnings: list[ReviewIssue]
    semantic_support_verified: Literal[False]
    publication_allowed: Literal[False]
    bundle_identity: dict[str, JsonValue]
    field_checks: list[dict[str, JsonValue]]
    reader_summary: ReaderSummaryCandidate | None = None
    official_syllabus: list[OfficialSyllabusCandidate] | None = None
    historical_cutoffs: list[HistoricalCutoffCandidate] | None = None
    enrichment_candidates: list[FieldEnrichmentCandidate] | None = None
    vision_recovery: dict[str, JsonValue] | None = None
    automated_decision: AutomatedDecisionSummary | None = None


class EvidenceLocation(BaseModel):
    model_config = ConfigDict(extra='forbid')
    evidence_id: str
    document_id: str
    source_url: str
    role: str | None
    authority: str | None
    locations: list[dict[str, JsonValue]]


class StorageCandidate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    bundle_id: str = Field(min_length=1, max_length=256)
    source_url: str = Field(min_length=1, max_length=2048)
    source_name: str = Field(min_length=1, max_length=256)
    facts: BundleFacts
    review: DraftReview
    evidence_units: list[EvidenceLocation]
    disposition: Literal['valid_recruitment_review_draft'] = 'valid_recruitment_review_draft'
    evidence_fingerprint: str | None = None
    extraction_version: str | None = None
    source_evidence: list[dict[str, JsonValue]] = []
    metadata: dict[str, JsonValue] = {}


def storage_schema():
    """Share the extraction contract plus the gate's storage bounds with TypeScript."""
    schema = StorageCandidate.model_json_schema()
    definitions = schema['$defs']
    definitions['BundleFacts']['properties']['posts']['minItems'] = 1
    definitions['CandidatePost']['properties']['post_name'] = {
        'type': 'string', 'minLength': 1, 'pattern': r'\S'}
    for name in ('CandidatePost', 'AgeRule', 'CategoryRelaxationRules', 'EducationOption',
                 'ExperienceRule', 'FeeRule', 'PayRule', 'VacancyCount'):
        for field, node in definitions[name]['properties'].items():
            for branch in node.get('anyOf', [node]):
                if branch.get('type') in {'integer', 'number'}:
                    branch['minimum'] = 0
                    if field in {'min_marks_percent', 'minimum_marks_percent'}:
                        branch['maximum'] = 100
                if field in {'application_start_date', 'fee_payment_last_date',
                             'application_last_date', 'age_as_on_date'} and branch.get('type') == 'string':
                    branch.update(format='date', pattern=r'^\d{4}-\d{2}-\d{2}$')
    return schema


def prepare_storage(
    result,
    source,
    *,
    source_name,
    reader_summary=None,
    official_syllabus=None,
    historical_cutoffs=None,
    enrichment_candidates=None,
    vision_recovery=None,
    automated_decision=None,
):
    report = validate_candidate(result, source)
    if report['status'] == 'blocked':
        raise ValueError('candidate_validation_blocked')
    if report['disposition'] != 'valid_recruitment_review_draft':
        raise ValueError('candidate_is_not_recruitment')
    if result.get('bundle_id') != source['bundle_id']:
        raise ValueError('candidate_bundle_mismatch')
    documents = source['documents']
    if not documents:
        raise ValueError('candidate_source_missing')
    url = documents[0]['source_url']
    parsed = urlsplit(url)
    if parsed.scheme not in {'http', 'https'} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('candidate_source_url_invalid')
    references = {item['evidence_id'] for item in report['validated_facts']['evidence']}
    references.update(item['evidence_id'] for item in report['validated_facts']['purpose_evidence'])
    for document in report['validated_facts']['document_purposes']:
        references.update(item['evidence_id'] for item in document['evidence'])
    units = [{'evidence_id': unit['evidence_id'], 'document_id': doc['document_id'],
              'source_url': doc['source_url'], 'locations': unit['locations'],
              'role': doc.get('role'), 'authority': doc.get('authority')}
             for doc in documents for unit in doc['sections'] if unit['evidence_id'] in references]
    review_payload = {
        'status': 'needs_review',
        'warnings': report['warnings'],
        'semantic_support_verified': False,
        'publication_allowed': False,
        'bundle_identity': source.get('identity', {}),
        'field_checks': result.get('inline_check', {}).get('fields', []),
    }
    optional_review = {
        'reader_summary': reader_summary,
        'official_syllabus': official_syllabus,
        'historical_cutoffs': historical_cutoffs,
        'enrichment_candidates': enrichment_candidates,
        'vision_recovery': vision_recovery,
        'automated_decision': automated_decision,
    }
    for key, val in optional_review.items():
        if val is not None:
            review_payload[key] = val
    validated = StorageCandidate.model_validate({
        'bundle_id': source['bundle_id'], 'source_url': url, 'source_name': source_name,
        'facts': report['validated_facts'], 'evidence_units': units,
        'review': review_payload,
    }).model_dump(mode='json')
    # Omit unset optional review keys so legacy callers/tests receive the exact minimal review shape.
    for key, val in optional_review.items():
        if val is None:
            validated['review'].pop(key, None)
    return validated


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Prepare a draft, never call an LLM or database.')
    parser.add_argument('result_json')
    parser.add_argument('prepared_json')
    parser.add_argument('output_json')
    parser.add_argument('--source-name', required=True)
    args = parser.parse_args()
    try:
        result = json.loads(Path(args.result_json).read_text())
        source = json.loads(Path(args.prepared_json).read_text())['llm_input']['input']
        envelope = prepare_storage(result, source, source_name=args.source_name)
        atomic_write(Path(args.output_json), json.dumps(envelope, ensure_ascii=False, indent=2).encode())
        print(json.dumps({'status': 'draft_prepared', 'posts': len(envelope['facts']['posts'])}))
    except (KeyError, TypeError, ValueError):
        print(json.dumps({'status': 'blocked', 'reason': 'candidate_not_ready_for_storage'}))
        raise SystemExit(1)
