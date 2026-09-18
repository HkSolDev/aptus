from pathlib import Path

import httpx
import pdfplumber

SSC_CGL_2026_PDF_URL = (
    "https://ssc.gov.in/api/attachment/uploads/masterData/"
    "NoticeBoards/Notice_of_adv_cgl_2026.pdf"
)

DOWNLOAD_DIR = Path(__file__).resolve().parents[2] / "downloads"
LOCAL_PDF_PATH = DOWNLOAD_DIR / "ssc-cgl-2026.pdf"


def fetch() -> str:
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

    if LOCAL_PDF_PATH.exists():
        pdf_bytes = LOCAL_PDF_PATH.read_bytes()
    else:
        response = httpx.get(SSC_CGL_2026_PDF_URL, follow_redirects=True)
        response.raise_for_status()
        pdf_bytes = response.content
        LOCAL_PDF_PATH.write_bytes(pdf_bytes)

    with pdfplumber.open(LOCAL_PDF_PATH) as pdf:
        pages = [page.extract_text() or "" for page in pdf.pages]

    return "\n".join(pages)
