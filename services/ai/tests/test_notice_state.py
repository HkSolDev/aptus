import copy
import json
import tempfile
import threading
import unittest
from pathlib import Path

from generic_pipeline import run_pipeline
from notice_state import (EXTRACTION_VERSION, NoticeStateManager,
                          compute_evidence_fingerprint)


def sample_prepared(bundle_id="bnd_101", docs=None):
    if docs is None:
        docs = [
            {
                "document_id": "doc_html_1",
                "role": "main_notice",
                "authority": "official",
                "format": "html",
                "title": "Recruitment Notice 2026",
                "amendment_scope": None,
                "sections": [{"evidence_id": "e1", "text": "Age 18-30 years", "locations": [{"block": 0}]}],
            },
            {
                "document_id": "doc_pdf_1",
                "role": "annexure",
                "authority": "official",
                "format": "pdf",
                "title": "Detailed Rules",
                "amendment_scope": None,
                "sections": [{"evidence_id": "e2", "text": "Fee Rs 100", "locations": [{"page": 1}]}],
            },
        ]
    return {
        "coverage": {"status": "ready_for_extraction", "review_reasons": []},
        "llm_input": {
            "instructions": "Extract recruitment facts.",
            "input": {
                "bundle_id": bundle_id,
                "coverage": {"status": "ready_for_extraction", "review_reasons": []},
                "identity": {"issuer": "SSC", "advertisement_number": "01/2026", "campaign": "CGL", "year": "2026"},
                "documents": docs,
            },
        },
    }


def sample_facts(quote="Age 18-30 years", evidence_id="e1"):
    return {
        "posts": [{"post_name": "Clerk"}],
        "evidence": [{
            "field_path": "posts.0.post_name",
            "evidence_id": evidence_id,
            "quote": quote,
        }],
        "missing_fields": [],
    }


class NoticeStateTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)

    def tearDown(self):
        self.temp_dir.cleanup()

    def run_with_input(self, prepared_obj, extract_fn, validate_fn=None,
                       draft_fn=None, persist_fn=None, prepare_only=False,
                       version=EXTRACTION_VERSION):
        path = self.root / "prepared.json"
        path.write_text(json.dumps(prepared_obj, ensure_ascii=False))

        def prepare(_prepared_root, **_opts):
            return [{
                "source": "test_board",
                "status": "prepared_for_review",
                "prepared_inputs": 1 if prepared_obj.get("llm_input") else 0,
                "prepared_paths": [str(path)],
            }]

        default_validate = lambda _res, _src: {"status": "needs_review"}
        def default_draft(res, _src, source_name=""):
            facts = res.get("facts")
            if not isinstance(facts, dict) or not facts.get("evidence"):
                facts = sample_facts()
            return {
                "bundle_id": res["bundle_id"],
                "source_name": source_name,
                "facts": facts,
            }

        return run_pipeline(
            self.root,
            prepare=prepare,
            extract=extract_fn,
            validate=validate_fn or default_validate,
            draft=draft_fn or default_draft,
            persist=persist_fn,
            prepare_only=prepare_only,
            extraction_version=version,
        )

    # 1. First successful run extracts and saves a reusable review draft.
    def test_first_successful_run_extracts_and_saves_draft_and_state(self):
        calls = []
        def extract(prepared):
            calls.append("extract")
            return {"bundle_id": prepared["llm_input"]["input"]["bundle_id"], "facts": sample_facts()}

        report = self.run_with_input(sample_prepared(), extract)
        counts = report["sources"]["test_board"]

        self.assertEqual(counts["extracted"], 1)
        self.assertEqual(counts["drafts"], 1)
        self.assertEqual(counts["reused"], 0)
        self.assertEqual(calls, ["extract"])

        draft_file = self.root / "drafts" / "bnd_101.json"
        self.assertTrue(draft_file.is_file())

        state_mgr = NoticeStateManager(self.root)
        state_file = state_mgr.state_path("bnd_101")
        self.assertTrue(state_file.is_file())
        state = json.loads(state_file.read_text())
        self.assertEqual(state["outcome"], "success")
        self.assertEqual(state["extraction_version"], EXTRACTION_VERSION)

    # 2. Identical second run makes zero additional extraction calls.
    def test_identical_second_run_makes_zero_extraction_calls(self):
        calls = []
        def extract(prepared):
            calls.append("extract")
            return {"bundle_id": prepared["llm_input"]["input"]["bundle_id"], "facts": sample_facts()}

        # Run 1
        self.run_with_input(sample_prepared(), extract)
        self.assertEqual(len(calls), 1)

        # Run 2 with identical input
        report2 = self.run_with_input(sample_prepared(), extract)
        counts2 = report2["sources"]["test_board"]
        self.assertEqual(counts2["extracted"], 0)
        self.assertEqual(counts2["reused"], 1)
        self.assertEqual(len(calls), 1)  # No second extract call

    # 3. A changed related document triggers extraction.
    def test_changed_related_document_triggers_extraction(self):
        calls = []
        def extract(prepared):
            calls.append("extract")
            return {"bundle_id": prepared["llm_input"]["input"]["bundle_id"], "facts": sample_facts()}

        prep1 = sample_prepared()
        self.run_with_input(prep1, extract)
        self.assertEqual(len(calls), 1)

        # Modify section text in the second document
        prep2 = copy.deepcopy(prep1)
        prep2["llm_input"]["input"]["documents"][1]["sections"][0]["text"] = "Fee Rs 200 (revised)"
        self.run_with_input(prep2, extract)
        self.assertEqual(len(calls), 2)

    # 4. Adding or removing a related document triggers extraction.
    def test_adding_or_removing_related_document_triggers_extraction(self):
        calls = []
        def extract(prepared):
            calls.append("extract")
            return {"bundle_id": prepared["llm_input"]["input"]["bundle_id"], "facts": sample_facts()}

        prep1 = sample_prepared()
        self.run_with_input(prep1, extract)
        self.assertEqual(len(calls), 1)

        # Add a 3rd document (corrigendum)
        prep2 = copy.deepcopy(prep1)
        prep2["llm_input"]["input"]["documents"].append({
            "document_id": "doc_corr_1",
            "role": "corrigendum",
            "authority": "official",
            "format": "pdf",
            "title": "Corrigendum",
            "amendment_scope": "dates",
            "sections": [{"evidence_id": "e3", "text": "Deadline extended to 2026-11-30", "locations": [{"page": 1}]}],
        })
        self.run_with_input(prep2, extract)
        self.assertEqual(len(calls), 2)

        # Remove the PDF document
        prep3 = copy.deepcopy(prep1)
        prep3["llm_input"]["input"]["documents"] = [prep1["llm_input"]["input"]["documents"][0]]
        self.run_with_input(prep3, extract)
        self.assertEqual(len(calls), 3)

    # 5. Document reordering alone does not trigger extraction.
    def test_document_reordering_alone_does_not_trigger_extraction(self):
        calls = []
        def extract(prepared):
            calls.append("extract")
            return {"bundle_id": prepared["llm_input"]["input"]["bundle_id"], "facts": sample_facts()}

        prep1 = sample_prepared()
        self.run_with_input(prep1, extract)
        self.assertEqual(len(calls), 1)

        # Reverse document order
        prep2 = copy.deepcopy(prep1)
        prep2["llm_input"]["input"]["documents"].reverse()

        report2 = self.run_with_input(prep2, extract)
        counts2 = report2["sources"]["test_board"]
        self.assertEqual(counts2["reused"], 1)
        self.assertEqual(counts2["extracted"], 0)
        self.assertEqual(len(calls), 1)

    # 6. Changing the extraction version triggers extraction.
    def test_changing_extraction_version_triggers_extraction(self):
        calls = []
        def extract(prepared):
            calls.append("extract")
            return {"bundle_id": prepared["llm_input"]["input"]["bundle_id"], "facts": sample_facts()}

        self.run_with_input(sample_prepared(), extract, version="extract-v1")
        self.assertEqual(len(calls), 1)

        # Bump extraction version
        self.run_with_input(sample_prepared(), extract, version="extract-v2")
        self.assertEqual(len(calls), 2)

    # 7. Failed extraction or blocked validation is never reused as success.
    def test_failed_extraction_or_blocked_validation_never_reused_as_success(self):
        def failing_extract(_prep):
            raise RuntimeError("LLM rate limit or provider error")

        report1 = self.run_with_input(sample_prepared(), failing_extract)
        self.assertEqual(report1["sources"]["test_board"]["failed"], 1)

        state_mgr = NoticeStateManager(self.root)
        self.assertFalse(state_mgr.state_path("bnd_101").exists())

        # Blocked validation test
        def extract_ok(prepared):
            return {"bundle_id": prepared["llm_input"]["input"]["bundle_id"], "facts": sample_facts()}
        def validate_blocked(_res, _src):
            return {"status": "blocked", "errors": [{"reason": "invalid_date_format"}]}

        report2 = self.run_with_input(sample_prepared(), extract_ok, validate_fn=validate_blocked)
        self.assertEqual(report2["sources"]["test_board"]["blocked"], 1)
        self.assertFalse(state_mgr.state_path("bnd_101").exists())

    # 8. A missing/corrupt draft cannot cause an AI skip.
    def test_missing_or_corrupt_draft_triggers_extraction(self):
        calls = []
        def extract(prepared):
            calls.append("extract")
            return {"bundle_id": prepared["llm_input"]["input"]["bundle_id"], "facts": sample_facts()}

        self.run_with_input(sample_prepared(), extract)
        self.assertEqual(len(calls), 1)

        # Delete draft
        draft_file = self.root / "drafts" / "bnd_101.json"
        draft_file.unlink()

        self.run_with_input(sample_prepared(), extract)
        self.assertEqual(len(calls), 2)

        # Corrupt draft file
        draft_file.write_text("{corrupt-json")
        self.run_with_input(sample_prepared(), extract)
        self.assertEqual(len(calls), 3)

    # 9. Missing/corrupt state cannot falsely report successful reuse.
    def test_missing_or_corrupt_state_triggers_extraction(self):
        calls = []
        def extract(prepared):
            calls.append("extract")
            return {"bundle_id": prepared["llm_input"]["input"]["bundle_id"], "facts": sample_facts()}

        self.run_with_input(sample_prepared(), extract)
        self.assertEqual(len(calls), 1)

        state_mgr = NoticeStateManager(self.root)
        state_file = state_mgr.state_path("bnd_101")
        state_file.write_text("not-json")

        self.run_with_input(sample_prepared(), extract)
        self.assertEqual(len(calls), 2)

    # 10. Prepare-only makes no AI call and creates no successful extraction state.
    def test_prepare_only_makes_no_ai_call_and_creates_no_state(self):
        calls = []
        def extract(prepared):
            calls.append("extract")
            return {"bundle_id": prepared["llm_input"]["input"]["bundle_id"], "facts": sample_facts()}

        report = self.run_with_input(sample_prepared(), extract, prepare_only=True)
        self.assertEqual(calls, [])
        self.assertEqual(report["sources"]["test_board"]["extracted"], 0)
        self.assertEqual(report["sources"]["test_board"]["drafts"], 0)
        self.assertEqual(report["sources"]["test_board"]["reused"], 0)

        state_mgr = NoticeStateManager(self.root)
        self.assertFalse(state_mgr.state_path("bnd_101").exists())

    # 11. Existing blocked-evidence behavior and no-publication boundary remain.
    def test_blocked_evidence_and_no_publication_boundary_remain(self):
        calls = []
        pushed = []

        # Blocked evidence (no llm_input)
        blocked_prep = {"coverage": {"status": "needs_review", "review_reasons": ["missing_main_notice"]}, "llm_input": None}
        report = self.run_with_input(blocked_prep, lambda _: calls.append("extract"))
        self.assertEqual(calls, [])
        self.assertEqual(report["sources"]["test_board"]["blocked"], 1)

        # Ready evidence, persist=None (default) -> published count is 0
        def extract(prepared):
            return {"bundle_id": prepared["llm_input"]["input"]["bundle_id"], "facts": sample_facts()}

        report2 = self.run_with_input(sample_prepared(), extract, persist_fn=None)
        self.assertEqual(report2["sources"]["test_board"]["published"], 0)
        self.assertEqual(len(pushed), 0)

    # 12. Overlapping runs cannot both pass the reuse check and extract concurrently.
    def test_overlapping_runs_protected_by_lock(self):
        extract_calls = []
        barrier = threading.Barrier(2)

        def slow_extract(prepared):
            extract_calls.append("extract")
            try:
                barrier.wait(timeout=2.0)
            except threading.BrokenBarrierError:
                pass
            return {"bundle_id": prepared["llm_input"]["input"]["bundle_id"], "facts": sample_facts()}

        def run_thread(result_holder):
            rep = self.run_with_input(sample_prepared(), slow_extract)
            result_holder.append(rep)

        res1, res2 = [], []
        t1 = threading.Thread(target=run_thread, args=(res1,))
        t2 = threading.Thread(target=run_thread, args=(res2,))

        t1.start()
        t2.start()
        t1.join()
        t2.join()

        # Exactly one thread extracted, the other waited and reused the draft!
        self.assertEqual(len(extract_calls), 1)
        total_reused = res1[0]["sources"]["test_board"]["reused"] + res2[0]["sources"]["test_board"]["reused"]
        total_extracted = res1[0]["sources"]["test_board"]["extracted"] + res2[0]["sources"]["test_board"]["extracted"]
        self.assertEqual(total_extracted, 1)
        self.assertEqual(total_reused, 1)

    # 13. Replaced/tampered draft fails checksum check and triggers extraction.
    def test_replaced_draft_fails_checksum_and_triggers_extraction(self):
        calls = []
        def extract(prepared):
            calls.append("extract")
            return {"bundle_id": prepared["llm_input"]["input"]["bundle_id"], "facts": sample_facts()}

        self.run_with_input(sample_prepared(), extract)
        self.assertEqual(len(calls), 1)

        # Tamper draft file
        draft_path = self.root / "drafts" / "bnd_101.json"
        envelope = json.loads(draft_path.read_text())
        envelope["tampered"] = True
        draft_path.write_text(json.dumps(envelope))

        # Second run detects checksum mismatch and re-extracts
        self.run_with_input(sample_prepared(), extract)
        self.assertEqual(len(calls), 2)

    # 14. Legacy state missing draft_sha256 safely misses cache.
    def test_legacy_state_missing_checksum_safely_misses_cache(self):
        calls = []
        def extract(prepared):
            calls.append("extract")
            return {"bundle_id": prepared["llm_input"]["input"]["bundle_id"], "facts": sample_facts()}

        self.run_with_input(sample_prepared(), extract)
        self.assertEqual(len(calls), 1)

        state_mgr = NoticeStateManager(self.root)
        state_file = state_mgr.state_path("bnd_101")
        state_data = json.loads(state_file.read_text())
        del state_data["draft_sha256"]
        state_file.write_text(json.dumps(state_data))

        # Safe cache miss
        self.run_with_input(sample_prepared(), extract)
        self.assertEqual(len(calls), 2)

    # 15. Whitespace changes that break exact quotation citations trigger re-extraction.
    def test_whitespace_change_breaking_exact_citation_triggers_reextraction(self):
        calls = []
        def extract(prepared):
            calls.append("extract")
            b_id = prepared["llm_input"]["input"]["bundle_id"]
            return {
                "bundle_id": b_id,
                "facts": sample_facts("Age 18-30 years"),
            }

        prep1 = sample_prepared()
        # Ensure section text matches quote and has locations
        prep1["llm_input"]["input"]["documents"][0]["sections"][0]["locations"] = [{"block": 0}]

        # Fresh extraction on initial run
        report1 = self.run_with_input(prep1, extract)
        self.assertEqual(len(calls), 1)
        self.assertEqual(report1["sources"]["test_board"]["extracted"], 1)

        # Positive case: unchanged cited draft is reused without calling AI
        report2 = self.run_with_input(prep1, extract)
        self.assertEqual(len(calls), 1)
        self.assertEqual(report2["sources"]["test_board"]["reused"], 1)
        self.assertEqual(report2["sources"]["test_board"]["extracted"], 0)

        # Whitespace change: new document text has extra horizontal spaces: "Age   18-30   years"
        # Fingerprint remains identical because of whitespace canonicalization.
        # BUT the saved quote "Age 18-30 years" is no longer a verbatim substring in the new document!
        prep2 = copy.deepcopy(prep1)
        prep2["llm_input"]["input"]["documents"][0]["sections"][0]["text"] = "Age   18-30   years"

        # Citation validation must reject the stale quote and force fresh extraction
        report3 = self.run_with_input(prep2, extract)
        self.assertEqual(len(calls), 2)
        self.assertEqual(report3["sources"]["test_board"]["extracted"], 1)
        self.assertEqual(report3["sources"]["test_board"]["reused"], 0)

    # 16. Missing or malformed citation data rejects reuse when current source evidence is supplied.
    def test_missing_or_malformed_citation_data_rejects_reuse(self):
        state_mgr = NoticeStateManager(self.root)
        draft_file = self.root / "drafts" / "bnd_101.json"
        draft_file.parent.mkdir(parents=True, exist_ok=True)

        source_input = sample_prepared()["llm_input"]["input"]
        bundle_id = source_input["bundle_id"]
        fingerprint = compute_evidence_fingerprint(source_input)

        def check_reuse(draft_content):
            draft_file.write_text(json.dumps(draft_content), encoding="utf-8")
            state_mgr.record_success(bundle_id, fingerprint, EXTRACTION_VERSION, draft_file)
            return state_mgr.get_reusable_draft(bundle_id, fingerprint, EXTRACTION_VERSION, source_input=source_input)

        # Valid cited draft succeeds
        valid_draft = {"bundle_id": bundle_id, "facts": sample_facts()}
        self.assertIsNotNone(check_reuse(valid_draft))

        # Missing facts entirely -> rejects reuse
        self.assertIsNone(check_reuse({"bundle_id": bundle_id}))

        # Facts is not a dict -> rejects reuse
        self.assertIsNone(check_reuse({"bundle_id": bundle_id, "facts": "not-a-dict"}))

        # Facts missing evidence list -> rejects reuse
        self.assertIsNone(check_reuse({"bundle_id": bundle_id, "facts": {"posts": [{"post_name": "Clerk"}]}}))

        # Facts missing posts list -> rejects reuse
        self.assertIsNone(check_reuse({"bundle_id": bundle_id, "facts": {"evidence": []}}))

        # Malformed citation quote not in cited evidence -> rejects reuse
        bad_quote_draft = {"bundle_id": bundle_id, "facts": sample_facts(quote="Nonexistent Text")}
        self.assertIsNone(check_reuse(bad_quote_draft))

        # Malformed citation pointing to nonexistent evidence_id -> rejects reuse
        bad_id_draft = {"bundle_id": bundle_id, "facts": sample_facts(evidence_id="nonexistent_id")}
        self.assertIsNone(check_reuse(bad_id_draft))


if __name__ == "__main__":
    unittest.main()
