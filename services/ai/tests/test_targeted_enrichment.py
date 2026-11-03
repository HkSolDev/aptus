"""Focused unit tests for targeted enrichment (planning, provenance, syllabus, cutoffs)."""

import copy
import json
import unittest
from unittest.mock import Mock

from targeted_enrichment import plan_enrichment_requests, run_targeted_enrichment


def sample_source_input() -> dict:
    return {
        "bundle_id": "bundle-upessc-09-2026",
        "identity": {
            "issuer": "UPESSC",
            "advertisement_number": "09/2026",
            "campaign": "Headmaster Recruitment",
            "year": "2026",
        },
        "coverage": {"status": "ready_for_extraction", "review_reasons": []},
        "documents": [
            {
                "document_id": "main-pdf",
                "source_url": "https://upessc.example.gov.in/notices/09-2026.pdf",
                "format": "pdf",
                "role": "main_notice",
                "authority": "official_host_candidate",
                "sections": [
                    {
                        "evidence_id": "main-pdf:sec-1",
                        "text": (
                            "Issuer: UPESSC | Advt No: 09/2026 | Post: Headmaster (Balak) | "
                            "Vacancies: 1037 | Education: Master Degree with 50% Marks and B.Ed."
                        ),
                        "locations": [{"page": 1, "block_id": "page-1-native"}],
                    }
                ],
            }
        ],
    }


def sample_facts(*, missing_last_date: bool = True) -> dict:
    post = {
        "post_name": "Headmaster (Balak)",
        "recruiting_body": "UPESSC",
        "vacancies": 1037,
        "application_last_date": None if missing_last_date else "2026-12-15",
        "age_as_on_date": "2026-07-01",
        "min_age": 30,
        "max_age": 62,
        "education_required": "Master Degree with 50% Marks and B.Ed.",
        "post_group": "B",
        "pay_level": "Level-10",
        "min_education_level": "MASTERS",
        "min_marks_percent": 50.0,
        "category_relaxation_applies": True,
        "category_relaxation_rules": {"SC": 5, "ST": 5, "OBC": 3, "EWS": None, "PwBD": None},
        "eligibility_rules": {
            "gender_requirement": None,
            "category_requirement": [],
            "education_options": [],
            "age_rules": [],
            "relaxation_combination_rule": None,
        },
    }
    evidence = [
        {
            "field_path": "posts.0.post_name",
            "evidence_id": "main-pdf:sec-1",
            "quote": "Post: Headmaster (Balak)",
        },
        {
            "field_path": "posts.0.recruiting_body",
            "evidence_id": "main-pdf:sec-1",
            "quote": "Issuer: UPESSC",
        },
        {
            "field_path": "posts.0.vacancies",
            "evidence_id": "main-pdf:sec-1",
            "quote": "Vacancies: 1037",
        },
        {
            "field_path": "posts.0.education_required",
            "evidence_id": "main-pdf:sec-1",
            "quote": "Education: Master Degree with 50% Marks and B.Ed.",
        },
    ]
    missing = []
    if missing_last_date:
        missing.append(
            {
                "field_path": "posts.0.application_last_date",
                "reason": "Last date not stated in section 1.",
            }
        )
    else:
        evidence.append(
            {
                "field_path": "posts.0.application_last_date",
                "evidence_id": "main-pdf:sec-1",
                "quote": "2026-12-15",
            }
        )
    return {
        "purpose": "recruitment",
        "purpose_evidence": [{"evidence_id": "main-pdf:sec-1", "quote": "Advt No: 09/2026"}],
        "document_purposes": [],
        "amendment": None,
        "posts": [post],
        "evidence": evidence,
        "missing_fields": missing,
    }


