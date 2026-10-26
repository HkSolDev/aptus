"""Manual/cron-only structured extraction trial; no ingestion or eligibility decisions."""

import copy
import json
import os
import re

import httpx
from provider_metrics import provider_post
from pydantic import ValidationError

from build_extraction_input import BundleFacts, INSTRUCTIONS, is_extraction_approved
from compact_inline import CompactPathError, MissingFactsError, compact_schema, decode_compact, field_catalogue
from inline_extraction import InlineFactError
from normalize_candidate_facts import normalize_candidate_facts
from providers.openai import _openai_schema
from provider_schedule import ProviderDeferred, provider_off_peak_delay


class ProviderRequestError(RuntimeError):
    def __init__(self, reason, *, retryable=False, retry_after=0):
        super().__init__(reason)
        self.retryable = retryable
        self.retry_after = retry_after


DECODE_CHECKS = {
    'Invalid compact response root': 'invalid_response_root',
    'Invalid compact post': 'invalid_post',
    'Invalid compact fact': 'invalid_fact',
    'Unknown compact fact path': 'unknown_field_path',
    'Duplicate or overlapping fact path': 'duplicate_or_overlapping_path',
    'Array indices must be consecutive and bounded': 'invalid_array_index',
    'Fact must address a scalar or a nullable object': 'non_scalar_fact',
    'Nullable object facts may only describe its absence': 'non_null_object_fact',
    'Every scalar needs an inline fact': 'missing_inline_fact',
    'Found fact needs a value and evidence': 'found_without_value_or_evidence',
    'Unresolved fact needs null and an explanation': 'invalid_unresolved_fact',
    'Invalid fact status or scope': 'invalid_status_or_scope',
    'Invalid missing reason': 'invalid_missing_reason',
    'Invalid evidence list': 'invalid_evidence_list',
    'Invalid inline citation': 'invalid_citation',
    'Invalid inline citation types': 'invalid_citation_types',
}


class FactDecodingError(RuntimeError):
    """Expose only fixed check codes and schema-owned paths, never response values."""
    def __init__(self, cause, schema):
        super().__init__('provider_fact_decoding_failed')
        patterns = [re.escape(item['field']).replace('<index>', r'(?:0|[1-9]\d*)')
                    for item in field_catalogue(schema)]
        paths = []
        if isinstance(cause, MissingFactsError):
            check, paths = 'unreported_scalar_fields', cause.fields
        elif isinstance(cause, CompactPathError):
            check = DECODE_CHECKS.get(str(cause), 'unclassified_decoding_error')
            paths = [cause.field_path]
            # Container paths are diagnostic locations, never accepted fact values.
            patterns = [prefix for pattern in patterns
                        for prefix in [pattern, *[pattern[:match.start()]
                            for match in re.finditer(r'\\\.', pattern)]]]
        elif isinstance(cause, InlineFactError):
            check = (cause.check if cause.check in {'unresolved_value_not_null',
                     'unresolved_explanation_missing'} else 'unclassified_decoding_error')
            tokens = cause.field_path.split('.', 2)
            if len(tokens) == 3 and tokens[0] == 'posts' and tokens[1].isdecimal():
                paths = [tokens[2]]
        elif isinstance(cause, ValidationError):
            check = 'invalid_field_value'
            for issue in cause.errors(include_url=False, include_context=False, include_input=False):
                location = issue['loc']
                if len(location) > 2 and location[0] == 'posts' and isinstance(location[1], int):
                    paths.append('.'.join(str(part) for part in location[2:]))
        else:
            check = ('invalid_response_root' if str(cause).startswith('Invalid compact response root')
                     else DECODE_CHECKS.get(str(cause), 'unclassified_decoding_error'))
        paths = sorted({path for path in paths if isinstance(path, str)
                        and any(re.fullmatch(pattern, path) for pattern in patterns)})
        self.details = {'check': check, 'field_count': len(paths), 'field_paths': paths[:20]}


def provider_keys(provider):
    if provider == 'openai':
        names = ['OPENAI_API_KEY']
    elif provider == 'deepseek':
        names = ['DEEPSEEK_API_KEY']
    else:
        numbered = sorted((name for name in os.environ
                           if re.fullmatch(r'GEMINI_API_KEY_[1-9]\d*', name)),
                          key=lambda name: int(name.rsplit('_', 1)[1]))
        names = ['GEMINI_API_KEY', *numbered]
    return list(dict.fromkeys(key.strip() for name in names
                             for key in os.environ.get(name, '').split(',') if key.strip()))


def invalid_gemini_key(response):
    if response.status_code == 401:
        return True
    if response.status_code not in {400, 403}:
        return False
    try:
        details = response.json().get('error', {}).get('details', [])
        return any(isinstance(item, dict) and item.get('reason') in {
            'API_KEY_INVALID', 'API_KEY_EXPIRED', 'API_KEY_SERVICE_BLOCKED',
            'API_KEY_IP_ADDRESS_BLOCKED', 'API_KEY_HTTP_REFERRER_BLOCKED'} for item in details)
    except (ValueError, AttributeError, TypeError):
        return False


