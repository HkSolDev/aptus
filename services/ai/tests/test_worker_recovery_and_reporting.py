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
from review_publication import approve, publish, is_valid_receipt_file
from stage_retry import StageRetries, is_transient_capture_error, capture_failure
from capture_retry import capture_with_retry
from recover_capture_holds import audit_capture_holds
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

    # 13. Transient capture recovers automatically after cooldown and restarts
    def test_transient_capture_recovers_after_cooldown_and_restart(self):
        root = self.root / "transient_capture_recovery"
        clock = [1000]
        test_url = "https://example.gov.in/notice"
        calls = []

        def failing_process(url, storage, **kwargs):
            calls.append(("fail", clock[0]))
            return None, "gaierror", True

        def succeeding_process(url, storage, **kwargs):
            calls.append(("success", clock[0]))
            body_file = Path(storage) / "doc.html"
            body_file.parent.mkdir(parents=True, exist_ok=True)
            body_file.write_text("<html><h1>Recruitment</h1></html>")
            norm_dir = Path(storage) / "normalized-runs" / "r1"
            norm_dir.mkdir(parents=True, exist_ok=True)
            norm_path = norm_dir / "normalized.json"
            norm_path.write_text(json.dumps({"format": "html", "sections": []}))
            content_path = norm_dir / "selected.json"
            content_path.write_text(json.dumps({"format": "html", "sections": []}))
            return {
                "source_url": url,
                "final_url": url,
                "sha256": hashlib.sha256(b"html").hexdigest(),
                "snapshot_id": "snap_1",
                "body_path": str(body_file),
                "document_kind": "html",
                "normalized_path": str(norm_path),
                "content_path": str(content_path),
            }, None, False

        # Attempt 1 (t=1000)
        res1, reason1, retryable1 = capture_with_retry(test_url, root, failing_process, "board", clock=lambda: clock[0])
        self.assertIsNone(res1)
        self.assertEqual(reason1, "gaierror")
        self.assertTrue(retryable1)
        self.assertEqual(len(calls), 1)

        # Check state: retry_wait with next_at in future
        retries = StageRetries(root, lambda: clock[0])
        st1 = retries.read("capture", test_url)
        self.assertEqual(st1["status"], "retry_wait")
        self.assertEqual(st1["attempts"], 1)
        next_at_1 = st1["next_at"]
        self.assertGreaterEqual(next_at_1, 1030)

        # Restart during cooldown (t=1010): should skip fetch without real network attempt
        clock[0] = 1010
        res_skip = capture_with_retry(test_url, root, failing_process, "board", clock=lambda: clock[0])
        self.assertIsNone(res_skip[0])
        self.assertEqual(res_skip[1], "gaierror")
        self.assertTrue(res_skip[2])
        self.assertTrue(getattr(res_skip, "cooldown_skip", False))
        self.assertEqual(len(calls), 1)  # No new network call!

        # Attempt 2 (t=next_at_1 + 1): cooldown expired -> real attempt allowed
        clock[0] = next_at_1 + 1
        res2 = capture_with_retry(test_url, root, failing_process, "board", clock=lambda: clock[0])
        self.assertIsNone(res2[0])
        self.assertEqual(len(calls), 2)
        st2 = retries.read("capture", test_url)
        self.assertEqual(st2["status"], "retry_wait")
        self.assertEqual(st2["attempts"], 2)
        next_at_2 = st2["next_at"]

        # Attempt 3 (t=next_at_2 + 1): attempt 3 fails -> enters capped delayed recovery (NOT permanent needs_review)
        clock[0] = next_at_2 + 1
        res3 = capture_with_retry(test_url, root, failing_process, "board", clock=lambda: clock[0])
        self.assertIsNone(res3[0])
        self.assertEqual(len(calls), 3)
        st3 = retries.read("capture", test_url)
        self.assertEqual(st3["status"], "retry_wait")
        self.assertEqual(st3["attempts"], 3)
        self.assertGreater(st3["next_at"], clock[0])
        next_at_3 = st3["next_at"]

        # Recovery run after outage resolved (t=next_at_3 + 1):
        clock[0] = next_at_3 + 1
        res_rec = capture_with_retry(test_url, root, succeeding_process, "board", clock=lambda: clock[0])
        self.assertIsNotNone(res_rec[0])
        self.assertEqual(len(calls), 4)
        st_rec = retries.read("capture", test_url)
        self.assertEqual(st_rec["status"], "success")
        self.assertIsNone(st_rec["reason"])
        # Next fresh capture cycle starts with attempt count 1
        self.assertTrue(retries.begin("capture", test_url))
        self.assertEqual(retries.read("capture", test_url)["attempts"], 1)

    # 14. Successful DNS with failed HTTP distinguishes transient from permanent
    def test_successful_dns_with_failed_http_distinguishes_transient_from_permanent(self):
        root = self.root / "http_classification"
        clock = [1000]

        # Case A: HTTP 503 Service Unavailable (DNS resolved, server temporarily overloaded)
        url_503 = "https://example.gov.in/status503"
        capture_with_retry(url_503, root, lambda *a, **k: (None, "http_503", True), clock=lambda: clock[0])
        retries = StageRetries(root, lambda: clock[0])
        st_503 = retries.read("capture", url_503)
        self.assertEqual(st_503["status"], "retry_wait")
        self.assertTrue(is_transient_capture_error(st_503["reason"]))

        # Case B: HTTP 404 Not Found (DNS resolved, resource permanently missing)
        url_404 = "https://example.gov.in/missing404"
        capture_with_retry(url_404, root, lambda *a, **k: (None, "http_404", False), clock=lambda: clock[0])
        st_404 = retries.read("capture", url_404)
        self.assertEqual(st_404["status"], "needs_review")
        self.assertEqual(st_404["next_at"], 0)
        self.assertFalse(is_transient_capture_error(st_404["reason"]))

        # Even 100 days later, HTTP 404 must NOT automatically retry
        clock[0] += 86400 * 100
        self.assertFalse(retries.begin("capture", url_404))

    # 15. No retry stampede: jitter staggers recovery and limits real attempts
    def test_no_retry_stampede_and_jitter(self):
        root = self.root / "stampede_jitter"
        clock = [1000]
        retries = StageRetries(root, lambda: clock[0], jitter=True)

        urls = [
            "https://example.gov.in/notice_alpha",
            "https://example.gov.in/notice_beta",
            "https://example.gov.in/notice_gamma",
        ]
        delays = []
        for u in urls:
            self.assertTrue(retries.begin("capture", u))
            retries.failure("capture", u, "gaierror", retryable=True)
            st = retries.read("capture", u)
            delays.append(st["next_at"])

        # Jitter ensures they do not all wake up at the exact same second
        self.assertEqual(len(delays), 3)
        self.assertTrue(all(d >= 1030 for d in delays))
        self.assertGreater(len(set(delays)), 1)

    # 16. Preservation of strong holds: uncertain AI, corrupt checkpoint, factual review
    def test_preservation_of_strong_holds_across_runs_and_restarts(self):
        root = self.root / "strong_holds"
        clock = [1000]
        retries = StageRetries(root, lambda: clock[0])

        # Hold 1: Uncertain paid AI generation
        retries.write("extraction", "fp_uncertain", {
            "status": "needs_review", "attempts": 1, "next_at": 0,
            "reason": "provider_completion_uncertain",
        })

        # Hold 2: Corrupt checkpoint
        retries.write("extraction", "fp_corrupt", {
            "status": "needs_review", "attempts": 1, "next_at": 0,
            "reason": "corrupt_extraction_checkpoint",
        })

        # Hold 3: Candidate validation failure (factual hold)
        retries.write("extraction", "fp_val_blocked", {
            "status": "needs_review", "attempts": 1, "next_at": 0,
            "reason": "candidate_validation_blocked",
        })

        # Hold 4: Non-transient capture hold
        retries.write("capture", "url_invalid_pdf", {
            "status": "needs_review", "attempts": 1, "next_at": 0,
            "reason": "invalid_pdf",
        })

        # Simulate 30 days and worker restarts
        clock[0] += 86400 * 30
        for stage, key in [
            ("extraction", "fp_uncertain"),
            ("extraction", "fp_corrupt"),
            ("extraction", "fp_val_blocked"),
            ("capture", "url_invalid_pdf"),
        ]:
            restarted = StageRetries(root, lambda: clock[0])
            self.assertFalse(restarted.begin(stage, key))
            st = restarted.read(stage, key)
            self.assertEqual(st["status"], "needs_review")

    # 17. Publication receipt content & integrity validation before counting published
    def test_publication_receipt_content_and_integrity_validation(self):
        root = self.root / "receipt_integrity_validation"
        prep = self._sample_prepared_bundle("bnd_receipt_test")
        prep_path = root / "bnd_receipt_test.prepared.json"
        prep_path.parent.mkdir(parents=True, exist_ok=True)
        prep_path.write_text(json.dumps(prep))

        # Create draft via pipeline run 1
        rep1 = run_pipeline(
            root,
            prepare=lambda *a, **k: [{"source": "ssc", "status": "prepared_for_review",
                                      "prepared_inputs": 1, "prepared_paths": [str(prep_path)]}],
            extract=lambda _: {"bundle_id": "bnd_receipt_test", "facts": self._sample_facts()},
            validate=lambda *_: {"status": "needs_review", "disposition": "valid_recruitment_review_draft", "errors": []},
        )
        self.assertEqual(rep1["summary"]["drafts"]["created"], 1)

        draft_file = root / "drafts" / "bnd_receipt_test.json"
        draft_sha = hashlib.sha256(draft_file.read_bytes()).hexdigest()
        receipts_dir = root / "publication" / "receipts"
        receipts_dir.mkdir(parents=True, exist_ok=True)
        bad_receipt = receipts_dir / f"{draft_sha}.json"

        # Case 1: Empty receipt file on disk
        bad_receipt.write_text("")
        rep_empty = run_pipeline(
            root,
            prepare=lambda *a, **k: [{"source": "ssc", "status": "prepared_for_review",
                                      "prepared_inputs": 1, "prepared_paths": [str(prep_path)]}],
            extract=lambda _: self.fail("Unexpected AI call"),
            validate=lambda *_: {"status": "needs_review", "disposition": "valid_recruitment_review_draft", "errors": []},
        )
        # Must NOT count as published!
        self.assertEqual(rep_empty["summary"]["drafts"]["published"], 0)
        self.assertEqual(rep_empty["summary"]["drafts"]["reused_awaiting_review"], 1)
        self.assertEqual(rep_empty["summary"]["drafts"]["total_backlog_awaiting_review"], 1)

        # Case 2: Corrupt JSON / schema mismatch
        bad_receipt.write_text(json.dumps({"invalid": "schema"}))
        rep_corrupt = run_pipeline(
            root,
            prepare=lambda *a, **k: [{"source": "ssc", "status": "prepared_for_review",
                                      "prepared_inputs": 1, "prepared_paths": [str(prep_path)]}],
            extract=lambda _: self.fail("Unexpected AI call"),
            validate=lambda *_: {"status": "needs_review", "disposition": "valid_recruitment_review_draft", "errors": []},
        )
        self.assertEqual(rep_corrupt["summary"]["drafts"]["published"], 0)
        self.assertEqual(rep_corrupt["summary"]["drafts"]["reused_awaiting_review"], 1)
        self.assertEqual(rep_corrupt["summary"]["drafts"]["total_backlog_awaiting_review"], 1)

        # Case 3: Legitimate approval and publication with verified receipt
        bad_receipt.unlink()
        approval = approve(root, draft_file, reviewer="Auditor", note="Checked facts")
        publish(root, draft_file, send=lambda _: {
            "candidate_id": "cand_real_001",
            "content_hash": hashlib.sha256(b"content").hexdigest(),
            "draft_sha256": approval["draft_sha256"],
            "post_ids": ["post_001"],
        })
        rep_valid = run_pipeline(
            root,
            prepare=lambda *a, **k: [{"source": "ssc", "status": "prepared_for_review",
                                      "prepared_inputs": 1, "prepared_paths": [str(prep_path)]}],
            extract=lambda _: self.fail("Unexpected AI call"),
            validate=lambda *_: {"status": "needs_review", "disposition": "valid_recruitment_review_draft", "errors": []},
        )
        self.assertEqual(rep_valid["summary"]["drafts"]["published"], 1)
        self.assertEqual(rep_valid["summary"]["drafts"]["reused_awaiting_review"], 0)
        self.assertEqual(rep_valid["summary"]["drafts"]["total_backlog_awaiting_review"], 0)

    # 18. Actual extractor invocation counter defects fixed
    def test_actual_extractor_invocation_counter_defects_fixed(self):
        root = self.root / "actual_invocations"
        prep = self._sample_prepared_bundle("bnd_invocations")
        prep_path = root / "bnd_invocations.prepared.json"
        prep_path.parent.mkdir(parents=True, exist_ok=True)
        prep_path.write_text(json.dumps(prep))

        called = []

        # Sub-case A: Provider is called and raises network error
        def failing_extractor(p):
            called.append("FAIL")
            raise RuntimeError("provider_http_503")

        rep_fail = run_pipeline(
            root,
            prepare=lambda *a, **k: [{"source": "ssc", "status": "prepared_for_review",
                                      "prepared_inputs": 1, "prepared_paths": [str(prep_path)]}],
            extract=failing_extractor,
        )
        self.assertEqual(called, ["FAIL"])
        ext_fail = rep_fail["summary"]["extractions"]
        self.assertEqual(ext_fail["attempted"], 1)
        self.assertEqual(ext_fail["failed"], 1)
        self.assertEqual(ext_fail["succeeded"], 0)

        # Sub-case B: Checkpoint storage failure (provider succeeded, local disk failed)
        fp = compute_evidence_fingerprint(prep["llm_input"]["input"], EXTRACTION_VERSION)
        retries = StageRetries(root)
        retries.path("extraction", fp).unlink(missing_ok=True)

        called.clear()
        def success_extractor(p):
            called.append("SUCCESS")
            return {"bundle_id": "bnd_invocations", "facts": self._sample_facts()}

        with patch("extraction_checkpoint.atomic_write", side_effect=OSError("Disk full")):
            rep_disk = run_pipeline(
                root,
                prepare=lambda *a, **k: [{"source": "ssc", "status": "prepared_for_review",
                                          "prepared_inputs": 1, "prepared_paths": [str(prep_path)]}],
                extract=success_extractor,
            )
        self.assertEqual(called, ["SUCCESS"])
        ext_disk = rep_disk["summary"]["extractions"]
        # Provider DID succeed!
        self.assertEqual(ext_disk["attempted"], 1)
        self.assertEqual(ext_disk["succeeded"], 1)
        self.assertEqual(ext_disk["failed"], 0)
        # Checkpoint failure recorded in retry state
        st_disk = retries.read("extraction", fp)
        self.assertEqual(st_disk["reason"], "checkpoint_storage_failed")

    # 19. Audited dry-run recovery procedure for eligible capture holds
    def test_audited_dry_run_recovery_procedure(self):
        root = self.root / "dry_run_audit_recovery"
        retries = StageRetries(root)

        # Seed 2 eligible transient capture holds
        retries.write("capture", "url_dns", {"status": "needs_review", "attempts": 3, "reason": "gaierror", "next_at": 0})
        retries.write("capture", "url_conn", {"status": "needs_review", "attempts": 3, "reason": "ConnectTimeout", "next_at": 0})

        # Seed 1 ineligible capture hold (permanent invalid_pdf)
        retries.write("capture", "url_bad_pdf", {"status": "needs_review", "attempts": 1, "reason": "invalid_pdf", "next_at": 0})

        # Seed 1 extraction hold (must NEVER be touched by capture audit)
        retries.write("extraction", "fp_ai", {"status": "needs_review", "attempts": 1, "reason": "provider_completion_uncertain", "next_at": 0})

        # 1. Run audit in dry_run=True (default)
        audit_dry = audit_capture_holds(root, dry_run=True)
        self.assertTrue(audit_dry["dry_run"])
        self.assertEqual(audit_dry["total_holds"], 3)
        self.assertEqual(audit_dry["eligible_holds"], 2)
        self.assertEqual(audit_dry["ineligible_holds"], 1)
        self.assertEqual(audit_dry["recovered"], 0)

        # Disk files must be COMPLETELY unmodified in dry-run
        self.assertEqual(retries.read("capture", "url_dns")["status"], "needs_review")
        self.assertEqual(retries.read("capture", "url_conn")["status"], "needs_review")
        self.assertEqual(retries.read("capture", "url_bad_pdf")["status"], "needs_review")
        self.assertEqual(retries.read("extraction", "fp_ai")["status"], "needs_review")

        # 2. Run recovery in dry_run=False
        audit_exec = audit_capture_holds(root, dry_run=False)
        self.assertFalse(audit_exec["dry_run"])
        self.assertEqual(audit_exec["eligible_holds"], 2)
        self.assertEqual(audit_exec["recovered"], 2)

        # ONLY the 2 eligible transient holds were transitioned to retry_wait
        self.assertEqual(retries.read("capture", "url_dns")["status"], "retry_wait")
        self.assertEqual(retries.read("capture", "url_conn")["status"], "retry_wait")

        # Ineligible capture hold and extraction hold are STRICTLY preserved in needs_review
        self.assertEqual(retries.read("capture", "url_bad_pdf")["status"], "needs_review")
        self.assertEqual(retries.read("extraction", "fp_ai")["status"], "needs_review")


if __name__ == "__main__":
    unittest.main()
