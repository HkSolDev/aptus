import os
import time

import httpx
from schema import PostBatch

from providers.base import LLMProviderError


class OpenAIProvider:
    def __init__(self) -> None:
        self.api_key = os.environ["OPENAI_API_KEY"]
        self.model = os.getenv("LLM_MODEL", "gpt-4o-mini")
        self.base_url = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1")

    def extract_posts(self, system_prompt: str, user_prompt: str) -> PostBatch:
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "post_batch",
                    "strict": True,
                    "schema": _openai_schema(PostBatch.model_json_schema()),
                },
            },
        }

        for attempt in range(3):
            try:
                response = httpx.post(
                    f"{self.base_url.rstrip('/')}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                    timeout=120,
                )

                if response.status_code in {429, 500, 502, 503, 504}:
                    if attempt < 2:
                        time.sleep(2**attempt)
                        continue

                response.raise_for_status()
                data = response.json()
                content = data["choices"][0]["message"]["content"]
                return PostBatch.model_validate_json(content)

            except httpx.TimeoutException as error:
                if attempt < 2:
                    time.sleep(2**attempt)
                    continue
                raise LLMProviderError(
                    "LLM request timed out after 3 attempts"
                ) from error
            except httpx.RequestError as error:
                if attempt < 2:
                    time.sleep(2**attempt)
                    continue
                raise LLMProviderError(
                    f"LLM network request failed: {error}"
                ) from error
            except httpx.HTTPStatusError as error:
                raise LLMProviderError(
                    f"LLM API returned HTTP {error.response.status_code}: "
                    f"{error.response.text[:500]}"
                ) from error
            except (KeyError, IndexError, TypeError, ValueError) as error:
                raise LLMProviderError(
                    "LLM returned an unexpected structured response"
                ) from error

        raise LLMProviderError("LLM request failed")


def _openai_schema(schema: dict) -> dict:
    """Remove metadata unsupported by strict OpenAI structured output."""
    if isinstance(schema, dict):
        schema.pop("format", None)
        for value in schema.values():
            _openai_schema(value)
    elif isinstance(schema, list):
        for value in schema:
            _openai_schema(value)
    return schema
