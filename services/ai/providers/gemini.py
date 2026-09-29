import os

import httpx

from schema import PostBatch


class GeminiProvider:
    def __init__(self) -> None:
        self.api_key = os.environ["GEMINI_API_KEY"]
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
                "responseSchema": PostBatch.model_json_schema(),
            },
        }

        response = httpx.post(
            url,
            params={"key": self.api_key},
            json=payload,
            timeout=120,
        )
        response.raise_for_status()

        data = response.json()
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        return PostBatch.model_validate_json(text)
