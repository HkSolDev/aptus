import unittest

from select_pdf_sections import select_pdf_sections


def normalized_pdf(*pages):
    """Build small normalized-PDF fixtures without involving PDF extraction."""
    return {
        "format": "pdf",
        "source_url": "https://example.gov.in/recruitment/notice.pdf",
        "warnings": [],
        "pages": [
            {"number": number, "native_status": status}
            for number, (_, status) in enumerate(pages, 1)
        ],
        "blocks": [
            {
                "id": f"page-{number}-native",
                "page": number,
                "bbox": [0, 0, 595, 842],
                "alternatives": [
                    {
                        "method": "native_text",
                        "status": "candidate",
                        "text": text,
                    }
                ],
            }
            for number, (text, _) in enumerate(pages, 1)
        ],
    }


def usable(text):
    return text, "usable_candidate"


def selected_text(result):
    return "\n".join(section["text"] for section in result["sections"])


class PdfSelectionIndependentTests(unittest.TestCase):
    def test_qualification_rows_and_officer_scope_are_selected_together(self):
        """A qualification without its post-specific scope can produce a false match."""
        document = normalized_pdf(usable("""
            EDUCATIONAL QUALIFICATIONS
            Officer Scale II only
            Post                         Essential qualification
            Law Officer                  Bachelor Degree in Law from a recognised university
            IT Officer                   B.E. / B.Tech in Computer Science
            Experience: two years after qualification is required.
        """))

        result = select_pdf_sections(document)
        text = selected_text(result)

        self.assertIn("EDUCATIONAL QUALIFICATIONS", text)
        self.assertIn("Officer Scale II only", text)
        self.assertIn("Bachelor Degree in Law from a recognised university", text)
        self.assertIn("B.E. / B.Tech in Computer Science", text)
        self.assertIn("two years after qualification", text)

    def test_continuation_page_keeps_qualification_exception_and_note(self):
        """A page break must not detach a condition from the qualification it limits."""
        document = normalized_pdf(
            usable("""
                EDUCATIONAL QUALIFICATIONS
                Officer Scale II only
                Chartered Accountant or MBA (Finance) from a recognised university.
            """),
            usable("""
                Continued
                Exception: candidates with an integrated MBA must have two years experience.
                Note: qualification must be complete on the last date of online registration.
            """),
        )

        result = select_pdf_sections(document)
        section = next(
            item
            for item in result["sections"]
            if "integrated MBA" in item["text"]
        )

        self.assertEqual(section["page_range"], [1, 2])
        self.assertIn("Officer Scale II only", section["text"])
        self.assertIn("integrated MBA", section["text"])
        self.assertIn("qualification must be complete", section["text"])
        self.assertEqual([evidence["page"] for evidence in section["evidence"]], [1, 2])

    def test_next_page_table_note_stays_with_related_vacancy_section(self):
        """Reservation notes below a table change how vacancy rows are interpreted."""
        document = normalized_pdf(
            usable("""
                VACANCY DETAILS
                Post                         UR      SC      ST
                Assistant Engineer           48      12      06
            """),
            usable("""
                Note: the above vacancies are tentative and may vary.
                Reservation for Persons with Benchmark Disabilities applies as per Government rules.
            """),
        )

        result = select_pdf_sections(document)
        section = next(
            item
            for item in result["sections"]
            if "Assistant Engineer" in item["text"]
        )

        self.assertEqual(section["page_range"], [1, 2])
        self.assertIn("48", section["text"])
        self.assertIn("vacancies are tentative", section["text"])
        self.assertIn("Persons with Benchmark Disabilities", section["text"])

    def test_contents_page_is_locator_only_and_never_llm_evidence(self):
        """Contents headings are pointers, not the source facts a model may infer from."""
        document = normalized_pdf(
            usable("""
                TABLE OF CONTENTS
                Age Limit ........................................ 12
                Vacancy Details ................................. 18
                Educational Qualifications ...................... 25
            """),
            usable("""
                AGE LIMIT
                Minimum age is 21 years and maximum age is 30 years as on 1 August 2026.
            """),
        )

        result = select_pdf_sections(document)

        self.assertEqual(result["coverage"]["pages_indexed"], 2)
        self.assertNotIn("TABLE OF CONTENTS", selected_text(result))
        self.assertTrue(result["sections"])
        for section in result["sections"]:
            self.assertNotIn(1, [evidence["page"] for evidence in section["evidence"]])

    def test_unusable_page_is_reported_but_not_treated_as_readable_evidence(self):
        """Garbage native text must trigger review rather than become an eligibility fact."""
        document = normalized_pdf(
            ("AGE LIMIT\nMaximum age is 32 years.", "suspicious_or_unusable"),
            usable("EDUCATIONAL QUALIFICATIONS\nBachelor degree from a recognised university."),
        )

        result = select_pdf_sections(document)

        self.assertEqual(result["coverage"]["unreadable_pages"], [1])
        self.assertNotIn("Maximum age is 32 years", selected_text(result))
        self.assertIn("Bachelor degree", selected_text(result))

    def test_appendix_and_annexure_references_remain_explicitly_unresolved(self):
        """Cross-references cannot be silently treated as fully captured rules."""
        document = normalized_pdf(usable("""
            EDUCATIONAL QUALIFICATIONS
            See Appendix II for the post-wise qualification matrix.
            Refer to Annexure I for category-wise relaxation.
        """))

        result = select_pdf_sections(document)
        unresolved = "\n".join(str(item) for item in result["coverage"]["unresolved_references"])

        self.assertIn("Appendix II", unresolved)
        self.assertIn("Annexure I", unresolved)
        self.assertNotEqual(result["status"], "complete")

    def test_budget_omits_a_whole_section_instead_of_cutting_a_rule(self):
        """A truncated qualification changes its meaning and must never reach the LLM."""
        document = normalized_pdf(usable("""
            EDUCATIONAL QUALIFICATIONS
            Bachelor degree from a recognised university is essential for every post.
            For Law Officer, Bachelor Degree in Law and two years advocacy experience are essential.
            Candidates awaiting final results are not eligible.
        """))

        result = select_pdf_sections(document, max_characters=20)

        self.assertEqual(result["sections"], [])
        self.assertTrue(result["coverage"]["omitted_sections"])

    def test_corrigendum_is_selected_and_flagged_for_scope_review(self):
        """Amendments can override an otherwise correct deadline or age rule."""
        document = normalized_pdf(usable("""
            CORRIGENDUM / ADDENDUM
            In paragraph 4, read maximum age as 32 years instead of 30 years.
            The last date for online application is extended to 21 September 2026.
        """))

        result = select_pdf_sections(document)
        section = next(item for item in result["sections"] if "CORRIGENDUM" in item["text"])

        self.assertIn("maximum age as 32 years", section["text"])
        self.assertIn("extended to 21 September 2026", section["text"])
        self.assertIn("amendment_scope_requires_review", section["warnings"])

    def test_complete_rule_document_reports_no_missing_topics(self):
        """Coverage is trustworthy only when every core recruitment topic is represented."""
        document = normalized_pdf(
            usable("AGE LIMIT\nMinimum age 21 years; maximum age 30 years."),
            usable("EDUCATIONAL QUALIFICATIONS\nGraduate degree from a recognised university."),
            usable("VACANCY DETAILS\nAssistant Engineer: 120 posts."),
            usable("RESERVATION\nSC, ST, OBC and EWS reservation applies as per rules."),
            usable("IMPORTANT DATES\nLast date: 31 October 2026."),
            usable("APPLICATION FEE\nGeneral: Rs. 100. SC/ST: Nil."),
        )

        result = select_pdf_sections(document)

        self.assertEqual(result["coverage"]["missing_topics"], [])

    def test_vague_heading_with_strong_rule_phrase_is_not_lost(self):
        """Some notices hide core eligibility rules under generic administrative headings."""
        document = normalized_pdf(usable("""
            OTHER CONDITIONS
            The maximum age shall not exceed 35 years on the closing date.
            A degree from a recognised university is mandatory for all applicants.
        """))

        result = select_pdf_sections(document)
        text = selected_text(result)

        self.assertIn("OTHER CONDITIONS", text)
        self.assertIn("maximum age shall not exceed 35 years", text)
        self.assertIn("recognised university", text)

    def test_repeated_table_headers_do_not_hide_following_data_rows(self):
        """Multi-page tables repeat headers, but the later vacancy rows remain evidence."""
        document = normalized_pdf(
            usable("""
                VACANCY DETAILS
                Post Name                     UR      SC
                Assistant Engineer             40      10
            """),
            usable("""
                Post Name                     UR      SC
                Junior Engineer                60      15
                Technical Assistant            20      05
            """),
        )

        result = select_pdf_sections(document)
        text = selected_text(result)

        self.assertIn("Assistant Engineer             40      10", text)
        self.assertIn("Junior Engineer                60      15", text)
        self.assertIn("Technical Assistant            20      05", text)

    def test_empty_invalid_and_invalid_budget_documents_fail_or_report_safely(self):
        """Bad inputs must not be misrepresented as complete rule coverage."""
        empty_result = select_pdf_sections(normalized_pdf())
        self.assertEqual(empty_result["sections"], [])
        self.assertTrue(empty_result["coverage"]["missing_topics"])

        invalid_document = normalized_pdf(usable("AGE LIMIT\nMaximum age 30 years."))
        invalid_document["format"] = "html"
        with self.assertRaises(ValueError):
            select_pdf_sections(invalid_document)

        for invalid_budget in (0, -1, True, "120000"):
            with self.subTest(invalid_budget=invalid_budget):
                with self.assertRaises(ValueError):
                    select_pdf_sections(normalized_pdf(), max_characters=invalid_budget)


if __name__ == "__main__":
    unittest.main()
