"""Audited recovery procedure for eligible historical capture holds.

Inspects capture-stage hold files, classifies transient errors eligible for
recovery vs permanent holds that must remain preserved for review, and
performs dry-run auditing by default without modifying disk state.
"""

import argparse
import json
from pathlib import Path
import time

from capture_store import atomic_write
from stage_retry import StageRetries, is_transient_capture_error


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
    """
    now = (clock or time.time)()
    files = find_capture_state_files(storage_dir)
    results = {
        "dry_run": dry_run,
        "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
        "storage_dir": str(Path(storage_dir).resolve()),
        "total_files_inspected": len(files),
        "total_holds": 0,
        "eligible_holds": 0,
        "ineligible_holds": 0,
        "recovered": 0,
        "holds": [],
    }

    for state_path in files:
        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError):
            continue

        if not isinstance(state, dict) or state.get("status") != "needs_review":
            continue

        results["total_holds"] += 1
        reason = state.get("reason") or "unknown_reason"
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
                # Transition eligible hold to retry_wait due for immediate recovery
                lock_path = state_path.with_suffix(".lock")
                retries = StageRetries(state_path.parents[3] if "shared" in state_path.parts else state_path.parents[2])
                with retries.lock("capture", state_path.stem):
                    new_state = {
                        **state,
                        "status": "retry_wait",
                        "attempts": 1,
                        "next_at": now,
                        "reason": reason,
                    }
                    atomic_write(state_path, json.dumps(new_state, ensure_ascii=False, indent=2).encode())
                results["recovered"] += 1
        else:
            results["ineligible_holds"] += 1

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
