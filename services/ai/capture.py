"""Bounded public HTML/PDF capture, independent of document parsing."""

import hashlib
import ipaddress
import json
import re
import socket
import time
import xml.etree.ElementTree as ET
from contextlib import closing
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import httpx
from bs4 import BeautifulSoup

from capture_store import finish, now, read_state, save_snapshot, usable_snapshot
from link_discovery import url_identity


def check_public_url(url: str):
    parts = urlsplit(url)
    addresses = socket.getaddrinfo(parts.hostname, parts.port or (443 if parts.scheme == "https" else 80))
    if not addresses or any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
        raise ValueError("non_public_destination")


def accept_document(body: bytes, content_type: str, url: str):
    media = content_type.split(";", 1)[0].strip().lower()
    pdf_url = urlsplit(url).path.lower().endswith(".pdf")
    if media == "application/pdf" or pdf_url or body.startswith(b"%PDF-"):
        if media in {"application/pdf", "application/octet-stream", ""} and body.startswith(b"%PDF-"):
            return "pdf"
        raise ValueError("invalid_pdf")
    if media in {"application/rss+xml", "application/xml", "text/xml"}:
        try:
            root = ET.fromstring(body)
        except ET.ParseError as error:
            raise ValueError("invalid_xml") from error
        if root.tag.rsplit("}", 1)[-1] != "rss" or root.find("channel") is None:
            raise ValueError("invalid_xml")
        return "xml"
    if media == "application/json":
        try:
            value = json.loads(body)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ValueError("invalid_json") from error
        if not isinstance(value, (dict, list)):
            raise ValueError("invalid_json")
        return "json"
    if media not in {"text/html", "application/xhtml+xml", "application/octet-stream", ""}:
        raise ValueError("unsupported_type")
    soup = BeautifulSoup(body, "html.parser")
    if not soup.find(["html", "body", "p", "a", "table", "div"]):
        raise ValueError("invalid_html")
    title = soup.title.get_text(" ", strip=True).casefold() if soup.title else ""
    password = soup.find("input", attrs={"type": re.compile("password", re.I)})
    if password and re.search(r"login|log in|sign in", title + " " + urlsplit(url).path.casefold()):
        raise ValueError("login_required")
    if re.search(r"access denied|just a moment|verify you are human|service unavailable", title):
        raise ValueError("blocked_or_error_page")
    return "html"


def capture(url, storage_dir, client=None, *, force=False):
    requested_url = url_identity(url, url)
    if not requested_url:
        raise ValueError("An HTTP(S) URL without credentials is required")
    root = Path(storage_dir)
    state_path, state = read_state(root, requested_url)
    owned = client is None
    client = client or httpx.Client(timeout=httpx.Timeout(20, connect=10), trust_env=False)
    target, redirects, unconditional = requested_url, [], force
    started = time.monotonic()
    result = {"requested_url": requested_url, "outcome": "failed"}
    validators = None
    try:
        for _ in range(7):  # Five redirects plus one missing-body recovery request.
            if time.monotonic() - started > 60:
                raise ValueError("elapsed_budget_exceeded")
            check_public_url(target)
            headers = {"User-Agent": "AptusCapture/1.0", "Accept": "text/html,application/xhtml+xml,application/pdf,application/json"}
            old = state.get("validators") or {}
            if not unconditional and old.get("target") == target:
                for field, header in (("etag", "If-None-Match"), ("last_modified", "If-Modified-Since")):
                    if old.get(field):
                        headers[header] = old[field]
            request = httpx.Request("GET", target, headers=headers)
            with closing(client.send(request, stream=True, auth=None, follow_redirects=False)) as response:
                if response.status_code in {301, 302, 303, 307, 308}:
                    location = response.headers.get("location")
                    next_url = url_identity(target, urljoin(target, location)) if location else None
                    if not next_url or len(redirects) >= 5:
                        raise ValueError("invalid_or_excessive_redirects")
                    redirects.append({"from": target, "to": next_url, "status": response.status_code})
                    target = next_url
                    continue
                result["http_status"] = response.status_code
                if response.status_code == 304:
                    conditional = "If-None-Match" in headers or "If-Modified-Since" in headers
                    if conditional and usable_snapshot(state):
                        validators = {**old, **{key: response.headers[header] for key, header in
                            (("etag", "etag"), ("last_modified", "last-modified")) if header in response.headers}}
                        result.update(outcome="revalidated", snapshot=state["snapshot"])
                        break
                    if unconditional:
                        raise ValueError("unexpected_304")
                    unconditional = True
                    continue
                if response.status_code != 200:
                    if response.status_code >= 400:
                        response.raise_for_status()
                    raise ValueError("http_error")
                content_type = response.headers.get("content-type", "")
                limit = (20 if "application/pdf" in content_type.lower() or urlsplit(target).path.lower().endswith(".pdf") else 5) * 1024 * 1024
                body = bytearray()
                for chunk in response.iter_bytes(chunk_size=64 * 1024):
                    if len(body) + len(chunk) > limit:
                        raise ValueError("body_too_large")
                    if time.monotonic() - started > 60:
                        raise ValueError("elapsed_budget_exceeded")
                    body.extend(chunk)
                if not body:
                    raise ValueError("empty_body")
                kind = accept_document(bytes(body), content_type, target)
                digest = hashlib.sha256(body).hexdigest()
                previous = state.get("snapshot") or {}
                same = (previous.get("sha256") == digest and previous.get("final_url") == target
                        and previous.get("content_type") == content_type and usable_snapshot(state))
                metadata = {"requested_url": requested_url, "final_url": target,
                            "redirects": redirects, "captured_at": now(), "content_type": content_type,
                            "document_kind": kind, "http_status": 200, "capture_version": "v1",
                            "request_profile": "public-doc-v1", "vary": response.headers.get("vary"),
                            "content_encoding": response.headers.get("content-encoding"),
                            "etag": response.headers.get("etag"), "last_modified": response.headers.get("last-modified")}
                snapshot = previous if same else save_snapshot(root, bytes(body), metadata)
                validators = {"target": target, "etag": response.headers.get("etag"),
                              "last_modified": response.headers.get("last-modified")}
                result.update(outcome="identical" if same else "changed", snapshot=snapshot,
                              observation=metadata)
                break
        else:
            raise ValueError("request_limit_exceeded")
    except (ValueError, httpx.HTTPError, OSError) as error:
        # Store stable reason codes, never exception strings containing request secrets.
        codes = {"non_public_destination", "invalid_or_excessive_redirects", "unexpected_304",
                 "http_error", "body_too_large", "elapsed_budget_exceeded", "empty_body",
                 "invalid_pdf", "unsupported_type", "invalid_html", "login_required",
                 "invalid_xml", "invalid_json", "blocked_or_error_page", "request_limit_exceeded"}
        reason = (str(error) if str(error) in codes else "invalid_response") if isinstance(error, ValueError) else type(error).__name__
        result.update(outcome="rejected" if isinstance(error, ValueError) else "failed", reason=reason)
    finally:
        if owned:
            client.close()
    return finish(root, state_path, state, result, validators)


if __name__ == "__main__":
    import argparse
    import json
    parser = argparse.ArgumentParser(description="Capture one public HTML/PDF document")
    parser.add_argument("url")
    parser.add_argument("storage_dir")
    parser.add_argument("--force", action="store_true", help="Download without conditional headers")
    arguments = parser.parse_args()
    print(json.dumps(capture(arguments.url, arguments.storage_dir, force=arguments.force),
                     ensure_ascii=False, indent=2))
