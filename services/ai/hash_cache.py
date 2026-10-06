"""Persist page hashes locally to skip repeat extraction across pipeline runs."""

import hashlib
import json
from pathlib import Path

CACHE_PATH = Path(__file__).resolve().parents[2] / "downloads" / "extraction_hash_cache.json"


def hash_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def load_cache() -> dict[str, str]:
    if not CACHE_PATH.exists():
        return {}
    return json.loads(CACHE_PATH.read_text())


def save_cache(cache: dict[str, str]) -> None:
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(json.dumps(cache, indent=2))


def is_unchanged(url: str, raw_text: str, cache: dict[str, str]) -> bool:
    return cache.get(url) == hash_text(raw_text)
