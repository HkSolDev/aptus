"""One saved-source experiment, exactly one provider call, no publication."""
import copy
import json
from pathlib import Path

from build_extraction_input import BundleFacts, INSTRUCTIONS
from compact_inline import MissingFactsError, decode_compact, field_catalogue
from extract_bundle import check_evidence, request_structured
from normalize_candidate_facts import normalize_candidate_facts
from staged_extraction import expand_quotes, response_schema

OUT = Path('outputs/extract')

def saved_wire(number):
    raw = json.loads((OUT / f'ibps-staged/call-{number}.json').read_text())
    return json.loads(raw['candidates'][0]['content']['parts'][0]['text'])

def write(name, value):
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2))

source = json.loads((OUT / 'ibps-html.prepared.json').read_text())['llm_input']['input']
source = copy.deepcopy(source)
all_units = {u['evidence_id']: u for d in source['documents'] for u in d['sections']}
# Keep the entire recruitment table, including shared notes and other rows:
# this trial removes chrome, not potentially important recruitment context.
ids = {'notice-html:unit-4', 'notice-html:unit-13'} | {
    f'notice-html:link-{i}' for i in (11, 13, 14, 18, 19, 23)}
for doc in source['documents']:
    doc['sections'] = [u for u in doc['sections'] if u['evidence_id'] in ids]
units = {u['evidence_id']: u for d in source['documents'] for u in d['sections']}
target = next(p for p in saved_wire(1)['posts'] if p['post_name'] == 'Office Assistant')
previous = saved_wire(3)
old_records = expand_quotes(previous, previous['posts'][0]['facts'], all_units)
contract = BundleFacts.model_json_schema()
catalogue = field_catalogue(contract)
required = [c['field'] for c in catalogue if '<index>' not in c['field']]

def example(field, value, status, evidence, reason):
    return {'field': field, 'value': value, 'status': status,
            'evidence': evidence, 'reason': reason, 'scope': 'post',
            'scope_evidence': evidence}

dummy = {'label': 'FORMAT ONLY: fictional example; NEVER copy these facts or IDs',
    'fictional_source': 'Example Clerk minimum age: 19. No pay information supplied.',
    'response': {'quotes': [{'id': 'demo-q', 'evidence_id': 'demo-unit',
                            'quote': 'Example Clerk minimum age: 19.'}],
        'posts': [{'post_id': 'demo-post', 'facts': [
            example('min_age', 19, 'found', ['demo-q'], None),
            example('pay', None, 'not_located', [],
                    'The supplied example does not state salary.')]}]}}
dummy['additional_examples'] = [
    {'label': 'FICTIONAL education row: Laboratory Technician',
     'fictional_source': 'Laboratory Technician: Diploma in Chemistry with 62.5% marks.',
     'response': {'quotes': [{'id': 'demo-education-q', 'evidence_id': 'demo-education-unit',
                             'quote': 'Laboratory Technician: Diploma in Chemistry with 62.5% marks.'}],
         'posts': [{'post_id': 'demo-technician', 'facts': [
             example('eligibility_rules.education_options.0.' + field, value,
                     'found' if value is not None else 'not_located',
                     ['demo-education-q'] if value is not None else [],
                     None if value is not None else 'No additional education conditions are stated.')
             for field, value in [('minimum_level', 'DIPLOMA'),
                                  ('minimum_marks_percent', 62.5),
                                  ('qualification', 'Diploma in Chemistry'),
                                  ('subject_requirement', 'Chemistry'), ('conditions', None)]
         ]}]}},
    {'label': 'FICTIONAL shared fee: Museum Guide and Archive Assistant',
     'fictional_source': 'For both Museum Guide and Archive Assistant, the application fee for every category is INR 300.',
     'response': {'quotes': [{'id': 'demo-fee-q', 'evidence_id': 'demo-fee-unit',
                             'quote': 'For both Museum Guide and Archive Assistant, the application fee for every category is INR 300.'}],
         'posts': [{'post_id': 'demo-guide', 'facts': [
             {**example('fee_rules.0.' + field, value,
                        'found' if value is not None else 'not_located',
                        ['demo-fee-q'] if value is not None else [],
                        None if value is not None else 'No additional fee conditions are stated.'),
              'scope': 'shared', 'scope_evidence': ['demo-fee-q']}
             for field, value in [('categories.0', 'every category'), ('amount', 300),
                                  ('currency', 'INR'), ('conditions', None)]
         ]}]}}
]
payload = {'bundle_id': source['bundle_id'], 'identity': source['identity'],
    'review_reasons': source['coverage']['review_reasons'],
    'target_posts': [{'post_id': 'post-0', **target}],
    'units': list(units.values()), 'field_catalogue': catalogue,
    'required_scalar_fields': required, 'format_example': dummy}
instructions = INSTRUCTIONS + '''
Extract ONLY Office Assistant, post_id post-0. Read the shared rules AND its own
row, age line and application link. Other posts' requirements must not leak in.
The fictional format_example demonstrates syntax only, NOT recruitment facts.
Its additional_examples are partial format demonstrations, not complete outputs.
Never copy their fictional job names, values or demo IDs into the actual result.
Return quotes once as {id,evidence_id,quote}; evidence/scope_evidence contain
those quote IDs. Every quote must match a REAL supplied unit verbatim.
Report EVERY required_scalar_fields entry with a supported value or null with
a specific reason. Nullable objects (pay/category_relaxation_rules) require
either parent null OR their applicable children, NEVER both. Empty arrays are
omitted, never parent null. Any included array-object row must report ALL its
scalar children, including unknowns as null with a reason. Use numeric values
for age, vacancies, marks, fees and years. Do not silently skip a scalar field.
Retain partial exam windows as text. Absence means not found in supplied evidence,
not proof that the official notice omits the rule. Do not invent age relaxation.
'''
write('office-assistant.focused-input-with-examples.json', payload)
write('office-assistant.offline-review.json', {
    'fresh_calls': 0, 'previous_reported_fields': [r['field'] for r in old_records],
    'required_scalar_checklist': required, 'retained_unit_ids': sorted(units),
    'omitted_unit_ids': sorted(set(all_units) - set(units)),
    'source_text_characters_before': sum(len(u['text']) for u in all_units.values()),
    'source_text_characters_after': sum(len(u['text']) for u in units.values()),
    'selection_note': 'Manual one-example chrome removal; whole recruitment table retained.'})
wire, metadata = request_structured(payload, response_schema(), instructions,
                                    provider='gemini', model='gemini-3.5-flash-lite')
write('office-assistant.provider-response.json', {'response': wire, **metadata})
result = {'fresh_calls': 1, **metadata, 'review_reasons': payload['review_reasons']}
try:
    if len(wire['posts']) != 1 or wire['posts'][0]['post_id'] != 'post-0':
        raise ValueError('Unexpected post count or identity')
    records = expand_quotes(wire, wire['posts'][0]['facts'])
    facts, audit = decode_compact({'posts': [{'facts': records}]}, source, contract)
    facts, corrections = normalize_candidate_facts(facts)
    result.update(status='candidate_needs_review', facts=facts, inline_check=audit,
                  evidence_check=check_evidence(facts, source), corrections=corrections)
except MissingFactsError as error:
    result.update(status='incomplete', unreported_fields=error.fields)
except (ValueError, TypeError, KeyError):
    result.update(status='invalid_post_output')
write('office-assistant.result.json', result)
print(json.dumps({'status': result['status'], 'usage': result['usage'],
                  'unreported_fields': result.get('unreported_fields', [])}))
