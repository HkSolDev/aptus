"""Focused unit tests for bounded Gemini Vision recovery."""

import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

from build_extraction_input import prepare_extraction
from verify_bundle import verify_bundles
from vision_recovery import recover_unreadable_pdf_pages


SUMMARY_URL = "https://upessc.example.gov.in/notices/headmaster-09-2026.html"
PDF_URL = "https://upessc.example.gov.in/notices/headmaster-09-2026.pdf"
FAKE_PDF_BYTES = b"%PDF-1.4\n%fake-canonical-pdf-bytes\n"
FAKE_PNG_BYTES = b"\x89PNG\r\n\x1a\nfake-rendered-page-6"
ORIGINAL_MOJIBAKE = "6-(d) vk;q lhek %& iz/kkuk/;kid in dh U;wure vk;q"


def make_bundle(*, readable_pdf: bool = False) -> dict:
    html_doc = {
        "document_id": "summary-html",
        "source_url": SUMMARY_URL,
        "format": "html",
        "content": {
            "title": "UPESSC Headmaster Recruitment Notification",
            "blocks": [
                {
                    "type": "paragraph",
                    "text": (
                        "Issuer: UPESSC\nAdvertisement No: 09/2026\nRecruitment Year: 2026\n"
                        "Post: Headmaster (Balak) | Vacancies: 1037 | Experience: 4 Years"
                    ),
                }
            ],
            "links": [{"url": PDF_URL, "text": "Download Official Notification PDF"}],
        },
    }
    pdf_content = {
        "source_url": PDF_URL,
        "pages": [
            {
                "number": 6,
                "native_status": "usable_candidate" if readable_pdf else "suspicious_or_unusable",
            }
        ],
        "blocks": [
            {
                "id": "page-6-native",
                "type": "unclassified",
                "page": 6,
                "alternatives": [
                    {
                        "id": "page-6-native-a1",
                        "method": "native_text",
                        "status": "candidate" if readable_pdf else "rejected",
                        "text": (
                            "Minimum age 30 years as on 01 July 2026."
                            if readable_pdf
                            else ORIGINAL_MOJIBAKE
                        ),
                    }
                ],
            }
        ],
        "sections": (
            [
                {
                    "id": "sec-6",
                    "text": "Minimum age 30 years as on 01 July 2026.",
                    "evidence": [{"page": 6, "block_id": "page-6-native", "line_range": [1, 1]}],
                }
            ]
            if readable_pdf
            else []
        ),
        "coverage": {"unreadable_pages": [] if readable_pdf else [6]},
    }
    pdf_doc = {
        "document_id": "official-pdf",
        "source_url": PDF_URL,
        "format": "pdf",
        "content": pdf_content,
    }
    return verify_bundles(
        [html_doc, pdf_doc],
        issuer_hosts={"UPESSC": ["upessc.example.gov.in"]},
    )["bundles"][0]


