"""Audited recovery procedure for eligible historical capture holds.

Inspects capture-stage hold files, classifies transient errors eligible for
recovery vs permanent holds that must remain preserved for review, and
performs dry-run auditing by default without modifying disk state.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import time
import uuid

from capture_store import atomic_write
from stage_retry import StageRetries, file_lock, is_valid_stage_record, is_transient_capture_error


def find_capture_state_files(storage_dir):
    """Locate all capture-stage state files under root and per-source shared dirs."""
    root = Path(storage_dir)
    found = []
    # Direct stage path: root/state/stages/capture/*.json
    direct = root / "state" / "stages" / "capture"
    if direct.is_dir():
        for p in direct.glob("*.json"):
            if not p.name.endswith(".response.json") and not p.name.endswith(".lock"):
                found.append(p)
    # Per-source shared paths: root/shared/*/state/stages/capture/*.json
    shared_root = root / "shared"
    if shared_root.is_dir():
        for source_dir in shared_root.iterdir():
            if source_dir.is_dir():
                sub = source_dir / "state" / "stages" / "capture"
                if sub.is_dir():
                    for p in sub.glob("*.json"):
                        if not p.name.endswith(".response.json") and not p.name.endswith(".lock"):
                            found.append(p)
    return sorted(set(found))


def _append_journal_entry(journal_path, entry):
    """Durably append and sync a single audit journal line to disk."""
    line = json.dumps(entry, ensure_ascii=False) + "\n"
    path = Path(journal_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as stream:
        stream.write(line)
        stream.flush()
        os.fsync(stream.fileno())


def _process_file_advisory(state_path, results):
    """Read-only advisory inspection without acquiring file locks or mutating disk."""
    try:
        raw_bytes = state_path.read_bytes()
        state = json.loads(raw_bytes.decode("utf-8"))
    except (OSError, ValueError, TypeError):
        results["total_holds"] += 1
        results["ineligible_holds"] += 1
        results["holds"].append({
            "path": str(state_path.resolve()),
            "key_hash": state_path.stem,
            "status": "needs_review",
            "reason": "corrupt_stage_state",
            "attempts": None,
            "eligible": False,
            "disposition": "ineligible_corrupt_hold",
            "action": "preserved_hold",
        })
        return

    if not is_valid_stage_record(state, max_attempts=StageRetries.MAX_CAPTURE_ATTEMPTS):
        results["total_holds"] += 1
        results["ineligible_holds"] += 1
        results["holds"].append({
            "path": str(state_path.resolve()),
            "key_hash": state_path.stem,
            "status": state.get("status") if isinstance(state, dict) else "corrupt",
            "reason": state.get("reason") if isinstance(state, dict) else "corrupt_stage_state",
            "attempts": state.get("attempts") if isinstance(state, dict) else None,
            "eligible": False,
            "disposition": "ineligible_corrupt_hold",
            "action": "preserved_hold",
        })
        return

    if state.get("status") != "needs_review":
        return

    results["total_holds"] += 1
    reason = state.get("reason")
    attempts = state.get("attempts", 1)
    eligible = is_transient_capture_error(reason)

    hold_info = {
        "path": str(state_path.resolve()),
        "key_hash": state_path.stem,
        "status": "needs_review",
        "reason": reason,
        "attempts": attempts,
        "eligible": eligible,
        "disposition": "eligible_for_delayed_recovery" if eligible else "ineligible_permanent_hold",
        "action": "would_reset_to_retry_wait" if eligible else "preserved_hold",
    }
    results["holds"].append(hold_info)
    if eligible:
        results["eligible_holds"] += 1
    else:
        results["ineligible_holds"] += 1


def _process_file_execute(state_path, root, backup_dir, journal_path, now_time, results, backup_records):
    """Mutate eligible hold under stage lock with durable backups and audit intent logging."""
    try:
        raw_bytes = state_path.read_bytes()
        state = json.loads(raw_bytes.decode("utf-8"))
    except (OSError, ValueError, TypeError):
        results["total_holds"] += 1
        results["ineligible_holds"] += 1
        results["holds"].append({
            "path": str(state_path.resolve()),
            "key_hash": state_path.stem,
            "status": "needs_review",
            "reason": "corrupt_stage_state",
            "attempts": None,
            "eligible": False,
            "disposition": "ineligible_corrupt_hold",
            "action": "preserved_hold",
        })
        return

    if not is_valid_stage_record(state, max_attempts=StageRetries.MAX_CAPTURE_ATTEMPTS):
        results["total_holds"] += 1
        results["ineligible_holds"] += 1
        results["holds"].append({
            "path": str(state_path.resolve()),
            "key_hash": state_path.stem,
            "status": state.get("status") if isinstance(state, dict) else "corrupt",
            "reason": state.get("reason") if isinstance(state, dict) else "corrupt_stage_state",
            "attempts": state.get("attempts") if isinstance(state, dict) else None,
            "eligible": False,
            "disposition": "ineligible_corrupt_hold",
            "action": "preserved_hold",
        })
        return

    if state.get("status") != "needs_review":
        return

    results["total_holds"] += 1
    reason = state.get("reason")
    attempts = state.get("attempts", 1)
    eligible = is_transient_capture_error(reason)

    hold_info = {
        "path": str(state_path.resolve()),
        "key_hash": state_path.stem,
        "status": "needs_review",
        "reason": reason,
        "attempts": attempts,
        "eligible": eligible,
        "disposition": "eligible_for_delayed_recovery" if eligible else "ineligible_permanent_hold",
        "action": "reset_to_retry_wait" if eligible else "preserved_hold",
    }
    results["holds"].append(hold_info)

    if eligible:
        results["eligible_holds"] += 1

        # 1. Durably back up exact original record before mutating
        try:
            rel_path = state_path.resolve().relative_to(root.resolve())
        except ValueError:
            rel_path = Path(state_path.name)
        backup_file = backup_dir / "records" / rel_path
        atomic_write(backup_file, raw_bytes)

        # 2. Compute new state
        new_state = {
            **state,
            "status": "retry_wait",
            "attempts": 1,
            "next_at": now_time,
            "reason": reason,
        }
        new_bytes = json.dumps(new_state, ensure_ascii=False, indent=2).encode()

        # 3. Durably log intent BEFORE mutating state
        intent_entry = {
            "event": "intent",
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now_time)),
            "key_hash": state_path.stem,
            "path": str(state_path.resolve()),
            "backup_path": str(backup_file.resolve()),
            "sha256": hashlib.sha256(raw_bytes).hexdigest(),
            "previous_state": state,
            "target_state": new_state,
        }
        _append_journal_entry(journal_path, intent_entry)

        # 4. Mutate state atomically under lock
        atomic_write(state_path, new_bytes)
        results["recovered"] += 1

        # 5. Durably log completion outcome
        outcome_entry = {
            "event": "completed",
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now_time)),
            "key_hash": state_path.stem,
            "path": str(state_path.resolve()),
            "new_sha256": hashlib.sha256(new_bytes).hexdigest(),
            "status": "applied",
        }
        _append_journal_entry(journal_path, outcome_entry)

        backup_records.append({
            "original_path": str(state_path.resolve()),
            "backup_path": str(backup_file.resolve()),
            "sha256": hashlib.sha256(raw_bytes).hexdigest(),
            "previous_state": state,
            "recovered_state": new_state,
        })
    else:
        results["ineligible_holds"] += 1


def audit_capture_holds(storage_dir, *, dry_run=True, clock=None):
    """Audit and optionally recover eligible historical capture holds.

    Preserves strong holds (corrupt state, non-transient capture errors,
    AI provider/validation holds) and never touches extraction or publication states.

    In dry-run mode (default), operates as a genuinely read-only advisory snapshot:
    no lock files are created and zero disk mutations occur.

    In execution mode (--execute), acquires the canonical stage lock before reading,
    re-validates state under lock, durably backs up original records into a unique
    UUID-named backup directory, records audit intents prior to each mutation, and logs completions.
    """
    now_time = (clock or time.time)()
    root = Path(storage_dir)
    files = find_capture_state_files(storage_dir)
    results = {
        "dry_run": dry_run,
        "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now_time)),
        "storage_dir": str(root.resolve()),
        "total_files_inspected": len(files),
        "total_holds": 0,
        "eligible_holds": 0,
        "ineligible_holds": 0,
        "recovered": 0,
        "backup_dir": None,
        "manifest_path": None,
        "journal_path": None,
        "holds": [],
    }

    backup_records = []
    backup_dir = None
    journal_path = None
    if not dry_run:
        run_ts = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime(now_time))
        run_uuid = uuid.uuid4().hex
        backup_dir = root / "backups" / "capture_recovery" / f"recovery_{run_ts}_{run_uuid}"
        backup_dir.mkdir(parents=True, exist_ok=False)
        journal_path = backup_dir / "audit_journal.jsonl"
        results["backup_dir"] = str(backup_dir.resolve())
        results["journal_path"] = str(journal_path.resolve())

    for state_path in files:
        if dry_run:
            _process_file_advisory(state_path, results)
        else:
            lock_path = state_path.with_suffix(".lock")
            with file_lock(lock_path):
                _process_file_execute(state_path, root, backup_dir, journal_path, now_time, results, backup_records)

    if not dry_run and results["recovered"] > 0:
        manifest = {
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now_time)),
            "storage_dir": str(root.resolve()),
            "backup_dir": str(backup_dir.resolve()),
            "journal_path": str(journal_path.resolve()),
            "total_recovered": results["recovered"],
            "records": backup_records,
        }
        manifest_path = backup_dir / "audit_manifest.json"
        atomic_write(manifest_path, json.dumps(manifest, ensure_ascii=False, indent=2).encode())
        results["manifest_path"] = str(manifest_path.resolve())

    return results


def main():
    parser = argparse.ArgumentParser(description="Audit and dry-run recover historical capture holds")
    parser.add_argument("storage_dir", type=Path, help="Worker storage directory")
    mode_group = parser.add_mutually_exclusive_group()
    mode_group.add_argument("--dry-run", action="store_true", default=True, help="Audit without modifying state (default)")
    mode_group.add_argument("--execute", action="store_true", help="Explicitly apply recovery to eligible holds")
    args = parser.parse_args()

    dry_run = not args.execute
    report = audit_capture_holds(args.storage_dir, dry_run=dry_run)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
