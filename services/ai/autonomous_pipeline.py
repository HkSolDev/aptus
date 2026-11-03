"""Autonomous end-to-end pipeline: capture -> identity -> Vision (if needed) -> extraction -> validation -> targeted enrichment -> automated acceptance -> publication payload."""

import copy
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

from capture_store import atomic_write, now
from extract_bundle import leaves
from notice_state import EXTRACTION_VERSION, compute_evidence_fingerprint
from store_candidate import prepare_storage
from targeted_enrichment import (
    run_targeted_enrichment,
    verify_enrichment_identity,
)
from validate_candidate import validate_candidate
from vision_recovery import (
    ALLOWED_VISION_FACT_FIELDS,
    _is_string_or_date_grounded_in_quote,
    _norm as _vision_norm,
    recover_unreadable_pdf_pages,
)

VALID_EDUCATION_LEVELS = {
    'TENTH',
    'TWELFTH',
    'DIPLOMA',
    'BACHELORS',
    'MASTERS',
    'DOCTORATE',
    'OTHER',
}
VISION_DATE_FIELDS = {
    'application_start_date',
    'application_last_date',
    'fee_payment_last_date',
    'age_as_on_date',
}



OFFICIAL_AUTHORITY_VALUES = {
    'official',
    'official_notification',
    'official_host_candidate',
    'official_portal',
    'official_pdf',
}

SUPPORTED_MERGE_FIELDS = (
    'recruiting_body',
    'application_start_date',
    'application_last_date',
    'fee_payment_last_date',
    'age_as_on_date',
    'vacancies',
    'min_age',
    'max_age',
    'education_required',
    'min_education_level',
    'min_marks_percent',
    'category_relaxation_applies',
    'category_relaxation_rules',
    'locations',
    'pay_level',
    'pay',
    'eligibility_rules',
    'experience_rules',
    'selection_process',
    'fee_rules',
    'official_site_url',
    'apply_url',
)


def is_official_authority(authority: str | None) -> bool:
    if not isinstance(authority, str):
        return False
    return authority.strip().casefold() in OFFICIAL_AUTHORITY_VALUES


def _utc_now(clock: Callable[[], datetime] | None = None) -> datetime:
    if clock is not None:
        value = clock()
        if isinstance(value, str):
            return datetime.fromisoformat(value.replace('Z', '+00:00'))
        return value
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def _post_has_qualification(post: dict[str, Any]) -> bool:
    if (post.get('education_required') or '').strip():
        return True
    if (post.get('min_education_level') or '').strip():
        return True
    rules = post.get('eligibility_rules') or {}
    for option in rules.get('education_options') or []:
        if isinstance(option, dict) and (
            (option.get('qualification') or '').strip() or (option.get('minimum_level') or '').strip()
        ):
            return True
    return False


def _post_has_age(post: dict[str, Any]) -> bool:
    if post.get('min_age') is not None or post.get('max_age') is not None:
        return True
    rules = post.get('eligibility_rules') or {}
    for rule in rules.get('age_rules') or []:
        if isinstance(rule, dict) and (rule.get('min_age') is not None or rule.get('max_age') is not None):
            return True
    return False


def _post_has_experience(post: dict[str, Any]) -> bool:
    for rule in post.get('experience_rules') or []:
        if isinstance(rule, dict) and rule.get('minimum_years') is not None:
            return True
    return False


def _post_has_vacancies(post: dict[str, Any]) -> bool:
    val = post.get('vacancies')
    return isinstance(val, int) and not isinstance(val, bool) and val >= 0


def _check_post_numeric_and_date_bounds(post: dict[str, Any], index: int) -> list[str]:
    reasons: list[str] = []
    prefix = f'posts.{index}'
    last_date = post.get('application_last_date')
    if last_date is not None:
        try:
            if not isinstance(last_date, str) or date.fromisoformat(last_date).isoformat() != last_date:
                reasons.append(f'{prefix}.application_last_date:invalid_iso_date')
        except ValueError:
            reasons.append(f'{prefix}.application_last_date:invalid_iso_date')

    min_age = post.get('min_age')
    max_age = post.get('max_age')
    if min_age is not None and (min_age < 14 or min_age > 70):
        reasons.append(f'{prefix}.min_age:age_out_of_bounds')
    if max_age is not None and (max_age < 14 or max_age > 70):
        reasons.append(f'{prefix}.max_age:age_out_of_bounds')
    if min_age is not None and max_age is not None and min_age > max_age:
        reasons.append(f'{prefix}:min_age_exceeds_max_age')

    marks = post.get('min_marks_percent')
    if marks is not None and (marks < 0 or marks > 100):
        reasons.append(f'{prefix}.min_marks_percent:marks_out_of_bounds')

    rules = post.get('eligibility_rules') or {}
    for r_idx, age_rule in enumerate(rules.get('age_rules') or []):
        if not isinstance(age_rule, dict):
            continue
        r_min = age_rule.get('min_age')
        r_max = age_rule.get('max_age')
        if r_min is not None and (r_min < 14 or r_min > 70):
            reasons.append(f'{prefix}.eligibility_rules.age_rules.{r_idx}.min_age:age_out_of_bounds')
        if r_max is not None and (r_max < 14 or r_max > 70):
            reasons.append(f'{prefix}.eligibility_rules.age_rules.{r_idx}.max_age:age_out_of_bounds')
        if r_min is not None and r_max is not None and r_min > r_max:
            reasons.append(f'{prefix}.eligibility_rules.age_rules.{r_idx}:min_age_exceeds_max_age')

    for e_idx, exp_rule in enumerate(post.get('experience_rules') or []):
        if not isinstance(exp_rule, dict):
            continue
        years = exp_rule.get('minimum_years')
        if years is not None and (years < 0 or years > 50):
            reasons.append(f'{prefix}.experience_rules.{e_idx}.minimum_years:experience_out_of_bounds')

    return reasons


