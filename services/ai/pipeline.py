import os

import httpx
from extract import extract_posts
from hash_cache import hash_text, is_unchanged, load_cache, save_cache
from sources.sarkariresult import fetch, list_jobs

BASE_URL = os.getenv("BASE_URL", "http://localhost:8080")


def push_to_ts(payload: dict) -> dict:
    """
    send clean data from python server to TS server
    """
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
            # 1. Fetch raw page text & extracted links
            page = fetch(url)
        except Exception as err:
            print(f"[Warning] Failed to fetch {url}: {err}")
            continue

        # 2. Skip if page content hasn't changed since last run
        if is_unchanged(url, page.text, cache):
            continue

        # 3. Extract structured posts from this changed notification.
        posts = extract_posts(page.text)
        posts_payload = [post.model_dump(mode="json") for post in posts]

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

        # 4. Push to TS server
        push_to_ts(payload)

        # 5. Update local hash cache
        cache[url] = hash_text(page.text)
        save_cache(cache)


if __name__ == "__main__":
    run_pipeline()
