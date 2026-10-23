"""A shallow provider schema; retain the full typed contract in local validation."""

import copy

from inline_extraction import CITATION, STATUSES, decode_inline


class MissingFactsError(ValueError):
    def __init__(self, fields):
        super().__init__('Required scalar facts were not returned')
        self.fields = fields


class CompactPathError(ValueError):
    def __init__(self, message, field_path):
        super().__init__(message)
        self.field_path = field_path


PURPOSE_VALUES = [
    'recruitment',
    'amendment',
    'result',
    'admit_card',
    'exam_update',
    'non_job',
    'unclear',
]


def compact_schema():
    fact = {'type': 'object', 'additionalProperties': False, 'properties': {
        'field': {'type': 'string'},
        'value': {'anyOf': [{'type': kind} for kind in ('string', 'number', 'boolean', 'null')]},
        'status': {'type': 'string', 'enum': STATUSES},
        'evidence': {'type': 'array', 'items': CITATION},
        'reason': {'anyOf': [{'type': 'string'}, {'type': 'null'}]},
        'scope': {'type': 'string', 'enum': ['post', 'shared', 'unknown']},
        'scope_evidence': {'type': 'array', 'items': CITATION}},
        'required': ['field', 'value', 'status', 'evidence', 'reason', 'scope', 'scope_evidence']}
    post = {'type': 'object', 'additionalProperties': False,
            'properties': {'facts': {'type': 'array', 'items': fact}}, 'required': ['facts']}

    doc_purpose = {
        'type': 'object',
        'additionalProperties': False,
        'properties': {
            'document_id': {'type': 'string'},
            'purpose': {'type': 'string', 'enum': PURPOSE_VALUES},
            'evidence': {'type': 'array', 'items': CITATION},
        },
        'required': ['document_id', 'purpose', 'evidence'],
    }

    amendment = {
        'anyOf': [
            {'type': 'null'},
            {
                'type': 'object',
                'additionalProperties': False,
                'properties': {
                    'amendment_type': {'anyOf': [{'type': 'string'}, {'type': 'null'}]},
                    'effective_date': {'anyOf': [{'type': 'string'}, {'type': 'null'}]},
                    'target_advertisement_number': {'anyOf': [{'type': 'string'}, {'type': 'null'}]},
                    'target_campaign_name': {'anyOf': [{'type': 'string'}, {'type': 'null'}]},
                    'target_post_names': {'type': 'array', 'items': {'type': 'string'}},
                    'changes_description': {'anyOf': [{'type': 'string'}, {'type': 'null'}]},
                    'evidence': {'type': 'array', 'items': CITATION},
                },
                'required': [
                    'amendment_type',
                    'effective_date',
                    'target_advertisement_number',
                    'target_campaign_name',
                    'target_post_names',
                    'changes_description',
                    'evidence',
                ],
            },
        ]
    }

    return {
        'type': 'object',
        'additionalProperties': False,
        'properties': {
            'purpose': {'type': 'string', 'enum': PURPOSE_VALUES},
            'purpose_evidence': {'type': 'array', 'items': CITATION},
            'document_purposes': {'type': 'array', 'items': doc_purpose},
            'amendment': amendment,
            'posts': {'type': 'array', 'items': post},
        },
        'required': ['purpose', 'purpose_evidence', 'document_purposes', 'amendment', 'posts'],
    }


def field_catalogue(schema):
    """Expose allowed paths/types without expanding the constrained provider grammar."""
    definitions = schema['$defs']

    def walk(node, path):
        if '$ref' in node:
            yield from walk(definitions[node['$ref'].rsplit('/', 1)[1]], path)
        elif node.get('type') == 'object':
            for key, value in node['properties'].items():
                yield from walk(value, f'{path}.{key}' if path else key)
        elif node.get('type') == 'array':
            yield from walk(node['items'], f'{path}.<index>')
        elif 'anyOf' in node and any('$ref' in branch for branch in node['anyOf']):
            yield {'field': path, 'value_schema': {'type': 'null'}}
            for branch in node['anyOf']:
                if '$ref' in branch:
                    yield from walk(branch, path)
        else:
            yield {'field': path, 'value_schema': node}

    return list(walk(definitions['CandidatePost'], ''))