def _index_documents(source_input: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    docs_by_id: dict[str, dict[str, Any]] = {}
    units_by_id: dict[str, dict[str, Any]] = {}
    for doc in source_input.get('documents') or []:
        if not isinstance(doc, dict):
            continue
        doc_id = doc.get('document_id')
        if doc_id:
            docs_by_id[doc_id] = doc
        for unit in doc.get('sections') or []:
            if isinstance(unit, dict) and unit.get('evidence_id'):
                units_by_id[unit['evidence_id']] = {
                    **unit,
                    'document_id': doc_id,
                    'source_url': doc.get('source_url'),
                    'authority': doc.get('authority'),
                }
    return docs_by_id, units_by_id


def _sync_missing_fields(facts: dict[str, Any]) -> None:
    """Keep facts['missing_fields'] synchronized with null leaves on posts."""
    posts = facts.get('posts') or []
    values = dict(leaves(posts, 'posts'))
    existing_reasons = {
        item['field_path']: item['reason']
        for item in (facts.get('missing_fields') or [])
        if isinstance(item, dict) and item.get('field_path') and item.get('reason')
    }
    new_missing = []
    for path, val in values.items():
        if val is None:
            new_missing.append({
                'field_path': path,
                'reason': existing_reasons.get(path, 'Not stated in supplied notice evidence.'),
            })
    facts['missing_fields'] = new_missing


def _coerce_and_validate_vision_fact(
    field_path: str,
    raw_value: Any,
    exact_quote: str,
) -> tuple[bool, str | None, Any, str | None]:
    """Validate a Vision candidate fact against the explicit allowlist and quote grounding."""
    if field_path not in ALLOWED_VISION_FACT_FIELDS:
        return False, None, None, 'vision_unsupported_field'
    if raw_value is None:
        return False, None, None, 'vision_null_candidate_fact'

    quote_norm = _vision_norm(exact_quote)
    if not quote_norm:
        return False, None, None, 'vision_missing_or_ungrounded_quote'

    if field_path in VISION_DATE_FIELDS:
        if not isinstance(raw_value, str):
            return False, None, None, 'vision_invalid_date_value'
        val_str = raw_value.strip()
        try:
            if date.fromisoformat(val_str).isoformat() != val_str:
                return False, None, None, 'vision_invalid_date_value'
        except ValueError:
            return False, None, None, 'vision_invalid_date_value'
        if not _is_string_or_date_grounded_in_quote(val_str, exact_quote, quote_norm):
            return False, None, None, 'vision_fact_value_not_in_quote'
        return True, field_path, val_str, None

    if field_path == 'education_required':
        if not isinstance(raw_value, str) or not raw_value.strip():
            return False, None, None, 'vision_invalid_qualification_value'
        val_str = raw_value.strip()
        if not _is_string_or_date_grounded_in_quote(val_str, exact_quote, quote_norm):
            return False, None, None, 'vision_fact_value_not_in_quote'
        return True, 'education_required', val_str, None

    if field_path == 'min_education_level':
        if not isinstance(raw_value, str) or raw_value.strip() not in VALID_EDUCATION_LEVELS:
            return False, None, None, 'vision_invalid_education_level'
        val_str = raw_value.strip()
        if not _is_string_or_date_grounded_in_quote(val_str, exact_quote, quote_norm):
            return False, None, None, 'vision_fact_value_not_in_quote'
        return True, 'min_education_level', val_str, None

    if field_path == 'min_marks_percent':
        if not isinstance(raw_value, (int, float)) or isinstance(raw_value, bool):
            return False, None, None, 'vision_invalid_numeric_value'
        val_f = float(raw_value)
        if val_f < 0 or val_f > 100:
            return False, None, None, 'vision_marks_out_of_bounds'
        num_str = str(int(val_f)) if val_f.is_integer() else str(val_f)
        if num_str not in exact_quote:
            return False, None, None, 'vision_numeric_value_not_in_quote'
        return True, 'min_marks_percent', val_f, None

    if field_path in {'min_age', 'max_age'}:
        if not isinstance(raw_value, (int, float)) or isinstance(raw_value, bool):
            return False, None, None, 'vision_invalid_numeric_value'
        if not float(raw_value).is_integer():
            return False, None, None, 'vision_invalid_age_value'
        val_i = int(raw_value)
        if val_i < 14 or val_i > 70:
            return False, None, None, 'vision_age_out_of_bounds'
        if str(val_i) not in exact_quote:
            return False, None, None, 'vision_numeric_value_not_in_quote'
        return True, field_path, val_i, None

    if field_path in {'vacancies', 'total_vacancies'}:
        if not isinstance(raw_value, (int, float)) or isinstance(raw_value, bool):
            return False, None, None, 'vision_invalid_numeric_value'
        if not float(raw_value).is_integer() or int(raw_value) < 0:
            return False, None, None, 'vision_invalid_vacancies_value'
        val_i = int(raw_value)
        if str(val_i) not in exact_quote:
            return False, None, None, 'vision_numeric_value_not_in_quote'
        return True, 'vacancies', val_i, None

    if field_path in {'experience_years', 'minimum_experience_years'}:
        if not isinstance(raw_value, (int, float)) or isinstance(raw_value, bool):
            return False, None, None, 'vision_invalid_numeric_value'
        val_f = float(raw_value)
        if val_f < 0 or val_f > 50:
            return False, None, None, 'vision_experience_out_of_bounds'
        num_str = str(int(val_f)) if val_f.is_integer() else str(val_f)
        if num_str not in exact_quote:
            return False, None, None, 'vision_numeric_value_not_in_quote'
        return True, 'experience_rules', val_f, None

    return False, None, None, 'vision_unsupported_field'


def apply_validated_vision_recovery(
    extracted: dict[str, Any],
    source_input: dict[str, Any],
    vision_requests: list[dict[str, Any]],
) -> dict[str, Any]:
    """Merge only validated, post-bound Vision facts into extracted facts without mutating native_text."""
    updated_extracted = copy.deepcopy(extracted)
    updated_source = copy.deepcopy(source_input)
    facts = updated_extracted.get('facts')
    if not isinstance(facts, dict):
        return {
            'extracted': updated_extracted,
            'source_input': updated_source,
            'applied_count': 0,
            'applied_fields': [],
            'unresolved_reasons': [],
            'conflicts': [],
        }

    posts = facts.get('posts') or []
    evidence_list = facts.setdefault('evidence', [])
    applied_count = 0
    applied_fields: list[str] = []
    unresolved_reasons: list[str] = []
    conflicts: list[dict[str, Any]] = []

    for record in vision_requests or []:
        if not isinstance(record, dict) or record.get('status') != 'recovered':
            continue
        doc_id = record.get('document_id')
        page_num = record.get('physical_pdf_page')
        validated_resp = record.get('validated_response') or {}
        target_doc = next(
            (doc for doc in (updated_source.get('documents') or []) if doc.get('document_id') == doc_id),
            None,
        )
        if target_doc is None or not (target_doc.get('source_url') or '').strip():
            unresolved_reasons.append(f'vision_missing_document_provenance:{doc_id}')
            continue

        for v_post in validated_resp.get('posts') or []:
            v_post_name = (v_post.get('post_name') or '').strip()
            if not v_post_name:
                unresolved_reasons.append('vision_missing_post_name')
                continue
            matched_indices = [
                idx for idx, post in enumerate(posts)
                if (post.get('post_name') or '').strip().casefold() == v_post_name.casefold()
            ]
            if len(matched_indices) != 1:
                unresolved_reasons.append(f'vision_unmatched_post:{v_post_name}')
                continue
            post_idx = matched_indices[0]
            post = posts[post_idx]
            exp_rules = post.setdefault('experience_rules', [])
            sections = target_doc.setdefault('sections', [])

            for fact_idx, fact in enumerate(v_post.get('candidate_facts') or []):
                if not isinstance(fact, dict):
                    continue
                raw_field = str(fact.get('field_path') or '').strip()
                quote = (fact.get('exact_quote') or '').strip()
                fact_page = fact.get('physical_pdf_page')
                locator = (fact.get('section_locator') or '').strip()
                if (
                    not quote
                    or not locator
                    or not isinstance(fact_page, int)
                    or isinstance(fact_page, bool)
                    or fact_page < 1
                    or (isinstance(page_num, int) and fact_page != page_num)
                ):
                    unresolved_reasons.append(f'vision_missing_fact_provenance:{v_post_name}:{raw_field}')
                    continue

                ok, target_field, coerced_val, err = _coerce_and_validate_vision_fact(
                    raw_field,
                    fact.get('value'),
                    quote,
                )
                if not ok or target_field is None:
                    unresolved_reasons.append(f'{err or "vision_invalid_fact"}:{v_post_name}:{raw_field}')
                    continue

                unit_id = f'{doc_id}:vision:p{fact_page}:{post_idx}:fact:{fact_idx}'

                if target_field == 'experience_rules':
                    cond_str = (fact.get('conditions') or '').strip() or None
                    conflicting_exp = next(
                        (
                            r for r in exp_rules
                            if isinstance(r, dict)
                            and r.get('minimum_years') is not None
                            and float(r['minimum_years']) != float(coerced_val)
                            and (r.get('conditions') or None) == cond_str
                        ),
                        None,
                    )
                    if conflicting_exp is not None:
                        unresolved_reasons.append(f'vision_extracted_fact_conflict:{v_post_name}:experience_rules')
                        conflicts.append({
                            'post_name': v_post_name,
                            'field_path': 'experience_rules',
                            'existing_value': conflicting_exp.get('minimum_years'),
                            'conflicting_value': coerced_val,
                            'quote': quote,
                            'physical_pdf_page': fact_page,
                            'document_id': doc_id,
                        })
                        continue
                    if not any(sec.get('evidence_id') == unit_id for sec in sections):
                        sections.append({
                            'evidence_id': unit_id,
                            'title': f'Vision recovered page {fact_page} (experience_rules)',
                            'text': quote,
                            'locations': [{'kind': 'pdf_page', 'page': fact_page, 'locator': locator}],
                        })
                    new_rule = {'minimum_years': coerced_val, 'conditions': cond_str}
                    rule_idx = len(exp_rules)
                    exp_rules.append(new_rule)
                    prefix = f'posts.{post_idx}.experience_rules.{rule_idx}'
                    for leaf_key, leaf_val in new_rule.items():
                        if leaf_val is not None:
                            evidence_list.append({
                                'field_path': f'{prefix}.{leaf_key}',
                                'evidence_id': unit_id,
                                'quote': quote,
                            })
                    applied_count += 1
                    applied_fields.append(f'{prefix}.minimum_years')
                    continue

                existing_val = post.get(target_field)
                if existing_val is not None and existing_val != coerced_val:
                    unresolved_reasons.append(f'vision_extracted_fact_conflict:{v_post_name}:{target_field}')
                    conflicts.append({
                        'post_name': v_post_name,
                        'field_path': target_field,
                        'existing_value': existing_val,
                        'conflicting_value': coerced_val,
                        'quote': quote,
                        'physical_pdf_page': fact_page,
                        'document_id': doc_id,
                    })
                    continue

                if not any(sec.get('evidence_id') == unit_id for sec in sections):
                    sections.append({
                        'evidence_id': unit_id,
                        'title': f'Vision recovered page {fact_page} ({target_field})',
                        'text': quote,
                        'locations': [{'kind': 'pdf_page', 'page': fact_page, 'locator': locator}],
                    })

                post[target_field] = coerced_val
                full_field_path = f'posts.{post_idx}.{target_field}'
                evidence_list[:] = [c for c in evidence_list if c.get('field_path') != full_field_path]
                evidence_list.append({
                    'field_path': full_field_path,
                    'evidence_id': unit_id,
                    'quote': quote,
                })
                applied_count += 1
                applied_fields.append(full_field_path)

            for alt_idx, alt in enumerate(v_post.get('experience_alternatives') or []):
                quote = (alt.get('supporting_quote') or '').strip()
                alt_page = alt.get('physical_pdf_page') or page_num
                if not quote or not isinstance(alt_page, int) or alt_page < 1:
                    unresolved_reasons.append(f'vision_missing_fact_provenance:{v_post_name}:experience_alternatives')
                    continue
                unit_id = f'{doc_id}:vision:p{alt_page}:{post_idx}:{alt_idx}'
                if not any(sec.get('evidence_id') == unit_id for sec in sections):
                    sections.append({
                        'evidence_id': unit_id,
                        'title': f'Vision recovered page {alt_page}',
                        'text': quote,
                        'locations': [{'kind': 'pdf_page', 'page': alt_page, 'locator': alt.get('source_locator') or f'page:{alt_page}'}],
                    })
                role_parts = [r.strip() for r in (alt.get('role_titles') or []) if isinstance(r, str) and r.strip()]
                qualifiers = [
                    q.strip()
                    for q in (alt.get('institution_or_scope'), alt.get('class_scope'), alt.get('certificate_requirement'))
                    if isinstance(q, str) and q.strip()
                ]
                cond_parts = [', '.join(role_parts)] if role_parts else []
                cond_parts.extend(qualifiers)
                conditions_str = ' | '.join(cond_parts) if cond_parts else None
                new_rule = {
                    'minimum_years': alt.get('minimum_years'),
                    'conditions': conditions_str,
                }
                rule_idx = len(exp_rules)
                exp_rules.append(new_rule)
                prefix = f'posts.{post_idx}.experience_rules.{rule_idx}'
                for leaf_key, leaf_val in new_rule.items():
                    if leaf_val is not None:
                        evidence_list.append({
                            'field_path': f'{prefix}.{leaf_key}',
                            'evidence_id': unit_id,
                            'quote': quote,
                        })
                applied_count += 1
                applied_fields.append(prefix)

    _sync_missing_fields(facts)
    return {
        'extracted': updated_extracted,
        'source_input': updated_source,
        'applied_count': applied_count,
        'applied_fields': applied_fields,
        'unresolved_reasons': sorted(set(unresolved_reasons)),
        'conflicts': conflicts,
    }


def apply_verified_enrichment_to_bundle(
    extracted: dict[str, Any],
    source_input: dict[str, Any],
    enrichment_report: dict[str, Any],
) -> dict[str, Any]:
    """Apply validated post-bound enrichment candidates into extracted facts and provenance documents."""
    updated_extracted = copy.deepcopy(extracted)
    updated_source = copy.deepcopy(source_input)
    facts = updated_extracted.get('facts')
    if not isinstance(facts, dict):
        return {
            'extracted': updated_extracted,
            'source_input': updated_source,
            'reader_summary': None,
            'official_syllabus': [],
            'historical_cutoffs': [],
            'applied_fields': [],
        }

    posts = facts.get('posts') or []
    evidence_list = facts.setdefault('evidence', [])
    documents = updated_source.setdefault('documents', [])
    applied_fields: list[str] = []

    for res_idx, cand in enumerate(enrichment_report.get('field_candidates') or []):
        if not isinstance(cand, dict) or cand.get('status') != 'verified':
            continue
        post_name = (cand.get('post_name') or '').strip()
        field_path = cand.get('field_path')
        value = cand.get('value')
        ev_list = cand.get('evidence') or []
        if not ev_list:
            continue
        ev = ev_list[0]
        quote = (ev.get('exact_quote') or '').strip()
        doc_id = ev.get('document_id')
        source_url = ev.get('source_url')
        authority = ev.get('authority') or 'official_host_candidate'
        page = ev.get('page') or 1
        locator = ev.get('locator') or f'enrichment:{field_path}'

        if not quote or not doc_id or not source_url or not is_official_authority(authority):
            continue

        matched_indices = [
            idx for idx, post in enumerate(posts)
            if (post.get('post_name') or '').strip().casefold() == post_name.casefold()
        ]
        if len(matched_indices) != 1:
            continue
        post_idx = matched_indices[0]
        post = posts[post_idx]

        unit_id = f'{doc_id}:enrichment:{post_idx}:{res_idx}'
        doc_entry = next((d for d in documents if d.get('document_id') == doc_id), None)
        if doc_entry is None:
            doc_entry = {
                'document_id': doc_id,
                'format': 'pdf',
                'role': 'supporting',
                'authority': 'official_host_candidate',
                'source_url': source_url,
                'title': f'Official enrichment source ({field_path})',
                'sections': [],
            }
            documents.append(doc_entry)
        doc_entry.setdefault('sections', []).append({
            'evidence_id': unit_id,
            'title': f'Enrichment {field_path}',
            'text': quote,
            'locations': [{'kind': 'page', 'page': page, 'block': 0, 'locator': locator}],
        })
        doc_purposes = facts.setdefault('document_purposes', [])
        if not any(dp.get('document_id') == doc_id for dp in doc_purposes if isinstance(dp, dict)):
            doc_purposes.append({
                'document_id': doc_id,
                'purpose': facts.get('purpose', 'recruitment'),
                'evidence': [{'evidence_id': unit_id, 'quote': quote}],
            })

        def add_citation(leaf_path: str) -> None:
            evidence_list[:] = [c for c in evidence_list if c.get('field_path') != leaf_path]
            evidence_list.append({
                'field_path': leaf_path,
                'evidence_id': unit_id,
                'quote': quote,
            })

        if field_path == 'application_last_date' and isinstance(value, str):
            post['application_last_date'] = value
            add_citation(f'posts.{post_idx}.application_last_date')
            applied_fields.append(f'posts.{post_idx}.application_last_date')
        elif field_path in {'vacancies', 'total_vacancies'} and isinstance(value, int) and not isinstance(value, bool):
            post['vacancies'] = value
            add_citation(f'posts.{post_idx}.vacancies')
            applied_fields.append(f'posts.{post_idx}.vacancies')
        elif field_path in {'education_required', 'min_education_level'} and isinstance(value, str) and value.strip():
            post[field_path] = value.strip()
            add_citation(f'posts.{post_idx}.{field_path}')
            applied_fields.append(f'posts.{post_idx}.{field_path}')
        elif field_path in {'min_age', 'max_age'} and isinstance(value, (int, float)) and not isinstance(value, bool):
            post[field_path] = int(value)
            add_citation(f'posts.{post_idx}.{field_path}')
            applied_fields.append(f'posts.{post_idx}.{field_path}')

    _sync_missing_fields(facts)

    verified_syllabus = [
        s for s in (enrichment_report.get('official_syllabus') or [])
        if isinstance(s, dict) and s.get('status') == 'verified'
    ]
    verified_cutoffs = [
        c for c in (enrichment_report.get('historical_cutoffs') or [])
        if isinstance(c, dict) and c.get('status') == 'verified' and c.get('reference_only') is True
    ]
    reader_summary_obj = enrichment_report.get('reader_summary')

    return {
        'extracted': updated_extracted,
        'source_input': updated_source,
        'reader_summary': reader_summary_obj,
        'official_syllabus': verified_syllabus,
        'historical_cutoffs': verified_cutoffs,
        'applied_fields': applied_fields,
    }


def evaluate_automated_acceptance(
    extracted: dict[str, Any],
    source_input: dict[str, Any],
    *,
    vision_requests: list[dict[str, Any]] | None = None,
    vision_merge_reasons: list[str] | None = None,
    enrichment_report: dict[str, Any] | None = None,
    research_exhausted: bool = False,
) -> dict[str, Any]:
    """Evaluate the 7 deterministic rules for autonomous acceptance and publication."""
    blocked_reasons: list[str] = []
    retryable_reasons: list[str] = []

    # Rule 1: Verified notice identity and official authority
    id_ok, _, id_reason = verify_enrichment_identity(source_input)
    if not id_ok:
        blocked_reasons.append(id_reason or 'unverified_notice_identity')

    identity = source_input.get('identity') or {}
    if 'authority' in identity and not is_official_authority(identity.get('authority')):
        blocked_reasons.append('non_official_identity_authority')

    docs_by_id, units_by_id = _index_documents(source_input)
    if not docs_by_id:
        blocked_reasons.append('missing_source_documents')
    for doc_id, doc in docs_by_id.items():
        if not is_official_authority(doc.get('authority')):
            blocked_reasons.append(f'non_official_source_document:{doc_id}')

    # Rule 5: Check Vision/Search outputs for unresolved conflicts, unsupported fields, or identity mismatches
    for merge_reason in vision_merge_reasons or []:
        if isinstance(merge_reason, str) and merge_reason.strip():
            blocked_reasons.append(merge_reason.strip())

    for v_rec in vision_requests or []:
        if not isinstance(v_rec, dict):
            continue
        if v_rec.get('status') not in {'recovered', 'skipped'}:
            for r in v_rec.get('reason_codes') or []:
                if 'conflict' in r or 'mismatch' in r or 'unsupported' in r:
                    blocked_reasons.append(r)
                elif v_rec.get('retryable') or 'resource_exhausted' in r or 'rate_limit' in r or 'cap_deferred' in r:
                    retryable_reasons.append(r)

    if isinstance(enrichment_report, dict):
        for r in enrichment_report.get('reason_codes') or []:
            if 'conflict' in r:
                blocked_reasons.append(r)
            elif enrichment_report.get('retryable') or 'resource_exhausted' in r or 'rate_limit' in r:
                retryable_reasons.append(r)

    # Rule 3, 4, 7: Deterministic candidate & evidence validation
    validation = validate_candidate(extracted, source_input)
    facts = extracted.get('facts') if isinstance(extracted.get('facts'), dict) else {}
    purpose = facts.get('purpose', 'recruitment')
    if purpose != 'recruitment':
        blocked_reasons.append(f'non_recruitment_purpose:{purpose}')

    for err in validation.get('errors') or []:
        reason = err.get('reason', 'validation_error')
        field_path = err.get('field_path', 'facts')
        blocked_reasons.append(f'{field_path}:{reason}')

    posts = facts.get('posts') if isinstance(facts.get('posts'), list) else []
    if not posts:
        blocked_reasons.append('posts:recruitment_requires_posts')

    # Rule 2 & Rule 3: Post-specific bound evidence & full provenance (quote + URL/doc/page/locator)
    citations = facts.get('evidence') if isinstance(facts.get('evidence'), list) else []
    seen_post_names: set[str] = set()
    core_fields_by_post: dict[str, dict[str, bool]] = {}
    missing_core_fields: list[tuple[str, str]] = []

    for idx, post in enumerate(posts):
        if not isinstance(post, dict):
            blocked_reasons.append(f'posts.{idx}:invalid_post_object')
            continue
        post_name = (post.get('post_name') or '').strip()
        norm_name = post_name.casefold()
        if not norm_name or norm_name in seen_post_names:
            blocked_reasons.append(f'posts.{idx}.post_name:missing_or_duplicate_post_name')
        seen_post_names.add(norm_name)

        # Rule 4: Deterministic numeric and date bounds
        blocked_reasons.extend(_check_post_numeric_and_date_bounds(post, idx))

        # Rule 6: Core publication fields completeness
        has_post_name = bool(post_name)
        has_recruiting_body = bool((post.get('recruiting_body') or '').strip())
        has_last_date = bool((post.get('application_last_date') or '').strip())
        has_qualification = _post_has_qualification(post)
        has_age = _post_has_age(post)
        has_vacancies = _post_has_vacancies(post)
        has_experience = _post_has_experience(post)
        has_secondary_metric = has_age or has_vacancies or has_experience

        core_status = {
            'post_name': has_post_name,
            'recruiting_body': has_recruiting_body,
            'application_last_date': has_last_date,
            'qualification': has_qualification,
            'secondary_core_metric': has_secondary_metric,
        }
        core_fields_by_post[post_name or f'posts.{idx}'] = core_status

        if not has_post_name:
            missing_core_fields.append((post_name or f'posts.{idx}', 'post_name'))
        if not has_recruiting_body:
            missing_core_fields.append((post_name or f'posts.{idx}', 'recruiting_body'))
        if not has_last_date:
            missing_core_fields.append((post_name or f'posts.{idx}', 'application_last_date'))
        if not has_qualification:
            missing_core_fields.append((post_name or f'posts.{idx}', 'education_required'))
        if not has_secondary_metric:
            missing_core_fields.append((post_name or f'posts.{idx}', 'vacancies'))

    # Verify every citation has quote, official document, URL, and page/locator provenance
    for cit in citations:
        if not isinstance(cit, dict):
            blocked_reasons.append('evidence:invalid_citation_entry')
            continue
        fp = cit.get('field_path') or ''
        quote = (cit.get('quote') or '').strip()
        ev_id = cit.get('evidence_id')
        if not quote or not ev_id:
            blocked_reasons.append(f'{fp}:missing_citation_provenance')
            continue
        unit = units_by_id.get(ev_id)
        if unit is None:
            blocked_reasons.append(f'{fp}:unknown_evidence_unit')
            continue
        doc = docs_by_id.get(unit.get('document_id') or '')
        if doc is None or not (doc.get('source_url') or '').strip():
            blocked_reasons.append(f'{fp}:missing_document_source_url')
            continue
        if not is_official_authority(doc.get('authority')):
            blocked_reasons.append(f'{fp}:non_official_citation_authority')
        locations = unit.get('locations') or []
        if not locations:
            blocked_reasons.append(f'{fp}:missing_page_or_locator_provenance')

    for post_label, missing_field in missing_core_fields:
        retryable_reasons.append(f'missing_core_field:{post_label}:{missing_field}')

    dedup_blocked = sorted(set(blocked_reasons))
    dedup_retryable = sorted(set(retryable_reasons))

    if dedup_blocked:
        return {
            'decision': 'blocked',
            'persistence_allowed': False,
            'publication_status': 'blocked',
            'reason_codes': dedup_blocked,
            'core_fields_by_post': core_fields_by_post,
            'research_exhausted': research_exhausted,
            'validation': validation,
            'checked_at': now(),
        }

    if dedup_retryable:
        return {
            'decision': 'retryable',
            'persistence_allowed': False,
            'publication_status': 'retryable',
            'reason_codes': dedup_retryable,
            'core_fields_by_post': core_fields_by_post,
            'research_exhausted': research_exhausted,
            'validation': validation,
            'checked_at': now(),
        }

    return {
        'decision': 'accepted',
        'persistence_allowed': True,
        'publication_status': 'published',
        'reason_codes': [],
        'core_fields_by_post': core_fields_by_post,
        'research_exhausted': research_exhausted,
        'validation': validation,
        'checked_at': now(),
    }


def _field_strength(value: Any) -> int:
    """Measure deterministic completeness strength of a supported post field."""
    if value is None:
        return 0
    if isinstance(value, str):
        return 1 if value.strip() else 0
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return 1
    if isinstance(value, list):
        return sum(1 for item in value if _field_strength(item) > 0)
    if isinstance(value, dict):
        return sum(_field_strength(v) for v in value.values())
    return 0


def merge_stronger_accepted_posts(
    existing_posts: list[dict[str, Any]],
    incoming_posts: list[dict[str, Any]],
    *,
    incoming_fingerprint: str,
    existing_lineage: list[dict[str, Any]] | None = None,
    updated_at: str | None = None,
) -> dict[str, Any]:
    """Update only supported fields when stronger later official evidence arrives, retaining prior values in audit_lineage."""
    merged_posts = copy.deepcopy(existing_posts)
    lineage = copy.deepcopy(existing_lineage or [])
    timestamp = updated_at or now()
    updated_fields: list[dict[str, Any]] = []

    by_name = {
        (p.get('post_name') or '').strip().casefold(): idx
        for idx, p in enumerate(merged_posts)
        if isinstance(p, dict) and (p.get('post_name') or '').strip()
    }

    for inc in incoming_posts or []:
        if not isinstance(inc, dict):
            continue
        p_name = (inc.get('post_name') or '').strip()
        key = p_name.casefold()
        if not key:
            continue
        if key not in by_name:
            merged_posts.append(copy.deepcopy(inc))
            by_name[key] = len(merged_posts) - 1
            entry = {
                'post_name': p_name,
                'field_path': '__post__',
                'previous_value': None,
                'new_value': copy.deepcopy(inc),
                'evidence_fingerprint': incoming_fingerprint,
                'updated_at': timestamp,
            }
            lineage.append(entry)
            updated_fields.append(entry)
            continue

        target = merged_posts[by_name[key]]
        for field in SUPPORTED_MERGE_FIELDS:
            old_val = target.get(field)
            new_val = inc.get(field)
            if new_val == old_val or new_val is None:
                continue
            old_strength = _field_strength(old_val)
            new_strength = _field_strength(new_val)
            if new_strength > old_strength:
                target[field] = copy.deepcopy(new_val)
                entry = {
                    'post_name': p_name,
                    'field_path': field,
                    'previous_value': copy.deepcopy(old_val),
                    'new_value': copy.deepcopy(new_val),
                    'evidence_fingerprint': incoming_fingerprint,
                    'updated_at': timestamp,
                }
                lineage.append(entry)
                updated_fields.append(entry)

    return {
        'posts': merged_posts,
        'audit_lineage': lineage,
        'updated_fields': updated_fields,
    }


class AutonomousNoticeStateStore:
    """Durable state store for accepted, blocked, and retryable notice outcomes with exponential backoff."""

    BACKOFF_SCHEDULE_SECONDS = (300, 900, 3600, 14400)

    def __init__(self, root: Path, clock: Callable[[], datetime] | None = None):
        self.root = Path(root) / 'autonomous_state'
        self.root.mkdir(parents=True, exist_ok=True)
        self._clock = clock

    def _path(self, bundle_id: str) -> Path:
        safe = ''.join(ch if ch.isalnum() or ch in '-_.' else '_' for ch in bundle_id)
        return self.root / f'{safe}.json'

    def read(self, bundle_id: str) -> dict[str, Any] | None:
        path = self._path(bundle_id)
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding='utf-8'))

    def should_skip_for_backoff(self, bundle_id: str, fingerprint: str) -> tuple[bool, dict[str, Any] | None]:
        state = self.read(bundle_id)
        if not state:
            return False, None
        if state.get('decision') == 'accepted' and state.get('evidence_fingerprint') == fingerprint:
            return True, state
        if state.get('decision') == 'retryable' and state.get('evidence_fingerprint') == fingerprint:
            next_retry_at = state.get('next_retry_at')
            if next_retry_at:
                now_dt = _utc_now(self._clock)
                retry_dt = datetime.fromisoformat(next_retry_at.replace('Z', '+00:00'))
                if now_dt < retry_dt:
                    return True, state
        return False, state

    def record(
        self,
        bundle_id: str,
        *,
        fingerprint: str,
        decision: str,
        reason_codes: list[str],
        accepted_posts: list[dict[str, Any]] | None = None,
        audit_lineage: list[dict[str, Any]] | None = None,
        payload_path: Path | None = None,
    ) -> dict[str, Any]:
        prior = self.read(bundle_id) or {}
        now_dt = _utc_now(self._clock)
        retry_count = int(prior.get('retry_count', 0))
        backoff_seconds = 0
        next_retry_at = None

        if decision == 'retryable':
            idx = min(retry_count, len(self.BACKOFF_SCHEDULE_SECONDS) - 1)
            backoff_seconds = self.BACKOFF_SCHEDULE_SECONDS[idx]
            retry_count += 1
            next_retry_at = _iso(now_dt + timedelta(seconds=backoff_seconds))
        elif decision == 'accepted':
            retry_count = 0

        record_data = {
            'bundle_id': bundle_id,
            'evidence_fingerprint': fingerprint,
            'extraction_version': EXTRACTION_VERSION,
            'decision': decision,
            'reason_codes': list(reason_codes),
            'retry_count': retry_count,
            'backoff_seconds': backoff_seconds,
            'next_retry_at': next_retry_at,
            'accepted_posts': accepted_posts if accepted_posts is not None else prior.get('accepted_posts'),
            'audit_lineage': audit_lineage if audit_lineage is not None else prior.get('audit_lineage', []),
            'payload_path': str(payload_path) if payload_path else prior.get('payload_path'),
            'updated_at': _iso(now_dt),
        }
        atomic_write(self._path(bundle_id), json.dumps(record_data, ensure_ascii=False, indent=2).encode('utf-8'))
        return record_data


