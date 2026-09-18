from pathlib import Path

from pdf_source import fetch_pdf_text

IBPS_RRB_XV_PDF_URL = (
    "https://www.ibps.in/wp-content/uploads/CRP-RRBs-XV-notification.pdf"
)

DOWNLOAD_DIR = Path(__file__).resolve().parents[2] / "downloads"
LOCAL_PDF_PATH = DOWNLOAD_DIR / "ibps-rrb-xv.pdf"


def fetch() -> str:
    return fetch_pdf_text(IBPS_RRB_XV_PDF_URL, LOCAL_PDF_PATH)
