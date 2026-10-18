"""Load the operator-owned source list; fetching still enforces public destinations."""

import ipaddress
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

DEFAULT_SOURCES_PATH = Path(__file__).with_name('sources.json')


def load_sources(path=DEFAULT_SOURCES_PATH):
    rows = json.loads(Path(path).read_text(encoding='utf-8'))
    if not isinstance(rows, list) or len(rows) > 100:
        raise ValueError('source_registry_requires_at_most_100_entries')
    seen = set()
    for row in rows:
        if not isinstance(row, dict) or set(row) != {'id', 'url', 'enabled', 'kind', 'reason'}:
            raise ValueError('invalid_source_fields')
        source_id = row['id']
        if (not isinstance(source_id, str)
                or not re.fullmatch(r'[a-z][a-z0-9_]{0,63}', source_id)
                or source_id in seen):
            raise ValueError('invalid_or_duplicate_source_id')
        seen.add(source_id)
        if type(row['enabled']) is not bool or row['kind'] not in ('official', 'third_party'):
            raise ValueError('invalid_source_settings')
        if row['reason'] is not None and (not isinstance(row['reason'], str)
                                          or len(row['reason']) > 200):
            raise ValueError('invalid_source_reason')
        url = row['url']
        if not isinstance(url, str) or len(url) > 4096 or any(char.isspace() for char in url):
            raise ValueError('invalid_source_url')
        try:
            parts = urlsplit(url)
            if (parts.scheme not in ('http', 'https') or not parts.hostname
                    or parts.username is not None or parts.password is not None
                    or parts.fragment or parts.port not in (None, 80, 443)
                    or '.' not in parts.hostname):
                raise ValueError('invalid_source_url')
            try:
                address = ipaddress.ip_address(parts.hostname)
            except ValueError:
                address = None
            if address is not None and not address.is_global:
                raise ValueError('non_public_source_url')
        except ValueError:
            raise ValueError('invalid_source_url') from None
    return rows
