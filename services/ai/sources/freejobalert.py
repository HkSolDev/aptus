"""Discovery for the two approved listing sections; no eligibility inference."""

from datetime import date, datetime
from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup

SOURCES = {
    'ssc': ('https://www.freejobalert.com/government-jobs/', 'SSC'),
    'rajasthan': ('https://www.freejobalert.com/rajasthan-government-jobs/',
                  'Latest Government Jobs in Rajasthan'),
}


def discover(html, source, today=None):
    page_url, label = SOURCES[source]
    today = today or date.today()
    soup = BeautifulSoup(html, 'html.parser')
    heading = soup.find(lambda node: node.name in {'h2', 'h3', 'h4'}
                        and node.get_text(' ', strip=True) == label)
    if heading is None:
        raise ValueError('listing_heading_missing')
    table = heading.find_next(['table', 'h2', 'h3', 'h4'])
    if table is None or table.name != 'table':
        raise ValueError('listing_table_missing')
    rows = table.find_all('tr')
    headers = [cell.get_text(' ', strip=True) for cell in rows[0].find_all(['th', 'td'])]
    title_column = 'Exam / Post Name' if source == 'ssc' else 'Job Title'
    if title_column not in headers or 'Last Date' not in headers:
        raise ValueError('listing_columns_changed')
    jobs = {}
    for row in rows[1:]:
        cells = row.find_all(['td', 'th'], recursive=False)
        if len(cells) != len(headers):
            continue
        deadline = cells[headers.index('Last Date')].get_text(' ', strip=True)
        try:
            if datetime.strptime(deadline, '%d-%m-%Y').date() < today:
                continue
        except ValueError:
            pass  # An unclear deadline remains unknown until source review.
        title = cells[headers.index(title_column)].get_text(' ', strip=True)[:500]
        for anchor in row.find_all('a', href=True):
            url = urljoin(page_url, anchor['href'])
            try:
                parts = urlsplit(url)
                port = parts.port
            except ValueError:
                continue
            if (parts.scheme == 'https' and parts.hostname == 'www.freejobalert.com'
                    and port in {None, 443} and not parts.username
                    and not parts.password and not parts.query and not parts.fragment
                    and parts.path.startswith('/articles/')):
                jobs.setdefault(url, {'url': url, 'title': title, 'source': source})
        if len(jobs) >= 100:
            break
    return list(jobs.values())
