"""Worker failure reporting and recovery tests covering the 8 observable cases.

Verifies truthful run outcomes, bounded diagnostics, artifact reuse, and safe recovery
without making paid AI calls or production writes.
"""
import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import httpx

from extraction_checkpoint import extract_or_resume
from generic_pipeline import run_pipeline
from notice_state import (EXTRACTION_VERSION, NoticeStateManager,
                          compute_evidence_fingerprint)
from review_publication import approve, publish
from stage_retry import StageRetries
from store_candidate import prepare_storage
try:
    from test_notice_state import sample_prepared
except ImportError:
    from services.ai.tests.test_notice_state import sample_prepared
from worker_schedule import main


class WorkerRecoveryAndReportingTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)

    def _sample_prepared_bundle(self, bundle_id="bnd_101"):
        prep = sample_prepared(bundle_id)
        for doc in prep["llm_input"]["input"]["documents"]:
            doc["source_url"] = "https://example.gov.in/notice"
        return prep

    def _sample_facts(self, quote="Age 18-30 years", evidence_id="e1"):
        post = {
            "post_name": "Engineer",
            "recruiting_body": None, "vacancies": None,
            "application_last_date": None, "age_as_on_date": None,
            "min_age": None, "max_age": None, "education_required": None,
            "post_group": None, "pay_level": None, "min_education_level": None,
            "min_marks_percent": None, "category_relaxation_applies": None,
            "category_relaxation_rules": None,
            "eligibility_rules": {
                "gender_requirement": None, "category_requirement": [],
                "education_options": [], "age_rules": [],
                "relaxation_combination_rule": None
            },
            "advertisement_number": None, "application_start_date": None,
            "fee_payment_last_date": None, "exam_dates": [],
            "nationality_requirement": None, "locations": [],
            "employment_type": None, "vacancy_breakdown": [],
            "experience_rules": [], "fee_rules": [], "pay": None,
            "selection_process": [], "application_steps": [],
            "documents_required": [], "language_requirements": [],
            "other_requirements": [], "official_site_url": None, "apply_url": None
        }
        missing = [
            {"field_path": f"posts.0.{f}", "reason": "not_located: Not located in supplied evidence."}
            for f in ("recruiting_body", "vacancies", "application_last_date", "age_as_on_date",
                      "min_age", "max_age", "education_required", "post_group", "pay_level",
                      "min_education_level", "min_marks_percent", "category_relaxation_applies",
                      "category_relaxation_rules", "eligibility_rules.gender_requirement",
                      "eligibility_rules.relaxation_combination_rule", "advertisement_number",
                      "application_start_date", "fee_payment_last_date", "nationality_requirement",
                      "employment_type", "pay", "official_site_url", "apply_url")
        ]
        return {
            "purpose": "recruitment",
            "purpose_evidence": [{"evidence_id": evidence_id, "quote": quote}],
            "document_purposes": [
                {"document_id": "doc_html_1", "purpose": "recruitment",
                 "evidence": [{"evidence_id": evidence_id, "quote": quote}]},
                {"document_id": "doc_pdf_1", "purpose": "recruitment",
                 "evidence": [{"evidence_id": "e2", "quote": "Fee Rs 100"}]},
            ],
            "amendment": None,
            "posts": [post],
            "evidence": [{"field_path": "posts.0.post_name", "evidence_id": evidence_id, "quote": quote}],
            "missing_fields": missing,
        }

    # 1. Every enabled source fails DNS -> visibly failed/degraded run, not success.
    def test_case_1_all_enabled_sources_fail_dns_reports_failed_run(self):
        root = self.root / "dns_failure"
        sources = [
            {"source": "ssc", "status": "failed", "prepared_inputs": 0, "prepared_paths": [],
             "reason": "gaierror", "errors": ["gaierror"]},
            {"source": "upsc", "status": "failed", "prepared_inputs": 0, "prepared_paths": [],
             "reason": "gaierror", "errors": ["gaierror"]},
        ]
        report = run_pipeline(root, prepare=lambda *a, **k: sources)

        self.assertEqual(report["status"], "failed")
        self.assertEqual(report["summary"]["sources"]["total"], 2)
        self.assertEqual(report["summary"]["sources"]["enabled"], 2)
        self.assertEqual(report["summary"]["sources"]["attempted"], 2)
        self.assertEqual(report["summary"]["sources"]["failed"], 2)
        self.assertEqual(report["summary"]["sources"]["succeeded"], 0)

        for sid in ("ssc", "upsc"):
            sc = report["sources"][sid]
            self.assertEqual(sc["crawl_status"], "failed")
            self.assertEqual(sc["failed"], 1)
            self.assertIn("discovery", sc["failure_stages"])
            self.assertIn("gaierror", sc["failure_reasons"])
            self.assertEqual(sc["bundle_outcomes"][0]["outcome"], "failed")
            self.assertIn("discovery_gaierror", sc["bundle_outcomes"][0]["reasons"])

        # Per-run evidence preservation: latest report and historical run file both exist.
        latest_file = root / "latest-generic-pipeline-run.json"
        self.assertTrue(latest_file.exists())
        run_files = list((root / "runs").glob("*.json"))
        self.assertEqual(len(run_files), 1)

        # Scheduler exit code: --once returns 1 on failed run
        with patch("worker_schedule.run_pipeline", return_value=report), \
             patch("sys.argv", ["worker_schedule.py", "--once", "--storage-dir", str(root)]):
            self.assertEqual(main(), 1)

    # 2. One source fails and another succeeds -> partial outcome with successful work preserved.
    def test_case_2_partial_source_failure_preserves_successful_work(self):
        root = self.root / "partial_source"
        prep = self._sample_prepared_bundle("bnd_good")
        prep_path = root / "bnd_good.prepared.json"
        prep_path.parent.mkdir(parents=True, exist_ok=True)
        prep_path.write_text(json.dumps(prep))

        sources = [
            {"source": "ssc_good", "status": "prepared_for_review", "documents": 2,
             "prepared_inputs": 1, "prepared_paths": [str(prep_path)]},
            {"source": "upsc_bad", "status": "failed", "documents": 0,
             "prepared_inputs": 0, "prepared_paths": [], "reason": "ConnectTimeout",
             "errors": ["ConnectTimeout"]},
        ]

        def extract(prepared):
            return {"bundle_id": "bnd_good", "facts": self._sample_facts()}

        def validate(result, source):
            return {"status": "needs_review", "disposition": "valid_recruitment_review_draft", "errors": []}

        report = run_pipeline(root, prepare=lambda *a, **k: sources, extract=extract, validate=validate)

        self.assertEqual(report["status"], "partial_failure")
        self.assertEqual(report["summary"]["sources"]["attempted"], 2)
        self.assertEqual(report["summary"]["sources"]["succeeded"], 1)
        self.assertEqual(report["summary"]["sources"]["failed"], 1)

        # Successful source work is preserved
        good = report["sources"]["ssc_good"]
        self.assertEqual(good["drafts"], 1)
        self.assertEqual(good["failed"], 0)
        self.assertTrue((root / "drafts" / "bnd_good.json").exists())

        # Failed source exposed accurately
        bad = report["sources"]["upsc_bad"]
        self.assertEqual(bad["failed"], 1)
        self.assertIn("discovery", bad["failure_stages"])
        self.assertIn("ConnectTimeout", bad["failure_reasons"])

        # Scheduler exit code: --once returns 0 on partial success because work was preserved
        with patch("worker_schedule.run_pipeline", return_value=report), \
             patch("sys.argv", ["worker_schedule.py", "--once", "--storage-dir", str(root)]):
            self.assertEqual(main(), 0)

    # 3. All sources succeed but nothing changes -> healthy unchanged outcome.
    def test_case_3_all_sources_succeed_unchanged_evidence_reuses_drafts(self):
        root = self.root / "unchanged_healthy"
        prep = self._sample_prepared_bundle("bnd_stable")
        prep_path = root / "bnd_stable.prepared.json"
        prep_path.parent.mkdir(parents=True, exist_ok=True)
        prep_path.write_text(json.dumps(prep))

        extract_mock = Mock(return_value={"bundle_id": "bnd_stable", "facts": self._sample_facts()})
        validate = lambda *_: {"status": "needs_review", "disposition": "valid_recruitment_review_draft", "errors": []}
        sources = [{"source": "ssc", "status": "prepared_for_review", "documents": 2,
                    "prepared_inputs": 1, "prepared_paths": [str(prep_path)]}]

        # First run: extracts and creates review draft
        first = run_pipeline(root, prepare=lambda *a, **k: sources, extract=extract_mock, validate=validate)
        self.assertEqual(first["status"], "completed")
        self.assertEqual(first["sources"]["ssc"]["drafts"], 1)
        self.assertEqual(first["sources"]["ssc"]["reused"], 0)
        self.assertEqual(extract_mock.call_count, 1)

        # Second run: identical evidence fingerprint -> reuses existing valid draft
        second = run_pipeline(root, prepare=lambda *a, **k: sources, extract=extract_mock, validate=validate)
        self.assertEqual(second["status"], "completed")
        self.assertEqual(second["summary"]["sources"]["failed"], 0)
        self.assertEqual(second["summary"]["artifacts"]["reused"], 1)
        self.assertEqual(second["sources"]["ssc"]["reused"], 1)
        self.assertEqual(second["sources"]["ssc"]["failed"], 0)
        self.assertEqual(second["sources"]["ssc"]["bundle_outcomes"][0]["outcome"], "reused")
        # No additional LLM calls
        self.assertEqual(extract_mock.call_count, 1)

    # 4. Disabled source -> excluded from enabled-source failure counts.
    def test_case_4_disabled_source_excluded_from_failure_counts(self):
        root = self.root / "disabled_source"
        prep = self._sample_prepared_bundle("bnd_active")
        prep_path = root / "bnd_active.prepared.json"
        prep_path.parent.mkdir(parents=True, exist_ok=True)
        prep_path.write_text(json.dumps(prep))

        sources = [
            {"source": "ssc_active", "status": "prepared_for_review", "documents": 1,
             "prepared_inputs": 1, "prepared_paths": [str(prep_path)]},
            {"source": "rajasthan_disabled", "status": "disabled"},
        ]

        report = run_pipeline(
            root,
            prepare=lambda *a, **k: sources,
            extract=lambda _: {"bundle_id": "bnd_active", "facts": self._sample_facts()},
            validate=lambda *_: {"status": "needs_review", "disposition": "valid_recruitment_review_draft", "errors": []},
        )

        self.assertEqual(report["status"], "completed")
        summary = report["summary"]["sources"]
        self.assertEqual(summary["total"], 2)
        self.assertEqual(summary["enabled"], 1)
        self.assertEqual(summary["disabled"], 1)
        self.assertEqual(summary["attempted"], 1)
        self.assertEqual(summary["succeeded"], 1)
        self.assertEqual(summary["failed"], 0)

        disabled_counts = report["sources"]["rajasthan_disabled"]
        self.assertEqual(disabled_counts["crawl_status"], "disabled")
        self.assertEqual(disabled_counts["failed"], 0)
        self.assertEqual(disabled_counts["blocked"], 0)

    # 5. Existing valid extraction + delivery failure -> recovery does not call the model again.
    def test_case_5_delivery_failure_retains_extraction_without_model_recall(self):
        root = self.root / "delivery_recovery"
        prep = self._sample_prepared_bundle("bnd_recover")
        prep_path = root / "bnd_recover.prepared.json"
        prep_path.parent.mkdir(parents=True, exist_ok=True)
        prep_path.write_text(json.dumps(prep))

        extract_calls = []

        def extract(prepared):
            extract_calls.append("LLM")
            return {"bundle_id": "bnd_recover", "facts": self._sample_facts()}

        validate = lambda *_: {"status": "needs_review", "disposition": "valid_recruitment_review_draft", "errors": []}

        # Step A: Run pipeline, creating validated draft in drafts/
        run_pipeline(
            root,
            prepare=lambda *a, **k: [{"source": "board", "status": "prepared_for_review",
                                      "prepared_inputs": 1, "prepared_paths": [str(prep_path)]}],
            extract=extract,
            validate=validate,
        )
        self.assertEqual(len(extract_calls), 1)

        draft_file = root / "drafts" / "bnd_recover.json"
        self.assertTrue(draft_file.exists())

        # Step B: Operator approves the exact draft bytes
        approval = approve(root, draft_file, reviewer="Operator Handoff", note="Checked facts")
        self.assertTrue((root / "publication" / "approvals" / f"{approval['draft_sha256']}.json").exists())

        # Step C: Delivery fails with network error (e.g. database connection down)
        clock = [1000]

        def broken_send(payload):
            request = httpx.Request("POST", "http://internal/ingest")
            raise httpx.ConnectError("Simulated remote DB down", request=request)

        with self.assertRaises(RuntimeError):
            publish(root, draft_file, send=broken_send, clock=lambda: clock[0])

        # Crucial check: Draft and notice state are intact, and no second LLM call occurs
        self.assertTrue(draft_file.exists())
        self.assertEqual(len(extract_calls), 1)

        # Step D: Retrying publication after backoff succeeds without calling model
        clock[0] += 35

        def working_send(payload):
            return {
                "candidate_id": "cand_recover_001",
                "content_hash": hashlib.sha256(b"content").hexdigest(),
                "draft_sha256": approval["draft_sha256"],
                "post_ids": ["post_001"],
            }

        receipt = publish(root, draft_file, send=working_send, clock=lambda: clock[0])
        self.assertEqual(receipt["candidate_id"], "cand_recover_001")
        self.assertEqual(len(extract_calls), 1)  # Zero extra AI calls throughout!

    # 6. Incompatible/invalid checkpoint -> not silently reused.
    def test_case_6_incompatible_or_corrupt_checkpoint_is_rejected(self):
        root = self.root / "corrupt_checkpoint"
        retries = StageRetries(root)
        prepared = self._sample_prepared_bundle("bnd_checkpoint")
        source_input = prepared["llm_input"]["input"]
        fingerprint = compute_evidence_fingerprint(source_input, EXTRACTION_VERSION)

        # Write a corrupted response checkpoint (wrong checksum)
        checkpoint_path = retries.path("extraction", fingerprint).with_suffix(".response.json")
        checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
        checkpoint_path.write_bytes(b'{"bundle_id": "bnd_checkpoint", "tampered": true}')

        # State says response_sha256 was different
        retries.write("extraction", fingerprint, {
            "status": "success",
            "attempts": 1,
            "next_at": 0,
            "evidence_sha256": hashlib.sha256(json.dumps(source_input, sort_keys=True).encode()).hexdigest(),
            "response_sha256": "0000000000000000000000000000000000000000000000000000000000000000",
        })

        extract_mock = Mock()
        result, resumed = extract_or_resume(retries, fingerprint, prepared, extract_mock)
        self.assertIsNone(result)
        self.assertFalse(resumed)
        extract_mock.assert_not_called()
        self.assertEqual(retries.read("extraction", fingerprint)["reason"], "corrupt_extraction_checkpoint")

    # 7. Awaiting human review -> reported as awaiting review, not published or an infrastructure failure.
    def test_case_7_candidate_reported_awaiting_review_never_published(self):
        root = self.root / "review_draft"
        prep = self._sample_prepared_bundle("bnd_candidate")
        prep_path = root / "bnd_candidate.prepared.json"
        prep_path.parent.mkdir(parents=True, exist_ok=True)
        prep_path.write_text(json.dumps(prep))

        publish_mock = Mock()
        report = run_pipeline(
            root,
            prepare=lambda *a, **k: [{"source": "ssc", "status": "prepared_for_review",
                                      "prepared_inputs": 1, "prepared_paths": [str(prep_path)]}],
            extract=lambda _: {"bundle_id": "bnd_candidate", "facts": self._sample_facts()},
            validate=lambda *_: {"status": "needs_review", "disposition": "valid_recruitment_review_draft", "errors": []},
            persist=publish_mock,
        )

        self.assertEqual(report["status"], "completed")
        self.assertEqual(report["summary"]["drafts"]["created"], 1)
        self.assertEqual(report["summary"]["drafts"]["awaiting_review"], 1)
        self.assertEqual(report["sources"]["ssc"]["drafts"], 1)
        self.assertEqual(report["sources"]["ssc"]["published"], 0)
        self.assertEqual(report["sources"]["ssc"]["failed"], 0)

        # Draft is saved for operator review
        draft_path = root / "drafts" / "bnd_candidate.json"
        self.assertTrue(draft_path.exists())
        # Injected persist callback must NOT be invoked to publish
        publish_mock.assert_not_called()
        # No publication receipt exists
        self.assertFalse((root / "publication" / "receipts").exists())

    # 8. Repeat approved delivery -> existing idempotency remains intact.
    def test_case_8_repeat_approved_delivery_idempotent_no_duplicate_writes(self):
        root = self.root / "idempotent_delivery"
        prep = self._sample_prepared_bundle("bnd_idem")
        prep_path = root / "bnd_idem.prepared.json"
        prep_path.parent.mkdir(parents=True, exist_ok=True)
        prep_path.write_text(json.dumps(prep))

        run_pipeline(
            root,
            prepare=lambda *a, **k: [{"source": "board", "status": "prepared_for_review",
                                      "prepared_inputs": 1, "prepared_paths": [str(prep_path)]}],
            extract=lambda _: {"bundle_id": "bnd_idem", "facts": self._sample_facts()},
            validate=lambda *_: {"status": "needs_review", "disposition": "valid_recruitment_review_draft", "errors": []},
        )

        draft_file = root / "drafts" / "bnd_idem.json"
        approval = approve(root, draft_file, reviewer="Operator Review", note="Confirmed facts")

        send_mock = Mock(return_value={
            "candidate_id": "cand_idem_001",
            "content_hash": hashlib.sha256(b"content").hexdigest(),
            "draft_sha256": approval["draft_sha256"],
            "post_ids": ["post_idem_1"],
        })

        first_receipt = publish(root, draft_file, send=send_mock)
        self.assertEqual(first_receipt["candidate_id"], "cand_idem_001")
        self.assertEqual(send_mock.call_count, 1)

        # Repeating delivery reads the durable receipt and does not call send again
        second_receipt = publish(root, draft_file, send=send_mock)
        self.assertEqual(second_receipt["candidate_id"], "cand_idem_001")
        self.assertEqual(second_receipt["post_ids"], ["post_idem_1"])
        self.assertEqual(send_mock.call_count, 1)  # send NOT called a second time

    # Issue 1: Partial discovery error reported when some work succeeds
    def test_issue_1_partial_discovery_error_reported_when_work_succeeds(self):
        root = self.root / "partial_discovery_with_work"
        prep = self._sample_prepared_bundle("bnd_part_work")
        prep_path = root / "bnd_part_work.prepared.json"
        prep_path.parent.mkdir(parents=True, exist_ok=True)
        prep_path.write_text(json.dumps(prep))

        # Source crawl status is 'partial' with error 'gaierror', but produced a prepared input
        sources = [{
            "source": "ssc_part",
            "status": "partial",
            "errors": ["gaierror"],
            "documents": 1,
            "prepared_inputs": 1,
            "prepared_paths": [str(prep_path)],
        }]

        report = run_pipeline(
            root,
            prepare=lambda *a, **k: sources,
            extract=lambda _: {"bundle_id": "bnd_part_work", "facts": self._sample_facts()},
            validate=lambda *_: {"status": "needs_review", "disposition": "valid_recruitment_review_draft", "errors": []},
        )

        # Overall status must be partial_failure, not completed
        self.assertEqual(report["status"], "partial_failure")
        sc = report["sources"]["ssc_part"]
        # Successful work is preserved
        self.assertEqual(sc["drafts"], 1)
        self.assertTrue((root / "drafts" / "bnd_part_work.json").exists())
        # Discovery errors and reasons are exposed
        self.assertIn("discovery", sc["failure_stages"])
        self.assertIn("gaierror", sc["failure_reasons"])
        self.assertEqual(sc["crawl_errors"], ["gaierror"])

    # Issue 2: Retry-wait is preserved as partial_failure with retry reason
    def test_issue_2_retry_wait_preserved_as_partial_failure_with_reason(self):
        root = self.root / "retry_wait_preservation"
        prep = self._sample_prepared_bundle("bnd_retry_wait")
        prep_path = root / "bnd_retry_wait.prepared.json"
        prep_path.parent.mkdir(parents=True, exist_ok=True)
        prep_path.write_text(json.dumps(prep))

        source_input = prep["llm_input"]["input"]
        fingerprint = compute_evidence_fingerprint(source_input, EXTRACTION_VERSION)
        retries = StageRetries(root)
        # Pre-seed extraction retry state in retry_wait with 60s lease (next_at in future)
        retries.write("extraction", fingerprint, {
            "status": "retry_wait",
            "attempts": 1,
            "next_at": 9999999999,
            "reason": "provider_http_503",
        })

        extract_mock = Mock()
        report = run_pipeline(
            root,
            prepare=lambda *a, **k: [{"source": "ssc", "status": "prepared_for_review",
                                      "prepared_inputs": 1, "prepared_paths": [str(prep_path)]}],
            extract=extract_mock,
        )

        # Status must NOT be completed: it is an unfinished retry_wait
        self.assertEqual(report["status"], "partial_failure")
        sc = report["sources"]["ssc"]
        self.assertIn("extraction", sc["failure_stages"])
        self.assertIn("provider_http_503", sc["failure_reasons"])
        self.assertEqual(sc["retry_wait"], 1)
        self.assertEqual(sc["bundle_outcomes"][0]["outcome"], "retry_wait")
        self.assertEqual(sc["bundle_outcomes"][0]["reasons"], ["provider_http_503"])
        # Provider must not have been called while waiting
        extract_mock.assert_not_called()
        self.assertEqual(report["summary"]["extractions"]["waiting_retry"], 1)
        self.assertEqual(report["summary"]["extractions"]["attempted"], 0)

    # Issue 3: Reused drafts separated from created drafts, awaiting-review maintained until published
    def test_issue_3_reused_draft_awaiting_review_versus_published_reporting(self):
        root = self.root / "reused_awaiting_review"
        prep = self._sample_prepared_bundle("bnd_lifecycle")
        prep_path = root / "bnd_lifecycle.prepared.json"
        prep_path.parent.mkdir(parents=True, exist_ok=True)
        prep_path.write_text(json.dumps(prep))

        sources = [{"source": "ssc", "status": "prepared_for_review", "documents": 1,
                    "prepared_inputs": 1, "prepared_paths": [str(prep_path)]}]

        # Run 1: Draft is created
        rep1 = run_pipeline(
            root,
            prepare=lambda *a, **k: sources,
            extract=lambda _: {"bundle_id": "bnd_lifecycle", "facts": self._sample_facts()},
            validate=lambda *_: {"status": "needs_review", "disposition": "valid_recruitment_review_draft", "errors": []},
        )
        self.assertEqual(rep1["summary"]["drafts"]["created"], 1)
        self.assertEqual(rep1["summary"]["drafts"]["reused_awaiting_review"], 0)
        self.assertEqual(rep1["summary"]["drafts"]["awaiting_review"], 1)
        self.assertEqual(rep1["summary"]["drafts"]["published"], 0)

        # Run 2: Unchanged content -> draft is reused, but NOT yet published
        rep2 = run_pipeline(
            root,
            prepare=lambda *a, **k: sources,
            extract=lambda _: self.fail("Unexpected AI call"),
            validate=lambda *_: {"status": "needs_review", "disposition": "valid_recruitment_review_draft", "errors": []},
        )
        self.assertEqual(rep2["summary"]["drafts"]["created"], 0)
        self.assertEqual(rep2["summary"]["drafts"]["reused_awaiting_review"], 1)
        self.assertEqual(rep2["summary"]["drafts"]["awaiting_review"], 1)
        self.assertEqual(rep2["summary"]["drafts"]["published"], 0)
        self.assertGreaterEqual(rep2["summary"]["drafts"]["total_backlog_awaiting_review"], 1)

        # Now approve and publish that draft (create durable receipt)
        draft_file = root / "drafts" / "bnd_lifecycle.json"
        approval = approve(root, draft_file, reviewer="Reviewer A", note="Verified notice")
        send_mock = Mock(return_value={
            "candidate_id": "cand_pub_001",
            "content_hash": hashlib.sha256(b"content").hexdigest(),
            "draft_sha256": approval["draft_sha256"],
            "post_ids": ["post_001"],
        })
        publish(root, draft_file, send=send_mock)

        # Run 3: Unchanged content reused, now confirmed published
        rep3 = run_pipeline(
            root,
            prepare=lambda *a, **k: sources,
            extract=lambda _: self.fail("Unexpected AI call"),
            validate=lambda *_: {"status": "needs_review", "disposition": "valid_recruitment_review_draft", "errors": []},
        )
        self.assertEqual(rep3["summary"]["drafts"]["created"], 0)
        self.assertEqual(rep3["summary"]["drafts"]["reused_awaiting_review"], 0)
        self.assertEqual(rep3["summary"]["drafts"]["awaiting_review"], 0)
        self.assertEqual(rep3["summary"]["drafts"]["published"], 1)

    # Issue 4: Diagnostic counter accuracy and distinctions
    def test_issue_4_diagnostic_counter_accuracy_and_distinctions(self):
        root = self.root / "counter_accuracy"

        # Bundle 1: fresh provider extraction
        prep1 = self._sample_prepared_bundle("bnd_fresh")
        p1 = root / "bnd_fresh.prepared.json"
        p1.parent.mkdir(parents=True, exist_ok=True)
        p1.write_text(json.dumps(prep1))

        # Bundle 2: resumed checkpoint
        prep2 = self._sample_prepared_bundle("bnd_checkpoint_resumed")
        p2 = root / "bnd_checkpoint_resumed.prepared.json"
        p2.write_text(json.dumps(prep2))
        fp2 = compute_evidence_fingerprint(prep2["llm_input"]["input"], EXTRACTION_VERSION)
        retries = StageRetries(root)
        ret_path2 = retries.path("extraction", fp2).with_suffix(".response.json")
        ret_path2.parent.mkdir(parents=True, exist_ok=True)
        resp_payload = json.dumps({"bundle_id": "bnd_checkpoint_resumed", "facts": self._sample_facts()}).encode()
        ret_path2.write_bytes(resp_payload)
        retries.write("extraction", fp2, {
            "status": "success",
            "attempts": 1,
            "next_at": 0,
            "evidence_sha256": hashlib.sha256(json.dumps(prep2["llm_input"]["input"], sort_keys=True).encode()).hexdigest(),
            "response_sha256": hashlib.sha256(resp_payload).hexdigest(),
        })

        # Bundle 3: retry_wait
        prep3 = self._sample_prepared_bundle("bnd_in_backoff")
        p3 = root / "bnd_in_backoff.prepared.json"
        p3.write_text(json.dumps(prep3))
        fp3 = compute_evidence_fingerprint(prep3["llm_input"]["input"], EXTRACTION_VERSION)
        retries.write("extraction", fp3, {
            "status": "retry_wait",
            "attempts": 1,
            "next_at": 9999999999,
            "reason": "provider_http_429",
        })

        called_providers = []

        def extract(prepared):
            called_providers.append(prepared["llm_input"]["input"]["bundle_id"])
            return {"bundle_id": prepared["llm_input"]["input"]["bundle_id"], "facts": self._sample_facts()}

        sources = [{
            "source": "multi_test",
            "status": "prepared_for_review",
            "documents": 3,
            "prepared_inputs": 3,
            "prepared_paths": [str(p1), str(p2), str(p3)],
        }]

        report = run_pipeline(
            root,
            prepare=lambda *a, **k: sources,
            extract=extract,
            validate=lambda *_: {"status": "needs_review", "disposition": "valid_recruitment_review_draft", "errors": []},
        )

        ext = report["summary"]["extractions"]
        art = report["summary"]["artifacts"]

        # Only 1 provider call was actually made (for bnd_fresh)
        self.assertEqual(called_providers, ["bnd_fresh"])
        self.assertEqual(ext["attempted"], 1)
        self.assertEqual(ext["succeeded"], 1)
        self.assertEqual(ext["failed"], 0)

        # Checkpoint was resumed, not counted as a new provider attempt
        self.assertEqual(ext["resumed_checkpoint"], 1)
        self.assertEqual(art["checkpoints_resumed"], 1)

        # Waiting retry was recorded as waiting, not counted as an extraction attempt
        self.assertEqual(ext["waiting_retry"], 1)


if __name__ == "__main__":
    unittest.main()
