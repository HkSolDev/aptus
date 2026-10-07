"""Local immutable snapshots; one worker owns this store."""

import hashlib
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4


def now():
    return datetime.now(timezone.utc).isoformat()


def atomic_write(path: Path, body: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
            temporary = stream.name
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)


def read_state(root: Path, url: str):
    key = hashlib.sha256(url.encode()).hexdigest()
    path = root / "urls" / (key + ".json")
    return path, json.loads(path.read_text()) if path.exists() else {}


def usable_snapshot(state: dict):
    snapshot = state.get("snapshot")
    if not snapshot:
        return False
    path = Path(snapshot["body_path"])
    return path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == snapshot["sha256"]


def save_snapshot(root: Path, body: bytes, metadata: dict):
    digest = hashlib.sha256(body).hexdigest()
    blob = root / "blobs" / digest
    # Replacing the same hash also repairs a missing/corrupted local blob.
    atomic_write(blob, body)
    snapshot = {**metadata, "snapshot_id": uuid4().hex, "sha256": digest,
                "byte_length": len(body), "body_path": str(blob.resolve()),
                "byte_basis": "content-decoded-before-character-decoding"}
    path = root / "snapshots" / (snapshot["snapshot_id"] + ".json")
    atomic_write(path, json.dumps(snapshot, ensure_ascii=False, indent=2).encode())
    return snapshot


def finish(root: Path, state_path: Path, state: dict, result: dict, validators=None):
    root.mkdir(parents=True, exist_ok=True)
    attempt = {"checked_at": now(), **result}
    with (root / "attempts.jsonl").open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(attempt, ensure_ascii=False) + "\n")
    updated = {**state, "last_attempt": attempt}
    if result["outcome"] in {"changed", "identical", "revalidated"}:
        updated.update(snapshot=result["snapshot"], validators=validators,
                       last_success_at=attempt["checked_at"])
    atomic_write(state_path, json.dumps(updated, ensure_ascii=False, indent=2).encode())
    snapshot = result.get("snapshot") or state.get("snapshot") or {}
    return {**result, **{key: snapshot.get(key) for key in (
        "snapshot_id", "body_path", "sha256", "content_type", "final_url")}}
