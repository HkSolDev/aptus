"""Conservative corrections to model facts; retain an audit of every changed value."""

import copy
import re

from schema import parse_date


def normalize_candidate_facts(facts):
    facts = copy.deepcopy(facts)
    corrections = []

    def change(container, key, path, value, reason):
        previous = container[key]
        if previous == value:
            return
        container[key] = value
        corrections.append({'field_path': path, 'previous': previous,
                            'value': value, 'reason': reason})
        if value is None:
            facts['evidence'] = [item for item in facts['evidence'] if item['field_path'] != path]
            facts['missing_fields'].append({'field_path': path, 'reason': reason})

    for index, post in enumerate(facts['posts']):
        prefix = f'posts.{index}'
        options = post['eligibility_rules']['education_options']
        for number, option in enumerate(options):
            text = ' '.join(option.get(key) or '' for key in
                            ('qualification', 'subject_requirement', 'conditions'))
            professional_ca = re.search(r'\bchartered accountan(?:t|cy)\b|\bC\.?A\.?(?=\W|$)', text, re.I)
            explicit_bachelor = re.search(r'\bbachelor|\bgraduate|\bgraduation|\bB\.?\s*(?:Com|Tech|Sc|A)\b', text, re.I)
            if professional_ca and not explicit_bachelor and option['minimum_level'] == 'BACHELORS':
                change(option, 'minimum_level',
                       f'{prefix}.eligibility_rules.education_options.{number}.minimum_level',
                       None, 'CA qualification does not establish a bachelor requirement.')
        if post['min_education_level'] == 'BACHELORS' and options and any(
                item['field_path'].startswith(f'{prefix}.eligibility_rules.education_options.')
                for item in corrections) and not any(option['minimum_level'] == 'BACHELORS' for option in options):
            change(post, 'min_education_level', f'{prefix}.min_education_level', None,
                   'No remaining education option establishes a bachelor requirement.')

        stages = post['selection_process']
        kept = []
        for number, stage in enumerate(stages):
            old_path = f'{prefix}.selection_process.{number}'
            if re.search(r'\bpre[\s-]*(?:exam|examination)[\s-]*training\b', stage, re.I):
                new_path = f'{prefix}.other_requirements.{len(post["other_requirements"])}'
                post['other_requirements'].append(stage)
                corrections.append({'field_path': old_path, 'previous': stage,
                                    'value': stage, 'moved_to': new_path,
                                    'reason': 'Pre-exam training is not a selection stage.'})
            else:
                new_path = f'{prefix}.selection_process.{len(kept)}'
                kept.append(stage)
            for collection in ('evidence', 'missing_fields'):
                for item in facts[collection]:
                    if item['field_path'] == old_path:
                        item['field_path'] = new_path
        post['selection_process'] = kept

        for key in ('application_start_date', 'fee_payment_last_date'):
            value = post[key]
            parsed = parse_date(value)
            if parsed:
                change(post, key, f'{prefix}.{key}', parsed.isoformat(), 'Normalize complete date to ISO.')
        for number, value in enumerate(post['exam_dates']):
            parsed = parse_date(value)
            if parsed:
                change(post['exam_dates'], number, f'{prefix}.exam_dates.{number}',
                       parsed.isoformat(), 'Normalize complete date to ISO.')
    return facts, corrections
