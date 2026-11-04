from __future__ import annotations

import argparse
import json
import re
from copy import deepcopy
from pathlib import Path
from typing import Any

from .generator import build_output
from .layout_table_extractor import extract_semantic_tables
from .models import BriefOutput, QAResult, ReviewItem, ReviewStatus
from .other_factor_extractor import extract_other_factor_comparisons
from .pdf_extractor import extract_pdf
from .semantic_table_pipeline import row_to_canonical


FACTOR_KEYS = (
    "street_condition",
    "access_condition",
    "environment_condition",
    "parcel_condition",
    "administrative_condition",
    "other_condition",
)


def _normalize_subject_lot(value: object) -> str | None:
    text = re.sub(r"\s+", "", str(value or ""))
    match = re.search(r"120-?0*(7|8)(?!\d)", text)
    return f"120-{match.group(1)}" if match else None


def _canonical_rows(table: dict[str, Any]) -> list[dict[str, object]]:
    header_map = {int(index): field for index, field in dict(table.get("header_map", {})).items()}
    return [row_to_canonical(list(row), header_map) for row in table.get("rows", [])]


def semantic_subject_rows(tables: list[dict[str, Any]], company: str) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for table in tables:
        if table.get("table_type") != "SUBJECT_TO_STANDARD":
            continue
        for item in _canonical_rows(table):
            lot = _normalize_subject_lot(item.get("lot_number"))
            if not lot:
                continue
            factors = {
                key: {
                    "value": item.get(key),
                    "state": "not_applicable" if item.get(f"{key}_raw") in {"-", "–", "—"} else (
                        "extracted" if item.get(key) is not None else "missing"
                    ),
                    "raw": str(item.get(f"{key}_raw", "")),
                }
                for key in FACTOR_KEYS
            }
            required = [
                item.get("official_price_per_sqm"),
                item.get("time_adjustment"),
                item.get("overall_individual_factor"),
                item.get("other_factor"),
                item.get("decided_unit_price"),
            ]
            complete = all(value is not None for value in required)
            output.append(
                {
                    "company_hint": company,
                    "page": int(table["page"]),
                    "lot_number": lot,
                    "official_price_per_sqm": item.get("official_price_per_sqm"),
                    "time_adjustment": item.get("time_adjustment"),
                    "regional_factor": item.get("regional_factor"),
                    **factors,
                    "overall_individual_factor": item.get("overall_individual_factor"),
                    "other_factor": item.get("other_factor"),
                    "road_factor": None,
                    "calculated_unit_price": item.get("calculated_unit_price"),
                    "decided_unit_price": item.get("decided_unit_price"),
                    "confidence": "high" if complete else "low",
                    "review_required": not complete,
                    "raw_segment": json.dumps(item, ensure_ascii=False),
                    "extraction_path": "semantic_layout",
                }
            )
    return output


def semantic_case_rows(tables: list[dict[str, Any]], company: str) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    accepted = {"STANDARD_TO_COMP_CASE", "OTHER_FACTOR_CALCULATION"}
    for table in tables:
        if table.get("table_type") not in accepted:
            continue
        for index, item in enumerate(_canonical_rows(table), start=1):
            required = [item.get("case_unit_price"), item.get("overall_individual_factor")]
            output.append(
                {
                    "appraisal_company": company,
                    "source_page": int(table["page"]),
                    "case_id": f"semantic-p{table['page']}-r{index}",
                    "case_lot_number": item.get("lot_number"),
                    "case_unit_price": item.get("case_unit_price"),
                    "case_price_date": item.get("case_price_date"),
                    "reference_lot_number": item.get("reference_lot_number"),
                    "time_adjustment": item.get("time_adjustment"),
                    "regional_factor": item.get("regional_factor"),
                    "street_condition": item.get("street_condition"),
                    "access_condition": item.get("access_condition"),
                    "environment_condition": item.get("environment_condition"),
                    "parcel_condition": item.get("parcel_condition"),
                    "administrative_condition": item.get("administrative_condition"),
                    "other_condition": item.get("other_condition"),
                    "overall_individual_factor": item.get("overall_individual_factor"),
                    "converted_reference_price": item.get("converted_reference_price"),
                    "review_status": "PASS" if all(value is not None for value in required) else "REVIEW_REQUIRED",
                    "raw_excerpt": json.dumps(item, ensure_ascii=False),
                    "extraction_path": "semantic_layout",
                }
            )
    return output