def request_structured(source, schema, instructions, *, provider=None, model=None, client=None):
    """One bounded provider request; shared by single-pass and staged extraction."""
    provider = provider or os.getenv('LLM_PROVIDER', 'gemini')
    if provider not in {'openai', 'gemini', 'deepseek'}:
        raise ValueError('Use openai, gemini or deepseek')
    delay = provider_off_peak_delay(provider)
    if delay:
        raise ProviderDeferred(delay)
    model = model or os.getenv('LLM_MODEL') or {
        'openai': 'gpt-4o-mini', 'gemini': 'gemini-3.8-flash', 'deepseek': 'deepseek-flash'}[provider]
    if not re.fullmatch(r'[A-Za-z0-9._-]{1,100}', model):
        raise ValueError('Invalid model name')
    keys = provider_keys(provider)
    if not keys:
        raise RuntimeError('provider_credential_unavailable')
    system = instructions
    if len(json.dumps({'instructions': system, 'input': {**source, 'output_schema': schema}},
                      ensure_ascii=False)) > 120_000:
        raise ValueError('Inline extraction input exceeds character budget')
    prompt = json.dumps(source, ensure_ascii=False)
    if provider == 'openai':
        url = 'https://api.openai.com/v1/chat/completions'
        headers = {}
        payload = {'model': model, 'messages': [{'role': 'system', 'content': system},
            {'role': 'user', 'content': prompt}], 'response_format': {'type': 'json_schema',
            'json_schema': {'name': 'bundle_facts', 'strict': True, 'schema': _openai_schema(schema)}}}
    elif provider == 'deepseek':
        url = 'https://api.deepseek.com/chat/completions'
        headers = {}
        # JSON mode constrains syntax, not this schema. Send the schema explicitly
        # and keep the same local decoding/grounding gate as every other provider.
        payload = {'model': model, 'messages': [
            {'role': 'system', 'content': system + '\nReturn one JSON object matching output_schema.'},
            {'role': 'user', 'content': json.dumps({**source, 'output_schema': schema}, ensure_ascii=False)}],
            'response_format': {'type': 'json_object'}, 'max_tokens': 32768,
            'thinking': {'type': 'disabled'}}
    else:
        url = f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
        headers = {}
        payload = {'systemInstruction': {'parts': [{'text': system}]},
            'contents': [{'parts': [{'text': prompt}]}],
            'generationConfig': {'responseMimeType': 'application/json', 'responseJsonSchema': schema}}
    # Only explicitly rejected keys fail over. Never repeat a timeout/quota request.
    try:
        for attempt, key in enumerate(keys, 1):
            headers = ({'Authorization': f'Bearer {key}'} if provider in {'openai', 'deepseek'}
                       else {'x-goog-api-key': key})
            response = provider_post(client or httpx, url, headers=headers, json=payload, timeout=120)
            if provider == 'gemini' and invalid_gemini_key(response):
                if attempt < len(keys):
                    continue
                raise RuntimeError('provider_credentials_rejected')
            break
        if not response.is_success:
            delay = response.headers.get('retry-after', '0')
            raise ProviderRequestError(f'provider_http_{response.status_code}',
                retryable=response.status_code in {408, 429, 500, 502, 503, 504},
                retry_after=min(int(delay), 86400) if delay.isdigit() else 0)
        data = response.json()
        if provider in {'openai', 'deepseek'}:
            choice = data['choices'][0]
            if choice.get('finish_reason') != 'stop' or choice['message'].get('refusal'):
                raise RuntimeError('provider_incomplete_or_refused')
            text = choice['message']['content']
            usage = data.get('usage', {})
        else:
            candidate = data['candidates'][0]
            if candidate.get('finishReason') != 'STOP':
                raise RuntimeError('provider_incomplete_or_refused')
            text = ''.join(part.get('text', '') for part in candidate['content']['parts'])
            usage = data.get('usageMetadata', {})
    except (httpx.ConnectError, httpx.ConnectTimeout):
        raise ProviderRequestError('provider_network_failed', retryable=True) from None
    except httpx.HTTPError:
        # A read timeout may follow a billed generation: require review instead
        # of silently paying for the same uncertain request again.
        raise ProviderRequestError('provider_network_failed') from None
    except (KeyError, IndexError, TypeError, ValueError):
        raise RuntimeError('provider_response_invalid') from None
    try:
        wire = json.loads(text)
    except (TypeError, ValueError):
        raise RuntimeError('provider_json_invalid') from None
    return wire, {'provider': provider, 'model': model, 'credential_attempts': attempt, 'usage': usage}


