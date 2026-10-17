"""Discover original HSSC recruitment-advertisement PDFs."""

from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup

LISTING_URL = 'https://hssc.gov.in/advertisement'
ORGANIZATION = 'Haryana Staff Selection Commission'
MAX_LISTINGS = 100
EXCLUDED_SIGNALS = ('corrigendum', 'extension', 'additional posts', 'withdrawal')


def official_pdf_url(value: str) -> str | None:
    """Accept HSSC's public advertisement-document route only."""
    url = urljoin(LISTING_URL, value)
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        return None
    path_parts = [part for part in parts.path.split('/') if part]
    if (
        parts.scheme != 'https' or parts.hostname != 'hssc.gov.in'
        or port not in {None, 443} or parts.username or parts.password
        or parts.query or parts.fragment or len(path_parts) != 3
        or path_parts[0] != 'file' or path_parts[2] != 'advertisements'
    ):
        return None
    return url


def recruitment_advertisement(title: str) -> bool:
    """Keep original advertisement notices; skip corrections and extensions."""
    lowered = title.casefold()
    return lowered.startswith('advt. no.') and not any(signal in lowered for signal in EXCLUDED_SIGNALS)


def discover_listings(html: str) -> list[dict[str, str]]:
    """Return bounded HSSC advertisement PDFs from the official public table."""
    soup = BeautifulSoup(html, 'html.parser')
    table = soup.select_one('#advertisementsTable')
    if table is None:
        raise ValueError('advertisement_table_missing')

    listings = {}
    for row in table.select('tbody tr'):
        cells = row.select('td')
        link = row.select_one('a[href]')
        if len(cells) < 3 or link is None:
            continue
        title = ' '.join(cells[0].get_text(' ', strip=True).split())[:500]
        url = official_pdf_url(link['href'])
        if not url or not recruitment_advertisement(title):
            continue
        listings.setdefault(url, {
            'source': 'hssc', 'url': url, 'title': title, 'organization': ORGANIZATION,
        })
        if len(listings) >= MAX_LISTINGS:
            break
    if not listings:
        raise ValueError('advertisement_pdf_links_missing')
    return list(listings.values())
