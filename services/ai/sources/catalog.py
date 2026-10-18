"""Compatibility view of disabled entries; edit sources.json to manage sources."""

from source_registry import load_sources

DISABLED_SOURCES = {
    row['id']: {'listing_url': row['url'], 'kind': row['kind'], 'reason': row['reason']}
    for row in load_sources() if not row['enabled']
}
