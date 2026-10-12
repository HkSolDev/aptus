"""Durable local missing-document tasks; completion means recheck coverage."""

import json
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

from link_discovery import url_identity


class RecoveryQueue:
    MAX_ATTEMPTS = 3
    LEASE_SECONDS = 300

    def __init__(self, path):
        self.path = str(path)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS tasks (
                    url TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'queued',
                    attempts INTEGER NOT NULL DEFAULT 0, available_at REAL NOT NULL DEFAULT 0,
                    lease_until REAL, claim TEXT, result TEXT, reason TEXT);
                CREATE TABLE IF NOT EXISTS dependencies (
                    bundle_id TEXT NOT NULL, url TEXT NOT NULL REFERENCES tasks(url),
                    PRIMARY KEY(bundle_id, url));
            """)

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    def request(self, bundle_id, urls):
        if not isinstance(bundle_id, str) or not 1 <= len(bundle_id) <= 200:
            raise ValueError("A bounded bundle ID is required")
        if not isinstance(urls, list) or not 1 <= len(urls) <= 50:
            raise ValueError("Provide 1–50 explicitly missing document URLs")
        canonical = []
        for url in urls:
            identity = url_identity(url, url) if isinstance(url, str) and len(url) <= 4096 else None
            if not identity:
                raise ValueError("Public-document HTTP(S) URLs without credentials are required")
            canonical.append(identity)
        with self.connection() as db:
            for url in canonical:
                db.execute("INSERT OR IGNORE INTO tasks(url) VALUES (?)", (url,))
                db.execute("INSERT OR IGNORE INTO dependencies VALUES (?, ?)", (bundle_id, url))
        return self.bundle(bundle_id)

    def claim_next(self, *, now=None):
        now = time.time() if now is None else now
        with self.connection() as db:
            # Serialize claims across processes, not network/parsing work.
            db.execute("BEGIN IMMEDIATE")
            db.execute("""UPDATE tasks SET status='needs_review', reason='attempt_limit',
                          claim=NULL, lease_until=NULL WHERE status='running'
                          AND lease_until<=? AND attempts>=?""", (now, self.MAX_ATTEMPTS))
            row = db.execute("""SELECT * FROM tasks WHERE attempts<? AND
                ((status IN ('queued','retry_wait') AND available_at<=?) OR
                 (status='running' AND lease_until<=?)) ORDER BY available_at, url LIMIT 1""",
                (self.MAX_ATTEMPTS, now, now)).fetchone()
            if row is None:
                return None
            claim = uuid4().hex
            db.execute("""UPDATE tasks SET status='running', attempts=attempts+1,
                          claim=?, lease_until=? WHERE url=?""",
                       (claim, now + self.LEASE_SECONDS, row['url']))
            return {**dict(row), 'claim': claim, 'attempts': row['attempts'] + 1}

    def finish(self, task, *, result=None, reason=None, retryable=False, now=None):
        now = time.time() if now is None else now
        if result is None and reason is None:
            raise ValueError("A result or stable failure code is required")
        if reason is not None and (not reason.isidentifier() or len(reason) > 80):
            raise ValueError("Use a stable reason code, never an exception message")
        retry = result is None and retryable and task['attempts'] < self.MAX_ATTEMPTS
        status = 'done' if result is not None else ('retry_wait' if retry else 'needs_review')
        with self.connection() as db:
            changed = db.execute("""UPDATE tasks SET status=?, result=?, reason=?,
                available_at=?, claim=NULL, lease_until=NULL
                WHERE url=? AND status='running' AND claim=? AND lease_until>?""",
                (status, json.dumps(result) if result is not None else None, reason,
                 now + 30 * 2 ** (task['attempts'] - 1) if retry else now,
                 task['url'], task['claim'], now)).rowcount
        return bool(changed)  # Expired or replaced workers cannot overwrite the new result.

    def bundle(self, bundle_id):
        with self.connection() as db:
            rows = db.execute("""SELECT tasks.* FROM tasks JOIN dependencies USING(url)
                                 WHERE bundle_id=? ORDER BY url""", (bundle_id,)).fetchall()
        tasks = [{key: row[key] for key in ('url', 'status', 'attempts', 'reason')}
                 | {'result': json.loads(row['result']) if row['result'] else None} for row in rows]
        pending = any(task['status'] not in {'done', 'needs_review'} for task in tasks)
        status = ('not_requested' if not tasks else 'waiting_for_document' if pending else
                  'needs_review' if any(task['status'] == 'needs_review' for task in tasks)
                  else 'ready_for_coverage')
        return {'bundle_id': bundle_id, 'status': status, 'tasks': tasks}
