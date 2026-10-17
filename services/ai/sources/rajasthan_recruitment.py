"""Offline discovery parser for Rajasthan's public vacancy cards.

The portal's public page exposes a JavaScript detail id, not a stable public
notice URL. This module is intentionally not registered for scheduled capture.
"""

import re

from bs4 import BeautifulSoup

LISTING_URL = 'https://recruitment.rajasthan.gov.in/'
DETAIL_ID = re.compile(r'\bpostDetailsClick\s*\(\s*(\d+)\s*\)')


def discover_listings(html: str) -> list[dict[str, str | None]]:
    """Return bounded vacancy cards without guessing a document URL."""
    soup = BeautifulSoup(html, 'html.parser')
    section = soup.select_one('.job-opening')
    if section is None:
        raise ValueError('vacancy_section_missing')

    jobs = {}
    for card in section.select('.job-card'):
        title_node = card.find('h6')
        detail_match = DETAIL_ID.search(title_node.get('onclick', '') if title_node else '')
        title = title_node.get_text(' ', strip=True)[:500] if title_node else ''
        if not title or detail_match is None:
            continue
        organization_node = card.select_one('.badge')
        deadline_node = card.find('small')
        detail_id = detail_match.group(1)
        jobs.setdefault(detail_id, {
            'source': 'rajasthan_recruitment',
            'listing_url': LISTING_URL,
            'detail_id': detail_id,
            'title': title,
            'organization': (
                organization_node.get_text(' ', strip=True)[:500]
                if organization_node else None
            ),
            'deadline': deadline_node.get_text(' ', strip=True)[:100] if deadline_node else None,
        })
        if len(jobs) >= 100:
            break
    return list(jobs.values())
