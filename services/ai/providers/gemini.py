"""Gemini provider abstraction with ordered key pool and 429/RESOURCE_EXHAUSTED rotation."""

import base64
import json
import os
import re
from typing import Any

import httpx

from schema import PostBatch


def gemini_api_keys(env: dict[str, str] | None = None) -> list[str]:
    """Return trimmed, deduplicated Gemini API keys in deterministic order without logging values.

    Order:
      1. GEMINI_API_KEYS (comma-separated ordered list)
      2. GEMINI_API_KEY (compatible single or comma-separated fallback)
      3. GEMINI_API_KEY_1, GEMINI_API_KEY_2, ... in numeric order
    """
    source_env = env if env is not None else os.environ
    numbered = sorted(
        (name for name in source_env if re.fullmatch(r"GEMINI_API_KEY_[1-9]\d*", name)),
        key=lambda name: int(name.rsplit("_", 1)[1]),
    )
    names = ["GEMINI_API_KEYS", "GEMINI_API_KEY", *numbered]
    return list(
        dict.fromkeys(
            key.strip()
            for name in names
            for key in source_env.get(name, "").split(",")
            if key.strip()
        )
    )


def gemini_api_key(env: dict[str, str] | None = None) -> str:
    keys = gemini_api_keys(env=env)
    if not keys:
        raise RuntimeError("provider_credential_unavailable")
    return keys[0]


def is_gemini_quota_exhausted(response: Any) -> bool:
    """Return True only for HTTP 429 or RESOURCE_EXHAUSTED quota errors."""
    status_code = getattr(response, "status_code", None)
    if status_code == 429:
        return True
    if status_code not in {429}:
        return False
    return False


def _response_has_resource_exhausted(response: Any) -> bool:
    status_code = getattr(response, "status_code", None)
    if status_code == 429:
        return True
    try:
        payload = response.json()
        err = payload.get("error", {}) if isinstance(payload, dict) else {}
        if status_code in {429, 503} and err.get("status") == "RESOURCE_EXHAUSTED":
            return status_code == 429
    except (ValueError, AttributeError, TypeError):
        return False
    return False


