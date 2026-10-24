"""Single-host stage attempts and backoff; callers hold the stage/notice lock."""
import fcntl
import hashlib
import json
import math
import time
from contextlib import contextmanager
from pathlib import Path

from capture_store import atomic_write


class StageRetries:
    MAX_ATTEMPTS = 3
    LEASE_SECONDS = 300

    def __init__(self, root, clock=None):
        self.root = Path(root) / 'state' / 'stages'
        self.clock = clock or time.time

    def path(self, stage, key):
        if stage not in {'capture', 'extraction', 'publication'}:
            raise ValueError('Unknown retry stage')
        return self.root / stage / (hashlib.sha256(key.encode()).hexdigest() + '.json')

    @contextmanager
    def lock(self, stage, key):
        path = self.path(stage, key).with_suffix('.lock')
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('a') as stream:
            fcntl.flock(stream, fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(stream, fcntl.LOCK_UN)

    def read(self, stage, key):
        path = self.path(stage, key)
        if not path.exists():
            return {}
        try:
            state = json.loads(path.read_text())
            if (not isinstance(state, dict) or type(state.get('attempts')) is not int
                    or not 0 <= state['attempts'] <= self.MAX_ATTEMPTS
                    or state.get('status') not in {'running', 'retry_wait', 'success', 'needs_review'}
                    or type(state.get('next_at', 0)) not in {int, float}
                    or not math.isfinite(state.get('next_at', 0))
                    or (state.get('reason') is not None and (
                        not isinstance(state['reason'], str) or not state['reason'].isidentifier()
                        or len(state['reason']) > 80))):
                raise ValueError
            return state
        except (ValueError, OSError):
            return {'status': 'needs_review', 'attempts': self.MAX_ATTEMPTS,
                    'reason': 'corrupt_stage_state'}

    def write(self, stage, key, state):
        atomic_write(self.path(stage, key), json.dumps(state, ensure_ascii=False, indent=2).encode())

    def begin(self, stage, key):
        state = self.read(stage, key)
        status = state.get('status')
        if status == 'needs_review' or state.get('next_at', 0) > self.clock():
            return False
        if stage == 'extraction' and status == 'running':
            # After a crash we cannot know whether the provider billed/completed
            # the request. Do not silently repeat an uncertain generation.
            self.failure(stage, key, 'provider_completion_uncertain')
            return False
        attempts = 0 if status == 'success' else state.get('attempts', 0)
        if attempts >= self.MAX_ATTEMPTS:
            self.write(stage, key, {**state, 'status': 'needs_review', 'reason': 'attempt_limit'})
            return False
        self.write(stage, key, {'status': 'running', 'attempts': attempts + 1,
                               'next_at': self.clock() + self.LEASE_SECONDS})
        return True

    def success(self, stage, key, **details):
        self.write(stage, key, {**self.read(stage, key), **details,
                               'status': 'success', 'next_at': 0, 'reason': None})

    def failure(self, stage, key, reason, *, retryable=False, retry_after=0):
        if not isinstance(reason, str) or not reason.isidentifier() or len(reason) > 80:
            reason = 'stage_failed'
        state = self.read(stage, key)
        attempts = state.get('attempts', 1)
        retryable = retryable and attempts < self.MAX_ATTEMPTS
        delay = max(30 * 2 ** max(attempts - 1, 0), min(max(retry_after, 0), 86400))
        self.write(stage, key, {**state, 'reason': reason,
            'status': 'retry_wait' if retryable else 'needs_review',
            'next_at': self.clock() + delay if retryable else 0})


def extraction_failure(error):
    """Never infer retryability from arbitrary exception messages or model text."""
    reason = str(error)
    known = {'provider_http_408', 'provider_http_429', 'provider_http_500',
             'provider_http_502', 'provider_http_503', 'provider_http_504'}
    retryable = getattr(error, 'retryable', reason in known)
    safe_reason = reason if reason in known or reason in {
        'provider_network_failed', 'provider_credentials_rejected', 'provider_credential_unavailable',
        'provider_fact_decoding_failed', 'provider_json_invalid', 'provider_response_invalid',
        'provider_incomplete_or_refused'} else 'extraction_failed'
    return safe_reason, retryable, getattr(error, 'retry_after', 0)
