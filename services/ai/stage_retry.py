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
    MAX_CAPTURE_ATTEMPTS = 10
    LEASE_SECONDS = 300
    BASE_DELAY = 30
    MAX_CAPTURE_COOLDOWN = 3600

    def __init__(self, root, clock=None, jitter=True):
        self.root = Path(root) / 'state' / 'stages'
        self.clock = clock or time.time
        self.jitter = jitter

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
        max_attempts = self.MAX_CAPTURE_ATTEMPTS if stage == 'capture' else self.MAX_ATTEMPTS
        try:
            state = json.loads(path.read_text())
            if (not isinstance(state, dict) or type(state.get('attempts')) is not int
                    or not 0 <= state['attempts'] <= max_attempts
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

    def _compute_capture_delay(self, attempts, key=None, retry_after=0):
        base = min(self.BASE_DELAY * 2 ** max(attempts - 1, 0), self.MAX_CAPTURE_COOLDOWN)
        if retry_after > 0:
            base = max(base, min(retry_after, self.MAX_CAPTURE_COOLDOWN))
        jitter = 0
        if self.jitter and key:
            max_jitter = min(int(base * 0.2), 300)
            if max_jitter > 0:
                h = hashlib.sha256(f"{key}:{attempts}".encode()).hexdigest()
                jitter = int(h[:8], 16) % (max_jitter + 1)
        return base + jitter

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
        max_attempts = self.MAX_CAPTURE_ATTEMPTS if stage == 'capture' else self.MAX_ATTEMPTS
        if stage != 'capture' and attempts >= max_attempts:
            self.write(stage, key, {**state, 'status': 'needs_review', 'reason': 'attempt_limit'})
            return False
        next_attempts = min(attempts + 1, max_attempts)
        self.write(stage, key, {'status': 'running', 'attempts': next_attempts,
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
        if stage == 'capture':
            retryable = bool(retryable) and is_transient_capture_error(reason)
            delay = self._compute_capture_delay(attempts, key, retry_after)
            next_at = self.clock() + delay if retryable else 0
            self.write(stage, key, {**state, 'reason': reason,
                'status': 'retry_wait' if retryable else 'needs_review',
                'next_at': next_at})
            return
        retryable = retryable and attempts < self.MAX_ATTEMPTS
        delay = max(30 * 2 ** max(attempts - 1, 0), min(max(retry_after, 0), 86400))
        self.write(stage, key, {**state, 'reason': reason,
            'status': 'retry_wait' if retryable else 'needs_review',
            'next_at': self.clock() + delay if retryable else 0})


TRANSIENT_CAPTURE_REASONS = {
    'gaierror',
    'ConnectError',
    'ConnectTimeout',
    'ReadTimeout',
    'ReadError',
    'WriteTimeout',
    'WriteError',
    'PoolTimeout',
    'RemoteProtocolError',
    'ProtocolError',
    'TimeoutError',
    'timeout',
    'connection_refused',
    'connection_reset',
    'dns_resolution_failed',
    'capture_network_failed',
    'network_error',
    'http_408',
    'http_429',
    'http_500',
    'http_502',
    'http_503',
    'http_504',
}

TRANSIENT_HTTP_STATUSES = {408, 429, 500, 502, 503, 504}


def is_transient_capture_error(reason, http_status=None):
    if http_status is not None and http_status in TRANSIENT_HTTP_STATUSES:
        return True
    if not isinstance(reason, str):
        return False
    if reason in TRANSIENT_CAPTURE_REASONS:
        return True
    if reason.startswith('http_'):
        try:
            code = int(reason[5:])
            return code in TRANSIENT_HTTP_STATUSES
        except ValueError:
            pass
    return False


def capture_failure(error_or_reason, http_status=None):
    if isinstance(error_or_reason, Exception):
        reason = type(error_or_reason).__name__
    elif isinstance(error_or_reason, str):
        reason = error_or_reason
    else:
        reason = 'capture_failed'
    if not reason.isidentifier() or len(reason) > 80:
        reason = 'capture_failed'
    retryable = is_transient_capture_error(reason, http_status=http_status)
    return reason, retryable


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