def _subject_key(row: dict[str, Any]) -> tuple[str, str | None]:
    return row.get("company_hint", ""), _normalize_subject_lot(row.get("lot_number"))


def merge_subject_rows(primary: list[dict[str, Any]], fallback: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[tuple[str, str | None], dict[str, Any]] = {}
    for row in primary:
        key = _subject_key(row)
        if key[1]:
            merged[key] = row
    for row in fallback:
        key = _subject_key(row)
        if key[1] and key not in merged:
            copied = dict(row)
            copied["extraction_path"] = "regex_fallback"
            merged[key] = copied
    return list(merged.values())


def merge_case_rows(primary: list[dict[str, Any]], fallback: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for row in primary:
        company = str(row.get("appraisal_company") or "")
        if company and row.get("overall_individual_factor") is not None:
            merged[company] = row
    for row in fallback:
        company = str(row.get("appraisal_company") or "")
        if company and company not in merged:
            copied = dict(row)
            copied["extraction_path"] = "regex_fallback"
            merged[company] = copied
    return list(merged.values())


def clear_extracted_values(payload: dict[str, Any]) -> None:
    for target in payload["valuation_bundle"]:
        for key in (
            "official_price_per_sqm", "time_adjustment", "regional_factor", "other_factor",
            "calculated_unit_price", "decided_unit_price",
        ):
            target[key] = None
        target["source_refs"] = []
        factors = target["individual_factors"]
        for key in FACTOR_KEYS:
            factors[key] = None
        factors["overall_individual_factor"] = None
        factors["source_refs"] = []
        factors["review_status"] = "FAIL"


def apply_rows(base: dict[str, Any], rows: list[dict[str, Any]], case_rows: list[dict[str, Any]]) -> dict[str, Any]:
    payload = deepcopy(base)
    clear_extracted_values(payload)
    by_key = {(item["appraisal_company"], item["subject_parcel_id"]): item for item in payload["valuation_bundle"]}
    lot_to_id = {"120-7": "subject-120-7", "120-8": "subject-120-8"}

    for row in rows:
        lot = _normalize_subject_lot(row.get("lot_number"))
        parcel_id = lot_to_id.get(lot or "")
        target = by_key.get((row.get("company_hint"), parcel_id))
        if not target:
            continue
        for key in (
            "official_price_per_sqm", "time_adjustment", "regional_factor", "other_factor",
            "calculated_unit_price", "decided_unit_price",
        ):
            target[key] = row.get(key)
        document_id = "doc-central" if str(row.get("company_hint", "")).startswith("중앙") else "doc-junghae"
        locator = str(row.get("extraction_path") or "extracted table")
        target["source_refs"] = [{"document_id": document_id, "page": row.get("page"), "locator": locator}]
        factors = target["individual_factors"]
        for key in FACTOR_KEYS:
            factor = row.get(key)
            factors[key] = factor.get("value") if isinstance(factor, dict) else factor
        factors["overall_individual_factor"] = row.get("overall_individual_factor")
        factors["source_refs"] = target["source_refs"]
        factors["review_status"] = "PASS" if not row.get("review_required") else "REVIEW_REQUIRED"

    expected_keys = set(by_key)
    extracted_keys = {
        (row.get("company_hint"), lot_to_id.get(_normalize_subject_lot(row.get("lot_number")) or ""))
        for row in rows
        if _normalize_subject_lot(row.get("lot_number"))
    }
    missing_keys = expected_keys - extracted_keys
    case_companies = {row["appraisal_company"] for row in case_rows if row.get("overall_individual_factor") is not None}
    expected_companies = {item["appraisal_company"] for item in payload["document_meta"] if item.get("appraisal_company")}
    missing_case_companies = sorted(expected_companies - case_companies)

    payload["analysis_bundle"]["standard_to_comp_case_factor_comparisons"] = case_rows
    payload["source_bundle"]["prototype_extraction"] = {
        "primary_path": "semantic_layout",
        "fallback_path": "regex_fallback",
        "expected_subject_rows": len(expected_keys),
        "extracted_subject_rows": len(extracted_keys & expected_keys),
        "missing_subject_rows": [f"{company}:{parcel}" for company, parcel in sorted(missing_keys)],
        "expected_case_comparison_companies": sorted(expected_companies),
        "extracted_case_comparison_companies": sorted(case_companies),
        "missing_case_comparison_companies": missing_case_companies,
        "status": "complete" if not missing_keys and not missing_case_companies else "partial",
    }
    payload["run_meta"]["status"] = "complete" if not missing_keys and not missing_case_companies else "partial"
    return payload


def attach_case_factor_qa(output: BriefOutput) -> BriefOutput:
    rows = list(output.analysis_bundle.get("standard_to_comp_case_factor_comparisons", []))
    expected = {item.appraisal_company for item in output.document_meta if item.appraisal_company}
    complete = {str(row.get("appraisal_company")) for row in rows if row.get("overall_individual_factor") is not None}
    missing = sorted(expected - complete)
    output.qa_bundle.append(
        QAResult(
            rule_id="QA-STANDARD-TO-COMP-CASE-FACTORS",
            status=ReviewStatus.FAIL if missing else ReviewStatus.PASS,
            message=(
                "비교표준지와 거래사례 간 개별요인 수치가 누락된 평가법인이 있다: " + ", ".join(missing)
                if missing else "평가법인별 비교표준지↔거래사례 개별요인 수치가 추출되었다."
            ),
            source_keys=missing,
        )
    )
    output.review_queue.append(
        ReviewItem(
            review_id="review-standard-to-comp-case-factors",
            priority="P0",
            title="비교표준지와 거래사례 간 개별요인 검토",
            reason="그 밖의 요인 보정치 산출구조의 원문 대조가 필요하다.",
            verification_method="사례, 가격시점, 시점수정, 지역요인, 개별요인 및 환산단가를 대조한다.",
        )
    )
    if missing:
        output.run_meta.status = "partial"
    return BriefOutput.model_validate(output.model_dump())


def main() -> None:
    parser = argparse.ArgumentParser(description="보상전략 OS v0.1 의미 기반 PDF 분석 프로토타입")
    parser.add_argument("--central", required=True)
    parser.add_argument("--junghae", required=True)
    parser.add_argument("--output", default="prototype-output")
    args = parser.parse_args()

    root = Path(__file__).resolve().parent
    base = json.loads((root / "golden_case_shinmh_input.json").read_text(encoding="utf-8"))
    semantic_dump: list[dict[str, Any]] = []
    semantic_subject: list[dict[str, Any]] = []
    semantic_case: list[dict[str, Any]] = []
    fallback_subject: list[dict[str, Any]] = []
    fallback_case: list[dict[str, Any]] = []

    for path, company in ((args.central, "중앙감정평가법인"), (args.junghae, "정해감정평가법인")):
        tables = extract_semantic_tables(path)
        for table in tables:
            table["appraisal_company"] = company
        semantic_dump.extend(tables)
        semantic_subject.extend(semantic_subject_rows(tables, company))
        semantic_case.extend(semantic_case_rows(tables, company))
        fallback_subject.extend(row.to_dict() for row in extract_pdf(path, company_hint=company))
        fallback_case.extend(row.to_dict() for row in extract_other_factor_comparisons(path, appraisal_company=company))

    extracted = merge_subject_rows(semantic_subject, fallback_subject)
    case_extracted = merge_case_rows(semantic_case, fallback_case)
    patched = apply_rows(base, extracted, case_extracted)
    output = attach_case_factor_qa(build_output(BriefOutput.model_validate(patched)))
    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)
    files = {
        "semantic_tables.json": semantic_dump,
        "semantic_subject_rows.json": semantic_subject,
        "semantic_case_rows.json": semantic_case,
        "fallback_subject_rows.json": fallback_subject,
        "fallback_case_rows.json": fallback_case,
        "extraction_result.json": extracted,
        "standard_to_comp_case_factor_comparisons.json": case_extracted,
        "qa_report.json": [item.model_dump(mode="json") for item in output.qa_bundle],
    }
    for name, value in files.items():
        (out_dir / name).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "bso_brief_output_v0.1.json").write_text(output.model_dump_json(indent=2), encoding="utf-8")
    print(out_dir.resolve())


if __name__ == "__main__":
    main()