def extract_bundle(prepared, *, provider=None, model=None, client=None, response_path=None):
    if not is_extraction_approved(prepared):
        raise ValueError('No approved input: inspect coverage/budget first')
    source = copy.deepcopy(prepared['llm_input']['input'])
    source.pop('output_schema')
    contract = BundleFacts.model_json_schema()
    source.update(output_format='compact-inline-facts-v1', field_catalogue=field_catalogue(contract))
    wire, metadata = request_structured(source, compact_schema(), INSTRUCTIONS,
                                        provider=provider, model=model, client=client)
    if response_path is not None:
        from pathlib import Path
        from capture_store import atomic_write
        # Explicit public-source trials only; never retain HTTP headers or credentials.
        atomic_write(Path(response_path), json.dumps(
            {'response': wire, 'metadata': metadata}, ensure_ascii=False, indent=2).encode())
    try:
        facts, inline_check = decode_compact(wire, source, contract)
    except (KeyError, TypeError, ValueError) as error:
        raise FactDecodingError(error, contract) from None
    try:
        facts, corrections = normalize_candidate_facts(facts)
    except (KeyError, TypeError, ValueError):
        raise RuntimeError('candidate_normalization_failed') from None
    result = {'bundle_id': source['bundle_id'], **metadata,
            'status': 'candidate_needs_review', 'facts': facts,
            'corrections': corrections,
            'output_format': 'compact-inline-facts-v1', 'inline_check': inline_check,
            'evidence_check': check_evidence(facts, source),
            'review_reasons': source['coverage']['review_reasons']}
    from validate_candidate import validate_candidate
    result['validation'] = validate_candidate(result, source)
    return result


def leaves(value, path):
    if isinstance(value, dict):
        for key, item in value.items():
            yield from leaves(item, f'{path}.{key}')
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from leaves(item, f'{path}.{index}')
    else:
        yield path, value


def check_evidence(facts, source):
    """Check quote existence and leaf coverage; semantic applicability still needs review."""
    units = {unit['evidence_id']: unit for document in source['documents']
             for unit in document['sections']}
    values = dict(leaves(facts['posts'], 'posts'))
    supported, errors = set(), []
    for citation in facts['evidence']:
        path, quote = citation['field_path'], citation['quote']
        unit = units.get(citation['evidence_id'])
        if path not in values or values[path] is None:
            errors.append({'field_path': path, 'reason': 'invalid_fact_path'})
        elif not unit or not quote.strip() or quote not in unit['text'] or not unit['locations']:
            errors.append({'field_path': path, 'reason': 'quote_not_in_cited_evidence'})
        else:
            supported.add(path)
    explained = {item['field_path'] for item in facts['missing_fields'] if item['reason'].strip()}
    for path, value in values.items():
        if value is not None and path not in supported:
            errors.append({'field_path': path, 'reason': 'missing_valid_citation'})
        if value is None and path not in explained:
            errors.append({'field_path': path, 'reason': 'missing_null_explanation'})
    return {'status': 'citation_errors' if errors else 'quotes_located', 'errors': errors,
            'semantic_support_verified': False}


if __name__ == '__main__':
    import argparse
    from pathlib import Path
    from capture_store import atomic_write
    parser = argparse.ArgumentParser(description='One offline extraction trial; never publishes')
    parser.add_argument('prepared_json')
    parser.add_argument('output_json')
    parser.add_argument('--provider', choices=['openai', 'gemini', 'deepseek'])
    parser.add_argument('--model')
    parser.add_argument('--staged', action='store_true', help='Roster, shared rules, then small post batches')
    parser.add_argument('--prepare-html', action='store_true',
                        help='Prepare a saved normalized HTML document instead of calling the model')
    parser.add_argument('--source-url')
    parser.add_argument('--save-response', help='Opt-in local replay file for public-source trials')
    args = parser.parse_args()
    if args.prepare_html:
        from build_extraction_input import prepare_extraction
        from verify_bundle import verify_bundles
        if not args.source_url:
            parser.error('--prepare-html requires --source-url')
        normalized = json.loads(Path(args.prepared_json).read_text())
        bundle = verify_bundles([{'document_id': 'notice-html', 'format': 'html',
            'source_url': args.source_url, 'content': normalized}])['bundles'][0]
        prepared = prepare_extraction(bundle)
        atomic_write(Path(args.output_json), json.dumps(prepared, ensure_ascii=False, indent=2).encode())
        print(json.dumps({'status': prepared['coverage']['status'],
            'input_characters': prepared.get('input_characters'),
            'coverage_focus': prepared['coverage']['coverage_focus'],
            'review_reasons': prepared['coverage']['review_reasons'],
            'prepared_path': str(Path(args.output_json).resolve())}))
        raise SystemExit(0)
    try:
        runner = extract_bundle
        if args.staged:
            if args.save_response:
                parser.error('--save-response is only supported for single-pass trials')
            from staged_extraction import extract_staged
            runner = extract_staged
        options = {'response_path': args.save_response} if args.save_response else {}
        result = runner(json.loads(Path(args.prepared_json).read_text()),
                        provider=args.provider, model=args.model, **options)
    except (RuntimeError, ValueError) as error:
        failure = {'status': 'blocked', 'reason': str(error)}
        if isinstance(error, FactDecodingError):
            failure['details'] = error.details
        print(json.dumps(failure))
        raise SystemExit(1)
    atomic_write(Path(args.output_json), json.dumps(result, ensure_ascii=False, indent=2).encode())
    print(json.dumps(result, ensure_ascii=False, indent=2))
