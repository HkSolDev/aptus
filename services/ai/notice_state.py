"""Durable notice state and grouped-evidence fingerprints for worker deduplication."""

import contextlib
import fcntl
import hashlib
import json
import re
from pathlib import Path
from typing import Any

from capture_store import atomic_write, now

# Extraction contract version. Increment this when schema, prompt,
# or extraction rules materially change to invalidate older cached extractions.
# v5 adds explicit primary/supporting document-order instructions and
# supporting-document condition rules.
EXTRACTION_VERSION = "extract-bundle-v5"


def canonicalize_for_fingerprint(value: Any) -> Any:
    """Canonicalize values for fingerprinting without mutating original evidence.

    - Collapses repeated ordinary horizontal whitespace (spaces, tabs) in text to one space.
    - Strips leading/trailing horizontal whitespace per line while preserving line breaks.
    - Preserves line breaks, section order, table rows/columns, punctuation,
      numbers, dates, and meaningful word boundaries.
    """
    if isinstance(value, str):
        lines = [re.sub(r"[ \t]+", " ", line).strip(" \t") for line in value.split("\n")]
        return "\n".join(lines).strip(" \t\n")
    if isinstance(value, dict):
        return {k: canonicalize_for_fingerprint(v) for k, v in sorted(value.items())}
    if isinstance(value, list):
        return [canonicalize_for_fingerprint(item) for item in value]
    return value


def compute_evidence_fingerprint(source_input: dict[str, Any], extraction_version: str = EXTRACTION_VERSION) -> str:
    """Compute a deterministic SHA-256 fingerprint of the grouped notice evidence.

    Includes:
      - extraction_version (schema/prompt contract)
      - bundle_id (grouped notice identifier)
      - identity metadata (issuer, ad, campaign, year)
      - documents: sorted by document_id, capturing role, format, title,
        authority, amendment_scope, and normalized sections/tables.

    Excludes:
      - capture timestamps, local file paths, crawl traversal order, run counters.
    """
    doc_entries = []
    for doc in source_input.get("documents", []):
        sections = doc.get("sections", [])
        sections_canonical = canonicalize_for_fingerprint(sections)
        sections_serialized = json.dumps(sections_canonical, sort_keys=True, ensure_ascii=False)
        content_hash = hashlib.sha256(sections_serialized.encode("utf-8")).hexdigest()

        doc_entries.append({
            "document_id": doc.get("document_id"),
            "role": doc.get("role"),
            "authority": doc.get("authority"),
            "format": doc.get("format"),
            "title": canonicalize_for_fingerprint(doc.get("title")),
            "amendment_scope": doc.get("amendment_scope"),
            "content_hash": content_hash,
        })

    # Sort documents by document_id so crawl traversal order does not change the fingerprint
    doc_entries.sort(key=lambda item: str(item["document_id"]))

    envelope = {
        "extraction_version": extraction_version,
        "bundle_id": source_input.get("bundle_id"),
        "identity": canonicalize_for_fingerprint(source_input.get("identity", {})),
        "documents": doc_entries,
    }
    canonical_repr = json.dumps(envelope, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical_repr.encode("utf-8")).hexdigest()


def verify_cached_citations(draft_envelope: dict[str, Any], source_input: dict[str, Any]) -> bool:
    """Verify that cached facts and exact quotes remain grounded in current evidence.

    Reusing a draft requires:
      1. Every cited evidence unit exists in current source documents with valid locations.
      2. Every cited quote matches verbatim (exact substring) in the current source evidence.
      3. All facts requiring citations remain covered.
    When current source evidence is supplied, missing or malformed citation data
    must reject reuse rather than silently pass.
    If formatting changes (e.g. whitespace or evidence IDs) cause quote mismatches
    in current evidence, we must NOT weaken validation; instead, treat as cache miss.
    """
    if not isinstance(draft_envelope, dict) or not isinstance(source_input, dict):
        return False

    facts = draft_envelope.get("facts")
    if not isinstance(facts, dict):
        return False

    # Checksums establish byte integrity, not the validity of the saved decision.
    from validate_candidate import validate_candidate
    try:
        if validate_candidate({'facts': facts}, source_input)['status'] == 'blocked':
            return False
    except (KeyError, TypeError, ValueError, AttributeError):
        return False

    return True


