import os
from pathlib import Path

import httpx
from extract import extract_posts
from hash_cache import hash_text, is_unchanged, load_cache, save_cache
from age_extractor import extract_age_facts
from sources.sarkariresult import fetch, list_jobs
from validate import validate_age_rules

BASE_URL = os.getenv("BASE_URL", "http://localhost:8080")


def push_to_ts(payload: dict) -> dict:
    """Send extracted JSON to the application for persistence, not extraction."""
    token = os.getenv("INGEST_TOKEN") or None
    token_file = os.getenv("INGEST_TOKEN_FILE")
    if token_file:
        if token is not None:
            raise RuntimeError("Configure only one ingestion credential source.")
        try:
            token = Path(token_file).read_text(encoding="utf-8").strip()
        except OSError:
            raise RuntimeError("Could not load the ingestion credential file.") from None
    if not token or not 32 <= len(token) <= 512 or any(
        char not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"
        for char in token
    ):
        raise RuntimeError("Configure a valid ingestion credential before sending posts.")
    res = httpx.post(
        f"{BASE_URL}/api/internal/ingest", json=payload,
        headers={"Authorization": f"Bearer {token}"}, follow_redirects=False,
        # Reviewed publication may use a bounded sixty-second transaction.
        timeout=(httpx.Timeout(90, connect=10)
                 if 'reviewed_candidate_json' in payload else 30),
    )
    res.raise_for_status()
    return res.json()


def validate_extracted_posts(page, posts):
    """Null source-conflicting ages while retaining the typed extraction."""
    age_section = page.sections.get("age_limit", "")
    age_facts = extract_age_facts(age_section)
    for post in posts:
        issues = validate_age_rules(age_section, post.eligibility_rules.age_rules)
        if not issues:
            continue
        post.eligibility_rules.age_rules = [
            rule.model_copy(update={
                field: None for field, kind in (("min_age", "minimum"), ("max_age", "maximum"))
                if any(
                    fact["age"] is not None
                    and getattr(rule, field) != fact["age"]
                    and (not fact["applies_to"]
                         or (rule.gender or "").casefold() in fact["applies_to"].casefold())
                    for fact in age_facts[kind]
                )
            }) if any((rule.gender or "").casefold() in issue.casefold()
                      or "no matching llm age rule" in issue.casefold() for issue in issues)
            else rule
            for rule in post.eligibility_rules.age_rules
        ]
    return posts


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

        posts = extract_posts(page.text, sections=page.sections)
        posts = validate_extracted_posts(page, posts)
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
