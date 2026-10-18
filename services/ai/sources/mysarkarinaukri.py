"""Discover job notices with labelled official PDFs from MySarkariNaukri."""

import re
from urllib.parse import urlsplit

from bs4 import BeautifulSoup

LISTING_URL = 'https://www.mysarkarinaukri.com/'
MAX_LISTINGS = 100


def official_pdf_url(value: str) -> str | None:
    """Accept only a direct HTTPS PDF outside the third-party publisher."""
    try:
        parts = urlsplit(value)
        port = parts.port
    except ValueError:
        return None
    if (
        parts.scheme != 'https' or not parts.hostname or port not in {None, 443}
        or parts.username or parts.password or parts.fragment
        or parts.hostname.endswith('mysarkarinaukri.com')
        or not parts.path.lower().endswith('.pdf')
    ):
        return None
    return value


def text(node) -> str:
    return ' '.join(node.get_text(' ', strip=True).split())[:500] if node else ''


def discover_listings(html: str) -> list[dict[str, str]]:
    """Return cards only when they label a direct external official PDF."""
    soup = BeautifulSoup(html, 'html.parser')
    cards = soup.select('.msn-job-card')
    if not cards:
        raise ValueError('job_cards_missing')
    listings = {}
    for card in cards:
        title = text(card.select_one('.job-title'))
        body = text(card.select_one('.job-qualification'))
        deadline_label = card.select_one('.date-label')
        deadline = text(card.select_one('.date-value')) if deadline_label and text(deadline_label).casefold() == 'last date:' else ''
        link = next((item for item in card.select('a[href]')
                     if 'official notification' in (item.get('title') or '').casefold()), None)
        url = official_pdf_url(link['href']) if link else None
        if not title or not url:
            continue
        organization = ''
        match = re.search(r'recruiting body:\s*(.*?)(?:\s+advertisement no\.?\s*:|$)', body, re.I)
        if match:
            organization = match.group(1).strip()
        record = {'source': 'mysarkarinaukri', 'url': url, 'title': title}
        if deadline:
            record['deadline'] = deadline
        if organization:
            record['organization'] = organization[:300]
        listings.setdefault(url, record)
        if len(listings) >= MAX_LISTINGS:
            break
    if not listings:
        raise ValueError('official_pdf_links_missing')
    return list(listings.values())
