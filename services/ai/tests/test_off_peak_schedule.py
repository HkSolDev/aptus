"""Billing windows use UTC; scheduling displays India time."""
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch

from provider_schedule import ProviderDeferred, seconds_until_off_peak
from extract_bundle import request_structured
from extraction_checkpoint import extract_or_resume
from stage_retry import StageRetries
from worker_schedule import main, seconds_until_next_run


class OffPeakScheduleTests(unittest.TestCase):
    def test_peak_boundaries_and_five_minute_safety_margin(self):
        cases = [(0, 54, 59, 0), (0, 55, 0, 11100), (1, 0, 0, 10800),
                 (3, 59, 59, 1), (4, 0, 0, 0), (5, 55, 0, 14700),
                 (6, 0, 0, 14400), (9, 59, 59, 1), (10, 0, 0, 0)]
        for hour, minute, second, expected in cases:
            with self.subTest(time=(hour, minute, second)):
                self.assertEqual(seconds_until_off_peak(datetime(2026, 10, 26, hour, minute, second,
                                                                tzinfo=timezone.utc)), expected)

    def test_weekend_is_off_peak_and_india_conversion_uses_utc_weekday(self):
        india = timezone(timedelta(hours=5, minutes=30))
        for day in [24, 25]:
            self.assertEqual(seconds_until_off_peak(datetime(2026, 10, day, 7, tzinfo=timezone.utc)), 0)
        self.assertEqual(seconds_until_off_peak(datetime(2026, 10, 26, 7, tzinfo=india)), 9000)
        self.assertEqual(seconds_until_off_peak(datetime(2026, 10, 26, 1, tzinfo=india)), 0)

    def test_four_daily_slots_stay_off_peak_and_roll_over(self):
        india = timezone(timedelta(hours=5, minutes=30))
        self.assertEqual(seconds_until_next_run(datetime(2026, 10, 26, 3, tzinfo=india), off_peak=True), 3600)
        self.assertEqual(seconds_until_next_run(datetime(2026, 10, 26, 22, tzinfo=india), off_peak=True), 21600)
        for day in range(24, 31):
            for hour in [4, 10, 16, 22]:
                self.assertEqual(seconds_until_off_peak(datetime(2026, 10, day, hour, tzinfo=india)), 0)

    def test_peak_startup_and_direct_provider_call_never_send(self):
        with patch.dict(os.environ, {'LLM_PROVIDER': 'deepseek', 'DEEPSEEK_OFF_PEAK_ONLY': 'true'}), \
                patch('worker_schedule.seconds_until_off_peak', return_value=3600), \
                patch('worker_schedule.run_pipeline') as run, \
                patch('sys.argv', ['worker_schedule.py', '--once']):
            main()
            run.assert_not_called()
        client = Mock()
        with patch('extract_bundle.provider_off_peak_delay', return_value=3600):
            with self.assertRaises(ProviderDeferred):
                request_structured({}, {}, 'Extract', provider='deepseek', client=client)
        client.post.assert_not_called()

    def test_deferral_does_not_consume_provider_retry_attempts(self):
        with tempfile.TemporaryDirectory() as directory:
            retries = StageRetries(directory, lambda: 1000)
            prepared = {'llm_input': {'input': {'bundle_id': 'notice'}}}
            def defer(_):
                raise ProviderDeferred(3600)
            with self.assertRaises(ProviderDeferred):
                extract_or_resume(retries, 'fp', prepared, defer)
            state = retries.read('extraction', 'fp')
            self.assertEqual(state['attempts'], 0)
            self.assertEqual(state['next_at'], 4600)
            self.assertEqual(state['reason'], 'provider_peak_hours')
            self.assertFalse(retries.begin('extraction', 'fp'))


if __name__ == '__main__':
    unittest.main()