def _map_post_to_ingest_post(post: dict[str, Any], source_url: str) -> dict[str, Any]:
    """Convert a validated CandidatePost into the deterministic TypeScript ingest post shape."""
    rules = post.get('eligibility_rules') or {}
    age_rules = rules.get('age_rules') or []
    first_age = age_rules[0] if age_rules and isinstance(age_rules[0], dict) else {}

    edu_str = (post.get('education_required') or post.get('min_education_level') or '').strip() or None
    min_marks = post.get('min_marks_percent')
    if min_marks is not None:
        min_marks = float(min_marks)

    exp_rules = post.get('experience_rules') or []
    exp_years: int | None = None
    for exp in exp_rules:
        if isinstance(exp, dict) and exp.get('minimum_years') is not None:
            exp_years = int(round(float(exp['minimum_years'])))
            break

    locations = [loc.strip() for loc in (post.get('locations') or []) if isinstance(loc, str) and loc.strip()]

    return {
        'title': (post.get('post_name') or '').strip(),
        'organization': (post.get('recruiting_body') or '').strip(),
        'sourceUrl': source_url,
        'minEducation': edu_str,
        'minMarksPercent': min_marks,
        'minAge': post.get('min_age') if post.get('min_age') is not None else first_age.get('min_age'),
        'maxAge': post.get('max_age') if post.get('max_age') is not None else first_age.get('max_age'),
        'ageAsOnDate': post.get('age_as_on_date'),
        'categoryRelaxationApplies': post.get('category_relaxation_applies'),
        'experienceYears': exp_years,
        'totalVacancies': post.get('vacancies'),
        'applicationLastDate': post.get('application_last_date'),
        'location': ', '.join(locations) if locations else None,
    }


