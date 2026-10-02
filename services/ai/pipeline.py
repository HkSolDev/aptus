import os

import httpx
from extract import extract_posts
from hash_cache import hash_text, is_unchanged, load_cache, save_cache
from sources.sarkariresult import fetch, list_jobs

BASE_URL = os.getenv("BASE_URL", "http://localhost:8080")


def push_to_ts(payload: dict) -> dict:
    """Send extracted JSON to the application for persistence, not extraction."""
    res = httpx.post(f"{BASE_URL}/api/internal/ingest", json=payload)
    res.raise_for_status()
    return res.json()


def run_pipeline() -> None:
    cache = load_cache()
    try:
        jobs = list_jobs()
    except Exception as err:
        print(f"[Error] Failed to fetch job list: {err}")
        return

    for title, url in jobs:
        try:
            page = fetch(url)
        except Exception as err:
            print(f"[Warning] Failed to fetch {url}: {err}")
            continue

        # Avoid paying for another LLM call when the stored page text is unchanged.
        if is_unchanged(url, page.text, cache):
            continue

        # The provider checks the response shape; standalone age checks are not wired here yet.
        posts = extract_posts(page.text, sections=page.sections)
        # JSON mode converts Python dates to strings the TypeScript API can accept.
        posts_payload = [post.model_dump(mode="json") for post in posts]

        # URLs come from HTML links. Saving a PDF URL does not read the PDF itself.
        payload = {
            "source_url": url,
            "source_name": f"SarkariResult: {title}",
            "raw_hash": hash_text(page.text),
            "notification_pdf_url": page.links.get("notification_pdf_url"),
            "official_site_url": page.links.get("official_site_url"),
            "apply_url": page.links.get("apply_url"),
            "source_text": page.text,
            "posts": posts_payload,
        }

        push_to_ts(payload)

        # Mark success only after ingestion succeeds, so a failed write can be retried.
        cache[url] = hash_text(page.text)
        save_cache(cache)


if __name__ == "__main__":
    run_pipeline()
