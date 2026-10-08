import unittest

from select_pdf_sections import complete_pdf_sections, select_pdf_sections


def document(*texts):
    return {"format": "pdf", "source_url": "https://example.gov.in/notice.pdf",
        "warnings": [], "pages": [{"number": n, "native_status": "usable_candidate"}
                                   for n in range(1, len(texts) + 1)],
        "blocks": [{"id": f"page-{n}-native", "page": n, "bbox": [0, 0, 600, 800],
            "alternatives": [{"method": "native_text", "status": "candidate", "text": text}]}
            for n, text in enumerate(texts, 1)]}


class PdfSelectionTests(unittest.TestCase):
    def test_header_survives_topic_selection_and_page_restoration(self):
        source = document("CRP RRBs XV\nIBPS\nRecruitment notice\nAGE LIMIT\nMaximum age 30 years.")
        selected = select_pdf_sections(source)
        context = selected["identity_context"]
        self.assertTrue(context["text"].startswith("CRP RRBs XV"))
        self.assertEqual(context["evidence"][0]["page"], 1)
        self.assertEqual(context["evidence"][0]["line_range"], [1, 5])
        self.assertEqual(complete_pdf_sections(selected, source)["identity_context"], context)

    def test_unreadable_header_is_not_promoted_to_identity(self):
        source = document("CRP RRBs XV\nIBPS", "AGE LIMIT\nMaximum age 30 years.")
        source["pages"][0]["native_status"] = "suspicious_or_unusable"
        self.assertIsNone(select_pdf_sections(source)["identity_context"])

    def test_contents_is_indexed_but_is_not_evidence(self):
        result = select_pdf_sections(document("TABLE OF CONTENTS\nAGE LIMIT 12", "AGE LIMIT\nMinimum age 18 years"))
        self.assertEqual(result["coverage"]["pages_indexed"], 2)
        self.assertEqual(result["sections"][0]["page_range"], [2, 2])

    def test_continuation_keeps_post_scope_and_footnote(self):
        result = select_pdf_sections(document(
            "EDUCATIONAL QUALIFICATIONS\nFor Officer Scale II only\nDegree in law",
            "Two years experience required.\nNote: certificate required at interview.\nVENUES\nNew Delhi"))
        unit = next(item for item in result["sections"] if "Two years" in item["text"])
        self.assertIn("For Officer Scale II only", unit["text"])
        self.assertIn("certificate required", unit["text"])
        self.assertEqual(unit["page_range"], [1, 2])
        self.assertEqual(unit["evidence"][1]["page"], 2)

    def test_split_heading_and_reference_remain_visible(self):
        result = select_pdf_sections(document("EDUCATIONAL\nQUALIFICATIONS\nSee Annexure II.\nBachelor degree required."))
        self.assertIn("EDUCATIONAL\nQUALIFICATIONS", result["sections"][0]["text"])
        self.assertTrue(result["coverage"]["unresolved_references"])
        self.assertEqual(result["status"], "candidate_requires_review")

    def test_budget_omits_whole_section_and_reports_it(self):
        result = select_pdf_sections(document("AGE LIMIT\nMinimum age 18 years"), max_characters=10)
        self.assertEqual(result["sections"], [])
        self.assertEqual(result["status"], "budget_exceeded")
        self.assertTrue(result["coverage"]["omitted_sections"])

    def test_rejected_page_is_not_selected(self):
        doc = document("AGE LIMIT\nMinimum age 18 years")
        doc["pages"][0]["native_status"] = "suspicious_or_unusable"
        result = select_pdf_sections(doc)
        self.assertFalse(result["sections"])
        self.assertEqual(result["coverage"]["unreadable_pages"], [1])

    def test_amendment_and_empty_document_report_review(self):
        result = select_pdf_sections(document("CORRIGENDUM\nRead as 21 September instead of 20 September."))
        self.assertIn("amendment_scope_requires_review", result["sections"][0]["warnings"])
        self.assertEqual(len(select_pdf_sections(document())["coverage"]["missing_topics"]), 6)
        with self.assertRaises(ValueError):
            select_pdf_sections(document(), max_characters=True)


if __name__ == "__main__":
    unittest.main()
