"""Back off failed downloads without refetching them on every scheduler tick."""
from stage_retry import StageRetries


def capture_with_retry(url, root, process, source_id):
    retries = StageRetries(root)
    with retries.lock('capture', url):
        if not retries.begin('capture', url):
            state = retries.read('capture', url)
            return None, state.get('reason') or 'capture_in_progress', state['status'] == 'retry_wait'
        try:
            try:
                result, reason, retryable = process(url, root / 'capture', source_id=source_id)
            except TypeError:
                result, reason, retryable = process(url, root / 'capture')
        except Exception:
            retries.failure('capture', url, 'capture_processing_failed')
            raise
        if result is None:
            retries.failure('capture', url, reason or 'capture_failed', retryable=retryable)
        else:
            retries.success('capture', url)
        return result, reason, retryable
