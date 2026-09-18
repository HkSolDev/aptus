from pathlib import Path

from pdf_source import fetch_pdf_text

SSC_CGL_2026_PDF_URL = (
    "https://ssc.gov.in/api/attachment/uploads/masterData/"
    "NoticeBoards/Notice_of_adv_cgl_2026.pdf"
)

DOWNLOAD_DIR = Path(__file__).resolve().parents[2] / "downloads"
LOCAL_PDF_PATH = DOWNLOAD_DIR / "ssc-cgl-2026.pdf"


def fetch() -> str:
    return fetch_pdf_text(SSC_CGL_2026_PDF_URL, LOCAL_PDF_PATH)
