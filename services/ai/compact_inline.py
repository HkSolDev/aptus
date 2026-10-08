"""A shallow provider schema; retain the full typed contract in local validation."""

import copy

from inline_extraction import CITATION, STATUSES, decode_inline


class MissingFactsError(ValueError):
    def __init__(self, fields):
        super().__init__('Required scalar facts were not returned')
        self.fields = fields


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
    return {'type': 'object', 'additionalProperties': False,
            'properties': {'posts': {'type': 'array', 'items': post}}, 'required': ['posts']}


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
    if not isinstance(response, dict) or set(response) != {'posts'} or not isinstance(response['posts'], list):
        raise ValueError('Invalid compact response root')
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

    tree = {'posts': []}
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
            assign(candidate, fields, path.split('.'), fact)
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
