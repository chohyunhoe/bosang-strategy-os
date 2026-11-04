from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from .case_summary_text_extractor import extract_case_summary
from .fitz_layout_table_extractor import extract_semantic_tables
from .generator import build_output
from .models import BriefOutput
from .other_factor_extractor import extract_other_factor_comparisons
from .pdf_extractor import extract_pdf
from .run_prototype import apply_rows, attach_case_factor_qa, semantic_subject_rows
from .semantic_case_assembler import semantic_case_rows
from .verified_subject_rows import verified_subject_rows


def _subject_key(row: dict[str, Any]) -> tuple[str, str]:
    return str(row.get("company_hint")), str(row.get("lot_number"))


def _case_key(row: dict[str, Any]) -> str:
    return str(row.get("appraisal_company"))


def _subject_score(row: dict[str, Any]) -> int:
    keys = (
        "official_price_per_sqm", "time_adjustment", "regional_factor",
        "overall_individual_factor", "other_factor", "calculated_unit_price", "decided_unit_price",
        "appraised_amount",
    )
    score = sum(row.get(key) is not None for key in keys)
    if row.get("extraction_path") == "verified_page_capture":
        score += 2
    return score


def _case_score(row: dict[str, Any]) -> int:
    keys = (
        "case_unit_price", "case_price_date", "time_adjustment", "regional_factor",
        "street_condition", "access_condition", "environment_condition", "parcel_condition",
        "administrative_condition", "other_condition", "overall_individual_factor", "converted_reference_price",
    )
    return sum(row.get(key) is not None for key in keys)


def choose_subject_rows(semantic_rows: list[dict[str, Any]], fallback_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    selected: dict[tuple[str, str], dict[str, Any]] = {}
    for row in fallback_rows + semantic_rows:
        key = _subject_key(row)
        current = selected.get(key)
        if current is None or _subject_score(row) > _subject_score(current):
            selected[key] = row
        elif _subject_score(row) == _subject_score(current) and str(row.get("extraction_path", "")).startswith("semantic"):
            selected[key] = row
    return list(selected.values())


def combine_case_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Merge complementary rows from the same company and page."""
    grouped: dict[tuple[str, int], list[dict[str, Any]]] = {}
    for row in rows:
        key = (str(row.get("appraisal_company") or ""), int(row.get("source_page") or 0))
        if key[0] and key[1]:
            grouped.setdefault(key, []).append(row)

    combined: list[dict[str, Any]] = []
    for (company, page), items in grouped.items():
        merged = dict(max(items, key=_case_score))
        for item in items:
            for key, value in item.items():
                if merged.get(key) is None and value is not None:
                    merged[key] = value
        merged["appraisal_company"] = company
        merged["source_page"] = page
        merged["case_id"] = f"combined-p{page}"
        required = (
            merged.get("case_unit_price"), merged.get("time_adjustment"),
            merged.get("regional_factor"), merged.get("overall_individual_factor"),
            merged.get("converted_reference_price"),
        )
        merged["review_status"] = "PASS" if all(value is not None for value in required) else "REVIEW_REQUIRED"
        merged["extraction_path"] = "semantic_page_merge_with_text_summary"
        combined.append(merged)
    return combined


def choose_case_rows(semantic_rows: list[dict[str, Any]], fallback_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    selected: dict[str, dict[str, Any]] = {}
    for row in fallback_rows + combine_case_rows(semantic_rows):
        key = _case_key(row)
        current = selected.get(key)
        if current is None or _case_score(row) > _case_score(current):
            selected[key] = row
        elif _case_score(row) == _case_score(current) and str(row.get("extraction_path", "")).startswith("semantic"):
            selected[key] = row
    return list(selected.values())


def _attach_appraised_amounts(payload: dict[str, Any], rows: list[dict[str, Any]]) -> None:
    lot_to_id = {"120-7": "subject-120-7", "120-8": "subject-120-8"}
    by_key = {
        (item["appraisal_company"], item["subject_parcel_id"]): item
        for item in payload.get("valuation_bundle", [])
    }
    for row in rows:
        amount = row.get("appraised_amount")
        parcel_id = lot_to_id.get(str(row.get("lot_number") or ""))
        target = by_key.get((row.get("company_hint"), parcel_id))
        if target is not None and amount is not None:
            target["appraised_amount"] = amount


def main() -> None:
    parser = argparse.ArgumentParser(description="보상전략 OS v0.1 PyMuPDF 복원력 우선 PDF 분석")
    parser.add_argument("--central", required=True)
    parser.add_argument("--junghae", required=True)
    parser.add_argument("--output", default="prototype-output")
    args = parser.parse_args()

    root = Path(__file__).resolve().parent
    base = json.loads((root / "golden_case_shinmh_input.json").read_text(encoding="utf-8"))
    semantic_dump: list[dict[str, Any]] = []
    semantic_subject_all: list[dict[str, Any]] = []
    fallback_subject_all: list[dict[str, Any]] = []
    semantic_case_all: list[dict[str, Any]] = []
    fallback_case_all: list[dict[str, Any]] = []

    for pdf_path, company in ((args.central, "중앙감정평가법인"), (args.junghae, "정해감정평가법인")):
        tables = extract_semantic_tables(pdf_path)
        for table in tables:
            table["appraisal_company"] = company
        semantic_dump.extend(tables)
        semantic_subject_all.extend(semantic_subject_rows(tables, company))
        semantic_case_all.extend(semantic_case_rows(tables, company))
        semantic_case_all.extend(extract_case_summary(pdf_path, company))
        fallback_subject_all.extend(row.to_dict() for row in extract_pdf(pdf_path, company_hint=company))
        fallback_case_all.extend(row.to_dict() for row in extract_other_factor_comparisons(pdf_path, appraisal_company=company))

    semantic_subject_all.extend(verified_subject_rows())
    selected_subject = choose_subject_rows(semantic_subject_all, fallback_subject_all)
    selected_case = choose_case_rows(semantic_case_all, fallback_case_all)
    patched = apply_rows(base, selected_subject, selected_case)
    _attach_appraised_amounts(patched, selected_subject)
    meta = patched["source_bundle"]["prototype_extraction"]
    meta["strategy"] = "pymupdf_words_text_summary_verified_capture_then_regex_fallback"
    meta["semantic_engine"] = "pymupdf_words"
    meta["semantic_subject_rows"] = len(semantic_subject_all)
    meta["fallback_subject_rows"] = len(fallback_subject_all)
    meta["semantic_case_rows"] = len(semantic_case_all)
    meta["fallback_case_rows"] = len(fallback_case_all)

    output = attach_case_factor_qa(build_output(BriefOutput.model_validate(patched)))
    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)
    artifacts = {
        "semantic_tables.json": semantic_dump,
        "semantic_subject_candidates.json": semantic_subject_all,
        "fallback_subject_candidates.json": fallback_subject_all,
        "semantic_case_candidates.json": semantic_case_all,
        "fallback_case_candidates.json": fallback_case_all,
        "extraction_result.json": selected_subject,
        "standard_to_comp_case_factor_comparisons.json": selected_case,
        "qa_report.json": [item.model_dump(mode="json") for item in output.qa_bundle],
    }
    for filename, value in artifacts.items():
        (out_dir / filename).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "bso_brief_output_v0.1.json").write_text(output.model_dump_json(indent=2), encoding="utf-8")
    print(out_dir.resolve())


if __name__ == "__main__":
    main()
