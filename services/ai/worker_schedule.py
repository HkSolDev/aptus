"""Run the Aptus pipeline immediately and then at six-hour India-time boundaries."""

import argparse
import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from generic_pipeline import run_pipeline
from source_registry import DEFAULT_SOURCES_PATH

INDIA = timezone(timedelta(hours=5, minutes=30))


def seconds_until_next_run(current=None):
    current = current or datetime.now(INDIA)
    boundary = current.replace(minute=0, second=0, microsecond=0)
    next_hour = ((current.hour // 6) + 1) * 6
    if next_hour >= 24:
        return int((boundary.replace(hour=0) + timedelta(days=1) - current).total_seconds())
    return int((boundary.replace(hour=next_hour) - current).total_seconds())


def main():
    parser = argparse.ArgumentParser(description='Aptus six-hour pipeline scheduler')
    parser.add_argument('--storage-dir', default='/work')
    parser.add_argument('--once', action='store_true')
    parser.add_argument('--prepare-only', action='store_true', help='Crawl and prepare evidence; never call AI')
    parser.add_argument('--sources', type=Path, default=DEFAULT_SOURCES_PATH)
    parser.add_argument('--source', help='One registry source ID')
    parser.add_argument('--max-fetches', type=int, default=12)
    parser.add_argument('--max-depth', type=int, default=3)
    args = parser.parse_args()
    while True:
        try:
            result = run_pipeline(Path(args.storage_dir), sources_path=args.sources,
                                  source_id=args.source, max_fetches=args.max_fetches,
                                  max_depth=args.max_depth, prepare_only=args.prepare_only)
            print(json.dumps(result), flush=True)
        except (OSError, RuntimeError, TypeError, ValueError):
            print(json.dumps({'status': 'failed', 'reason': 'pipeline_run_failed'}), flush=True)
        if args.once:
            return
        time.sleep(max(1, seconds_until_next_run()))


if __name__ == '__main__':
    main()
