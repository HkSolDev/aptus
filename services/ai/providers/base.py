from typing import Protocol

from schema import PostBatch


class LLMProviderError(RuntimeError):
    """A provider call failed in a way the pipeline can report."""


class LLMProvider(Protocol):
    def extract_posts(self, system_prompt: str, user_prompt: str) -> PostBatch:
        ...
