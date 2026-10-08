"""Offline candidate gate: missing details need review; invalid facts are blocked."""

import json
import math
from datetime import date

from pydantic import ValidationError

from build_extraction_input import BundleFacts
from extract_bundle import check_evidence, leaves


def validate_candidate(result, source):
    errors, warnings = [], []
    report = {'status': 'blocked', 'persistence_allowed': False,
              'errors': errors, 'warnings': warnings, 'validated_facts': None,
              'semantic_support_verified': False}
    for reason in sorted(set(result.get('review_reasons', []) +
                             source.get('coverage', {}).get('review_reasons', []))):
        warnings.append({'field_path': 'source', 'reason': reason})
    warnings.append({'field_path': 'facts', 'reason': 'semantic_support_requires_review'})
    raw = result.get('facts')
    if not isinstance(raw, dict):
        errors.append({'field_path': 'facts', 'reason': 'missing_candidate_facts'})
        return report
    # The legacy date validator converts malformed dates to null. Catch them
    # before schema validation so a bad value cannot become an innocent unknown.
    for path, value in leaves(raw.get('posts', []), 'posts'):
        field = path.rsplit('.', 1)[-1]
        if value is not None and field in {'application_last_date', 'age_as_on_date',
                                          'application_start_date', 'fee_payment_last_date'}:
            try:
                if not isinstance(value, str) or date.fromisoformat(value).isoformat() != value:
                    raise ValueError
            except ValueError:
                errors.append({'field_path': path, 'reason': 'invalid_iso_date'})
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            if (isinstance(value, float) and not math.isfinite(value)) or value < 0:
                errors.append({'field_path': path, 'reason': 'invalid_nonnegative_number'})
            elif field in {'min_marks_percent', 'minimum_marks_percent'} and value > 100:
                errors.append({'field_path': path, 'reason': 'marks_out_of_range'})
    try:
        facts = BundleFacts.model_validate_json(json.dumps(raw), strict=True).model_dump(mode='json')
    except (ValidationError, TypeError, ValueError):
        errors.append({'field_path': 'facts', 'reason': 'invalid_candidate_structure'})
        return report
    if not facts['posts']:
        errors.append({'field_path': 'posts', 'reason': 'no_candidate_posts'})
    names = set()
    for index, post in enumerate(facts['posts']):
        prefix = f'posts.{index}'
        name = (post['post_name'] or '').strip().casefold()
        if not name or name in names:
            errors.append({'field_path': prefix + '.post_name', 'reason': 'missing_or_duplicate_post_name'})
        names.add(name)
        groups = [(prefix, post), *[(f'{prefix}.eligibility_rules.age_rules.{i}', rule)
                  for i, rule in enumerate(post['eligibility_rules']['age_rules'])]]
        if post['pay'] is not None:
            groups.append((prefix + '.pay', post['pay']))
        for path, rule in groups:
            low, high = (('minimum_amount', 'maximum_amount') if path.endswith('.pay')
                         else ('min_age', 'max_age'))
            if rule[low] is not None and rule[high] is not None and rule[low] > rule[high]:
                errors.append({'field_path': path, 'reason': 'minimum_exceeds_maximum'})
        start, end = post['application_start_date'], post['application_last_date']
        if start and end and start > end:
            errors.append({'field_path': prefix, 'reason': 'application_dates_reversed'})
        for path, value in leaves(post, prefix):
            if value is None:
                warnings.append({'field_path': path, 'reason': 'detail_not_supported'})
        def empty_lists(node, path):
            if isinstance(node, dict):
                for key, value in node.items():
                    empty_lists(value, f'{path}.{key}')
            elif isinstance(node, list):
                if not node:
                    warnings.append({'field_path': path, 'reason': 'array_coverage_unconfirmed'})
                for i, value in enumerate(node):
                    empty_lists(value, f'{path}.{i}')
        empty_lists(post, prefix)
    errors.extend(check_evidence(facts, source)['errors'])
    for issue in result.get('inline_check', {}).get('errors', []):
        (warnings if issue['reason'] == 'scope_needs_review' else errors).append(issue)
    if not errors:
        report.update(status='needs_review', validated_facts=facts)
    return report


if __name__ == '__main__':
    import argparse
    from pathlib import Path
    from capture_store import atomic_write
    parser = argparse.ArgumentParser(description='Validate saved extraction offline; no API/database calls.')
    parser.add_argument('result_json')
    parser.add_argument('prepared_json')
    parser.add_argument('output_json')
    args = parser.parse_args()
    result = json.loads(Path(args.result_json).read_text())
    source = json.loads(Path(args.prepared_json).read_text())['llm_input']['input']
    report = validate_candidate(result, source)
    atomic_write(Path(args.output_json), json.dumps(report, ensure_ascii=False, indent=2).encode())
    print(json.dumps({'status': report['status'], 'errors': report['errors'],
                      'review_flags': len(report['warnings']), 'persistence_allowed': False}))
