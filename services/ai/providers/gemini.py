import os

import httpx

from schema import PostBatch


def gemini_api_key() -> str:
    key = os.getenv("GEMINI_API_KEY") or os.getenv("GEMINI_API_KEY_1")
    if not key or not key.strip():
        raise RuntimeError("provider_credential_unavailable")
    return key.strip()


class GeminiProvider:
    def __init__(self) -> None:
        self.api_key = gemini_api_key()
        self.model = os.getenv("LLM_MODEL", "gemini-2.5-flash-lite")

    def extract_posts(self, system_prompt: str, user_prompt: str) -> PostBatch:
        url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self.model}:generateContent"
        )
        payload = {
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "contents": [{"parts": [{"text": user_prompt}]}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseJsonSchema": PostBatch.model_json_schema(),
            },
        }

        response = httpx.post(
            url,
            headers={"x-goog-api-key": self.api_key},
            json=payload,
            timeout=120,
        )
        if not response.is_success:
            raise RuntimeError(f"Gemini API returned HTTP {response.status_code}")

        data = response.json()
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        # Return the same typed result as other providers; source accuracy is a separate check.
        return PostBatch.model_validate_json(text)
