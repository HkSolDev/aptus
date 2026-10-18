"""Discover UPSC recruitment-advertisement PDFs from its official listing."""

from urllib.parse import urlsplit

from bs4 import BeautifulSoup

LISTING_URL = 'https://www.upsc.gov.in/recruitment/recruitment-advertisement'
ORGANIZATION = 'Union Public Service Commission'
MAX_LISTINGS = 100


def official_pdf_url(value: str) -> str | None:
    """Accept only direct UPSC-hosted PDF advertisement links."""
    try:
        parts = urlsplit(value)
        port = parts.port
    except ValueError:
        return None
    if (
        parts.scheme != 'https'
        or parts.hostname != 'www.upsc.gov.in'
        or port not in {None, 443}
        or parts.username or parts.password or parts.query or parts.fragment
        or not parts.path.startswith('/sites/default/files/')
        or not parts.path.lower().endswith('.pdf')
    ):
        return None
    return value


def discover_listings(html: str) -> list[dict[str, str]]:
    """Return bounded UPSC advertisement records; fail closed on layout changes."""
    soup = BeautifulSoup(html, 'html.parser')
    rows = soup.select('.views-field-field-advertisement-number li')
    if not rows:
        raise ValueError('advertisement_rows_missing')

    listings = {}
    for row in rows:
        link = row.select_one('a[href]')
        url = official_pdf_url(link['href']) if link else None
        if url is None:
            continue
        link.extract()
        title = row.get_text(' ', strip=True)[:500]
        if not title.casefold().startswith('advertisement no.'):
            continue
        listings.setdefault(url, {
            'source': 'upsc', 'url': url, 'title': title, 'organization': ORGANIZATION,
        })
        if len(listings) >= MAX_LISTINGS:
            break
    if not listings:
        raise ValueError('advertisement_pdf_links_missing')
    return list(listings.values())
