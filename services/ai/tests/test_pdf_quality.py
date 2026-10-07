import unittest

from normalize_pdf import native_quality, normalize_pdf


class PdfQualityTests(unittest.TestCase):
    def test_real_minimal_pdf_preserves_native_candidate_and_geometry(self):
        stream = b"BT /F1 12 Tf 50 200 Td (Recruitment 120 posts) Tj ET"
        objects = [b"<< /Type /Catalog /Pages 2 0 R >>",
            b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
            b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream"]
        body, offsets = b"%PDF-1.4\n", [0]
        for number, obj in enumerate(objects, 1):
            offsets.append(len(body))
            body += str(number).encode() + b" 0 obj\n" + obj + b"\nendobj\n"
        xref = len(body)
        body += b"xref\n0 6\n0000000000 65535 f \n"
        for offset in offsets[1:]:
            body += f"{offset:010} 00000 n \n".encode()
        body += b"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + str(xref).encode() + b"\n%%EOF"
        doc = normalize_pdf(body, "https://example.gov.in/notice.pdf")
        self.assertEqual(doc["pages"][0]["native_status"], "usable_candidate")
        self.assertIsNone(doc["blocks"][0]["text"])
        self.assertEqual(doc["blocks"][0]["alternatives"][0]["text"], "Recruitment 120 posts")
        self.assertEqual(doc["blocks"][0]["bbox"], [0, 0, 300, 300])
        self.assertTrue(doc["blocks"][0]["alternatives"][0]["words"])

    def test_devlys_ascii_is_rejected_but_unicode_hindi_is_not(self):
        self.assertEqual(native_quality([{"text": "jktLFkku", "fontname": "ABC+DevLys 010"}], 0)[0],
                         "suspicious_or_unusable")
        self.assertEqual(native_quality([{"text": "राजस्थान", "fontname": "DevLys"}], 0)[0],
                         "usable_candidate")

    def test_english_is_not_rejected_merely_for_being_ascii(self):
        self.assertEqual(native_quality([{"text": "Recruitment 120 posts", "fontname": "Arial"}], 0)[0],
                         "usable_candidate")

    def test_missing_text_and_unmapped_characters(self):
        self.assertEqual(native_quality([], 1)[0], "image_only_or_scan_candidate")
        self.assertEqual(native_quality([], 0)[0], "no_native_text")
        self.assertEqual(native_quality([{"text": "(cid:12)", "fontname": "Arial"}], 0)[0],
                         "suspicious_or_unusable")

    def test_bad_document_and_limits(self):
        with self.assertRaises(ValueError):
            normalize_pdf(b"HTML", "https://example.gov.in")
        with self.assertRaises(ValueError):
            normalize_pdf(b"%PDF-1.4", "https://example.gov.in", max_pages=0)
        self.assertIn("invalid_pdf", normalize_pdf(b"%PDF-1.4 broken", "https://example.gov.in")["warnings"])


if __name__ == "__main__":
    unittest.main()
