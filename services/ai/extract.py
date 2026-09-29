"""Extract structured job posts from one notification's text.

This module owns the LLM boundary. Fetching, hashing, validation, deduplication,
and database writes belong in their own modules.
"""

from __future__ import annotations

from llm import get_llm_provider
from schema import Post

SYSTEM_PROMPT = """You extract facts from Indian government job notifications.

Return only structured data matching the Post schema. Never guess missing
values. Use null when a value is not stated clearly in the source text.
Extract eligibility facts only; do not decide whether a particular user is
eligible.
"""


def build_user_prompt(source_text: str) -> str:
    """Build the LLM input for one already-trimmed notification."""
    return f"""Extract every distinct job post from this notification.

SOURCE TEXT:
{source_text}
"""


def extract_posts(source_text: str) -> list[Post]:
    """Extract structured posts without knowing which provider is configured."""
    if not source_text.strip():
        return []

    result = get_llm_provider().extract_posts(
        system_prompt=SYSTEM_PROMPT,
        user_prompt=build_user_prompt(source_text),
    )
    return result.posts
