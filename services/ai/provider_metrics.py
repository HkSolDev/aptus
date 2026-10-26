"""Count HTTP request attempts independently of extraction and local validation."""
from contextlib import contextmanager
from contextvars import ContextVar

_current = ContextVar('provider_request_metrics', default=None)


@contextmanager
def track_provider_requests():
    counts = {'attempted': 0, 'succeeded': 0, 'failed': 0}
    token = _current.set(counts)
    try:
        yield counts
    finally:
        _current.reset(token)


def provider_post(client, url, **kwargs):
    counts = _current.get()
    if counts is not None:
        counts['attempted'] += 1
    try:
        response = client.post(url, **kwargs)
    except Exception:
        if counts is not None:
            counts['failed'] += 1
        raise
    if counts is not None:
        counts['succeeded' if response.is_success else 'failed'] += 1
    return response
