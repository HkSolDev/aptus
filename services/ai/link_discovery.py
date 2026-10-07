"""Collect and rank unique destinations from one saved static HTML page."""

import json
import sys
from pathlib import Path
from urllib.parse import urljoin, urlsplit, urlunsplit

from bs4 import BeautifulSoup

from discovery_score import score_link


def url_identity(base_url: str, href: str) -> str | None:
    try:
        parts = urlsplit(urljoin(base_url, href.strip()))
        if parts.scheme not in {"http", "https"} or not parts.hostname:
            return None
        if parts.username or parts.password:
            return None
        host = parts.hostname.lower()
        if ":" in host:
            host = "[" + host + "]"
        port = parts.port
        if port and port != {"http": 80, "https": 443}[parts.scheme]:
            host += ":" + str(port)
        return urlunsplit((parts.scheme, host, parts.path or "/", parts.query, ""))
    except ValueError:
        return None


def link_context(anchor):
    container = anchor.find_parent(["tr", "li", "p", "article", "section"])
    if container is None:
        container = anchor.parent
    # ponytail: semantic containers only; unusual card layouts need labeled examples.
    copy = BeautifulSoup(str(container), "html.parser")
    links = copy.find_all("a", href=True)
    for link in links:
        link.decompose()  # Sibling Result/Admit-card labels must not poison a notice.
    nearby = copy.get_text(" ", strip=True)[:800]
    if len(links) > 1 and container.name not in {"tr", "li", "p"}:
        nearby = ""  # Whole sections are too broad to score a particular link.
    scope = anchor.find_parent(["section", "article"]) or anchor.find_parent("table") or anchor.find_parent("body")
    heading = ""
    if scope:
        for previous in anchor.find_all_previous(["h1", "h2", "h3"]):
            owner = previous.find_parent(["section", "article"]) or previous.find_parent("table") or previous.find_parent("body")
            if owner is scope:
                heading = previous.get_text(" ", strip=True)[:200]
                break
    return nearby, heading


def discover_links(html: str, page_url: str) -> dict:
    if not url_identity(page_url, page_url):
        raise ValueError("page_url must be an HTTP(S) URL without credentials")
    if len(html.encode("utf-8")) > 5_000_000:
        raise ValueError("HTML exceeds the 5 MB discovery limit")
    soup = BeautifulSoup(html, "html.parser")
    base = soup.find("base", href=True)
    base_url = urljoin(page_url, base["href"]) if base else page_url
    destinations = {}
    occurrences = skipped = 0
    for index, anchor in enumerate(soup.find_all("a", href=True)):
        if anchor.find_parent(["script", "style", "template"]):
            continue
        href = anchor["href"]
        url = url_identity(base_url, href)
        if not href.strip() or not url:
            skipped += 1
            continue
        text = anchor.get_text(" ", strip=True) or " ".join(
            image.get("alt", "") for image in anchor.find_all("img"))
        nearby, heading = link_context(anchor)
        score = score_link(text[:300], nearby, heading, urlsplit(url).path)
        occurrence = {"id": index, "parent_url": page_url, "href": href,
                      "anchor": text[:300], "nearby": nearby, "heading": heading,
                      "score": score}
        path = urlsplit(url).path.lower()
        kind = "document_reference" if path.endswith((".pdf", ".doc", ".docx")) else "html_candidate"
        destination = destinations.setdefault(url, {
            "url": url, "target_kind": kind, "priority": 0,
            "best_occurrence_id": index, "occurrences": []})
        if not destination["occurrences"] or score["priority"] > destination["priority"]:
            destination.update(priority=score["priority"], best_occurrence_id=index)
        destination["occurrences"].append(occurrence)
        occurrences += 1
    ranked = sorted(destinations.values(), key=lambda item: -item["priority"])
    return {"page_url": page_url, "occurrences": occurrences,
            "unique_destinations": len(ranked), "duplicate_occurrences": occurrences - len(ranked),
            "skipped_links": skipped, "destinations": ranked}


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: python link_discovery.py saved-page.html https://source.example/")
    report = discover_links(Path(sys.argv[1]).read_text(encoding="utf-8"), sys.argv[2])
    print(json.dumps(report, ensure_ascii=False, indent=2))
