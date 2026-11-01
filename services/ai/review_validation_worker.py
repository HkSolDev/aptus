"""Validation-only execution worker; runs deterministic candidate validation without AI or network calls."""
import argparse
import json
import os
import sys
import time
from typing import Any

import httpx

from validate_candidate import validate_candidate


VALIDATOR_VERSION = 'aptus-val-v1'


def validate_revision_payload(task: dict[str, Any]) -> dict[str, Any]:
    """Run deterministic validation over the task's immutable facts and evidence."""
    bundle_id = task.get('bundle_id') or task.get('bundleId')
    facts = task['facts']
    source_evidence = task.get('source_evidence') or task.get('sourceEvidence') or []
    revision_hash = task.get('revision_hash') or task.get('revisionHash') or ''

    result_input = {
        'bundle_id': bundle_id,
        'facts': facts,
        'review_reasons': [],
    }
    source_input = {
        'bundle_id': bundle_id,
        'documents': source_evidence,
    }

    report = validate_candidate(result_input, source_input)

    return {
        'status': report['status'],
        'disposition': report['disposition'],
        'errors': report['errors'],
        'warnings': report['warnings'],
        'semantic_support_verified': False,
        'validator_version': VALIDATOR_VERSION,
        'revision_hash': revision_hash,
    }


def process_claimed_task(
    task: dict[str, Any],
    api_url: str,
    token: str,
    client: httpx.Client | None = None,
) -> dict[str, Any]:
    """Validate a claimed task and submit its result back to the API."""
    should_close = False
    if client is None:
        client = httpx.Client(timeout=15.0)
        should_close = True

    try:
        task_id = task.get('task_id') or task.get('taskId')
        claim_token = task.get('claim_token') or task.get('claimToken')
        revision_hash = task.get('revision_hash') or task.get('revisionHash')

        try:
            result = validate_revision_payload(task)
            payload = {
                'claim_token': claim_token,
                'revision_hash': revision_hash,
                'validator_version': VALIDATOR_VERSION,
                'result': result,
            }
            resp = client.post(
                f'{api_url.rstrip("/")}/api/internal/review-tasks/{task_id}/result',
                json=payload,
                headers={'Authorization': f'Bearer {token}'},
            )
            resp.raise_for_status()
            return {'status': 'completed', 'task_id': task_id, 'result': result}

        except Exception as exc:
            # Report infrastructure failure so it's not marked as a factual rejection
            fail_payload = {
                'claim_token': claim_token,
                'error_details': f'Infrastructure error during validation: {exc}',
            }
            try:
                client.post(
                    f'{api_url.rstrip("/")}/api/internal/review-tasks/{task_id}/fail',
                    json=fail_payload,
                    headers={'Authorization': f'Bearer {token}'},
                )
            except Exception:
                pass
            raise

    finally:
        if should_close:
            client.close()


def claim_and_run_once(
    api_url: str,
    token: str,
    worker_id: str = 'aptus-val-worker',
    client: httpx.Client | None = None,
) -> dict[str, Any] | None:
    """Claim at most one pending validation task and process it."""
    should_close = False
    if client is None:
        client = httpx.Client(timeout=15.0)
        should_close = True

    try:
        resp = client.post(
            f'{api_url.rstrip("/")}/api/internal/review-tasks/claim',
            json={'worker_id': worker_id, 'lease_seconds': 60},
            headers={'Authorization': f'Bearer {token}'},
        )
        resp.raise_for_status()
        data = resp.json()
        task = data.get('task')
        if not task:
            return None

        return process_claimed_task(task, api_url, token, client=client)
    finally:
        if should_close:
            client.close()


def main():
    parser = argparse.ArgumentParser(description='Aptus review validation worker')
    parser.add_argument(
        '--api-url',
        default=os.getenv('BACKEND_INTERNAL_URL', 'http://127.0.0.1:8081'),
    )
    parser.add_argument(
        '--token',
        default=os.getenv('APTUS_INTERNAL_INGEST_TOKEN', ''),
    )
    parser.add_argument('--worker-id', default='aptus-val-worker-cli')
    parser.add_argument(
        '--once', action='store_true', help='Process at most one task and exit'
    )
    parser.add_argument('--poll-interval', type=float, default=2.0)
    args = parser.parse_args()

    if not args.token:
        print(
            json.dumps({'error': 'APTUS_INTERNAL_INGEST_TOKEN or --token required'}),
            file=sys.stderr,
        )
        sys.exit(1)

    while True:
        try:
            result = claim_and_run_once(
                args.api_url, args.token, worker_id=args.worker_id
            )
            if result:
                print(json.dumps(result), flush=True)
            elif args.once:
                print(
                    json.dumps({'status': 'idle', 'message': 'No pending tasks'}),
                    flush=True,
                )
                return
        except Exception as exc:
            print(
                json.dumps({'status': 'error', 'message': str(exc)}),
                file=sys.stderr,
                flush=True,
            )
            if args.once:
                sys.exit(1)

        if args.once:
            return
        time.sleep(args.poll_interval)


if __name__ == '__main__':
    main()
