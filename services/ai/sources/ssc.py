"""Discover original recruitment-notice PDFs from SSC's public notice API."""

from urllib.parse import quote, urlsplit

NOTICE_BOARD_URL = (
    'https://ssc.gov.in/api/general-website/portal/notice-boards?'
    'page=1&limit=100&key=createdAt&order=DESC&isPaginationRequired=true&'
    'isAttachment=true&language=english&'
    'attributes=id,headline,examId,contentType,startDate,endDate,language,createdAt'
)
ATTACHMENT_ROOT = 'https://ssc.gov.in/api/attachment/'
MAX_LISTINGS = 100
RECRUITMENT_SIGNALS = ('notification', 'recruitment', 'advertisement', 'inviting applications')
EXCLUDED_SIGNALS = (
    'admit card', 'answer key', 'result', 'marks', 'response sheet', 'schedule',
    'tentative vacancy', 'vacancies of', 'cancellation', 'corrigendum', 'addendum',
    'city of examination', 'shortlisting', 'allocation', 'recommended candidates',
)


def official_attachment_url(path: object) -> str | None:
    """Build a direct SSC attachment URL only from a safe relative PDF path."""
    if not isinstance(path, str) or not path.strip():
        return None
    normalized = path.replace('\\', '/').lstrip('/')
    if '..' in normalized.split('/') or not normalized.lower().endswith('.pdf'):
        return None
    url = ATTACHMENT_ROOT + quote(normalized, safe='/')
    parts = urlsplit(url)
    return url if parts.scheme == 'https' and parts.hostname == 'ssc.gov.in' else None


def recruitment_notice(title: str) -> bool:
    lowered = title.casefold()
    return (any(signal in lowered for signal in RECRUITMENT_SIGNALS)
            and not any(signal in lowered for signal in EXCLUDED_SIGNALS))


def discover_listings(payload: object) -> list[dict[str, str]]:
    """Return bounded, original recruitment notices with official PDF documents."""
    if not isinstance(payload, dict) or payload.get('statusCode') != '200':
        raise ValueError('notice_api_response_invalid')
    records = payload.get('data')
    if not isinstance(records, list):
        raise ValueError('notice_records_missing')

    notices = {}
    for record in records:
        if not isinstance(record, dict):
            continue
        title = record.get('headline')
        if not isinstance(title, str):
            continue
        title = ' '.join(title.split())[:500]
        if not recruitment_notice(title):
            continue
        attachments = record.get('attachments')
        if not isinstance(attachments, list):
            continue
        for attachment in attachments:
            if not isinstance(attachment, dict) or attachment.get('type') != 'application/pdf':
                continue
            url = official_attachment_url(attachment.get('path'))
            if url is None:
                continue
            notices.setdefault(url, {'source': 'ssc', 'url': url, 'title': title})
            if len(notices) >= MAX_LISTINGS:
                return list(notices.values())
    return list(notices.values())