class TargetedEnrichmentTests(unittest.TestCase):
    def test_missing_allowed_field_creates_one_request_while_complete_or_unsupported_creates_none(self):
        source = sample_source_input()
        facts = sample_facts(missing_last_date=True)

        plan = plan_enrichment_requests(
            facts,
            source,
            requested_fields=["application_last_date", "vacancies", "unsupported_custom_field"],
        )
        self.assertEqual(plan["status"], "ready")
        self.assertEqual(len(plan["requests"]), 1)
        req = plan["requests"][0]
        self.assertEqual(req["field_path"], "application_last_date")
        self.assertEqual(req["post_name"], "Headmaster (Balak)")
        self.assertEqual(req["trigger_reason"], "missing_value")
        self.assertIn("UPESSC", req["query"])
        self.assertIn("09/2026", req["query"])
        self.assertIn("Headmaster (Balak)", req["query"])

    def test_official_syllabus_and_category_cutoffs_retain_structured_values_and_provenance(self):
        source = sample_source_input()
        facts = sample_facts(missing_last_date=False)
        facts_before = copy.deepcopy(facts)

        syllabus_url = "https://upessc.example.gov.in/syllabus/09-2026-headmaster.pdf"
        cutoff_url = "https://upessc.example.gov.in/results/2022-headmaster-cutoff.pdf"

        search_client = Mock()
        def fake_discover(req):
            if req["target_type"] == "official_syllabus":
                return {
                    "status": "ok",
                    "candidates": [
                        {
                            "post_name": "Headmaster (Balak)",
                            "exam_name": "UPESSC Headmaster Written Examination 2026",
                            "exam_pattern": "360 marks written exam (120 objective questions) + 40 marks interview",
                            "subjects": ["General Studies", "Educational Administration"],
                            "topics": ["School Management", "Education Policy"],
                            "post_binding_quote": "UPESSC Advt 09/2026 Syllabus for Headmaster (Balak)",
                            "exact_quote": (
                                "UPESSC Advt 09/2026 Syllabus for Headmaster (Balak): "
                                "Subjects: General Studies, Educational Administration. "
                                "Pattern: 360 marks written exam (120 objective questions) + 40 marks interview."
                            ),
                            "source_url": syllabus_url,
                        }
                    ],
                }
            if req["target_type"] == "historical_cutoff":
                return {
                    "status": "ok",
                    "candidates": [
                        {
                            "recruitment_year": 2022,
                            "stage": "Final Merit",
                            "post_name": "Headmaster (Balak)",
                            "category": "UR",
                            "score_type": "marks",
                            "score": 312.5,
                            "maximum_score": 400.0,
                            "post_binding_quote": "UPESSC Headmaster (Balak) 2022 Final Merit Cutoff",
                            "exact_quote": (
                                "UPESSC Headmaster (Balak) 2022 Final Merit Cutoff: "
                                "Category UR: 312.5 marks out of 400; Category OBC: 298.0 marks out of 400."
                            ),
                            "source_url": cutoff_url,
                        },
                        {
                            "recruitment_year": 2022,
                            "stage": "Final Merit",
                            "post_name": "Headmaster (Balak)",
                            "category": "OBC",
                            "score_type": "marks",
                            "score": 298.0,
                            "maximum_score": 400.0,
                            "post_binding_quote": "UPESSC Headmaster (Balak) 2022 Final Merit Cutoff",
                            "exact_quote": (
                                "UPESSC Headmaster (Balak) 2022 Final Merit Cutoff: "
                                "Category UR: 312.5 marks out of 400; Category OBC: 298.0 marks out of 400."
                            ),
                            "source_url": cutoff_url,
                        },
                    ],
                }
            return {"status": "ok", "candidates": []}

        search_client.discover_for_request.side_effect = fake_discover

        capture_client = Mock()
        def fake_capture(url):
            if url == syllabus_url:
                return {
                    "status": "captured",
                    "source_url": syllabus_url,
                    "document_id": "doc-syl-1",
                    "captured_at": "2026-11-03T10:05:00Z",
                    "sha256": "a" * 64,
                    "text_units": [
                        {
                            "page": 2,
                            "locator": "page:2:line:1-5",
                            "text": (
                                "UPESSC Advt 09/2026 Syllabus for Headmaster (Balak): "
                                "Subjects: General Studies, Educational Administration. "
                                "Pattern: 360 marks written exam (120 objective questions) + 40 marks interview."
                            ),
                        }
                    ],
                }
            if url == cutoff_url:
                return {
                    "status": "captured",
                    "source_url": cutoff_url,
                    "document_id": "doc-cut-1",
                    "captured_at": "2026-11-03T10:06:00Z",
                    "sha256": "b" * 64,
                    "text_units": [
                        {
                            "page": 1,
                            "locator": "page:1:table:1",
                            "text": (
                                "UPESSC Headmaster (Balak) 2022 Final Merit Cutoff: "
                                "Category UR: 312.5 marks out of 400; Category OBC: 298.0 marks out of 400."
                            ),
                        }
                    ],
                }
            return {"status": "failed"}

        capture_client.capture_source.side_effect = fake_capture

        result = run_targeted_enrichment(
            facts,
            source,
            search_client=search_client,
            capture_client=capture_client,
            issuer_hosts={"UPESSC": ["upessc.example.gov.in"]},
            requested_fields=[],
            include_syllabus=True,
            include_historical_cutoffs=True,
        )
        self.assertEqual(result["status"], "completed")
        self.assertEqual(len(result["official_syllabus"]), 1)
        syl = result["official_syllabus"][0]
        self.assertEqual(syl["status"], "verified")
        self.assertEqual(syl["subjects"], ["General Studies", "Educational Administration"])
        self.assertEqual(syl["evidence"][0]["source_url"], syllabus_url)
        self.assertEqual(syl["evidence"][0]["page"], 2)

        self.assertEqual(len(result["historical_cutoffs"]), 2)
        for cutoff in result["historical_cutoffs"]:
            self.assertEqual(cutoff["status"], "verified")
            self.assertTrue(cutoff["reference_only"])
            self.assertEqual(cutoff["recruitment_year"], 2022)
            self.assertEqual(cutoff["evidence"][0]["source_url"], cutoff_url)

        # Enrichment must never mutate extracted facts in place
        self.assertEqual(facts, facts_before)

    def test_third_party_only_identity_mismatch_missing_quote_and_conflict_stay_unresolved(self):
        source = sample_source_input()
        facts = sample_facts(missing_last_date=True)

        # Case 1: Third-party domain
        search_3p = Mock()
        search_3p.discover_for_request.return_value = {
            "status": "ok",
            "candidates": [
                {
                    "post_name": "Headmaster (Balak)",
                    "value": "2026-12-15",
                    "exact_quote": "UPESSC 09/2026 Headmaster (Balak) Last Date: 2026-12-15",
                    "source_url": "https://sarkariresult.example.com/upessc-hm/",
                }
            ],
        }
        capture_3p = Mock()
        capture_3p.capture_source.return_value = {
            "status": "captured",
            "source_url": "https://sarkariresult.example.com/upessc-hm/",
            "document_id": "doc-3p",
            "captured_at": "2026-11-03T10:10:00Z",
            "text_units": [
                {
                    "page": None,
                    "locator": "block:1",
                    "text": "UPESSC 09/2026 Headmaster (Balak) Last Date: 2026-12-15",
                }
            ],
        }
        res_3p = run_targeted_enrichment(
            facts,
            source,
            search_client=search_3p,
            capture_client=capture_3p,
            issuer_hosts={"UPESSC": ["upessc.example.gov.in"]},
            requested_fields=["application_last_date"],
        )
        self.assertEqual(res_3p["field_candidates"][0]["status"], "unresolved")
        self.assertEqual(res_3p["field_candidates"][0]["reason"], "third_party_source_not_official")
        self.assertIsNone(res_3p["field_candidates"][0]["value"])

        # Case 2: Identity mismatch (wrong advertisement number in official PDF)
        search_mismatch = Mock()
        search_mismatch.discover_for_request.return_value = {
            "status": "ok",
            "candidates": [
                {
                    "post_name": "Headmaster (Balak)",
                    "value": "2026-12-15",
                    "exact_quote": "UPESSC Advt 01/2025 Headmaster (Balak) Last Date: 2026-12-15",
                    "source_url": "https://upessc.example.gov.in/notices/01-2025.pdf",
                }
            ],
        }
        capture_mismatch = Mock()
        capture_mismatch.capture_source.return_value = {
            "status": "captured",
            "source_url": "https://upessc.example.gov.in/notices/01-2025.pdf",
            "document_id": "doc-wrong-ad",
            "captured_at": "2026-11-03T10:11:00Z",
            "text_units": [
                {
                    "page": 1,
                    "locator": "page:1:line:1",
                    "text": "UPESSC Advt 01/2025 Headmaster (Balak) Last Date: 2026-12-15",
                }
            ],
        }
        res_mismatch = run_targeted_enrichment(
            facts,
            source,
            search_client=search_mismatch,
            capture_client=capture_mismatch,
            issuer_hosts={"UPESSC": ["upessc.example.gov.in"]},
            requested_fields=["application_last_date"],
        )
        self.assertEqual(res_mismatch["field_candidates"][0]["status"], "unresolved")
        self.assertEqual(res_mismatch["field_candidates"][0]["reason"], "enrichment_identity_mismatch")

        # Case 3: Conflicting official values remain null with conflicting status
        search_conflict = Mock()
        search_conflict.discover_for_request.return_value = {
            "status": "ok",
            "candidates": [
                {
                    "post_name": "Headmaster (Balak)",
                    "value": "2026-12-15",
                    "exact_quote": "UPESSC 09/2026 Headmaster (Balak) Last Date: 2026-12-15",
                    "source_url": "https://upessc.example.gov.in/notices/09-2026-a.pdf",
                },
                {
                    "post_name": "Headmaster (Balak)",
                    "value": "2026-12-30",
                    "exact_quote": "UPESSC 09/2026 Headmaster (Balak) Last Date: 2026-12-30",
                    "source_url": "https://upessc.example.gov.in/notices/09-2026-a.pdf",
                },
            ],
        }
        capture_conflict = Mock()
        capture_conflict.capture_source.return_value = {
            "status": "captured",
            "source_url": "https://upessc.example.gov.in/notices/09-2026-a.pdf",
            "document_id": "doc-conflict",
            "captured_at": "2026-11-03T10:12:00Z",
            "text_units": [
                {
                    "page": 1,
                    "locator": "page:1:line:1-2",
                    "text": (
                        "UPESSC 09/2026 Headmaster (Balak) Last Date: 2026-12-15. "
                        "UPESSC 09/2026 Headmaster (Balak) Last Date: 2026-12-30."
                    ),
                }
            ],
        }
        res_conflict = run_targeted_enrichment(
            facts,
            source,
            search_client=search_conflict,
            capture_client=capture_conflict,
            issuer_hosts={"UPESSC": ["upessc.example.gov.in"]},
            requested_fields=["application_last_date"],
        )
        self.assertEqual(res_conflict["field_candidates"][0]["status"], "conflicting")
        self.assertIsNone(res_conflict["field_candidates"][0]["value"])
        self.assertEqual(len(res_conflict["field_candidates"][0]["evidence"]), 2)


if __name__ == "__main__":
    unittest.main()