def decode_compact(response, source, schema):
    if not isinstance(response, dict):
        raise ValueError('Invalid compact response root')
    has_purpose = 'purpose' in response
    if has_purpose:
        expected_keys = {'purpose', 'purpose_evidence', 'document_purposes', 'amendment', 'posts'}
        if set(response) != expected_keys:
            raise ValueError('Invalid compact response root: missing purpose fields')
        purpose = response['purpose']
        if purpose not in PURPOSE_VALUES:
            raise ValueError('Invalid compact response root: unknown purpose')
        if not isinstance(response['purpose_evidence'], list):
            raise ValueError('Invalid compact response root: purpose_evidence must be list')
        if not isinstance(response['document_purposes'], list):
            raise ValueError('Invalid compact response root: document_purposes must be list')
        if response['amendment'] is not None and not isinstance(response['amendment'], dict):
            raise ValueError('Invalid compact response root: amendment must be object or null')
    else:
        if set(response) != {'posts'}:
            raise ValueError('Invalid compact response root')
        purpose = 'recruitment'

    if not isinstance(response['posts'], list):
        raise ValueError('Invalid compact response root: posts must be list')

    tree = {
        'purpose': purpose,
        'purpose_evidence': response.get('purpose_evidence', []),
        'document_purposes': response.get('document_purposes', []),
        'amendment': response.get('amendment'),
        'posts': [],
    }

    if purpose in {'result', 'admit_card', 'exam_update', 'non_job', 'unclear', 'amendment'} and not response['posts']:
        return decode_inline(tree, source)

    definitions = schema['$defs']

    def resolve(node):
        if '$ref' in node:
            return resolve(definitions[node['$ref'].rsplit('/', 1)[1]])
        return node

    def skeleton(node):
        node = resolve(node)
        if node.get('type') == 'object':
            return {key: skeleton(value) for key, value in node['properties'].items()}
        if node.get('type') == 'array':
            # Unknown arrays use no indexed entries because null placeholders violate their item type;
            # omitting indexed entries leaves the container as [] cleanly.
            return []
        return None

    def assign(container, node, tokens, fact):
        node = resolve(node)
        if 'anyOf' in node:
            node = next((resolve(branch) for branch in node['anyOf'] if '$ref' in branch), node)
        token = tokens[0]
        if node.get('type') == 'object' and token in node['properties']:
            child = node['properties'][token]
            key = token
        elif node.get('type') == 'array' and token.isdecimal() and str(int(token)) == token:
            key = int(token)
            if key > len(container) or key >= 100:
                raise ValueError('Array indices must be consecutive and bounded')
            child = node['items']
            if key == len(container):
                container.append(skeleton(child))
        else:
            raise ValueError('Unknown compact fact path')
        if len(tokens) == 1:
            target = resolve(child)
            if target.get('type') in {'object', 'array'}:
                raise ValueError('Fact must address a scalar or a nullable object')
            if any('$ref' in branch for branch in target.get('anyOf', [])) and fact['value'] is not None:
                raise ValueError('Nullable object facts may only describe its absence')
            container[key] = fact
            return
        if container[key] is None:
            branch = resolve(child)
            branch = next((item for item in branch.get('anyOf', []) if '$ref' in item), branch)
            container[key] = skeleton(branch)
        assign(container[key], child, tokens[1:], fact)

    for post in response['posts']:
        if not isinstance(post, dict) or set(post) != {'facts'} or not isinstance(post['facts'], list):
            raise ValueError('Invalid compact post')
        fields = definitions['CandidatePost']
        candidate, used = skeleton(fields), set()
        for record in post['facts']:
            if not isinstance(record, dict) or not isinstance(record.get('field'), str):
                raise ValueError('Invalid compact fact')
            path = record['field']
            if not path or any(path == previous or path.startswith(previous + '.')
                               or previous.startswith(path + '.') for previous in used):
                raise ValueError('Duplicate or overlapping fact path')
            used.add(path)
            fact = copy.deepcopy(record)
            fact.pop('field')
            try:
                assign(candidate, fields, path.split('.'), fact)
            except ValueError as error:
                raise CompactPathError(str(error), path) from None
        def missing(node, path=''):
            if node is None:
                return [path]
            if isinstance(node, dict) and 'value' not in node:
                return [field for key, value in node.items()
                        for field in missing(value, f'{path}.{key}' if path else key)]
            if isinstance(node, list):
                return [field for index, value in enumerate(node)
                        for field in missing(value, f'{path}.{index}')]
            return []
        unreported = missing(candidate)
        if unreported:
            raise MissingFactsError(unreported)
        tree['posts'].append(candidate)
    # Unreported scalar slots remain bare None and are rejected by the inline decoder.
    return decode_inline(tree, source)
