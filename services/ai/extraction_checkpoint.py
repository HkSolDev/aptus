"""Retain completed provider work before validation or storage can fail."""
import hashlib
import json

from capture_store import atomic_write
from stage_retry import extraction_failure
from provider_schedule import ProviderDeferred


def extract_or_resume(retries, fingerprint, prepared, extract):
    # The caller's notice lock serializes this checkpoint with draft creation.
    state = retries.read('extraction', fingerprint)
    evidence_sha = hashlib.sha256(json.dumps(prepared['llm_input']['input'], sort_keys=True).encode()).hexdigest()
    path = retries.path('extraction', fingerprint).with_suffix('.response.json')
    if state.get('status') == 'success' and state.get('evidence_sha256') == evidence_sha:
        try:
            payload = path.read_bytes()
            if hashlib.sha256(payload).hexdigest() != state.get('response_sha256'):
                raise ValueError('Checkpoint checksum mismatch')
            result = json.loads(payload)
            if result['bundle_id'] != prepared['llm_input']['input']['bundle_id']:
                raise ValueError('Checkpoint identity mismatch')
            return result, True
        except (OSError, ValueError, KeyError, TypeError):
            retries.failure('extraction', fingerprint, 'corrupt_extraction_checkpoint')
            return None, False
    if not retries.begin('extraction', fingerprint):
        return None, False
    try:
        result = extract(prepared)
    except ProviderDeferred as error:
        state = retries.read('extraction', fingerprint)
        retries.write('extraction', fingerprint, {
            **state, 'status': 'retry_wait', 'reason': 'provider_peak_hours',
            'attempts': max(0, state['attempts'] - 1),
            'next_at': retries.clock() + error.retry_after})
        raise
    except (RuntimeError, ValueError, TypeError, OSError) as error:
        reason, retryable, delay = extraction_failure(error)
        retries.failure('extraction', fingerprint, reason, retryable=retryable, retry_after=delay)
        raise
    try:
        if not isinstance(result, dict) or result.get('bundle_id') != prepared['llm_input']['input']['bundle_id']:
            raise ValueError('Extracted identity mismatch')
        payload = json.dumps(result, ensure_ascii=False).encode()
        atomic_write(path, payload)
        retries.success('extraction', fingerprint, response_sha256=hashlib.sha256(payload).hexdigest(),
                        evidence_sha256=evidence_sha)
        return result, False
    except (RuntimeError, ValueError, TypeError, OSError):
        retries.failure('extraction', fingerprint, 'checkpoint_storage_failed')
        raise
