"""Synthetic export/read-back checks; these are not live BSO operations."""

import copy
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "integrations" / "n8n"))
from cross_review.bso import build_bso_package, confirm_bso_readback, export_new


def sha(text):
    return hashlib.sha256(text.encode()).hexdigest()


def fixture():
    job = {
        "job_id": "BSO_SYNTHETIC_CROSS", "snapshot_id": "SYNTHETIC_SNAPSHOT",
        "artifact_version": 1, "artifact_hash": sha("synthetic draft"),
        "legacy_input_sha256": sha("synthetic request"),
        "bso_context": {"schema_version": "lk-bso-job/1.0", "document_id": "WORK_DOC_1",
                        "revision": 1, "artifact_sha256": sha("synthetic draft")},
    }
    summary = {key: job[key] for key in ("job_id", "snapshot_id", "artifact_version", "artifact_hash")}
    summary.update({"case_id": "SYNTHETIC_CASE", "state": "READY_FOR_HUMAN",
                    "evidence_mode": "MOCK", "approval_status": "PENDING",
                    "submission_status": "NOT_SUBMITTED", "cost": {"actual": None},
                    "key_differences": ["합성 비교 결과"], "next_action": "담당자 검토"})
    return job, summary


class BsoBridgeTest(unittest.TestCase):
    def test_version_bound_pending_report_has_no_execution_claim(self):
        job, summary = fixture()
        package = build_bso_package(job, summary)
        self.assertEqual(package["bso_receipt"]["status"], "NEEDS_GPT_REVIEW")
        self.assertEqual(package["bso_receipt"]["output_sha256"], sha(package["output"]))
        self.assertFalse(package["verification"]["human_approved"])
        self.assertFalse(package["verification"]["legal_accuracy_approved"])
        self.assertFalse(package["cross_review"]["report_reference_is_provider_evidence"])
        self.assertFalse(package["cross_review"]["bso_reflected"])
        self.assertIn("NOT_AUTHENTICATED_BY_BSO", package["evidence_source"])
        self.assertEqual(package["cross_review"]["evidence_mode"], "MOCK")

    def test_stale_summary_and_approval_escalation_rejected(self):
        job, summary = fixture()
        for key, value in (("job_id", "BSO_OTHER"), ("snapshot_id", "OTHER"),
                           ("artifact_version", 2), ("artifact_hash", "0" * 64)):
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "BSO_REPORT_BINDING"):
                build_bso_package(job, {**summary, key: value})
        for key, value in (("approval_status", "APPROVED"), ("submission_status", "SUBMITTED")):
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "ESCALATION"):
                build_bso_package(job, {**summary, key: value})

    def test_revised_artifact_needs_explicit_new_saved_handoff_mapping(self):
        job, summary = fixture()
        job.update(artifact_version=2, artifact_hash=sha("revised draft"))
        summary.update(artifact_version=2, artifact_hash=sha("revised draft"))
        with self.assertRaisesRegex(ValueError, "BSO_REVISION_MAPPING_REQUIRED"):
            build_bso_package(job, summary)
        job["bso_mapping"] = {"document_id": "WORK_DOC_1", "revision": 2,
                              "artifact_sha256": job["artifact_hash"],
                              "job_id": "BSO_SYNTHETIC_REVISED", "input_sha256": sha("new handoff")}
        package = build_bso_package(job, summary)
        self.assertEqual(package["bso_receipt"]["job_id"], "BSO_SYNTHETIC_REVISED")
        self.assertEqual(package["bso_receipt"]["revision"], 2)
        self.assertFalse(package["cross_review"]["bso_reflected"])
        job["bso_mapping"]["document_id"] = "WORK_DOC_2"
        with self.assertRaisesRegex(ValueError, "BSO_REVISION_MAPPING_REQUIRED"):
            build_bso_package(job, summary)

    def test_blocked_report_empty_and_private_envelopes_not_exported(self):
        job, summary = fixture()
        summary.update(state="BLOCKED", raw_provider_response="SENTINEL_RAW_SECRET",
                       headers={"Authorization": "SENTINEL_HEADER"})
        package = build_bso_package(job, summary)
        self.assertEqual(package["output"], "")
        self.assertFalse(package["verification"]["provider_guard_passed"])
        self.assertNotIn("SENTINEL", json.dumps(package))
        summary.update(state="READY_FOR_HUMAN", key_differences=["Bearer SECRET_SENTINEL_TOKEN"])
        with self.assertRaisesRegex(ValueError, "SECRET_PATTERN"):
            build_bso_package(job, summary)
        summary["key_differences"] = [{"nested": {"authorization": "SENTINEL_SECRET"}}]
        with self.assertRaisesRegex(ValueError, "SECRET_PATTERN"):
            build_bso_package(job, summary)

    def test_exclusive_export_is_only_filesystem_confirmation(self):
        job, summary = fixture()
        package = build_bso_package(job, summary)
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "synthetic-result.json"
            receipt = export_new(target, package)
            self.assertEqual(receipt["status"], "EXPORTED_READBACK_CONFIRMED")
            self.assertFalse(receipt["bso_reflected"])
            self.assertEqual(receipt["external_model_calls"], 0)
            self.assertEqual(json.loads(target.read_text()), package)
            if os.name != "nt":
                self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):
                export_new(target, package)
            corrupted = copy.deepcopy(package)
            corrupted["verification"]["human_approved"] = True
            with self.assertRaisesRegex(ValueError, "ESCALATION"):
                export_new(Path(tmp) / "invalid.json", corrupted)

    def test_real_adapter_readback_contract_rejects_file_receipt_and_stale_version(self):
        expected = {"job_id": "BSO_SYNTHETIC_CROSS", "snapshot_id": "SYNTHETIC_SNAPSHOT",
                    "artifact_version": 1, "artifact_hash": sha("draft"), "document_id": "WORK_DOC_1",
                    "verification_status": "READY_FOR_HUMAN", "approval_status": "PENDING"}
        with self.assertRaisesRegex(ValueError, "BACKING_READBACK_REQUIRED"):
            confirm_bso_readback(expected, {**expected, "readback_source": "EXPORTED_FILE"})
        actual = {**expected, "readback_source": "BSO_ADAPTER"}
        self.assertEqual(confirm_bso_readback(expected, actual)["status"], "BSO_READBACK_MATCHED")
        with self.assertRaisesRegex(ValueError, "BINDING_MISMATCH"):
            confirm_bso_readback(expected, {**actual, "artifact_version": 2})
        with self.assertRaisesRegex(ValueError, "ESCALATION"):
            confirm_bso_readback({**expected, "approval_status": "APPROVED"},
                                 {**actual, "approval_status": "APPROVED"})


if __name__ == "__main__":
    unittest.main()