class NoticeStateManager:
    """Manages durable notice state and file locking under worker storage."""

    def __init__(self, root: Path):
        self.root = Path(root)
        self.state_dir = self.root / "state" / "notices"
        self.lock_dir = self.root / "state" / "locks"
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.lock_dir.mkdir(parents=True, exist_ok=True)

    def state_path(self, bundle_id: str) -> Path:
        return self.state_dir / f"{bundle_id}.json"

    def lock_path(self, bundle_id: str) -> Path:
        return self.lock_dir / f"{bundle_id}.lock"

    @contextlib.contextmanager
    def notice_lock(self, bundle_id: str):
        """Single-machine file lock protecting notice reuse check and write."""
        lock_file = self.lock_path(bundle_id)
        with lock_file.open("a") as stream:
            fcntl.flock(stream, fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(stream, fcntl.LOCK_UN)

    def get_reusable_draft(self, bundle_id: str, expected_fingerprint: str,
                           expected_version: str,
                           source_input: dict[str, Any] | None = None) -> dict[str, Any] | None:
        """Return the saved draft envelope if durable state and draft are valid and match fingerprint."""
        path = self.state_path(bundle_id)
        if not path.is_file():
            return None
        try:
            state = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return None

        if not isinstance(state, dict) or state.get("outcome") != "success":
            return None
        if state.get("evidence_fingerprint") != expected_fingerprint:
            return None
        if state.get("extraction_version") != expected_version:
            return None

        expected_draft_sha256 = state.get("draft_sha256")
        if not expected_draft_sha256 or not isinstance(expected_draft_sha256, str):
            # Missing draft integrity information in state -> safe cache miss
            return None

        draft_file = Path(state.get("draft_path", ""))
        if not draft_file.is_file():
            return None
        try:
            draft_bytes = draft_file.read_bytes()
            actual_draft_sha256 = hashlib.sha256(draft_bytes).hexdigest()
            if actual_draft_sha256 != expected_draft_sha256:
                return None
            draft_envelope = json.loads(draft_bytes.decode("utf-8"))
            if not isinstance(draft_envelope, dict) or draft_envelope.get("bundle_id") != bundle_id:
                return None
        except (json.JSONDecodeError, UnicodeDecodeError, OSError):
            return None

        # Verify cached citations against current evidence if provided
        if source_input is not None:
            if not verify_cached_citations(draft_envelope, source_input):
                return None

        return draft_envelope

    def record_outcome(self, bundle_id: str, fingerprint: str, extraction_version: str,
                       draft_path: Path, disposition: str = "valid_recruitment_review_draft"):
        """Record successful extraction outcome, draft location, SHA-256, and disposition."""
        draft_path = Path(draft_path)
        if not draft_path.is_file():
            raise FileNotFoundError(f"Draft file not found: {draft_path}")
        draft_sha256 = hashlib.sha256(draft_path.read_bytes()).hexdigest()
        state = {
            "bundle_id": bundle_id,
            "evidence_fingerprint": fingerprint,
            "extraction_version": extraction_version,
            "outcome": "success",
            "disposition": disposition,
            "draft_path": str(draft_path.resolve()),
            "draft_sha256": draft_sha256,
            "updated_at": now(),
        }
        atomic_write(self.state_path(bundle_id), json.dumps(state, indent=2).encode("utf-8"))

    def record_success(self, bundle_id: str, fingerprint: str, extraction_version: str, draft_path: Path):
        """Record successful extraction outcome (backward-compatible alias for record_outcome)."""
        self.record_outcome(bundle_id, fingerprint, extraction_version, draft_path,
                            disposition="valid_recruitment_review_draft")
