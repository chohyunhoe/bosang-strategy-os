"""Deterministic evidence gates. Model agreement never bypasses these checks."""
from __future__ import annotations

import json
import re
from decimal import Decimal, ROUND_DOWN, ROUND_HALF_UP, localcontext

from .contract import canonical, decimal_string, digest, validate_evidence


def run_rules(job):
    issues = []
    coverage = []
    comparisons = []
    source = job.get("rule_input", {})

    def issue(code, reason, evidence=None, severity="P1", **details):
        issues.append({"finding_id": code + "_" + str(len(issues) + 1), "code": code,
                       "severity": severity, "reason": reason, "evidence": evidence or [], **details})

    if job.get("task_type") not in {"OWNER_COMPARISON", "FORMATTING", "FORMAT_REVIEW"}:
        issue("TASK_SCOPE_UNSUPPORTED", "This runner implements owner/amount/factor comparison and limited formatting; other task types need a dedicated evidence adapter.")

    if source.get("evidence_version") != 2 or source.get("parse_status") != "READY":
        issue("PARSE_HOLD", "Evidence v2 and a fresh READY parse are required; re-enter the original.")
    docs = {d["doc_id"]: d for d in job["snapshot"]["documents"]}
    for d in docs.values():
        if d.get("evidence_version") != 2:
            issue("LEGACY_EVIDENCE", "Legacy source evidence requires re-entry.", [{"doc_id": d["doc_id"], "sha256": d["sha256"], "pdf_page": 1}])
        coverage.append({"doc_id": d["doc_id"], "sha256": d["sha256"], "pages": [p["pdf_page"] for p in d["pages"]],
                         "source_mode": "text_original" if "source_content" in d else "bytes_with_extraction",
                         "images_verified": False})
        for p in d["pages"]:
            evidence = [{"doc_id": d["doc_id"], "sha256": d["sha256"], "pdf_page": p["pdf_page"]}]
            if any(p.get(k) for k in ("cropped", "missing", "unreadable", "masked_required_values")):
                issue("SOURCE_GAP", "Required source values are cropped, missing, masked or unreadable.", evidence)
            if p.get("requires_image_review") or p.get("image_sha256") or str(d.get("file_name", "")).lower().endswith(".pdf"):
                checks = [c for c in source.get("image_checks", []) if c.get("doc_id") == d["doc_id"] and c.get("pdf_page") == p["pdf_page"]]
                good = bool(p.get("image_sha256")) and bool(checks) and any(c.get("verified_by") and c.get("image_sha256") == p["image_sha256"] and isinstance(c.get("verified_image_text"), str) for c in checks)
                if not good:
                    issue("IMAGE_UNVERIFIED", "The page image has no trusted image comparison; OCR alone is insufficient.", evidence)
    for check in source.get("image_checks", []):
        d = docs.get(check.get("doc_id"))
        if d is None or type(check.get("pdf_page")) is not int or not 1 <= check["pdf_page"] <= d["page_count"]:
            issue("IMAGE_EVIDENCE_INVALID", "Image check does not bind to a source page.")
            continue
        p = next(p for p in d["pages"] if p["pdf_page"] == check["pdf_page"])
        evidence = [{"doc_id": d["doc_id"], "sha256": d["sha256"], "pdf_page": p["pdf_page"]}]
        if not p.get("image_sha256") or not check.get("verified_by") or check.get("image_sha256") != p["image_sha256"] or not isinstance(check.get("verified_image_text"), str):
            issue("IMAGE_UNVERIFIED", "Image comparison is missing its source binding or trusted verifier.", evidence)
        elif check.get("ocr_text") != check["verified_image_text"]:
            issue("OCR_IMAGE_MISMATCH", "OCR differs from the separately verified page image; do not reconstruct silently.", evidence,
                  original_value=check["verified_image_text"], normalized_value=check.get("ocr_text"))

    def row_index(rows, label):
        result = {}
        if not isinstance(rows, list):
            issue("PARSE_HOLD", label + " owner rows are missing.")
            return result
        for row in rows:
            evidence = [row.get("evidence", {})] if isinstance(row, dict) else []
            if not isinstance(row, dict):
                issue("PARSE_HOLD", label + " owner row is malformed.")
                continue
            try:
                validate_evidence(job, row.get("evidence"))
            except (ValueError, TypeError):
                issue("PARSE_HOLD", label + " owner row has no valid source location.")
                continue
            identity_type = row.get("owner_id_type")
            if identity_type not in {"member_number", "statement_number"} or not all(isinstance(row.get(k), str) and row[k].strip() for k in ("owner_id", "property_id", "appraisal_id", "doc_id")):
                issue("PARSE_HOLD", label + " owner identifier is missing or unsupported; names and addresses are not fallback keys.", evidence)
                continue
            if row["doc_id"] != row["evidence"]["doc_id"]:
                issue("OWNER_SOURCE_MISMATCH", label + " owner belongs to another source document.", evidence, "P0")
                continue
            if label == "Reference":
                document = docs[row["doc_id"]]
                page = next(p for p in document["pages"] if p["pdf_page"] == row["evidence"]["pdf_page"])
                quote = row.get("source_quote")
                values = [row["owner_id"], row.get("amount")]
                factors = row.get("factors", {})
                if isinstance(factors, dict):
                    values.extend(factors.values())
                def literal_in_quote(value):
                    if not isinstance(value, str):
                        return False
                    if re.fullmatch(r"[0-9.]+", value):
                        return re.search(r"(?<![0-9.])" + re.escape(value) + r"(?![0-9]|\.[0-9])", quote) is not None
                    return re.search(r"(?<![A-Za-z0-9_-])" + re.escape(value) + r"(?![A-Za-z0-9_-])", quote) is not None

                if not row.get("verified_by") or not isinstance(quote, str) or not quote or quote not in page["text"] or not all(literal_in_quote(v) for v in values):
                    issue("REFERENCE_VALUE_UNVERIFIED", "Reference owner, amount and factor values require an exact source quote and independent extraction verifier.", evidence)
                    continue
            key = (row["doc_id"], identity_type, row["owner_id"], row["property_id"], row["appraisal_id"])
            if key in result:
                issue("PARSE_HOLD", label + " has a duplicate owner/property/appraisal relation.", evidence)
                continue
            result[key] = row
        return result

    owner_required = job.get("profile") != "QUICK" or bool(source.get("reference_rows")) or bool(source.get("candidate_rows"))
    reference = row_index(source.get("reference_rows"), "Reference") if owner_required else {}
    candidate_rows = None
    if not owner_required:
        candidate_rows = []
    elif job.get("artifact_format") == "lk-owner-comparison/1.0":
        try:
            artifact = json.loads(job["artifact_text"])
            if not isinstance(artifact, dict) or artifact.get("schema_version") != "lk-owner-comparison/1.0" or not isinstance(artifact.get("rows"), list):
                raise ValueError("ARTIFACT_ROWS_REQUIRED")
            candidate_rows = artifact["rows"]
        except (ValueError, TypeError):
            issue("ARTIFACT_VALUE_BINDING_UNVERIFIED", "Structured artifact rows cannot be read from the exact draft bytes.")
    else:
        issue("ARTIFACT_VALUE_BINDING_UNVERIFIED", "Prose owner values require a verified extraction adapter; detached candidate rows cannot establish draft correctness.")
    candidate = row_index(candidate_rows, "Candidate") if owner_required else {}
    if owner_required and not reference:
        issue("REFERENCE_OWNER_EVIDENCE_REQUIRED", "At least one independently checked source owner relation is required.")
    if set(reference) != set(candidate):
        issue("OWNER_RELATION_MISMATCH", "Owner relations differ; do not join by parcel, area, name, row or upload order.", severity="P0",
              missing=[list(k) for k in sorted(set(reference) - set(candidate))], extra=[list(k) for k in sorted(set(candidate) - set(reference))])
    units = {"원": Decimal(1), "천원": Decimal(1000)}
    for key in sorted(set(reference) & set(candidate)):
        ref, actual = reference[key], candidate[key]
        evidence = [ref["evidence"], actual["evidence"]]
        comparisons.append({"subject_key": list(key), "original_amount": ref.get("amount"), "original_unit": ref.get("unit"),
                            "candidate_amount": actual.get("amount"), "candidate_unit": actual.get("unit"),
                            "original_factors": ref.get("factors"), "candidate_factors": actual.get("factors"), "evidence": evidence})
        try:
            require_units = ref.get("unit") in units and actual.get("unit") in units
            if not require_units:
                raise ValueError("UNIT_RULE_UNKNOWN")
            with localcontext() as context:
                context.prec = 80
                original = decimal_string(ref.get("amount")) * units[ref["unit"]]
                normalized = decimal_string(actual.get("amount")) * units[actual["unit"]]
            if original != normalized:
                issue("OWNER_AMOUNT_DIFFERENCE", "Source and candidate amount differ for this owner/property/appraisal.", evidence,
                      subject_key=list(key), original_value=ref["amount"], normalized_value=actual["amount"], source_unit=ref["unit"], candidate_unit=actual["unit"], difference_won=str(normalized-original))
        except ValueError:
            issue("AMOUNT_RULE_UNKNOWN", "Amount or unit cannot be normalized without an explicit rule.", evidence)
        if not isinstance(ref.get("factors"), dict) or not isinstance(actual.get("factors"), dict):
            issue("FACTORS_MISSING", "Owner-specific factor evidence is missing.", evidence)
        elif canonical(ref["factors"]) != canonical(actual["factors"]):
            issue("OWNER_FACTOR_DIFFERENCE", "Individual factors differ for this owner/property/appraisal; same-parcel factors cannot be reused.", evidence,
                  subject_key=list(key), original_value=ref["factors"], normalized_value=actual["factors"])
    calculations = []
    for calculation in source.get("calculations", []):
        try:
            evidence = [validate_evidence(job, calculation.get("evidence"))]
            rounding = calculation.get("rounding")
            if not isinstance(rounding, dict) or rounding.get("mode") not in {"HALF_UP", "DOWN"} or type(rounding.get("places")) is not int or not 0 <= rounding["places"] <= 20 or rounding.get("stage") != "final":
                raise ValueError("ROUNDING_RULE_UNKNOWN")
            operands = calculation.get("operands")
            if not isinstance(operands, list) or not operands:
                raise ValueError("OPERANDS_REQUIRED")
            with localcontext() as context:
                context.prec = 80
                operands = [decimal_string(v) for v in operands]
                if calculation.get("operation") == "multiply":
                    value = Decimal(1)
                    for operand in operands:
                        value *= operand
                elif calculation.get("operation") == "sum":
                    value = sum(operands, Decimal(0))
                else:
                    raise ValueError("OPERATION_UNKNOWN")
                value = value.quantize(Decimal(1).scaleb(-rounding["places"]), rounding={"HALF_UP": ROUND_HALF_UP, "DOWN": ROUND_DOWN}[rounding["mode"]])
                expected = decimal_string(calculation.get("expected"))
            if not isinstance(calculation.get("unit"), str) or not calculation["unit"].strip():
                raise ValueError("UNIT_REQUIRED")
            result = {"calculation_id": calculation.get("calculation_id"), "original_value": calculation["expected"], "recalculated_value": str(value), "unit": calculation.get("unit"), "rounding": rounding, "evidence": evidence}
            calculations.append(result)
            if value != expected:
                issue("CALCULATION_DIFFERENCE", "Exact decimal recalculation differs; no arbitrary tolerance was applied.", evidence, **{k: v for k, v in result.items() if k != "evidence"})
        except (ValueError, ArithmeticError, TypeError, KeyError):
            issue("CALCULATION_UNVERIFIED", "Calculation has missing source, unit, operation or explicit rounding rules.")
    for legal in source.get("legal_sources", []):
        try:
            evidence = [validate_evidence(job, legal.get("evidence"))]
        except (ValueError, TypeError):
            evidence = []
        if not all(legal.get(key) for key in ("opened", "official", "as_of", "citation")) or not evidence:
            issue("LEGAL_SOURCE_UNVERIFIED", "Official source, applicable date and exact citation have not all been verified.", evidence)
    return {"passed": not any(i["severity"] in {"P0", "P1"} for i in issues), "issues": issues, "coverage": coverage, "calculations": calculations, "owner_comparison": comparisons,
            "source_manifest_hash": job["manifest_hash"], "artifact_hash": job["artifact_hash"], "rule_input_hash": digest(source)}
