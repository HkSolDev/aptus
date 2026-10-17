"""Discover current UPPSC recruitment advertisements from its public table."""

from urllib.parse import parse_qs, urljoin, urlsplit

from bs4 import BeautifulSoup

LISTING_URL = 'https://uppsc.up.nic.in/CandidatePages/Notifications.aspx'
MAX_LISTINGS = 100


def official_advertisement_url(value: str) -> str | None:
    """Accept UPPSC's public advertisement-detail route only."""
    url = urljoin(LISTING_URL, value)
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        return None
    if (
        parts.scheme != 'https' or parts.hostname != 'uppsc.up.nic.in'
        or port not in {None, 443} or parts.username or parts.password
        or parts.path != '/OuterPages/View_Advertisement.aspx'
        or set(parse_qs(parts.query)) - {'ID', 'flag'} or not parse_qs(parts.query).get('ID')
    ):
        return None
    return url


def cell_text(row, suffix: str) -> str:
    node = row.select_one(f'[id$="{suffix}"]')
    return ' '.join(node.get_text(' ', strip=True).split())[:500] if node else ''


def discover_listings(html: str) -> list[dict[str, str]]:
    """Return current public UPPSC advertisement-detail records."""
    soup = BeautifulSoup(html, 'html.parser')
    table = soup.select_one('#ctl00_MainContent_GridView1')
    if table is None:
        raise ValueError('notification_table_missing')
    records = {}
    for row in table.select('tr'):
        link = next((item for item in row.select('a[href]')
                     if 'View Advertisement' in item.get_text(' ', strip=True)), None)
        url = official_advertisement_url(link['href']) if link else None
        number = cell_text(row, 'Lbl_Adv_number')
        exam = cell_text(row, 'Lbl_Exam_Name')
        deadline = cell_text(row, 'Lbl_ApplicationFormRegistration_LastDate')
        if not url or not number:
            continue
        records.setdefault(url, {
            'source': 'uppsc', 'url': url,
            'title': f'{exam or "UPPSC Recruitment"} — Advertisement {number}',
            'deadline': deadline or None,
        })
        if len(records) >= MAX_LISTINGS:
            break
    if not records:
        raise ValueError('advertisement_links_missing')
    return list(records.values())
