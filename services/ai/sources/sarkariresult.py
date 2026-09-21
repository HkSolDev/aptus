import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass

import httpx
from bs4 import BeautifulSoup

RSS_URL = "https://www.sarkariresult.com/feed_rss.xml"
HEADERS = {"User-Agent": "Mozilla/5.0"}
ATTEMPTS = 3


def get_with_retry(url: str) -> httpx.Response:
    for attempt in range(ATTEMPTS):
        try:
            response = httpx.get(
                url, headers=HEADERS, timeout=30, follow_redirects=True
            )
            response.raise_for_status()
            return response
        except httpx.HTTPError:
            if attempt == ATTEMPTS - 1:
                raise
            time.sleep(2**attempt)

JOB_SIGNALS = ("online form", "offline form", "recruitment")
SKIP_WORDS = (
    "admit card",
    "result",
    "answer key",
    "exam date",
    "syllabus",
    "counselling",
    "correction",
    "edit form",
    "cancelled",
    "re upload",
    "merit list",
)

def is_recruitment_notice(title: str) -> bool:
    title_lower = title.lower()
    has_job_signal = any(signal in title_lower for signal in JOB_SIGNALS)
    has_noisy_signal = any(skip in title_lower for skip in SKIP_WORDS)
    return has_job_signal and not has_noisy_signal


def list_jobs() -> list[tuple[str, str]]:
    root = ET.fromstring(get_with_retry(RSS_URL).content)
    jobs = []
    for item in root.iter("item"):
        title = item.findtext("title")
        url = item.findtext("link")
        if title and url and is_recruitment_notice(title):
            jobs.append((title, url))
    return jobs


NOISY_PATTERNS = (
    "telegram",
    "whatsapp",
    "instagram",
    "mobile app",
    "android app",
    "ios app",
    "sarkari result tools",
    "signature resizer",
    "frequently asked questions",
)


LINK_LABELS = {
    "notification_pdf_url": "download notification",
    "official_site_url": "official website",
    "apply_url": "apply online",
}


@dataclass
class Page:
    text: str
    links: dict[str, str | None]


def find_links(soup: BeautifulSoup) -> dict[str, str | None]:
    links = dict.fromkeys(LINK_LABELS)
    for tr in soup.find_all("tr"):
        anchor = tr.find("a", href=True)
        first_cell = tr.find(["td", "th"])
        if not anchor or not first_cell:
            continue
        label = first_cell.get_text(" ", strip=True).lower()
        for field, wanted in LINK_LABELS.items():
            if links[field] is None and wanted in label:
                links[field] = anchor["href"]
    return links


def parse_page(html: str) -> Page:
    soup = BeautifulSoup(html, "html.parser")
    links = find_links(soup)
    for tag in soup(["script", "style", "nav", "header", "footer", "aside"]):
        tag.decompose()

    tables = soup.find_all("table")
    if tables:
        lines: list[str] = []
        for table in tables:
            for tr in table.find_all("tr"):
                if any(
                    bad in tr.get_text(" ", strip=True).lower()
                    for bad in NOISY_PATTERNS
                ):
                    continue
                for line in tr.get_text("\n").splitlines():
                    cleaned = line.strip()
                    if cleaned:
                        lines.append(cleaned)
        return Page("\n".join(lines), links)

    lines = (line.strip() for line in soup.get_text("\n").splitlines())
    text = "\n".join(
        line
        for line in lines
        if line and not any(bad in line.lower() for bad in NOISY_PATTERNS)
    )
    return Page(text, links)


def fetch(url: str) -> Page:
    return parse_page(get_with_retry(url).text)
