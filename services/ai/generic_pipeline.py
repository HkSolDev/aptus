"""Run the generic crawl path; only ready evidence may reach extraction."""

import json
import os
from pathlib import Path

from capture_store import atomic_write, now
from build_extraction_input import is_extraction_approved, prepare_extraction
from extract_bundle import extract_bundle
from notice_state import (EXTRACTION_VERSION, NoticeStateManager,
                          compute_evidence_fingerprint)
from pipeline import push_to_ts
from providers.gemini import GeminiProvider, gemini_api_keys
from shared_pipeline import prepare_sources
from source_registry import DEFAULT_SOURCES_PATH
from store_candidate import prepare_storage
from validate_candidate import validate_candidate
from stage_retry import StageRetries
from extraction_checkpoint import extract_or_resume
from autonomous_pipeline import (
    _map_post_to_ingest_post,
    apply_validated_vision_recovery,
    evaluate_automated_acceptance,
)
from vision_recovery import recover_unreadable_pdf_pages, unusable_pdf_pages


def _resolve_vision_provider(vision_provider, *, allow_default=False):
    if vision_provider is not None:
        return vision_provider
    if allow_default and gemini_api_keys():
        return GeminiProvider()
    return None


def _resolve_persist(persist, *, allow_default=False):
    if persist is not None:
        return persist
    if allow_default and (os.getenv('INGEST_TOKEN') or os.getenv('INGEST_TOKEN_FILE')):
        return push_to_ts
    return None


def _source_name(source_id, prepared):
    documents = prepared['llm_input']['input']['documents']
    title = next((document.get('title') for document in documents if document.get('title')), None)
    return f'{source_id}: {title}' if title else source_id


def _load_bundles_for_source(source, prepared_path):
    bundles_list = source.get('bundles') if isinstance(source, dict) else None
    if not isinstance(bundles_list, list):
        candidates = []
        if isinstance(source, dict) and isinstance(source.get('bundles_path'), str):
            candidates.append(Path(source['bundles_path']))
        if prepared_path is not None:
            candidates.append(Path(prepared_path).parent / 'bundles.json')
        for cand in candidates:
            if cand.exists():
                try:
                    data = json.loads(cand.read_text(encoding='utf-8'))
                    if isinstance(data, dict) and isinstance(data.get('bundles'), list):
                        bundles_list = data['bundles']
                        break
                except (OSError, ValueError):
                    continue
    if not isinstance(bundles_list, list):
        return {}
    return {
        b['bundle_id']: b
        for b in bundles_list
        if isinstance(b, dict) and isinstance(b.get('bundle_id'), str)
    }


