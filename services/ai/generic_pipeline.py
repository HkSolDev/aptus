"""Run the generic crawl path; only ready evidence may reach extraction."""

import json
from pathlib import Path

from capture_store import atomic_write, now
from extract_bundle import extract_bundle
from notice_state import (EXTRACTION_VERSION, NoticeStateManager,
                          compute_evidence_fingerprint)
from shared_pipeline import prepare_sources
from source_registry import DEFAULT_SOURCES_PATH
from store_candidate import prepare_storage
from validate_candidate import validate_candidate


def _source_name(source_id, prepared):
    documents = prepared['llm_input']['input']['documents']
    title = next((document.get('title') for document in documents if document.get('title')), None)
    return f'{source_id}: {title}' if title else source_id


def run_pipeline(root, *, sources_path=DEFAULT_SOURCES_PATH, source_id=None,
                 max_fetches=12, max_depth=3, prepare=prepare_sources,
                 extract=extract_bundle, validate=validate_candidate,
                 draft=prepare_storage, persist=None, prepare_only=False,
                 extraction_version=EXTRACTION_VERSION):
    """Crawl sources and process only coverage-approved evidence.

    ``persist`` is deliberately injectable. The default worker writes reviewable
    drafts locally and never turns model output into published jobs without the
    explicit reviewed-candidate publication flow.
    """
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    state_manager = NoticeStateManager(root)
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
        }
        if source['status'] == 'blocked':
            counts['blocked'] += 1
            counts['reason'] = 'unsupported_seed_type'
            report['status'] = 'partial_failure'
            continue
        for path in source.get('prepared_paths', []):
            stage = 'prepared_input'
            try:
                prepared = json.loads(Path(path).read_text(encoding='utf-8'))
                if not prepared.get('llm_input'):
                    counts['blocked'] += 1
                    counts['blocked_reasons'].extend(
                        prepared.get('coverage', {}).get('review_reasons', ['coverage_not_ready']))
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
                        if persist is not None:
                            stage = 'persistence'
                            persist(cached_envelope)
                            counts['published'] += 1
                        continue

                    stage = 'extraction'
                    extracted = extract(prepared)
                    counts['extracted'] += 1
                    stage = 'validation'
                    validation = validate(extracted, source_input)
                    if validation.get('status') == 'blocked':
                        counts['blocked'] += 1
                        counts['blocked_reasons'].extend(
                            issue.get('reason', 'candidate_validation_blocked')
                            for issue in validation.get('errors', []) if isinstance(issue, dict))
                        continue
                    stage = 'draft_preparation'
                    envelope = draft(extracted, source_input,
                                     source_name=_source_name(source_id, prepared))
                    draft_path = root / 'drafts' / f"{extracted['bundle_id']}.json"
                    atomic_write(draft_path, json.dumps(envelope, ensure_ascii=False, indent=2).encode())
                    counts['drafts'] += 1
                    state_manager.record_success(bundle_id, fingerprint, extraction_version, draft_path)
                    if persist is not None:
                        stage = 'persistence'
                        persist(envelope)
                        counts['published'] += 1
            except (KeyError, OSError, RuntimeError, TypeError, ValueError):
                counts['failed'] += 1
                counts['failure_stages'].append(stage)
                report['status'] = 'partial_failure'
        if counts['blocked'] or counts['failed']:
            report['status'] = 'partial_failure'
        counts['blocked_reasons'] = sorted(set(counts['blocked_reasons']))
        counts['failure_stages'] = sorted(set(counts['failure_stages']))
    atomic_write(root / 'latest-generic-pipeline-run.json',
                 json.dumps(report, ensure_ascii=False, indent=2).encode())
    return report
