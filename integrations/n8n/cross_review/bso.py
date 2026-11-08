"""Conservative export to the existing BSO manual-import contract.

An export or a filesystem read-back is not evidence that BSO accepted a result.
This module never changes human approval, use, or external-submission state.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re


HASH = re.compile(r"^[a-f0-9]{64}$")
BSO_JOB = re.compile(r"^BSO_[A-Za-z0-9_-]{1,76}$")
DOCUMENT = re.compile(r"^WORK_DOC_\d+$")
READBACK_KEYS = (
    "job_id", "snapshot_id", "artifact_version", "artifact_hash", "document_id",
    "verification_status", "approval_status",
)


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _valid_mapping(mapping: dict) -> bool:
    return (
        isinstance(mapping, dict)
        and DOCUMENT.fullmatch(str(mapping.get("document_id", ""))) is not None
        and type(mapping.get("revision")) is int and mapping["revision"] >= 1
        and HASH.fullmatch(str(mapping.get("artifact_sha256", ""))) is not None
        and BSO_JOB.fullmatch(str(mapping.get("job_id", ""))) is not None
        and HASH.fullmatch(str(mapping.get("input_sha256", ""))) is not None
    )


def _mapping(job: dict) -> dict:
    context = job.get("bso_context")
    if not isinstance(context, dict) or context.get("schema_version") != "lk-bso-job/1.0":
        raise ValueError("BSO_CONTEXT_REQUIRED")
    initial = {
        "document_id": context.get("document_id"),
        "revision": context.get("revision"),
        "artifact_sha256": context.get("artifact_sha256"),
        "job_id": job.get("job_id"),
        "input_sha256": job.get("legacy_input_sha256"),
    }
    if not _valid_mapping(initial):
        raise ValueError("BSO_CONTEXT_INVALID")
    if initial["revision"] == job.get("artifact_version") and initial["artifact_sha256"] == job.get("artifact_hash"):
        return initial
    # A revised draft requires a new BSO handoff created by BSO itself. A caller
    # may supply its mapping; only the existing BSO importer can authenticate it
    # against the locally saved document and handoff, so export remains pending.
    mapping = job.get("bso_mapping")
    if not _valid_mapping(mapping) or mapping["document_id"] != initial["document_id"] or mapping["revision"] != job.get("artifact_version") or mapping["artifact_sha256"] != job.get("artifact_hash") or mapping["job_id"] == initial["job_id"]:
        raise ValueError("BSO_REVISION_MAPPING_REQUIRED")
    return dict(mapping)


def _safe_report(summary: dict) -> dict:
    # Only known report fields leave the local runner. In particular, raw
    # requests, headers, credentials, and provider response envelopes do not.
    allowed = (
        "case_id", "artifact_version", "state", "verification_status",
        "evidence_mode", "actual_reviewers", "reviewer_completion", "coverage",
        "key_differences", "owner_comparison", "unresolved", "source_locations",
        "cost", "duration_seconds", "next_action", "issues",
    )
    report = {key: summary[key] for key in allowed if key in summary}
    def reject_secret_fields(value):
        if isinstance(value, dict):
            for key, child in value.items():
                normalized = re.sub(r"[^a-z]", "", str(key).lower())
                if normalized in {"authorization", "apikey", "headers", "password", "secret", "token", "accesstoken", "credential", "credentials", "rawproviderresponse"}:
                    raise ValueError("BSO_REPORT_SECRET_PATTERN")
                reject_secret_fields(child)
        elif isinstance(value, list):
            for child in value:
                reject_secret_fields(child)
    reject_secret_fields(report)
    # Defense in depth for user-controlled finding text. Values are data, but
    # the exported report is also not a place for credentials accidentally
    # echoed by a provider. Reject rather than silently altering the evidence.
    text = json.dumps(report, ensure_ascii=False, sort_keys=True)
    if re.search(r"(?i)(?:bearer\s+\S+|sk-(?:proj-|ant-)?[A-Za-z0-9_-]{12,}|(?:api[_-]?key|authorization)\s*[:=])", text):
        raise ValueError("BSO_REPORT_SECRET_PATTERN")
    return report


def build_bso_package(job: dict, summary: dict) -> dict:
    """Create a version-bound *manual* BSO import package without granting use.

    READY_FOR_HUMAN becomes the legacy NEEDS_GPT_REVIEW state deliberately:
    that state's existing UI cannot grant human/legal approval. Other runner
    states export an empty blocked result. Model text cannot set either state.
    """
    if not isinstance(job, dict) or not isinstance(summary, dict):
        raise ValueError("BSO_REPORT_BINDING")
    for key in ("job_id", "snapshot_id", "artifact_version", "artifact_hash"):
        if key not in job or summary.get(key) != job[key]:
            raise ValueError("BSO_REPORT_BINDING")
    mapping = _mapping(job)
    if summary.get("approval_status", "PENDING") != "PENDING" or summary.get("submission_status", "NOT_SUBMITTED") != "NOT_SUBMITTED":
        raise ValueError("BSO_APPROVAL_ESCALATION_BLOCKED")
    ready = summary.get("state") == "READY_FOR_HUMAN"
    report = _safe_report(summary)
    output = json.dumps(report, ensure_ascii=False, indent=2) if ready else ""
    if len(output) > 100000:
        raise ValueError("BSO_REPORT_TOO_LARGE")
    # This is a logical runner-report reference, never a provider request ID.
    report_ref = "CROSS_REPORT_" + _sha(job["job_id"] + ":" + str(job["artifact_version"]))[:32]
    mode = summary.get("evidence_mode", "UNVERIFIED")
    return {
        "schema_version": "lk-bso-result/1.0",
        "bso_receipt": {
            "schema_version": "lk-bso-receipt/1.0",
            **mapping,
            "output_sha256": _sha(output),
            "execution_id": report_ref,
            "status": "NEEDS_GPT_REVIEW" if ready else "BLOCKED",
            "human_approved": False,
        },
        "output": output,
        "verification": {
            "output_sha256_checked": True,
            "provider_guard_passed": ready,
            "human_approved": False,
            "legal_accuracy_approved": False,
        },
        "evidence_source": "CROSS_REVIEW_RUNNER_EXPORT_NOT_AUTHENTICATED_BY_BSO",
        "cross_review": {
            "job_id": job["job_id"], "snapshot_id": job["snapshot_id"],
            "artifact_version": job["artifact_version"], "artifact_hash": job["artifact_hash"],
            "evidence_mode": mode, "report_reference_is_provider_evidence": False,
            "bso_reflected": False, "approval_status": "PENDING",
            "submission_status": "NOT_SUBMITTED",
        },
    }


def export_new(path: str | Path, package: dict) -> dict:
    """Exclusively create then read the export. Does not call or acknowledge BSO."""
    if not isinstance(package, dict) or package.get("schema_version") != "lk-bso-result/1.0":
        raise ValueError("BSO_EXPORT_SCHEMA")
    if set(package) != {"schema_version", "bso_receipt", "output", "verification", "evidence_source", "cross_review"}:
        raise ValueError("BSO_EXPORT_SCHEMA")
    receipt, verification, cross = package.get("bso_receipt"), package.get("verification"), package.get("cross_review")
    output = package.get("output")
    if not isinstance(receipt, dict) or not isinstance(verification, dict) or not isinstance(cross, dict) or not isinstance(output, str) or len(output) > 100000 or receipt.get("output_sha256") != _sha(output):
        raise ValueError("BSO_EXPORT_INTEGRITY")
    if receipt.get("human_approved") is not False or verification.get("human_approved") is not False or verification.get("legal_accuracy_approved") is not False or verification.get("output_sha256_checked") is not True or cross.get("bso_reflected") is not False or cross.get("approval_status") != "PENDING" or cross.get("submission_status") != "NOT_SUBMITTED":
        raise ValueError("BSO_APPROVAL_ESCALATION_BLOCKED")
    if receipt.get("status") not in {"BLOCKED", "NEEDS_GPT_REVIEW"} or (receipt["status"] == "BLOCKED" and output) or (receipt["status"] == "NEEDS_GPT_REVIEW" and (not output.strip() or verification.get("provider_guard_passed") is not True)):
        raise ValueError("BSO_EXPORT_INTEGRITY")
    text = json.dumps(package, ensure_ascii=False, indent=2)
    encoded = text.encode("utf-8")
    if len(encoded) > 2_000_000:
        raise ValueError("BSO_EXPORT_TOO_LARGE")
    target = Path(path)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(target, flags, 0o600)
    with os.fdopen(fd, "wb") as handle:
        handle.write(encoded)
        handle.flush()
        os.fsync(handle.fileno())
    with target.open("rb") as handle:
        readback = handle.read(2_000_001)
    if readback != encoded or json.loads(readback) != package:
        raise ValueError("BSO_EXPORT_READBACK_MISMATCH")
    return {
        "status": "EXPORTED_READBACK_CONFIRMED",
        "package_sha256": hashlib.sha256(encoded).hexdigest(),
        "bso_reflected": False, "human_approved": False,
        "external_model_calls": 0,
    }


def confirm_bso_readback(expected: dict, actual: dict) -> dict:
    """Compare an actual backing BSO adapter's read result with expected data.

    This function performs no write/read itself. The caller must supply the
    actual backing adapter receipt; a package/file read is explicitly excluded.
    """
    if not isinstance(expected, dict) or not isinstance(actual, dict) or actual.get("readback_source") != "BSO_ADAPTER":
        raise ValueError("BSO_BACKING_READBACK_REQUIRED")
    if any(key not in expected or key not in actual or expected[key] != actual[key] for key in READBACK_KEYS):
        raise ValueError("BSO_READBACK_BINDING_MISMATCH")
    if actual["approval_status"] != "PENDING" or actual.get("submission_status", "NOT_SUBMITTED") != "NOT_SUBMITTED":
        raise ValueError("BSO_APPROVAL_ESCALATION_BLOCKED")
    return {"status": "BSO_READBACK_MATCHED", **{key: actual[key] for key in READBACK_KEYS}, "human_approved": False}
