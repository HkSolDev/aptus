import unittest

from verify_bundle import amendment_scope, verify_bundles


HOSTS = {"Example Commission": ["jobs.example.gov.in"]}


def document(identifier, title="Recruitment Notice", *, campaign="Engineers", year="2026",
             ad="EC/01/2026", url="https://jobs.example.gov.in/notice", kind="html"):
    text = f"{title}\nIssuer: Example Commission\nCampaign: {campaign}\nRecruitment Year: {year}"
    if ad:
        text += f"\nAdvertisement No: {ad}"
    content = {"format": "html", "title": title, "blocks": [{"type": "paragraph", "text": text}]}
    if kind == "pdf":
        content = {"source_url": url, "sections": [{"text": text,
            "evidence": [{"page": 1, "block_id": "page-1-native", "line_range": [1, 5]}]}]}
    return {"document_id": identifier, "source_url": url, "format": kind, "content": content}


class VerifyBundleTests(unittest.TestCase):
    def test_explicit_annexure_update_keeps_quote_and_unchanged_terms(self):
        locations = [{"page": 1, "line_range": [1, 4]}]
        scope = amendment_scope([("Vacancies have been updated in Annexure I. All other terms remain unchanged.", locations)], "corrigendum")
        self.assertEqual(scope["changes"], ["vacancies"])
        self.assertEqual(scope["applies_to"], ["Annexure I"])
        self.assertEqual(scope["status"], "candidate_scope")
        self.assertEqual(scope["evidence"][0]["locations"], locations)
        self.assertIn("remain unchanged", scope["unchanged_evidence"][0]["quote"])

    def test_unchanged_age_is_not_a_change_and_unknown_target_needs_review(self):
        scope = amendment_scope([("Age limit is not revised. Last date is extended to 30 October.", [{"block": 2}])], "corrigendum")
        self.assertEqual(scope["changes"], ["deadline"])
        self.assertEqual(scope["applies_to"], [])
        self.assertEqual(scope["status"], "needs_review")

    def test_post_scope_and_main_notice_are_not_overwritten(self):
        text = "Qualification for the post of Law Officer revised in Section II."
        scope = amendment_scope([(text, [{"block": 1}])], "corrigendum")
        self.assertEqual(scope["changes"], ["qualification"])
        self.assertIn("Section II", scope["applies_to"])
        self.assertIsNone(amendment_scope([(text, [])], "main_notice"))

    def test_unrecognized_change_is_not_guessed(self):
        scope = amendment_scope([("The arrangements have been revised.", [{"page": 1}])], "corrigendum")
        self.assertEqual(scope["changes"], [])
        self.assertEqual(scope["status"], "needs_review")

    def test_reference_to_updated_annexure_is_not_a_new_change(self):
        scope = amendment_scope([("Vacancies mentioned in the updated Annexure I are indicative.", [{"page": 1}])], "corrigendum")
        self.assertEqual(scope["changes"], [])
    def test_pdf_html_bundle_preserves_content_and_locators(self):
        main = document("main", kind="pdf")
        annexure = document("annexure", "Vacancy Annexure")
        result = verify_bundles([main, annexure], issuer_hosts=HOSTS)
        self.assertEqual(len(result["bundles"]), 1)
        bundle = result["bundles"][0]
        self.assertEqual(bundle["status"], "candidate_for_extraction")
        # Lookup documents by document_id rather than assuming discovery arrival order
        docs_by_id = {d["document_id"]: d for d in bundle["documents"]}
        self.assertEqual(set(docs_by_id), {"main", "annexure"})
        self.assertEqual(len(bundle["documents"]), 2)
        self.assertEqual(docs_by_id["main"]["role"], "main_notice")
        self.assertEqual(docs_by_id["annexure"]["role"], "vacancy_annexure")
        self.assertEqual(docs_by_id["main"]["content"], main["content"])
        self.assertEqual(docs_by_id["main"]["identity_evidence"][0]["locations"][0]["page"], 1)

    def test_mirror_and_domain_suffix_attack_never_gain_authority(self):
        for url in ("https://mirror.example/notice", "https://jobs.example.gov.in.evil.example/notice",
                    "http://jobs.example.gov.in/notice"):
            with self.subTest(url=url):
                result = verify_bundles([document("main", url=url)], issuer_hosts=HOSTS)
                bundle = result["bundles"][0]
                self.assertEqual(bundle["status"], "needs_review")
                self.assertIn("authority_needs_review", bundle["review_reasons"])

    def test_campaign_year_and_advertisement_do_not_fuzzy_merge(self):
        documents = [document("a"), document("b", ad="EC/02/2026"), document("c", year="2027")]
        self.assertEqual(len(verify_bundles(documents, issuer_hosts=HOSTS)["bundles"]), 3)

    def test_incomplete_identity_stays_separate(self):
        documents = [document("a", year="", ad=None), document("b", year="", ad=None)]
        bundles = verify_bundles(documents, issuer_hosts=HOSTS)["bundles"]
        self.assertEqual(len(bundles), 2)
        self.assertTrue(all("insufficient_campaign_identity" in b["review_reasons"] for b in bundles))

    def test_corrigendum_and_cancellation_do_not_silently_override(self):
        for title in ("Corrigendum", "Cancellation"):
            bundle = verify_bundles([document("a"), document("b", title)], issuer_hosts=HOSTS)["bundles"][0]
            self.assertEqual(bundle["status"], "needs_review")
            self.assertIn("amendment_or_cancellation_scope_needs_review", bundle["review_reasons"])

    def test_conflicting_campaign_under_same_ad_requires_review(self):
        bundle = verify_bundles([document("a"), document("b", campaign="Nurses")], issuer_hosts=HOSTS)["bundles"][0]
        self.assertIn("conflicting_campaign", bundle["review_reasons"])
        self.assertIsNone(bundle["identity"]["campaign"])

    def test_coverage_and_budget_flags_survive(self):
        item = document("a", kind="pdf")
        item["content"].update(status="budget_exceeded", coverage={"unreadable_pages": [2], "unresolved_references": ["Annexure II"]})
        reasons = verify_bundles([item], issuer_hosts=HOSTS)["bundles"][0]["review_reasons"]
        self.assertTrue({"content_budget_exceeded", "content_coverage_gap", "unresolved_document_references"} <= set(reasons))

    def test_duplicate_id_and_mismatched_content_fail(self):
        with self.assertRaises(ValueError):
            verify_bundles([document("a"), document("a")])
        item = document("a", kind="pdf")
        item["content"]["source_url"] = "https://other.example/notice"
        with self.assertRaises(ValueError):
            verify_bundles([item])

    def test_ambiguous_labels_and_form_only_need_review(self):
        item = document("a", "Certificate Form")
        item["content"]["blocks"][0]["text"] += "\nAdvertisement No: EC/02/2026"
        bundle = verify_bundles([item], issuer_hosts=HOSTS)["bundles"][0]
        self.assertIn("ambiguous_advertisement_number", bundle["review_reasons"])
        self.assertIn("missing_main_notice", bundle["review_reasons"])

    def test_prior_campaign_in_body_does_not_replace_title_identity(self):
        item = document("a", kind="pdf")
        item["content"]["sections"][0]["text"] = "CRP RRBs XV\nIBPS\nRecruitment Notice\nSee previous CRP RRBs XIV rules."
        bundle = verify_bundles([item], issuer_hosts={"IBPS": []})["bundles"][0]
        self.assertEqual(bundle["identity"]["campaign"], "CRP RRBs XV")

    def test_source_header_bundles_notice_when_selected_text_lost_title(self):
        main = document("main", kind="pdf")
        main["content"]["sections"][0]["text"] = "Important dates\nIBPS\nApplication closing date follows."
        main["content"]["identity_context"] = {"text": "CRP RRBs XV\nIBPS\nRecruitment Notice",
            "evidence": [{"page": 1, "block_id": "page-1-native", "line_range": [1, 3]}]}
        update = document("update", kind="pdf")
        update["content"]["sections"][0]["text"] = "CRP RRBs XV\nIBPS\nCORRIGENDUM"
        result = verify_bundles([main, update], issuer_hosts={"IBPS": ["jobs.example.gov.in"]})
        self.assertEqual(len(result["bundles"]), 1)
        bundle = result["bundles"][0]
        self.assertEqual([unit["role"] for unit in bundle["documents"]], ["main_notice", "corrigendum"])
        identity = next(item for item in bundle["documents"][0]["identity_evidence"] if item["field"] == "campaign")
        self.assertEqual(identity["locations"][0]["line_range"], [1, 3])
        self.assertEqual(bundle["documents"][0]["content"], main["content"])


if __name__ == "__main__":
    unittest.main()
