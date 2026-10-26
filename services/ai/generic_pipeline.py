"""Run the generic crawl path; only ready evidence may reach extraction."""

import hashlib
import json
from pathlib import Path

from capture_store import atomic_write, now
from build_extraction_input import is_extraction_approved
from extract_bundle import extract_bundle
from notice_state import (EXTRACTION_VERSION, NoticeStateManager,
                          compute_evidence_fingerprint)
from shared_pipeline import prepare_sources
from source_registry import DEFAULT_SOURCES_PATH
from store_candidate import prepare_storage
from validate_candidate import validate_candidate
from stage_retry import StageRetries
from extraction_checkpoint import extract_or_resume
from review_publication import is_valid_receipt_file
from provider_metrics import track_provider_requests


def _source_name(source_id, prepared):
    documents = prepared['llm_input']['input']['documents']
    title = next((document.get('title') for document in documents if document.get('title')), None)
    return f'{source_id}: {title}' if title else source_id


def run_pipeline(root, *, sources_path=DEFAULT_SOURCES_PATH, source_id=None,
                 max_fetches=12, max_depth=3, prepare=prepare_sources,
                 extract=extract_bundle, validate=validate_candidate,
                 draft=prepare_storage, persist=None, prepare_only=False,
                 extraction_version=EXTRACTION_VERSION, retry_clock=None):
    """Crawl sources and process only coverage-approved evidence.

    ``persist`` remains accepted for legacy callers but cannot publish. Use
    review_publication's explicit approval/delivery flow for database writes.
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
        crawl_status = source['status']
        counts = report['sources'][source_id] = {
            'crawl_status': crawl_status, 'prepared': source.get('prepared_inputs', 0),
            'extracted': 0, 'drafts': 0, 'reused': 0, 'published': 0, 'blocked': 0, 'failed': 0,
            'blocked_reasons': [], 'failure_stages': [],
            'bundle_outcomes': [],
            'capture_attempts': source.get('capture_attempts', 0),
            'cooldown_skips': source.get('cooldown_skips', 0),
        }
        if source.get('errors'):
            counts['crawl_errors'] = list(source['errors'])
            counts['failure_stages'].append('discovery')
            counts['failure_reasons'] = sorted(set(counts.get('failure_reasons', []) + list(source['errors'])))

        if crawl_status == 'disabled':
            continue

        if crawl_status == 'blocked':
            counts['blocked'] += 1
            reason = source.get('reason') or 'unsupported_seed_type'
            counts['reason'] = reason
            counts['blocked_reasons'].append(reason)
            counts['bundle_outcomes'].append({
                'bundle_id': source_id,
                'outcome': 'blocked',
                'reasons': [reason],
            })
            continue

        if crawl_status == 'already_running':
            counts['blocked'] += 1
            counts['reason'] = 'source_lock_held'
            counts['blocked_reasons'].append('source_lock_held')
            counts['bundle_outcomes'].append({
                'bundle_id': source_id,
                'outcome': 'blocked',
                'reasons': ['source_lock_held'],
            })
            continue

        if crawl_status == 'failed':
            counts['failed'] += 1
            if 'discovery' not in counts['failure_stages']:
                counts['failure_stages'].append('discovery')
            reason = source.get('reason') or (source.get('errors', ['discovery_failed'])[0] if source.get('errors') else 'discovery_failed')
            counts['reason'] = reason
            counts['failure_reasons'] = sorted(set(counts.get('failure_reasons', []) + [reason]))
            counts['bundle_outcomes'].append({
                'bundle_id': source_id,
                'outcome': 'failed',
                'reasons': [f'discovery_{reason}'],
            })
            continue

        if crawl_status == 'partial' and not source.get('prepared_paths'):
            if source.get('errors'):
                counts['failed'] += 1
                counts['reason'] = source['errors'][0]
                counts['bundle_outcomes'].append({
                    'bundle_id': source_id,
                    'outcome': 'failed',
                    'reasons': [f'discovery_{r}' for r in source['errors']],
                })
                continue
        for path in source.get('prepared_paths', []):
            stage = 'prepared_input'
            bundle_id = None
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
                        state_path = state_manager.state_path(bundle_id)
                        draft_sha = None
                        if state_path.is_file():
                            try:
                                draft_sha = json.loads(state_path.read_text(encoding='utf-8')).get('draft_sha256')
                            except (OSError, ValueError):
                                pass
                        is_published = False
                        if draft_sha:
                            receipt_file = root / 'publication' / 'receipts' / f'{draft_sha}.json'
                            post_count = len(cached_envelope.get('facts', {}).get('posts', []))
                            is_published = is_valid_receipt_file(
                                receipt_file, draft_sha,
                                expected_count=post_count if post_count else None,
                                stage_retries=retries,
                            )
                        if is_published:
                            counts['published'] = counts.get('published', 0) + 1
                        elif disposition in {'valid_recruitment_review_draft', 'amendment_pending_review', 'unclear_purpose_review'}:
                            counts['reused_awaiting_review'] = counts.get('reused_awaiting_review', 0) + 1

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

                    extraction_calls = {'attempted': 0, 'succeeded': 0, 'failed': 0}

                    def tracked_extractor(val):
                        extraction_calls['attempted'] += 1
                        try:
                            res = extractor(val)
                            extraction_calls['succeeded'] += 1
                            return res
                        except Exception:
                            extraction_calls['failed'] += 1
                            raise

                    try:
                        with track_provider_requests() as requests:
                            extracted, resumed = extract_or_resume(retries, fingerprint, prepared, tracked_extractor)
                    finally:
                        for outcome, value in requests.items():
                            key = f'provider_requests_{outcome}'
                            counts[key] = counts.get(key, 0) + value
                        counts['extraction_calls_attempted'] = counts.get('extraction_calls_attempted', 0) + extraction_calls['attempted']
                        counts['extraction_calls_succeeded'] = counts.get('extraction_calls_succeeded', 0) + extraction_calls['succeeded']
                        counts['extraction_calls_failed'] = counts.get('extraction_calls_failed', 0) + extraction_calls['failed']

                    if extracted is None:
                        retry = retries.read('extraction', fingerprint)
                        retry_status = retry.get('status', 'needs_review')
                        reason = retry.get('reason') or ('extraction_needs_review' if retry_status == 'needs_review' else 'extraction_retry_wait')
                        counts['failure_stages'].append('extraction')
                        counts['failure_reasons'] = sorted(set(counts.get('failure_reasons', []) + [reason]))
                        if retry_status == 'needs_review':
                            counts['blocked'] += 1
                            counts['blocked_reasons'].append(reason)
                            counts['held_for_review'] = counts.get('held_for_review', 0) + 1
                        elif retry_status == 'retry_wait':
                            counts['retry_wait'] = counts.get('retry_wait', 0) + 1
                        counts['bundle_outcomes'].append({
                            'bundle_id': bundle_id, 'outcome': retry_status,
                            'reasons': [reason],
                        })
                        report['status'] = 'partial_failure'
                        continue

                    if resumed:
                        counts['checkpoint_reused'] = counts.get('checkpoint_reused', 0) + 1
                    elif extracted is not None:
                        counts['extracted'] += 1

                    if extracted.get('bundle_id') != bundle_id:
                        raise ValueError('Extracted bundle identity mismatch')
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
                        counts['held_for_review'] = counts.get('held_for_review', 0) + 1
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
                        envelope = draft(extracted, source_input,
                                         source_name=_source_name(source_id, prepared))
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
                counts['failure_reasons'] = sorted(set(counts.get('failure_reasons', []) + [f'failed_at_{stage}']))
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
        counts['blocked_reasons'] = sorted(set(counts['blocked_reasons']))
        counts['failure_stages'] = sorted(set(counts['failure_stages']))
        if 'failure_reasons' in counts:
            counts['failure_reasons'] = sorted(set(counts['failure_reasons']))

    enabled_sources = [s for s in sources if s.get('status') != 'disabled']
    disabled_sources = [s for s in sources if s.get('status') == 'disabled']
    attempted_sources = len(enabled_sources)

    succeeded_sources = 0
    failed_sources = 0
    blocked_sources = 0
    partial_sources = 0

    total_discovered_docs = sum(s.get('documents', 0) for s in enabled_sources)
    total_prepared_inputs = sum(report['sources'][s['source']].get('prepared', 0) for s in enabled_sources)
    total_capture_attempts = sum(report['sources'][s['source']].get('capture_attempts', 0) for s in enabled_sources)
    total_cooldown_skips = sum(report['sources'][s['source']].get('cooldown_skips', 0) for s in enabled_sources)

    total_cached_drafts_reused = sum(report['sources'][s['source']].get('reused', 0) for s in enabled_sources)
    total_checkpoints_resumed = sum(report['sources'][s['source']].get('checkpoint_reused', 0) for s in enabled_sources)

    total_extraction_calls_attempted = sum(report['sources'][s['source']].get('extraction_calls_attempted', 0) for s in enabled_sources)
    total_extraction_calls_succeeded = sum(report['sources'][s['source']].get('extraction_calls_succeeded', 0) for s in enabled_sources)
    total_extraction_calls_failed = sum(report['sources'][s['source']].get('extraction_calls_failed', 0) for s in enabled_sources)
    total_waiting_retry = sum(report['sources'][s['source']].get('retry_wait', 0) for s in enabled_sources)
    total_held_for_review = sum(report['sources'][s['source']].get('held_for_review', 0) for s in enabled_sources)

    total_drafts_created = sum(report['sources'][s['source']].get('drafts', 0) for s in enabled_sources)
    total_reused_awaiting_review = sum(report['sources'][s['source']].get('reused_awaiting_review', 0) for s in enabled_sources)
    total_published_seen = sum(report['sources'][s['source']].get('published', 0) for s in enabled_sources)
    total_amendments = sum(report['sources'][s['source']].get('amendments', 0) for s in enabled_sources)
    total_unclear = sum(report['sources'][s['source']].get('unclear', 0) for s in enabled_sources)

    run_awaiting_review = total_drafts_created + total_reused_awaiting_review + total_amendments + total_unclear

    backlog_drafts = 0
    drafts_dir = root / 'drafts'
    receipts_dir = root / 'publication' / 'receipts'
    if drafts_dir.is_dir():
        for f in drafts_dir.glob('*.json'):
            try:
                raw_draft = f.read_bytes()
                d_hash = hashlib.sha256(raw_draft).hexdigest()
                post_count = None
                try:
                    draft_obj = json.loads(raw_draft)
                    post_count = len(draft_obj.get('facts', {}).get('posts', []))
                except (OSError, ValueError):
                    pass
                if not is_valid_receipt_file(
                    receipts_dir / f'{d_hash}.json',
                    d_hash,
                    expected_count=post_count if post_count else None,
                    stage_retries=retries,
                ):
                    backlog_drafts += 1
            except OSError:
                pass
    backlog_amendments = len(list((root / 'amendments').glob('*.json'))) if (root / 'amendments').is_dir() else 0
    backlog_unclear = len(list((root / 'unclear').glob('*.json'))) if (root / 'unclear').is_dir() else 0
    total_backlog_awaiting_review = backlog_drafts + backlog_amendments + backlog_unclear

    for s in enabled_sources:
        sid = s['source']
        sc = report['sources'][sid]

        has_discovery_failure = (sc.get('failed', 0) > 0 and 'discovery' in sc.get('failure_stages', []))
        has_pipeline_failure = (sc.get('failed', 0) > 0)
        has_blocked = (sc.get('blocked', 0) > 0)
        has_retry_wait = (sc.get('retry_wait', 0) > 0)
        has_discovery_errors = bool(sc.get('crawl_errors')) or ('discovery' in sc.get('failure_stages', []))
        has_work_done = (sc.get('drafts', 0) > 0 or sc.get('reused', 0) > 0 or sc.get('extracted', 0) > 0
                         or sc.get('amendments', 0) > 0 or sc.get('non_jobs', 0) > 0 or sc.get('unclear', 0) > 0
                         or sc.get('checkpoint_reused', 0) > 0)

        if sc.get('crawl_status') == 'failed' or (has_discovery_failure and not has_work_done):
            failed_sources += 1
        elif sc.get('crawl_status') == 'blocked':
            blocked_sources += 1
        elif has_pipeline_failure and not has_work_done:
            failed_sources += 1
        elif has_discovery_errors or has_blocked or has_retry_wait or has_pipeline_failure:
            partial_sources += 1
            succeeded_sources += 1
        else:
            succeeded_sources += 1

    if not enabled_sources:
        report['status'] = 'completed'
    elif succeeded_sources == 0 and (failed_sources > 0 or blocked_sources > 0):
        report['status'] = 'failed'
    elif failed_sources > 0 or blocked_sources > 0 or partial_sources > 0 or any(
        sc.get('blocked', 0) > 0 or sc.get('failed', 0) > 0 or sc.get('retry_wait', 0) > 0
        or bool(sc.get('crawl_errors')) or bool(sc.get('failure_stages'))
        for sc in report['sources'].values()
    ):
        report['status'] = 'partial_failure'
    else:
        report['status'] = 'completed'

    report['summary'] = {
        'sources': {
            'total': len(sources),
            'enabled': attempted_sources,
            'disabled': len(disabled_sources),
            'attempted': attempted_sources,
            'succeeded': succeeded_sources,
            'failed': failed_sources,
        },
        'documents': {
            'discovered': total_discovered_docs,
            'prepared': total_prepared_inputs,
        },
        'captures': {
            'attempted': total_capture_attempts,
            'cooldown_skips': total_cooldown_skips,
        },
        'artifacts': {
            'cached_drafts_reused': total_cached_drafts_reused,
            'checkpoints_resumed': total_checkpoints_resumed,
            'reused': total_cached_drafts_reused,
            'checkpoint_reused': total_checkpoints_resumed,
        },
        'provider_requests': {
            outcome: sum(sc.get(f'provider_requests_{outcome}', 0) for sc in report['sources'].values())
            for outcome in ('attempted', 'succeeded', 'failed')
        },
        'extractions': {
            'attempted': total_extraction_calls_attempted,
            'succeeded': total_extraction_calls_succeeded,
            'failed': total_extraction_calls_failed,
            'resumed_checkpoint': total_checkpoints_resumed,
            'waiting_retry': total_waiting_retry,
            'held': total_held_for_review,
            'held_for_review': total_held_for_review,
        },
        'drafts': {
            'created': total_drafts_created,
            'reused_awaiting_review': total_reused_awaiting_review,
            'awaiting_review': run_awaiting_review,
            'published': total_published_seen,
            'total_backlog_awaiting_review': total_backlog_awaiting_review,
        },
    }

    atomic_write(root / 'latest-generic-pipeline-run.json',
                 json.dumps(report, ensure_ascii=False, indent=2).encode())
    runs_dir = root / 'runs'
    runs_dir.mkdir(parents=True, exist_ok=True)
    run_timestamp = report['checked_at'].replace(':', '-').replace('.', '-')
    atomic_write(runs_dir / f'{run_timestamp}.json',
                 json.dumps(report, ensure_ascii=False, indent=2).encode())
    return report