def valid_vision_payload(*, page: int = 6) -> dict:
    page_text = (
        "6.(ख) आयु सीमा :- प्रधानाध्यापक पद की न्यूनतम आयु दिनांक 01 जुलाई, 2026 को 30 वर्ष निर्धारित है। "
        "(तीन) केन्द्र/राज्य सरकार द्वारा मान्यता प्राप्त संस्था की उच्चतर कक्षाओं (कक्षा 9 से 12) में प्रवक्ता "
        "अथवा सहायक अध्यापक के पद पर कम से कम 4 वर्ष का शिक्षण अनुभव अथवा "
        "जूनियर हाईस्कूल में प्रधानाध्यापक के पद पर कम से कम 4 वर्ष का कार्यानुभव, जो सक्षम स्तर से निर्गत हो। "
        "टिप्पणी :- (एक) सक्षम स्तर से निर्गत का तात्पर्य जनपदीय अधिकारी द्वारा निर्गत एवं मण्डलीय अधिकारी द्वारा प्रतिहस्ताक्षरित।"
    )
    return {
        "physical_pdf_page": page,
        "visible_issuer": "UPESSC",
        "visible_advertisement_number": "09/2026",
        "page_text_quote": page_text,
        "posts": [
            {
                "post_name": "Headmaster (Balak)",
                "post_binding_quote": "Post: Headmaster (Balak) | Vacancies: 1037 | Experience: 4 Years",
                "candidate_facts": [
                    {
                        "field_path": "min_age",
                        "value": 30,
                        "exact_quote": "6.(ख) आयु सीमा :- प्रधानाध्यापक पद की न्यूनतम आयु दिनांक 01 जुलाई, 2026 को 30 वर्ष निर्धारित है।",
                        "physical_pdf_page": page,
                        "section_locator": "official-pdf:page-6:section-6(kha)",
                        "conditions": None,
                    }
                ],
                "experience_alternatives": [
                    {
                        "minimum_years": 4,
                        "role_titles": ["प्रवक्ता", "सहायक अध्यापक"],
                        "institution_or_scope": "केन्द्र/राज्य सरकार द्वारा मान्यता प्राप्त संस्था",
                        "class_scope": "कक्षा 9 से 12",
                        "certificate_requirement": (
                            "टिप्पणी :- (एक) सक्षम स्तर से निर्गत का तात्पर्य जनपदीय अधिकारी द्वारा निर्गत एवं मण्डलीय अधिकारी द्वारा प्रतिहस्ताक्षरित।"
                        ),
                        "supporting_quote": (
                            "(तीन) केन्द्र/राज्य सरकार द्वारा मान्यता प्राप्त संस्था की उच्चतर कक्षाओं (कक्षा 9 से 12) में प्रवक्ता "
                            "अथवा सहायक अध्यापक के पद पर कम से कम 4 वर्ष का शिक्षण अनुभव"
                        ),
                        "physical_pdf_page": page,
                        "source_locator": "official-pdf:page-6:section-7(3)-a",
                    },
                    {
                        "minimum_years": 4,
                        "role_titles": ["प्रधानाध्यापक"],
                        "institution_or_scope": "जूनियर हाईस्कूल",
                        "class_scope": None,
                        "certificate_requirement": (
                            "टिप्पणी :- (एक) सक्षम स्तर से निर्गत का तात्पर्य जनपदीय अधिकारी द्वारा निर्गत एवं मण्डलीय अधिकारी द्वारा प्रतिहस्ताक्षरित।"
                        ),
                        "supporting_quote": (
                            "जूनियर हाईस्कूल में प्रधानाध्यापक के पद पर कम से कम 4 वर्ष का कार्यानुभव, जो सक्षम स्तर से निर्गत हो।"
                        ),
                        "physical_pdf_page": page,
                        "source_locator": "official-pdf:page-6:section-7(3)-b",
                    },
                ],
            }
        ],
    }


