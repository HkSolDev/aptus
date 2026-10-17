"""Discover original JKSSB recruitment-advertisement PDFs."""

from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup

LISTING_URL = 'https://jkssb.nic.in/Advertisement.html'
ORGANIZATION = 'Jammu and Kashmir Services Selection Board'
MAX_LISTINGS = 100


def official_pdf_url(value: str) -> str | None:
    """Accept a direct PDF from JKSSB's public PDF directory only."""
    url = urljoin(LISTING_URL, value)
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        return None
    if (
        parts.scheme != 'https' or parts.hostname != 'jkssb.nic.in'
        or port not in {None, 443} or parts.username or parts.password
        or parts.query or parts.fragment or not parts.path.startswith('/Pdf/')
        or not parts.path.lower().endswith('.pdf')
    ):
        return None
    return url


def discover_listings(html: str) -> list[dict[str, str]]:
    """Return bounded original advertisement PDFs from JKSSB's public page."""
    soup = BeautifulSoup(html, 'html.parser')
    heading = next((node for node in soup.find_all('h1')
                    if node.get_text(' ', strip=True).casefold() == 'advertisement'), None)
    if heading is None:
        raise ValueError('advertisement_heading_missing')
    container = heading.find_parent('div', class_='wrapper-content')
    table = container.select_one('table') if container else None
    if table is None:
        raise ValueError('advertisement_table_missing')

    listings = {}
    for link in table.select('tbody a[href]'):
        url = official_pdf_url(link['href'])
        title = ' '.join(link.get_text(' ', strip=True).split())[:500]
        if not url or not title or not title.casefold().startswith(('advt.', 'advertisement', '0')):
            continue
        listings.setdefault(url, {
            'source': 'jkssb', 'url': url, 'title': f'JKSSB Advertisement {title}',
            'organization': ORGANIZATION,
        })
        if len(listings) >= MAX_LISTINGS:
            break
    if not listings:
        raise ValueError('advertisement_pdf_links_missing')
    return list(listings.values())
