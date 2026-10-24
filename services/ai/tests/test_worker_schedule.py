import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from worker_schedule import main, seconds_until_next_run


class WorkerScheduleTests(unittest.TestCase):
    def test_next_run_uses_six_hour_india_boundaries(self):
        india = timezone(timedelta(hours=5, minutes=30))
        self.assertEqual(
            seconds_until_next_run(datetime(2026, 10, 13, 7, 15, tzinfo=india)),
            4 * 3600 + 45 * 60,
        )
        self.assertEqual(
            seconds_until_next_run(datetime(2026, 10, 13, 23, 59, tzinfo=india)),
            60,
        )

    def test_default_worker_selects_generic_route(self):
        with patch('worker_schedule.run_pipeline', return_value={'status': 'completed'}) as runner, \
                patch('sys.argv', ['worker_schedule.py', '--once']):
            main()
        self.assertTrue(runner.called)
        self.assertFalse(runner.call_args.kwargs['prepare_only'])


if __name__ == '__main__':
    unittest.main()
