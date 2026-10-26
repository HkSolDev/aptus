"""Back off failed downloads without refetching them on every scheduler tick."""
from stage_retry import StageRetries, capture_failure, is_transient_capture_error


class CaptureRetryOutcome(tuple):
    """3-tuple subclass for backwards compatibility with (result, reason, retryable)."""
    def __new__(cls, result, reason, retryable, attempted=True, cooldown_skip=False):
        return super().__new__(cls, (result, reason, retryable))

    def __init__(self, result, reason, retryable, attempted=True, cooldown_skip=False):
        self.result = result
        self.reason = reason
        self.retryable = retryable
        self.attempted = attempted
        self.cooldown_skip = cooldown_skip


def capture_with_retry(url, root, process, source_id=None, *, clock=None):
    retries = StageRetries(root, clock=clock)
    with retries.lock('capture', url):
        if not retries.begin('capture', url):
            state = retries.read('capture', url)
            is_wait = state.get('status') == 'retry_wait'
            current_clock = clock() if clock else retries.clock()
            is_cooldown = is_wait and current_clock < state.get('next_at', 0)
            return CaptureRetryOutcome(
                None,
                state.get('reason') or 'capture_in_progress',
                is_wait,
                attempted=False,
                cooldown_skip=is_cooldown,
            )
        try:
            try:
                result, reason, retryable = process(url, root / 'capture', source_id=source_id)
            except TypeError:
                result, reason, retryable = process(url, root / 'capture')
        except Exception:
            retries.failure('capture', url, 'capture_processing_failed')
            raise
        if result is None:
            safe_reason, is_retry = capture_failure(reason or 'capture_failed')
            if retryable is not None:
                is_retry = is_retry or (retryable and is_transient_capture_error(safe_reason))
            retries.failure('capture', url, safe_reason, retryable=is_retry)
            return CaptureRetryOutcome(None, safe_reason, is_retry, attempted=True, cooldown_skip=False)
        else:
            retries.success('capture', url)
            return CaptureRetryOutcome(result, None, False, attempted=True, cooldown_skip=False)
