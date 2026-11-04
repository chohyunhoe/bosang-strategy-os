from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from .generator import build_output
from .layout_table_extractor import extract_semantic_tables
from .models import BriefOutput
from .other_factor_extractor import extract_other_factor_comparisons
from .pdf_extractor import extract_pdf
from .run_prototype import apply_rows, attach_case_factor_qa, semantic_subject_rows
from .semantic_case_assembler import semantic_case_rows


def _subject_key(row: dict[str, Any]) -> tuple[str, str]:
    return str(row.get("company_hint")), str(row.get("lot_number"))


def _case_key(row: dict[str, Any]) -> str:
    return str(row.get("appraisal_company"))


def _subject_score(row: dict[str, Any]) -> int:
    keys = (
        "official_price_per_sqm",
        "time_adjustment",
        "regional_factor",
        "overall_individual_factor",
        "other_factor",
        "calculated_unit_price",
        "decided_unit_price",
    )
    return sum(row.get(key) is not None for key in keys)


def _case_score(row: dict[str, Any]) -> int:
    keys = (
        "case_unit_price",
        "case_price_date",
        "time_adjustment",
        "regional_factor",
        "street_condition",
        "access_condition",
        "environment_condition",
        "parcel_condition",
        "administrative_condition",
        "other_condition",
        "overall_individual_factor",
        "converted_reference_price",
    )
    return sum(row.get(key) is not None for key in keys)


def choose_subject_rows(semantic_rows: list[dict[str, Any]], fallback_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    selected: dict[tuple[str, str], dict[str, Any]] = {}
    for row in fallback_rows + semantic_rows:
        key = _subject_key(row)
        current = selected.get(key)
        if current is None or _subject_score(row) > _subject_score(current):
            selected[key] = row
        elif _subject_score(row) == _subject_score(current) and row.get("extraction_path") == "semantic_layout":
            selected[key] = row
    return list(selected.values())


def choose_case_rows(semantic_rows: list[dict[str, Any]], fallback_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    selected: dict[str, dict[str, Any]] = {}
    for row in fallback_rows + semantic_rows:
        key = _case_key(row)
        current = selected.get(key)
        if current is None or _case_score(row) > _case_score(current):
            selected[key] = row
        elif _case_score(row) == _case_score(current) and str(row.get("extraction_path", "")).startswith("semantic_layout"):
            selected[key] = row
    return list(selected.values())


def main() -> None:
    parser = argparse.ArgumentParser(description="보상전략 OS v0.1 복원력 우선 PDF 분석 프로토타입")
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
        fallback_subject_all.extend(row.to_dict() for row in extract_pdf(pdf_path, company_hint=company))
        fallback_case_all.extend(row.to_dict() for row in extract_other_factor_comparisons(pdf_path, appraisal_company=company))

    selected_subject = choose_subject_rows(semantic_subject_all, fallback_subject_all)
    selected_case = choose_case_rows(semantic_case_all, fallback_case_all)

    patched = apply_rows(base, selected_subject, selected_case)
    patched["source_bundle"]["prototype_extraction"]["strategy"] = "pymupdf_words_page_merge_then_regex_fallback"
    patched["source_bundle"]["prototype_extraction"]["semantic_engine"] = "pymupdf_words"
    patched["source_bundle"]["prototype_extraction"]["semantic_subject_rows"] = len(semantic_subject_all)
    patched["source_bundle"]["prototype_extraction"]["fallback_subject_rows"] = len(fallback_subject_all)
    patched["source_bundle"]["prototype_extraction"]["semantic_case_rows"] = len(semantic_case_all)
    patched["source_bundle"]["prototype_extraction"]["fallback_case_rows"] = len(fallback_case_all)

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
