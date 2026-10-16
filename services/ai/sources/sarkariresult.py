import json
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from urllib.parse import urlsplit

import httpx
from bs4 import BeautifulSoup, NavigableString

RSS_URL = "https://www.sarkariresult.com/feed_rss.xml"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}
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


def discover_feed(xml: str | bytes) -> list[dict[str, str]]:
    """Return bounded, recruitment-only entries from a captured RSS document."""
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as error:
        raise ValueError("invalid_rss") from error
    if root.tag.rsplit("}", 1)[-1] != "rss" or root.find("channel") is None:
        raise ValueError("rss_root_missing")

    jobs = {}
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()[:500]
        url = (item.findtext("link") or "").strip()
        try:
            parts = urlsplit(url)
            port = parts.port
        except ValueError:
            continue
        allowed_url = (
            parts.scheme == "https"
            and parts.hostname == "www.sarkariresult.com"
            and port in {None, 443}
            and not parts.username
            and not parts.password
            and not parts.query
            and not parts.fragment
            and parts.path.startswith("/")
        )
        if title and allowed_url and is_recruitment_notice(title):
            jobs.setdefault(url, {"url": url, "title": title, "source": "sarkariresult"})
        if len(jobs) >= 100:
            break
    return list(jobs.values())


def list_jobs() -> list[tuple[str, str]]:
    return [(job["title"], job["url"]) for job in discover_feed(get_with_retry(RSS_URL).content)]


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


SECTION_LABELS = {
    "important_dates": "Important Dates",
    "application_fee": "Application Fee",
    "age_limit": "Age Limit",
    "posts_and_qualifications": ("Post Name", "Exam Name"),
    "subject_wise_vacancies": "Subject Wise Vacancy Details",
    "category_wise_vacancies": "Category Wise Vacancy Details",
}
LINK_LABELS = {
    "notification_pdf_url": "download notification",
    "official_site_url": "official website",
    "apply_url": "apply online",
}


@dataclass
class Page:
    text: str
    links: dict[str, str | None]
    sections: dict[str, str] = field(default_factory=dict)


def render_table(table) -> str:
    """Keep each row as an array of cells, including empty cells."""
    rows = []
    for row in table.find_all("tr"):
        if row.find_parent("table") is not table:
            continue  # Nested rows are rendered through their containing cell.
        if not row.find("table") and any(
            bad in row.get_text(" ", strip=True).lower() for bad in NOISY_PATTERNS
        ):
            continue
        cells = row.find_all(["td", "th"], recursive=False)
        if cells:
            rows.append(json.dumps(
                [render_excerpt(cell) for cell in cells], ensure_ascii=False,
            ))
    return "\n".join(rows)


def render_excerpt(node) -> str:
    """Render nested tables once while retaining surrounding text."""
    # Work on a copy so rendering one excerpt cannot change later section searches.
    copy = BeautifulSoup(str(node), "html.parser")
    for table in list(copy.find_all("table")):
        if table.find_parent("table") is None:
            table.replace_with(NavigableString(render_table(table)))
    return copy.get_text("\n", strip=True)


def extract_section(soup: BeautifulSoup, label: str) -> str | None:
    """Read a heading's cell, or the post table rows up to the next section."""
    heading = soup.find(
        string=lambda text: bool(
            text and label.casefold() in text.strip().casefold()
            and text.find_parent(["h1", "h2", "h3", "b", "strong"])
        )
    )
    if heading is None:
        return None
    cell = heading.find_parent(["td", "th"])
    if cell is None:
        return None

    if label not in {"Post Name", "Exam Name"}:
        # Some section headings share a cell with a nested table.
        if cell.find("table"):
            return render_excerpt(cell)
        # Other headings occupy their own row above the data table.
        row = cell.find_parent("tr")
        if row is not None and not cell.find(["ul", "ol"]) and (
            "Vacancy Details" in label
        ):
            return collect_table_rows(row)
        # Stay inside this cell: adjacent cells can contain unrelated fees or dates.
        return render_excerpt(cell)

    # Keep each role, its vacancy count, and its qualification together.
    row = cell.find_parent("tr")
    if row is None:
        return None
    return collect_table_rows(row)


def collect_table_rows(row) -> str:
    """Read consecutive rows until the next section heading or nested table."""
    excerpts = []
    for current in [row, *row.find_next_siblings("tr")]:
        cells = current.find_all(["td", "th"], recursive=False)
        if current is not row and (
            len(cells) <= 1 or current.find(["h1", "h2", "h3", "table"])
        ):
            break
        excerpts.append(json.dumps(
            [render_excerpt(cell) for cell in cells], ensure_ascii=False,
        ))
    return "\n".join(excerpts)


def extract_sections(soup: BeautifulSoup) -> dict[str, str]:
    """Try each known heading alias and keep the first nonempty excerpt per section."""
    sections = {}
    for key, labels in SECTION_LABELS.items():
        for label in (labels if isinstance(labels, tuple) else (labels,)):
            text = extract_section(soup, label)
            if text:
                sections[key] = text
                break
    return sections


def find_links(soup: BeautifulSoup) -> dict[str, str | None]:
    links = dict.fromkeys(LINK_LABELS)
    for tr in soup.find_all("tr"):
        anchor = tr.find("a", href=True)
        first_cell = tr.find(["td", "th"])
        if not anchor or not first_cell:
            continue
        label = first_cell.get_text(" ", strip=True).lower()
        for field, wanted in LINK_LABELS.items():
            matches = wanted in label
            if field == "notification_pdf_url":
                matches = matches or (
                    "download" in label and "notification" in label
                )
            if links[field] is None and matches:
                links[field] = anchor["href"]
    return links


def parse_page(html: str) -> Page:
    """Collect links, labelled excerpts, and cleaned text from one HTML notification."""
    soup = BeautifulSoup(html, "html.parser")
    links = find_links(soup)
    for tag in soup(["script", "style", "nav", "header", "footer", "aside"]):
        tag.decompose()

    sections = extract_sections(soup)

    # Nested tables are handled inside their cells, not rendered a second time here.
    tables = [table for table in soup.find_all("table")
              if table.find_parent("table") is None]
    text_lines = (
        "\n".join(render_table(table) for table in tables)
        if tables else render_excerpt(soup)
    ).splitlines()
    cleaned_lines = (line.strip() for line in text_lines)

    text = "\n".join(
        line
        for line in cleaned_lines
        if line and not any(bad in line.lower() for bad in NOISY_PATTERNS)
    )

    return Page(text, links, sections)


def fetch(url: str) -> Page:
    return parse_page(get_with_retry(url).text)