class VisionRecoveryTests(unittest.TestCase):
    def test_readable_pdf_page_never_invokes_vision(self):
        bundle = make_bundle(readable_pdf=True)
        provider = Mock()
        result = recover_unreadable_pdf_pages(
            bundle,
            gemini_provider=provider,
            pdf_bytes_by_doc={"official-pdf": FAKE_PDF_BYTES},
            page_images_by_doc={"official-pdf": {6: FAKE_PNG_BYTES}},
        )
        self.assertFalse(result["vision_called"])
        self.assertEqual(result["status"], "not_needed")
        provider.recover_pdf_page.assert_not_called()

    def test_unusable_verified_page_creates_vision_request_and_preserves_four_immutable_versions(self):
        bundle = make_bundle(readable_pdf=False)
        # Before Vision recovery, extraction gate blocks the unreadable PDF
        before_prep = prepare_extraction(bundle)
        self.assertIsNone(before_prep["llm_input"])

        provider = Mock()
        provider.model = "gemini-2.5-flash"
        payload = valid_vision_payload(page=6)
        provider.recover_pdf_page.return_value = {
            "status": "ok",
            "retryable": False,
            "reason": None,
            "data": payload,
            "raw_text": "{}",
        }

        with tempfile.TemporaryDirectory() as tmp:
            result = recover_unreadable_pdf_pages(
                bundle,
                gemini_provider=provider,
                pdf_bytes_by_doc={"official-pdf": FAKE_PDF_BYTES},
                page_images_by_doc={"official-pdf": {6: FAKE_PNG_BYTES}},
                storage_dir=Path(tmp),
            )
            self.assertTrue(result["vision_called"])
            self.assertEqual(result["status"], "recovered")
            self.assertEqual(len(result["requests"]), 1)
            req = result["requests"][0]
            versions = req["evidence_versions"]
            self.assertEqual(
                set(versions.keys()),
                {"canonical_pdf", "native_text", "rendered_image", "vision_output"},
            )
            # Original native text in block alternatives is NEVER overwritten
            pdf_doc = next(
                d for d in result["bundle"]["documents"] if d["document_id"] == "official-pdf"
            )
            native_alt = pdf_doc["content"]["blocks"][0]["alternatives"][0]
            self.assertEqual(native_alt["text"], ORIGINAL_MOJIBAKE)
            self.assertEqual(native_alt["status"], "rejected")
            self.assertEqual(versions["native_text"]["text"], ORIGINAL_MOJIBAKE)
            self.assertTrue(Path(versions["rendered_image"]["artifact_path"]).is_file())
            self.assertTrue(Path(versions["vision_output"]["artifact_path"]).is_file())

            # Now extraction input can be prepared with physical page 6 provenance
            after_prep = prepare_extraction(result["bundle"])
            self.assertIsNotNone(after_prep["llm_input"])

    def test_missing_quote_wrong_page_identity_mismatch_or_conflict_stays_unresolved(self):
        bundle = make_bundle(readable_pdf=False)
        bad_cases = []

        # 1. Wrong physical page number (e.g. printed page 5 instead of physical page 6)
        wrong_page = valid_vision_payload(page=5)
        bad_cases.append(("vision_page_number_mismatch", wrong_page))

        # 2. Missing quote
        missing_quote = valid_vision_payload(page=6)
        missing_quote["posts"][0]["candidate_facts"][0]["exact_quote"] = "   "
        bad_cases.append(("vision_missing_or_ungrounded_quote", missing_quote))

        # 3. Identity mismatch
        bad_identity = valid_vision_payload(page=6)
        bad_identity["visible_advertisement_number"] = "99/2099"
        bad_cases.append(("vision_identity_mismatch", bad_identity))

        # 4. Conflicting values for the same post and field
        conflict_payload = valid_vision_payload(page=6)
        second_fact = copy.deepcopy(conflict_payload["posts"][0]["candidate_facts"][0])
        second_fact["value"] = 21
        second_fact["exact_quote"] = "दिनांक 01 जुलाई, 2026 को 30 वर्ष निर्धारित है। (21)"
        conflict_payload["page_text_quote"] += " दिनांक 01 जुलाई, 2026 को 30 वर्ष निर्धारित है। (21)"
        conflict_payload["posts"][0]["candidate_facts"].append(second_fact)
        bad_cases.append(("vision_fact_conflict", conflict_payload))

        for expected_reason, payload in bad_cases:
            with self.subTest(expected_reason=expected_reason):
                provider = Mock()
                provider.recover_pdf_page.return_value = {
                    "status": "ok",
                    "retryable": False,
                    "reason": None,
                    "data": payload,
                    "raw_text": "{}",
                }
                result = recover_unreadable_pdf_pages(
                    bundle,
                    gemini_provider=provider,
                    pdf_bytes_by_doc={"official-pdf": FAKE_PDF_BYTES},
                    page_images_by_doc={"official-pdf": {6: FAKE_PNG_BYTES}},
                )
                self.assertEqual(result["status"], "unresolved")
                self.assertIn(expected_reason, result["reason_codes"])
                # Unresolved Vision output must NOT unlock the extraction gate
                prep = prepare_extraction(result["bundle"])
                self.assertIsNone(prep["llm_input"])

    def test_multi_page_selection_cap_skips_irrelevant_pages_and_preserves_valid_evidence(self):
        bundle = make_bundle(readable_pdf=False)
        pdf_doc = next(d for d in bundle["documents"] if d["document_id"] == "official-pdf")
        pdf_doc["content"]["pages"] = [
            {"number": 1, "native_status": "usable_candidate", "topics": ["post"]},
            {"number": 2, "native_status": "suspicious_or_unusable", "topics": ["fee"]},
            {"number": 3, "native_status": "suspicious_or_unusable", "topics": ["education"]},
            {"number": 4, "native_status": "suspicious_or_unusable", "topics": ["dates"]},
            {"number": 5, "native_status": "suspicious_or_unusable", "topics": ["age"]},
            {"number": 6, "native_status": "suspicious_or_unusable", "topics": ["vacancies"]},
        ]
        pdf_doc["content"]["sections"] = [
            {
                "id": "sec-1-existing",
                "text": "Existing readable PDF page 1 section.",
                "evidence": [{"page": 1, "block_id": "page-1-native", "line_range": [1, 1]}],
            }
        ]
        pdf_doc["content"]["coverage"] = {
            "unreadable_pages": [2, 3, 4, 5, 6],
            "missing_required_fields": ["education", "dates", "age", "vacancies"],
        }

        import json

        called_pages = []

        def fake_recover_pdf_page(*, prompt, **kwargs):
            page_number = json.loads(prompt)["physical_pdf_page"]
            called_pages.append(page_number)
            if page_number == 4:
                return {
                    "status": "error",
                    "retryable": True,
                    "reason": "timeout",
                    "data": None,
                    "raw_text": None,
                }
            return {
                "status": "ok",
                "retryable": False,
                "reason": None,
                "data": valid_vision_payload(page=page_number),
                "raw_text": "{}",
            }

        provider = Mock()
        provider.model = "gemini-2.5-flash"
        provider.recover_pdf_page.side_effect = fake_recover_pdf_page

        result = recover_unreadable_pdf_pages(
            bundle,
            gemini_provider=provider,
            pdf_bytes_by_doc={"official-pdf": FAKE_PDF_BYTES},
            page_images_by_doc={
                "official-pdf": {p: FAKE_PNG_BYTES for p in (2, 3, 4, 5, 6)}
            },
        )

        # Hard cap of 3 Vision calls per notice: pages 3, 4, 5 only
        self.assertEqual(provider.recover_pdf_page.call_count, 3)
        self.assertEqual(called_pages, [3, 4, 5])

        by_page = {req["physical_pdf_page"]: req for req in result["requests"]}
        self.assertEqual(by_page[2]["status"], "skipped")
        self.assertIn("vision_page_not_relevant_to_missing_fields", by_page[2]["reason_codes"])
        self.assertEqual(by_page[3]["status"], "recovered")
        self.assertEqual(by_page[4]["status"], "unresolved")
        self.assertTrue(by_page[4]["retryable"])
        self.assertIn("timeout", by_page[4]["reason_codes"])
        self.assertEqual(by_page[5]["status"], "recovered")
        self.assertEqual(by_page[6]["status"], "retryable")
        self.assertIn("vision_page_cap_deferred", by_page[6]["reason_codes"])

        # Previously valid HTML and PDF sections are preserved alongside recovered pages
        out_pdf = next(
            d for d in result["bundle"]["documents"] if d["document_id"] == "official-pdf"
        )
        section_ids = [s["id"] for s in out_pdf["content"]["sections"]]
        self.assertIn("sec-1-existing", section_ids)
        self.assertIn("vision-page-3", section_ids)
        self.assertIn("vision-page-5", section_ids)
        self.assertEqual(out_pdf["content"]["coverage"]["unreadable_pages"], [4, 6])


if __name__ == "__main__":
    unittest.main()