def run_autonomous_notice(
    root: Path | str,
    prepared: dict[str, Any],
    *,
    source_name: str,
    extract_fn: Callable[[dict[str, Any]], dict[str, Any]],
    vision_bundle: dict[str, Any] | None = None,
    vision_provider: Any = None,
    pdf_bytes_by_doc: dict[str, bytes] | None = None,
    page_images_by_doc: dict[str, dict[int, bytes]] | None = None,
    search_client: Any = None,
    capture_client: Any = None,
    issuer_hosts: dict[str, list[str]] | None = None,
    include_syllabus: bool = False,
    include_historical_cutoffs: bool = False,
    persist_fn: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
    clock: Callable[[], datetime] | None = None,
) -> dict[str, Any]:
    """Run the bounded autonomous flow for a prepared notice bundle."""
    root_path = Path(root)
    root_path.mkdir(parents=True, exist_ok=True)
    state_store = AutonomousNoticeStateStore(root_path, clock=clock)

    source_input = copy.deepcopy(prepared['llm_input']['input'])
    bundle_id = source_input['bundle_id']
    notice_identity = source_input.get('identity') or {}
    fingerprint = compute_evidence_fingerprint(source_input, EXTRACTION_VERSION)

    skip, existing_state = state_store.should_skip_for_backoff(bundle_id, fingerprint)
    if skip and existing_state is not None:
        if existing_state.get('decision') == 'accepted':
            saved_path = existing_state.get('payload_path')
            saved_payload = (
                json.loads(Path(saved_path).read_text(encoding='utf-8'))
                if saved_path and Path(saved_path).exists()
                else None
            )
            return {
                'bundle_id': bundle_id,
                'evidence_fingerprint': fingerprint,
                'decision': 'accepted',
                'publication_status': 'published',
                'vision_called': False,
                'reused_accepted': True,
                'backoff_skipped': False,
                'reason_codes': [],
                'state': existing_state,
                'ingest_payload': saved_payload,
            }
        return {
            'bundle_id': bundle_id,
            'evidence_fingerprint': fingerprint,
            'decision': 'retryable',
            'publication_status': 'retryable',
            'vision_called': False,
            'reused_accepted': False,
            'backoff_skipped': True,
            'reason_codes': existing_state.get('reason_codes', []),
            'state': existing_state,
            'ingest_payload': None,
        }

    # Step 1: Vision recovery ONLY when a verified PDF page is marked unusable
    vision_requests: list[dict[str, Any]] = []
    vision_called = False
    if vision_bundle is not None and vision_provider is not None:
        v_res = recover_unreadable_pdf_pages(
            vision_bundle,
            gemini_provider=vision_provider,
            pdf_bytes_by_doc=pdf_bytes_by_doc,
            page_images_by_doc=page_images_by_doc,
            storage_dir=root_path,
        )
        vision_requests = v_res['requests']
        vision_called = v_res['vision_called']

    # Step 2: Structured extraction
    prepared_for_extract = copy.deepcopy(prepared)
    prepared_for_extract['llm_input']['input'] = source_input
    extracted = copy.deepcopy(extract_fn(prepared_for_extract))

    vision_merge_reasons: list[str] = []
    if vision_requests:
        merged_vision = apply_validated_vision_recovery(extracted, source_input, vision_requests)
        extracted = merged_vision['extracted']
        source_input = merged_vision['source_input']
        vision_merge_reasons = merged_vision.get('unresolved_reasons', [])

    # Step 3: Targeted enrichment / bounded research when core or supported fields are missing/weak
    enrichment_report: dict[str, Any] | None = None
    reader_summary: dict[str, Any] | None = None
    official_syllabus: list[dict[str, Any]] = []
    historical_cutoffs: list[dict[str, Any]] = []

    if search_client is not None and capture_client is not None:
        requested_fields: list[str] = []
        for post in (extracted.get('facts') or {}).get('posts') or []:
            if not (post.get('application_last_date') or '').strip():
                requested_fields.append('application_last_date')
            if not _post_has_qualification(post):
                requested_fields.append('education_required')
            if not (_post_has_age(post) or _post_has_vacancies(post) or _post_has_experience(post)):
                requested_fields.append('vacancies')
        requested_fields = sorted(set(requested_fields))

        if requested_fields or include_syllabus or include_historical_cutoffs:
            enrichment_report = run_targeted_enrichment(
                extracted.get('facts') or {},
                source_input,
                search_client=search_client,
                capture_client=capture_client,
                issuer_hosts=issuer_hosts,
                requested_fields=requested_fields,
                include_syllabus=include_syllabus,
                include_historical_cutoffs=include_historical_cutoffs,
            )
            applied = apply_verified_enrichment_to_bundle(extracted, source_input, enrichment_report)
            extracted = applied['extracted']
            source_input = applied['source_input']
            reader_summary = applied['reader_summary']
            official_syllabus = applied['official_syllabus']
            historical_cutoffs = applied['historical_cutoffs']

    # Step 4: Evaluate deterministic automated acceptance after bounded research
    final_acceptance = evaluate_automated_acceptance(
        extracted,
        source_input,
        vision_requests=vision_requests,
        vision_merge_reasons=vision_merge_reasons,
        enrichment_report=enrichment_report,
        research_exhausted=True,
    )
    decision = final_acceptance['decision']
    reason_codes = list(final_acceptance['reason_codes'])

    # Step 5: Stronger-evidence merge & audit lineage when accepted
    audit_lineage: list[dict[str, Any]] = []
    if existing_state and existing_state.get('audit_lineage'):
        audit_lineage = copy.deepcopy(existing_state['audit_lineage'])

    if decision == 'accepted':
        incoming_posts = extracted['facts']['posts']
        if existing_state and existing_state.get('accepted_posts'):
            merged = merge_stronger_accepted_posts(
                existing_state['accepted_posts'],
                incoming_posts,
                incoming_fingerprint=fingerprint,
                existing_lineage=audit_lineage,
                updated_at=_iso(_utc_now(clock)),
            )
            extracted['facts']['posts'] = merged['posts']
            audit_lineage = merged['audit_lineage']
            _sync_missing_fields(extracted['facts'])

    # Step 6: Build storage draft envelope & autonomous ingest payload
    draft_envelope: dict[str, Any] | None = None
    storage_error: str | None = None
    if final_acceptance['validation'].get('validated_facts') is not None:
        try:
            draft_envelope = prepare_storage(
                extracted,
                source_input,
                source_name=source_name,
                reader_summary=reader_summary,
                official_syllabus=official_syllabus or None,
                historical_cutoffs=historical_cutoffs or None,
                enrichment_candidates=(enrichment_report.get('field_candidates') if enrichment_report else None) or None,
                vision_recovery={'requests': vision_requests} if vision_requests else None,
                automated_decision={
                    'decision': decision,
                    'reason_codes': reason_codes,
                    'evidence_fingerprint': fingerprint,
                    'extraction_version': EXTRACTION_VERSION,
                },
            )
            draft_envelope['disposition'] = 'valid_recruitment_review_draft'
            draft_envelope['evidence_fingerprint'] = fingerprint
            draft_envelope['extraction_version'] = EXTRACTION_VERSION
            draft_envelope['source_evidence'] = source_input['documents']
            draft_envelope['metadata'] = {
                key: extracted.get(key)
                for key in ('provider', 'model', 'usage')
                if extracted.get(key) is not None
            }
        except (KeyError, TypeError, ValueError) as exc:
            draft_envelope = None
            storage_error = f'candidate_storage_contract_failed:{type(exc).__name__}'
    elif decision == 'accepted':
        storage_error = 'candidate_storage_contract_failed:missing_validated_facts'

    if decision == 'accepted' and draft_envelope is None:
        err_code = storage_error or 'candidate_storage_contract_failed'
        decision = 'blocked'
        final_acceptance['decision'] = 'blocked'
        final_acceptance['publication_status'] = 'blocked'
        final_acceptance['persistence_allowed'] = False
        reason_codes = sorted(set(reason_codes + [err_code]))

    primary_url = (source_input.get('documents') or [{}])[0].get('source_url') or 'https://example.gov.in/notice'
    ingest_posts = (
        [_map_post_to_ingest_post(p, primary_url) for p in extracted['facts']['posts']]
        if decision == 'accepted'
        else []
    )

    payload_path = root_path / 'autonomous_payloads' / f'{bundle_id}.json'
    state_record = state_store.record(
        bundle_id,
        fingerprint=fingerprint,
        decision=decision,
        reason_codes=reason_codes,
        accepted_posts=extracted.get('facts', {}).get('posts') if decision == 'accepted' else None,
        audit_lineage=audit_lineage,
        payload_path=payload_path,
    )

    ingest_payload = {
        'kind': 'autonomous_notice',
        'bundleId': bundle_id,
        'sourceName': source_name,
        'sourceUrl': primary_url,
        'evidenceFingerprint': fingerprint,
        'extractionVersion': EXTRACTION_VERSION,
        'decision': decision,
        'publicationStatus': final_acceptance['publication_status'],
        'persistenceAllowed': final_acceptance['persistence_allowed'],
        'reasonCodes': reason_codes,
        'retryCount': state_record['retry_count'],
        'backoffSeconds': state_record['backoff_seconds'],
        'nextRetryAt': state_record['next_retry_at'],
        'noticeIdentity': notice_identity,
        'posts': ingest_posts,
        'draftEnvelope': draft_envelope,
        'readerSummary': reader_summary,
        'officialSyllabus': official_syllabus,
        'historicalCutoffs': historical_cutoffs,
        'visionRecovery': vision_requests,
        'enrichmentCandidates': enrichment_report.get('field_candidates') if enrichment_report else [],
        'auditLineage': audit_lineage,
    }
    atomic_write(payload_path, json.dumps(ingest_payload, ensure_ascii=False, indent=2).encode('utf-8'))

    persistence_result = persist_fn(ingest_payload) if persist_fn is not None else None

    return {
        'bundle_id': bundle_id,
        'evidence_fingerprint': fingerprint,
        'decision': decision,
        'publication_status': final_acceptance['publication_status'],
        'persistence_allowed': final_acceptance['persistence_allowed'],
        'vision_called': vision_called,
        'reused_accepted': False,
        'backoff_skipped': False,
        'reason_codes': reason_codes,
        'storage_error': storage_error,
        'state': state_record,
        'extracted': extracted,
        'draft_envelope': draft_envelope,
        'ingest_payload': ingest_payload,
        'persistence_result': persistence_result,
    }
