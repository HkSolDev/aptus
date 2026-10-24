"""Bounded listing readers for source-list feeds (RSS and SSC JSON); discovery only."""

import json
import xml.etree.ElementTree as ET
from urllib.parse import urlsplit

from link_discovery import url_identity
from sources.sarkariresult import is_recruitment_notice
from sources.ssc import official_attachment_url

MAX_LISTING_ITEMS = 100
MAX_EMITTED_DESTINATIONS = 100


def read_rss_feed(
    xml_content: bytes | str,
    base_url: str,
    *,
    source_id: str | None = None,
) -> dict:
    """Read a validated RSS feed and discover bounded recruitment notice destinations."""
    if not xml_content:
        raise ValueError("empty_rss_content")

    try:
        root = ET.fromstring(xml_content)
    except ET.ParseError as error:
        raise ValueError("invalid_rss_xml") from error

    tag = root.tag.rsplit("}", 1)[-1].lower()
    if tag != "rss":
        raise ValueError("rss_root_missing")

    channel = root.find("channel")
    if channel is None:
        for child in root:
            if child.tag.rsplit("}", 1)[-1].lower() == "channel":
                channel = child
                break
    if channel is None:
        raise ValueError("rss_channel_missing")

    all_items = [child for child in channel if child.tag.rsplit("}", 1)[-1].lower() == "item"]
    total_entries = len(all_items)
    truncated = total_entries > MAX_LISTING_ITEMS
    items_to_process = all_items[:MAX_LISTING_ITEMS]

    destinations = []
    seen_urls = set()
    skipped_entries = 0

    is_sarkari = (
        source_id == "sarkariresult"
        or "sarkariresult" in (urlsplit(base_url).hostname or "").lower()
    )

    for item in items_to_process:
        title_elem = None
        link_elem = None
        date_elem = None
        for child in item:
            ctag = child.tag.rsplit("}", 1)[-1].lower()
            if ctag == "title" and title_elem is None:
                title_elem = child
            elif ctag == "link" and link_elem is None:
                link_elem = child
            elif ctag in ("pubdate", "date") and date_elem is None:
                date_elem = child

        raw_title = (title_elem.text if title_elem is not None and title_elem.text else "").strip()
        raw_link = (link_elem.text if link_elem is not None and link_elem.text else "").strip()
        raw_date = (date_elem.text if date_elem is not None and date_elem.text else "").strip() or None

        if not raw_title or not raw_link:
            skipped_entries += 1
            continue

        resolved_url = url_identity(base_url, raw_link)
        if not resolved_url:
            skipped_entries += 1
            continue

        if is_sarkari:
            if not is_recruitment_notice(raw_title):
                continue
            parts = urlsplit(resolved_url)
            if parts.hostname != "www.sarkariresult.com":
                continue

        if resolved_url in seen_urls:
            continue

        if len(destinations) >= MAX_EMITTED_DESTINATIONS:
            truncated = True
            break

        seen_urls.add(resolved_url)
        destinations.append({
            "url": resolved_url,
            "title": " ".join(raw_title.split())[:500],
            "date": raw_date[:100] if raw_date else None,
            "parent_url": base_url,
        })

    return {
        "kind": "listing",
        "format": "rss",
        "parent_url": base_url,
        "destinations": destinations,
        "total_entries": total_entries,
        "skipped_entries": skipped_entries,
        "truncated": truncated,
    }


def read_ssc_json(
    json_content: bytes | str | dict,
    base_url: str,
    *,
    source_id: str | None = None,
) -> dict:
    """Read a validated SSC notice-board response and discover notice and corrigendum PDFs."""
    if isinstance(json_content, (bytes, str)):
        try:
            payload = json.loads(json_content)
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise ValueError("invalid_json") from error
    elif isinstance(json_content, dict):
        payload = json_content
    else:
        raise ValueError("unsupported_listing_format")

    if not isinstance(payload, dict):
        raise ValueError("unsupported_listing_format")

    if "statusCode" not in payload and "data" not in payload:
        raise ValueError("unsupported_listing_format")

    if str(payload.get("statusCode")) != "200":
        raise ValueError("invalid_ssc_response")

    records = payload.get("data")
    if not isinstance(records, list):
        raise ValueError("ssc_records_missing")

    total_entries = len(records)
    truncated = total_entries > MAX_LISTING_ITEMS
    records_to_process = records[:MAX_LISTING_ITEMS]

    destinations = []
    seen_urls = set()
    skipped_entries = 0

    for record_idx, record in enumerate(records_to_process):
        if not isinstance(record, dict):
            skipped_entries += 1
            continue

        headline = record.get("headline")
        if not isinstance(headline, str) or not headline.strip():
            skipped_entries += 1
            continue
        title = " ".join(headline.split())[:500]

        date = (
            record.get("createdAt")
            or record.get("startDate")
            or record.get("endDate")
        )
        if isinstance(date, str) and date.strip():
            date = date.strip()[:100]
        else:
            date = None

        attachments = record.get("attachments")
        if not isinstance(attachments, list):
            skipped_entries += 1
            continue

        for attach_idx, attachment in enumerate(attachments):
            if not isinstance(attachment, dict):
                skipped_entries += 1
                continue
            if attachment.get("type") != "application/pdf":
                continue
            path = attachment.get("path")
            url = official_attachment_url(path)
            if not url:
                skipped_entries += 1
                continue
            if url in seen_urls:
                continue
            seen_urls.add(url)
            destinations.append({
                "url": url,
                "title": title,
                "date": date,
                "parent_url": base_url,
            })
            if len(destinations) >= MAX_EMITTED_DESTINATIONS:
                has_more_attachments = (attach_idx + 1 < len(attachments))
                has_more_records = (record_idx + 1 < len(records_to_process))
                if has_more_attachments or has_more_records:
                    truncated = True
                break

        if len(destinations) >= MAX_EMITTED_DESTINATIONS:
            break

    return {
        "kind": "listing",
        "format": "ssc_json",
        "parent_url": base_url,
        "destinations": destinations,
        "total_entries": total_entries,
        "skipped_entries": skipped_entries,
        "truncated": truncated,
    }


def read_listing(
    body: bytes | str,
    final_url: str,
    *,
    content_type: str = "",
    document_kind: str = "",
    source_id: str | None = None,
) -> dict:
    """Dispatch captured listing content to the appropriate format adapter."""
    ctype = (content_type or "").lower()
    dkind = (document_kind or "").lower()

    if dkind == "xml" or "xml" in ctype or (isinstance(body, (bytes, str)) and (
        body.startswith(b"<?xml") if isinstance(body, bytes) else body.startswith("<?xml")
        or (body.lstrip().startswith(b"<rss") if isinstance(body, bytes) else body.lstrip().startswith("<rss"))
    )):
        return read_rss_feed(body, final_url, source_id=source_id)

    if dkind == "json" or "json" in ctype or source_id == "ssc":
        return read_ssc_json(body, final_url, source_id=source_id)

    raise ValueError("unsupported_listing_format")