def run_pipeline(root, *, sources_path=DEFAULT_SOURCES_PATH, source_id=None,
                 max_fetches=12, max_depth=3, prepare=prepare_sources,
                 extract=extract_bundle, validate=validate_candidate,
                 draft=prepare_storage, persist=None, prepare_only=False,
                 extraction_version=EXTRACTION_VERSION, retry_clock=None,
                 vision_provider=None, pdf_bytes_by_doc=None,
                 page_images_by_doc=None):
    """Crawl sources and process only coverage-approved evidence.

    When a verified PDF page is marked unusable by deterministic native-text
    checks and ``vision_provider`` is available, Vision recovery runs only on
    relevant unreadable pages and rebuilds the prepared extraction input before
    re-checking ``is_extraction_approved``. Autonomous persistence runs only
    when all deterministic evidence and acceptance gates approve.
    """
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    state_manager = NoticeStateManager(root)
    retries = StageRetries(root, retry_clock)
    prepared_root = root / 'shared'
    sources = prepare(prepared_root, sources_path=sources_path, source_id=source_id,
                      max_fetches=max_fetches, max_depth=max_depth)
    report = {'checked_at': now(), 'route': 'generic_shared_crawl',
              'status': 'completed', 'sources': {}}

    for source in sources:
        source_id = source['source']
        counts = report['sources'][source_id] = {
            'crawl_status': source['status'], 'prepared': source.get('prepared_inputs', 0),
            'extracted': 0, 'drafts': 0, 'reused': 0, 'published': 0, 'blocked': 0, 'failed': 0,
            'blocked_reasons': [], 'failure_stages': [],
            'bundle_outcomes': [],
        }
        if source['status'] == 'blocked':
            counts['blocked'] += 1
            counts['reason'] = 'unsupported_seed_type'
            report['status'] = 'partial_failure'
            continue
        for path in source.get('prepared_paths', []):
            stage = 'prepared_input'
            bundle_id = None
            vision_requests = []
            vision_merge_reasons = []
            try:
                raw_text = Path(path).read_text(encoding='utf-8')
                prepared = json.loads(raw_text)
                # Reject corrupt artifact shapes through the normal per-file failure path.
                if not isinstance(prepared, dict):
                    raise ValueError('Prepared artifact must be an object')
                if isinstance(prepared, dict):
                    bundle_id = prepared.get('bundle_id')
                    if not bundle_id and isinstance(prepared.get('llm_input'), dict):
                        src = prepared['llm_input'].get('input')
                        if isinstance(src, dict):
                            bundle_id = src.get('bundle_id')
                if not bundle_id:
                    stem = Path(path).name
                    bundle_id = stem[:-len('.prepared.json')] if stem.endswith('.prepared.json') else (
                        stem[:-len('.json')] if stem.endswith('.json') else stem)

                active_vision_provider = _resolve_vision_provider(
                    vision_provider, allow_default=(extract is extract_bundle)
                )
                if not is_extraction_approved(prepared) and not prepare_only and active_vision_provider is not None:
                    bundles_by_id = _load_bundles_for_source(source, path)
                    bundle = bundles_by_id.get(bundle_id) or (
                        prepared.get('bundle') if isinstance(prepared.get('bundle'), dict) else None
                    )
                    has_unusable_pdf = bool(
                        bundle
                        and any(
                            unusable_pdf_pages(doc)
                            for doc in bundle.get('documents', [])
                            if isinstance(doc, dict) and doc.get('format') == 'pdf'
                        )
                    )
                    if has_unusable_pdf:
                        stage = 'vision_recovery'
                        v_res = recover_unreadable_pdf_pages(
                            bundle,
                            gemini_provider=active_vision_provider,
                            pdf_bytes_by_doc=pdf_bytes_by_doc,
                            page_images_by_doc=page_images_by_doc,
                            storage_dir=root,
                        )
                        vision_requests = v_res['requests']
                        if v_res['vision_called']:
                            counts['vision_called'] = counts.get('vision_called', 0) + 1
                            crawl_status = None
                            if isinstance(source.get('crawl_path'), str) and Path(source['crawl_path']).exists():
                                crawl_status = json.loads(
                                    Path(source['crawl_path']).read_text(encoding='utf-8')
                                ).get('status')
                            elif source.get('status') in {'scanned', 'partial', 'blocked'}:
                                crawl_status = source.get('status')
                            prepared = prepare_extraction(v_res['bundle'], crawl_status=crawl_status)
                            atomic_write(Path(path), json.dumps(prepared, ensure_ascii=False, indent=2).encode())

                stage = 'prepared_input'
                if not is_extraction_approved(prepared):
                    counts['blocked'] += 1
                    gate_reasons = (
                        prepared.get('coverage', {}).get('review_reasons')
                        if isinstance(prepared.get('coverage'), dict)
                        else None
                    )
                    reasons = sorted(set(gate_reasons)) if gate_reasons else ['coverage_not_ready']
                    counts['blocked_reasons'].extend(reasons)
                    counts['bundle_outcomes'].append({
                        'bundle_id': bundle_id,
                        'outcome': 'blocked',
                        'reasons': reasons,
                    })
                    continue
                if prepare_only:
                    continue

                source_input = prepared['llm_input']['input']
                bundle_id = source_input['bundle_id']
                fingerprint = compute_evidence_fingerprint(source_input, extraction_version)

                with state_manager.notice_lock(bundle_id):
                    cached_envelope = state_manager.get_reusable_draft(
                        bundle_id, fingerprint, extraction_version, source_input=source_input)
                    if cached_envelope is not None:
                        counts['reused'] += 1
                        disposition = cached_envelope.get('disposition', 'valid_recruitment_review_draft')
                        counts['bundle_outcomes'].append({
                            'bundle_id': bundle_id,
                            'outcome': 'reused',
                            'disposition': disposition,
                            'reasons': ['unchanged_evidence_fingerprint'],
                        })
                        # Publication is a separate explicit operator action;
                        # an injected callback must not bypass draft approval.
                        continue

                    stage = 'extraction'
                    extractor = extract
                    if extract is extract_bundle:
                        extractor = lambda value: extract_bundle(value, response_path=(
                            root / 'responses' / f'{fingerprint}.json'))
                    extracted, resumed = extract_or_resume(retries, fingerprint, prepared, extractor)
                    if extracted is None:
                        retry = retries.read('extraction', fingerprint)
                        counts['blocked'] += retry['status'] == 'needs_review'
                        if retry['status'] == 'needs_review':
                            counts['blocked_reasons'].append(retry.get('reason') or 'extraction_needs_review')
                        counts['bundle_outcomes'].append({
                            'bundle_id': bundle_id, 'outcome': retry['status'],
                            'reasons': [retry.get('reason') or 'extraction_in_progress'],
                        })
                        report['status'] = 'partial_failure'
                        continue
                    counts['extracted'] += not resumed
                    counts['checkpoint_reused'] = counts.get('checkpoint_reused', 0) + resumed
                    if extracted.get('bundle_id') != bundle_id:
                        raise ValueError('Extracted bundle identity mismatch')
                    if vision_requests:
                        merged_vision = apply_validated_vision_recovery(extracted, source_input, vision_requests)
                        extracted = merged_vision['extracted']
                        source_input = merged_vision['source_input']
                        vision_merge_reasons = merged_vision.get('unresolved_reasons', [])
                    stage = 'validation'
                    validation = validate(extracted, source_input)
                    disposition = validation.get('disposition', 'validation_blocked')
                    if validation.get('status') == 'blocked':
                        retries.failure('extraction', fingerprint, 'candidate_validation_blocked')
                        # Retain the rejected response and findings for review, but
                        # never record it as a reusable successful extraction.
                        atomic_write(root / 'validation' / f'{bundle_id}.json', json.dumps({
                            'bundle_id': bundle_id, 'evidence_fingerprint': fingerprint,
                            'extraction_version': extraction_version,
                            'result': extracted, 'validation': validation,
                        }, ensure_ascii=False, indent=2).encode())
                        counts['blocked'] += 1
                        val_reasons = [
                            issue.get('reason', 'candidate_validation_blocked')
                            for issue in validation.get('errors', []) if isinstance(issue, dict)
                        ]
                        reasons = sorted(set(val_reasons)) if val_reasons else ['candidate_validation_blocked']
                        counts['blocked_reasons'].extend(reasons)
                        counts['bundle_outcomes'].append({
                            'bundle_id': bundle_id,
                            'outcome': 'blocked',
                            'disposition': disposition,
                            'reasons': reasons,
                        })
                        continue

                    if disposition not in {'valid_recruitment_review_draft', 'amendment_pending_review',
                                            'valid_non_job_classification', 'unclear_purpose_review'}:
                        raise ValueError('Unknown validated disposition')

                    if disposition == 'valid_recruitment_review_draft':
                        stage = 'draft_preparation'
                        src_name = _source_name(source_id, prepared)
                        acceptance = evaluate_automated_acceptance(
                            extracted,
                            source_input,
                            vision_requests=vision_requests,
                            vision_merge_reasons=vision_merge_reasons,
                            research_exhausted=True,
                        )
                        if draft is prepare_storage:
                            envelope = draft(
                                extracted,
                                source_input,
                                source_name=src_name,
                                vision_recovery={'requests': vision_requests} if vision_requests else None,
                                automated_decision={
                                    'decision': acceptance['decision'],
                                    'reason_codes': acceptance['reason_codes'],
                                    'evidence_fingerprint': fingerprint,
                                    'extraction_version': extraction_version,
                                },
                            )
                        else:
                            envelope = draft(extracted, source_input, source_name=src_name)
                        envelope['disposition'] = disposition
                        envelope['evidence_fingerprint'] = fingerprint
                        envelope['extraction_version'] = extraction_version
                        envelope['source_evidence'] = source_input['documents']
                        envelope['metadata'] = {key: extracted.get(key) for key in ('provider', 'model', 'usage')}
                        draft_path = root / 'drafts' / f"{extracted['bundle_id']}.json"
                        atomic_write(draft_path, json.dumps(envelope, ensure_ascii=False, indent=2).encode())
                        counts['drafts'] += 1
                        counts['bundle_outcomes'].append({
                            'bundle_id': bundle_id,
                            'outcome': 'extracted',
                            'disposition': disposition,
                            'reasons': [],
                        })
                        state_manager.record_outcome(bundle_id, fingerprint, extraction_version, draft_path,
                                                     disposition=disposition)
                        active_persist = _resolve_persist(
                            persist, allow_default=(extract is extract_bundle)
                        )
                        if acceptance['decision'] == 'accepted' and active_persist is not None:
                            stage = 'autonomous_ingestion'
                            primary_url = (source_input.get('documents') or [{}])[0].get('source_url') or ''
                            ingest_payload = {
                                'kind': 'autonomous_notice',
                                'bundleId': bundle_id,
                                'sourceName': src_name,
                                'sourceUrl': primary_url,
                                'evidenceFingerprint': fingerprint,
                                'extractionVersion': extraction_version,
                                'decision': 'accepted',
                                'publicationStatus': 'published',
                                'persistenceAllowed': True,
                                'reasonCodes': [],
                                'retryCount': 0,
                                'backoffSeconds': 0,
                                'nextRetryAt': None,
                                'noticeIdentity': source_input.get('identity') or {},
                                'posts': [_map_post_to_ingest_post(p, primary_url) for p in extracted['facts']['posts']],
                                'draftEnvelope': envelope,
                                'readerSummary': None,
                                'officialSyllabus': [],
                                'historicalCutoffs': [],
                                'visionRecovery': vision_requests,
                                'enrichmentCandidates': [],
                                'auditLineage': [],
                            }
                            payload_path = root / 'autonomous_payloads' / f'{bundle_id}.json'
                            atomic_write(payload_path, json.dumps(ingest_payload, ensure_ascii=False, indent=2).encode())
                            active_persist(ingest_payload)
                            counts['published'] += 1
                    elif disposition == 'amendment_pending_review':
                        stage = 'amendment_review_preparation'
                        out_dir = root / 'amendments'
                        out_dir.mkdir(parents=True, exist_ok=True)
                        out_path = out_dir / f"{extracted['bundle_id']}.json"
                        envelope = {
                            'bundle_id': bundle_id,
                            'evidence_fingerprint': fingerprint,
                            'extraction_version': extraction_version,
                            'disposition': disposition,
                            'status': 'needs_review',
                            'source_name': _source_name(source_id, prepared),
                            'source_url': source_input['documents'][0]['source_url'],
                            'source_evidence': source_input['documents'],
                            'purpose': 'amendment',
                            'purpose_evidence': extracted['facts'].get('purpose_evidence', []),
                            'document_purposes': extracted['facts'].get('document_purposes', []),
                            'amendment': extracted['facts'].get('amendment'),
                            'facts': extracted['facts'],
                            'validation': validation,
                            'review_reasons': sorted(set(extracted.get('review_reasons', []) +
                                                        source_input.get('coverage', {}).get('review_reasons', []))),
                            'metadata': {
                                'provider': extracted.get('provider'),
                                'model': extracted.get('model'),
                                'usage': extracted.get('usage', {}),
                            },
                            'updated_at': now(),
                        }
                        atomic_write(out_path, json.dumps(envelope, ensure_ascii=False, indent=2).encode())
                        counts['amendments'] = counts.get('amendments', 0) + 1
                        counts['bundle_outcomes'].append({
                            'bundle_id': bundle_id,
                            'outcome': 'amendment_review',
                            'disposition': disposition,
                            'reasons': [],
                        })
                        state_manager.record_outcome(bundle_id, fingerprint, extraction_version, out_path,
                                                     disposition=disposition)
                    elif disposition == 'valid_non_job_classification':
                        stage = 'non_job_preparation'
                        out_dir = root / 'non_jobs'
                        out_dir.mkdir(parents=True, exist_ok=True)
                        out_path = out_dir / f"{extracted['bundle_id']}.json"
                        envelope = {
                            'bundle_id': bundle_id,
                            'evidence_fingerprint': fingerprint,
                            'extraction_version': extraction_version,
                            'disposition': disposition,
                            'status': 'completed',
                            'source_name': _source_name(source_id, prepared),
                            'source_url': source_input['documents'][0]['source_url'],
                            'source_evidence': source_input['documents'],
                            'purpose': extracted['facts']['purpose'],
                            'purpose_evidence': extracted['facts'].get('purpose_evidence', []),
                            'document_purposes': extracted['facts'].get('document_purposes', []),
                            'facts': extracted['facts'],
                            'validation': validation,
                            'metadata': {
                                'provider': extracted.get('provider'),
                                'model': extracted.get('model'),
                                'usage': extracted.get('usage', {}),
                            },
                            'updated_at': now(),
                        }
                        atomic_write(out_path, json.dumps(envelope, ensure_ascii=False, indent=2).encode())
                        counts['non_jobs'] = counts.get('non_jobs', 0) + 1
                        counts['bundle_outcomes'].append({
                            'bundle_id': bundle_id,
                            'outcome': 'non_job_classified',
                            'disposition': disposition,
                            'reasons': [],
                        })
                        state_manager.record_outcome(bundle_id, fingerprint, extraction_version, out_path,
                                                     disposition=disposition)
                    elif disposition == 'unclear_purpose_review':
                        stage = 'unclear_preparation'
                        out_dir = root / 'unclear'
                        out_dir.mkdir(parents=True, exist_ok=True)
                        out_path = out_dir / f"{extracted['bundle_id']}.json"
                        envelope = {
                            'bundle_id': bundle_id,
                            'evidence_fingerprint': fingerprint,
                            'extraction_version': extraction_version,
                            'disposition': disposition,
                            'status': 'needs_review',
                            'source_name': _source_name(source_id, prepared),
                            'source_url': source_input['documents'][0]['source_url'],
                            'source_evidence': source_input['documents'],
                            'purpose': 'unclear',
                            'purpose_evidence': extracted['facts'].get('purpose_evidence', []),
                            'document_purposes': extracted['facts'].get('document_purposes', []),
                            'facts': extracted['facts'],
                            'validation': validation,
                            'metadata': {
                                'provider': extracted.get('provider'),
                                'model': extracted.get('model'),
                                'usage': extracted.get('usage', {}),
                            },
                            'updated_at': now(),
                        }
                        atomic_write(out_path, json.dumps(envelope, ensure_ascii=False, indent=2).encode())
                        counts['unclear'] = counts.get('unclear', 0) + 1
                        counts['bundle_outcomes'].append({
                            'bundle_id': bundle_id,
                            'outcome': 'unclear_review',
                            'disposition': disposition,
                            'reasons': [],
                        })
                        state_manager.record_outcome(bundle_id, fingerprint, extraction_version, out_path,
                                                     disposition=disposition)
                    # Completed durable outcomes now own reuse. A checkpoint is
                    # only for interrupted work, never an alternate integrity bypass.
                    retries.path('extraction', fingerprint).with_suffix('.response.json').unlink(missing_ok=True)
                    retries.path('extraction', fingerprint).unlink(missing_ok=True)
            except (KeyError, OSError, RuntimeError, TypeError, ValueError):
                counts['failed'] += 1
                counts['failure_stages'].append(stage)
                report['status'] = 'partial_failure'
                stem = Path(path).name
                fail_id = bundle_id or (stem[:-len('.prepared.json')] if stem.endswith('.prepared.json') else (
                    stem[:-len('.json')] if stem.endswith('.json') else stem))
                counts['bundle_outcomes'].append({
                    'bundle_id': fail_id,
                    'outcome': 'failed',
                    'reasons': [f'failed_at_{stage}'],
                })
                if stage == 'extraction':
                    retry = retries.read('extraction', fingerprint)
                    counts['bundle_outcomes'][-1]['reasons'] = [retry.get('reason') or 'extraction_failed']
        if counts['blocked'] or counts['failed']:
            report['status'] = 'partial_failure'
        counts['blocked_reasons'] = sorted(set(counts['blocked_reasons']))
        counts['failure_stages'] = sorted(set(counts['failure_stages']))
    atomic_write(root / 'latest-generic-pipeline-run.json',
                 json.dumps(report, ensure_ascii=False, indent=2).encode())
    return report
