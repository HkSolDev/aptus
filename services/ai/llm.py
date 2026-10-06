import os

from providers.base import LLMProvider
from providers.gemini import GeminiProvider
from providers.openai import OpenAIProvider


def get_llm_provider() -> LLMProvider:
    """Choose the API adapter without making extract.py depend on a specific API."""
    provider = os.getenv("LLM_PROVIDER", "openai").lower()

    if provider == "openai":
        return OpenAIProvider()

    if provider == "gemini":
        return GeminiProvider()

    raise ValueError(f"Unsupported LLM_PROVIDER: {provider}")