class GeminiProvider:
    def __init__(
        self,
        *,
        keys: list[str] | None = None,
        model: str | None = None,
        client: Any = None,
        env: dict[str, str] | None = None,
    ) -> None:
        resolved_keys = (
            list(dict.fromkeys(k.strip() for k in keys if isinstance(k, str) and k.strip()))
            if keys is not None
            else gemini_api_keys(env=env)
        )
        if not resolved_keys:
            raise RuntimeError("provider_credential_unavailable")
        self.keys = resolved_keys
        self.api_key = self.keys[0]
        source_env = env if env is not None else os.environ
        self.model = model or source_env.get("LLM_MODEL", "gemini-2.5-flash-lite")
        self.client = client

    def request_json(
        self,
        *,
        system_prompt: str,
        parts: list[dict[str, Any]],
        response_schema: dict[str, Any] | None = None,
        tools: list[dict[str, Any]] | None = None,
        timeout: int = 120,
    ) -> dict[str, Any]:
        """Execute one structured Gemini request, rotating across keys once only on 429/RESOURCE_EXHAUSTED.

        Never rotates on 400/401/403/500, invalid JSON, validation failures, or weak evidence.
        Returns a safe dict describing status ('ok' or 'unresolved'), retryability, and parsed data.
        """
        url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self.model}:generateContent"
        )
        gen_config: dict[str, Any] = {"responseMimeType": "application/json"}
        if response_schema is not None:
            gen_config["responseJsonSchema"] = response_schema
        payload: dict[str, Any] = {
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": gen_config,
        }
        if tools:
            payload["tools"] = tools

        transport = self.client or httpx
        attempts = 0
        for idx, key in enumerate(self.keys, start=1):
            attempts = idx
            try:
                response = transport.post(
                    url,
                    headers={"x-goog-api-key": key},
                    json=payload,
                    timeout=timeout,
                )
            except (httpx.ConnectError, httpx.ConnectTimeout):
                return {
                    "status": "unresolved",
                    "retryable": True,
                    "reason": "gemini_network_failed",
                    "data": None,
                    "raw_text": None,
                    "grounding_metadata": None,
                    "attempt_count": attempts,
                    "key_pool_size": len(self.keys),
                    "used_key_index": None,
                }
            except httpx.HTTPError:
                return {
                    "status": "unresolved",
                    "retryable": False,
                    "reason": "gemini_transport_error",
                    "data": None,
                    "raw_text": None,
                    "grounding_metadata": None,
                    "attempt_count": attempts,
                    "key_pool_size": len(self.keys),
                    "used_key_index": None,
                }

            if is_gemini_quota_exhausted(response) or _response_has_resource_exhausted(response):
                if idx < len(self.keys):
                    continue
                return {
                    "status": "unresolved",
                    "retryable": True,
                    "reason": "gemini_quota_exhausted",
                    "data": None,
                    "raw_text": None,
                    "grounding_metadata": None,
                    "attempt_count": attempts,
                    "key_pool_size": len(self.keys),
                    "used_key_index": None,
                }

            if not response.is_success:
                return {
                    "status": "unresolved",
                    "retryable": response.status_code in {408, 500, 502, 503, 504},
                    "reason": f"gemini_http_{response.status_code}",
                    "data": None,
                    "raw_text": None,
                    "grounding_metadata": None,
                    "attempt_count": attempts,
                    "key_pool_size": len(self.keys),
                    "used_key_index": idx,
                }

            try:
                body = response.json()
                candidate = body["candidates"][0]
                if candidate.get("finishReason") not in {None, "STOP"}:
                    return {
                        "status": "unresolved",
                        "retryable": False,
                        "reason": "gemini_incomplete_or_refused",
                        "data": None,
                        "raw_text": None,
                        "grounding_metadata": None,
                        "attempt_count": attempts,
                        "key_pool_size": len(self.keys),
                        "used_key_index": idx,
                    }
                text = "".join(
                    part.get("text", "")
                    for part in candidate.get("content", {}).get("parts", [])
                    if isinstance(part, dict)
                )
                grounding_metadata = candidate.get("groundingMetadata")
                usage = body.get("usageMetadata", {})
            except (KeyError, IndexError, TypeError, ValueError):
                return {
                    "status": "unresolved",
                    "retryable": False,
                    "reason": "gemini_response_invalid",
                    "data": None,
                    "raw_text": None,
                    "grounding_metadata": None,
                    "attempt_count": attempts,
                    "key_pool_size": len(self.keys),
                    "used_key_index": idx,
                }

            try:
                parsed = json.loads(text)
            except (TypeError, ValueError):
                return {
                    "status": "unresolved",
                    "retryable": False,
                    "reason": "gemini_json_invalid",
                    "data": None,
                    "raw_text": text,
                    "grounding_metadata": grounding_metadata,
                    "attempt_count": attempts,
                    "key_pool_size": len(self.keys),
                    "used_key_index": idx,
                }

            return {
                "status": "ok",
                "retryable": False,
                "reason": None,
                "data": parsed,
                "raw_text": text,
                "grounding_metadata": grounding_metadata,
                "usage": usage,
                "attempt_count": attempts,
                "key_pool_size": len(self.keys),
                "used_key_index": idx,
            }

        return {
            "status": "unresolved",
            "retryable": True,
            "reason": "gemini_quota_exhausted",
            "data": None,
            "raw_text": None,
            "grounding_metadata": None,
            "attempt_count": attempts,
            "key_pool_size": len(self.keys),
            "used_key_index": None,
        }

    def recover_pdf_page(
        self,
        *,
        image_bytes: bytes,
        prompt: str,
        response_schema: dict[str, Any],
        system_prompt: str,
        mime_type: str = "image/png",
    ) -> dict[str, Any]:
        """Send a rendered PDF page image + identity/provenance prompt for structured Vision recovery."""
        encoded = base64.b64encode(image_bytes).decode("ascii")
        parts = [
            {"text": prompt},
            {"inline_data": {"mime_type": mime_type, "data": encoded}},
        ]
        return self.request_json(
            system_prompt=system_prompt,
            parts=parts,
            response_schema=response_schema,
        )

    def discover_sources(
        self,
        *,
        query: str,
        system_prompt: str,
        response_schema: dict[str, Any],
    ) -> dict[str, Any]:
        """Use Gemini Search Grounding for source discovery only (snippets are never proof)."""
        return self.request_json(
            system_prompt=system_prompt,
            parts=[{"text": query}],
            response_schema=response_schema,
            tools=[{"google_search": {}}],
        )

    def extract_posts(self, system_prompt: str, user_prompt: str) -> PostBatch:
        result = self.request_json(
            system_prompt=system_prompt,
            parts=[{"text": user_prompt}],
            response_schema=PostBatch.model_json_schema(),
        )
        if result["status"] != "ok" or result["data"] is None:
            raise RuntimeError(result["reason"] or "Gemini API request failed")
        return PostBatch.model_validate(result["data"])
