"""Bounded offline PDF diagnostics; unreadable native text stays unselected."""

from collections import Counter
from io import BytesIO

import pdfplumber
from pdfminer.pdfdocument import PDFPasswordIncorrect
from pdfminer.pdfparser import PDFSyntaxError
from pdfplumber.utils.exceptions import PdfminerException

from normalize_html import clean_text, http_url


def native_quality(chars, image_count):
    text = "".join(char["text"] for char in chars)
    if not text.strip():
        reason = "image_only_or_scan_candidate" if image_count else "no_native_text"
        return reason, [reason]
    legacy = [char for char in chars if any(name in char.get("fontname", "").casefold()
              for name in ("devlys", "krutidev", "kruti dev"))]
    if legacy and not any("\u0900" <= letter <= "\u097f"
                          for char in legacy for letter in char["text"]):
        return "suspicious_or_unusable", ["legacy_font_mapping_suspected",
                                           "native_text_not_usable"]
    if "\ufffd" in text or "(cid:" in text:
        return "suspicious_or_unusable", ["unmapped_characters", "native_text_not_usable"]
    return "usable_candidate", ["native_text_requires_review"]


def normalize_pdf(body: bytes, final_url: str, *, max_pages=30) -> dict:
    """Expose native alternatives/geometry. No OCR, converter, or job interpretation."""
    if not isinstance(body, bytes):
        raise TypeError("PDF must be captured bytes")
    if len(body) > 20 * 1024 * 1024 or not body.startswith(b"%PDF-"):
        raise ValueError("Invalid or oversized PDF")
    if not isinstance(final_url, str) or not http_url(final_url, ""):
        raise ValueError("final_url must be an absolute HTTP(S) URL")
    if not isinstance(max_pages, int) or not 1 <= max_pages <= 100:
        raise ValueError("max_pages must be between 1 and 100")
    result = {"format": "pdf", "source_url": final_url,
              "normalizer_version": "pdf-diagnostics-v1",
              "coordinate_system": "top-left-page-points",
              "pages": [], "blocks": [], "links": [], "warnings": []}
    try:
        with pdfplumber.open(BytesIO(body)) as pdf:
            if len(pdf.pages) > max_pages:
                result["warnings"] = ["page_limit_exceeded", "manual_review"]
                return result
            for number, page in enumerate(pdf.pages, 1):
                if len(page.chars) > 200_000:
                    result["warnings"].append(f"page_{number}_character_limit_exceeded")
                    result["pages"].append({"number": number,
                        "resolution_status": "manual_review", "warnings": ["character_limit_exceeded"]})
                    continue
                status, warnings = native_quality(page.chars, len(page.images))
                usable = status == "usable_candidate"
                words = page.extract_words()
                native = clean_text(page.extract_text() or "")
                tables = page.find_tables()
                if tables:
                    warnings.append("table_structure_requires_review")
                block_id = f"page-{number}-native"
                result["pages"].append({"number": number, "width": page.width,
                    "height": page.height, "rotation": page.rotation,
                    "native_status": status, "resolution_status": "manual_review",
                    "character_count": len(page.chars), "image_count": len(page.images),
                    "fonts": dict(Counter(char["fontname"] for char in page.chars)),
                    "block_ids": [block_id], "warnings": warnings})
                # Text is an alternative, never silently promoted to validated content.
                result["blocks"].append({"id": block_id, "type": "unclassified",
                    "page": number, "bbox": list(page.bbox), "text": None,
                    "method": None, "selected_alternative_id": None,
                    "alternatives": [{"id": f"{block_id}-a1", "method": "native_text",
                        "status": "candidate" if usable else "rejected", "text": native,
                        "words": [{"text": word["text"], "bbox": [word["x0"], word["top"],
                                   word["x1"], word["bottom"]]} for word in words]}],
                    "tables": [{"bbox": list(table.bbox),
                                "cells": [list(cell) for cell in table.cells],
                                "status": "geometry_only_requires_review"} for table in tables],
                    "warnings": warnings})
                for link in page.hyperlinks:
                    url = http_url(link.get("uri") or "", final_url) if link.get("uri") else None
                    if url:
                        result["links"].append({"url": url, "page": number,
                            "bbox": [link["x0"], link["top"], link["x1"], link["bottom"]]})
                result["warnings"].append(f"page_{number}_requires_review" if usable
                                          else f"page_{number}_requires_fallback")
    except PDFPasswordIncorrect:
        result["warnings"] = ["encrypted_or_unsupported", "password_required"]
    except PdfminerException as error:
        password_required = bool(error.args and isinstance(error.args[0], PDFPasswordIncorrect))
        result["warnings"] = (["encrypted_or_unsupported", "password_required"]
                              if password_required else ["invalid_pdf", "manual_review"])
    except (PDFSyntaxError, ValueError, EOFError):
        result["warnings"] = ["invalid_pdf", "manual_review"]
    return result
