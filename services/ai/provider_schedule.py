"""DeepSeek billing windows; no provider request is needed to check the clock."""
import math
import os
from datetime import datetime, timezone


class ProviderDeferred(RuntimeError):
    def __init__(self, retry_after):
        super().__init__('provider_peak_hours')
        self.retry_after = retry_after


def off_peak_schedule_enabled():
    return (os.getenv('LLM_PROVIDER') == 'deepseek'
            and os.getenv('DEEPSEEK_OFF_PEAK_ONLY', 'false').lower() in {'true', '1'})


def seconds_until_off_peak(current=None):
    current = current or datetime.now(timezone.utc)
    if current.tzinfo is None:
        raise ValueError('Billing windows require a timezone-aware clock')
    current = current.astimezone(timezone.utc)
    if current.weekday() >= 5:
        return 0
    seconds = current.hour * 3600 + current.minute * 60 + current.second + current.microsecond / 1_000_000
    # Stop five minutes early so a bounded 120-second generation has room to
    # finish before peak pricing. Holidays need no calendar to remain safe.
    for start, end in [(55 * 60, 4 * 3600), (5 * 3600 + 55 * 60, 10 * 3600)]:
        if start <= seconds < end:
            return math.ceil(end - seconds)
    return 0


def provider_off_peak_delay(provider):
    if (provider == 'deepseek'
            and os.getenv('DEEPSEEK_OFF_PEAK_ONLY', 'false').lower() in {'true', '1'}):
        return seconds_until_off_peak()
    return 0
