"""Manual/cron-only structured extraction trial; no ingestion or eligibility decisions."""

import copy
import json
import os
import re

import httpx

from build_extraction_input import BundleFacts, INSTRUCTIONS
from compact_inline import compact_schema, decode_compact, field_catalogue
from normalize_candidate_facts import normalize_candidate_facts
from providers.openai import _openai_schema


def provider_keys(provider):
    if provider == 'openai':
        names = ['OPENAI_API_KEY']
    else:
        numbered = sorted((name for name in os.environ
                           if re.fullmatch(r'GEMINI_API_KEY_[1-9]\d*', name)),
                          key=lambda name: int(name.rsplit('_', 1)[1]))
        names = ['GEMINI_API_KEY', *numbered]
    return list(dict.fromkeys(os.environ[name].strip() for name in names
                             if os.environ.get(name, '').strip()))


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
    provider = provider or os.getenv('LLM_PROVIDER', 'openai')
    if provider not in {'openai', 'gemini'}:
        raise ValueError('Use openai or gemini')
    model = model or os.getenv('LLM_MODEL') or (
        'gpt-4o-mini' if provider == 'openai' else 'gemini-2.5-flash-lite')
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
    else:
        url = f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
        headers = {}
        payload = {'systemInstruction': {'parts': [{'text': system}]},
            'contents': [{'parts': [{'text': prompt}]}],
            'generationConfig': {'responseMimeType': 'application/json', 'responseJsonSchema': schema}}
    # Only explicitly rejected keys fail over. Never repeat a timeout/quota request.
    try:
        for attempt, key in enumerate(keys, 1):
            headers = ({'Authorization': f'Bearer {key}'} if provider == 'openai'
                       else {'x-goog-api-key': key})
            response = (client or httpx).post(url, headers=headers, json=payload, timeout=120)
            if provider == 'gemini' and invalid_gemini_key(response):
                if attempt < len(keys):
                    continue
                raise RuntimeError('provider_credentials_rejected')
            break
        if not response.is_success:
            raise RuntimeError(f'provider_http_{response.status_code}')
        data = response.json()
        if provider == 'openai':
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
        wire = json.loads(text)
    except httpx.HTTPError:
        raise RuntimeError('provider_network_failed') from None
    except (KeyError, IndexError, TypeError, ValueError):
        raise RuntimeError('provider_invalid_structured_output') from None
    return wire, {'provider': provider, 'model': model, 'credential_attempts': attempt, 'usage': usage}


def extract_bundle(prepared, *, provider=None, model=None, client=None):
    if not prepared.get('llm_input'):
        raise ValueError('No approved input: inspect coverage/budget first')
    source = copy.deepcopy(prepared['llm_input']['input'])
    source.pop('output_schema')
    contract = BundleFacts.model_json_schema()
    source.update(output_format='compact-inline-facts-v1', field_catalogue=field_catalogue(contract))
    wire, metadata = request_structured(source, compact_schema(), INSTRUCTIONS,
                                        provider=provider, model=model, client=client)
    try:
        facts, inline_check = decode_compact(wire, source, contract)
        facts, corrections = normalize_candidate_facts(facts)
    except (KeyError, TypeError, ValueError):
        raise RuntimeError('provider_invalid_structured_output') from None
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
    parser.add_argument('--provider', choices=['openai', 'gemini'])
    parser.add_argument('--model')
    parser.add_argument('--staged', action='store_true', help='Roster, shared rules, then small post batches')
    parser.add_argument('--prepare-html', action='store_true',
                        help='Prepare a saved normalized HTML document instead of calling the model')
    parser.add_argument('--source-url')
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
            from staged_extraction import extract_staged
            runner = extract_staged
        result = runner(json.loads(Path(args.prepared_json).read_text()),
                                provider=args.provider, model=args.model)
    except (RuntimeError, ValueError) as error:
        print(json.dumps({'status': 'blocked', 'reason': str(error)}))
        raise SystemExit(1)
    atomic_write(Path(args.output_json), json.dumps(result, ensure_ascii=False, indent=2).encode())
    print(json.dumps(result, ensure_ascii=False, indent=2))
