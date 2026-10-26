"""Audited recovery procedure for eligible historical capture holds.

Inspects capture-stage hold files, classifies transient errors eligible for
recovery vs permanent holds that must remain preserved for review, and
performs dry-run auditing by default without modifying disk state.
"""

import argparse
import hashlib
import json
from pathlib import Path
import time

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


def audit_capture_holds(storage_dir, *, dry_run=True, clock=None):
    """Audit and optionally recover eligible historical capture holds.

    Preserves strong holds (corrupt state, non-transient capture errors,
    AI provider/validation holds) and never touches extraction or publication states.
    Locks each state using its canonical stage lock before reading, re-validates
    under the lock, and backs up original records before executing recovery.
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
        "holds": [],
    }

    backup_records = []
    backup_dir = None
    if not dry_run:
        run_ts = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime(now_time))
        backup_dir = root / "backups" / "capture_recovery" / f"recovery_{run_ts}_{int(now_time)}"

    for state_path in files:
        lock_path = state_path.with_suffix(".lock")
        with file_lock(lock_path):
            try:
                raw_bytes = state_path.read_bytes()
                state = json.loads(raw_bytes.decode("utf-8"))
            except (OSError, ValueError, TypeError):
                # Corrupt or unparseable JSON file
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
                continue

            if not is_valid_stage_record(state, max_attempts=StageRetries.MAX_CAPTURE_ATTEMPTS):
                # Corrupt / malformed durable record (e.g. attempts="invalid")
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
                continue

            if state.get("status") != "needs_review":
                continue

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
                "action": ("would_reset_to_retry_wait" if dry_run else "reset_to_retry_wait") if eligible else "preserved_hold",
            }
            results["holds"].append(hold_info)

            if eligible:
                results["eligible_holds"] += 1
                if not dry_run:
                    # Durably back up the exact original record before mutating
                    try:
                        rel_path = state_path.resolve().relative_to(root.resolve())
                    except ValueError:
                        rel_path = Path(state_path.name)
                    backup_file = backup_dir / "records" / rel_path
                    atomic_write(backup_file, raw_bytes)

                    # Update state under lock
                    new_state = {
                        **state,
                        "status": "retry_wait",
                        "attempts": 1,
                        "next_at": now_time,
                        "reason": reason,
                    }
                    atomic_write(state_path, json.dumps(new_state, ensure_ascii=False, indent=2).encode())
                    results["recovered"] += 1

                    backup_records.append({
                        "original_path": str(state_path.resolve()),
                        "backup_path": str(backup_file.resolve()),
                        "sha256": hashlib.sha256(raw_bytes).hexdigest(),
                        "previous_state": state,
                        "recovered_state": new_state,
                    })
            else:
                results["ineligible_holds"] += 1

    if not dry_run and results["recovered"] > 0:
        manifest = {
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now_time)),
            "storage_dir": str(root.resolve()),
            "backup_dir": str(backup_dir.resolve()),
            "total_recovered": results["recovered"],
            "records": backup_records,
        }
        manifest_path = backup_dir / "audit_manifest.json"
        atomic_write(manifest_path, json.dumps(manifest, ensure_ascii=False, indent=2).encode())
        results["backup_dir"] = str(backup_dir.resolve())
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
