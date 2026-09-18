from pathlib import Path

import httpx
import pdfplumber


def fetch_pdf_text(url: str, cache_path: Path) -> str:
    cache_path.parent.mkdir(parents=True, exist_ok=True)

    if cache_path.exists():
        pdf_bytes = cache_path.read_bytes()
    else:
        response = httpx.get(url, follow_redirects=True)
        response.raise_for_status()
        pdf_bytes = response.content
        cache_path.write_bytes(pdf_bytes)

    with pdfplumber.open(cache_path) as pdf:
        pages = [page.extract_text() or "" for page in pdf.pages]

    return "\n".join(pages)
