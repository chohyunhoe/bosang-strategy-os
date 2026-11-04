from __future__ import annotations

import json
from typing import Any

from .semantic_table_pipeline import row_to_canonical


FACTOR_KEYS = (
    "street_condition",
    "access_condition",
    "environment_condition",
    "parcel_condition",
    "administrative_condition",
    "other_condition",
    "overall_individual_factor",
)


def _canonical_rows(table: dict[str, Any]) -> list[dict[str, object]]:
    header_map = {int(index): field for index, field in dict(table.get("header_map", {})).items()}
    return [row_to_canonical(list(row), header_map) for row in table.get("rows", [])]


def _score(item: dict[str, object]) -> int:
    keys = (
        "case_unit_price",
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
    return sum(item.get(key) is not None for key in keys)


def _merge(base: dict[str, object], supplement: dict[str, object]) -> dict[str, object]:
    merged = dict(base)
    for key, value in supplement.items():
        if merged.get(key) is None and value is not None:
            merged[key] = value
    return merged


def semantic_case_rows(tables: list[dict[str, Any]], company: str) -> list[dict[str, Any]]:
    accepted = {"STANDARD_TO_COMP_CASE", "OTHER_FACTOR_CALCULATION"}
    by_page: dict[int, list[dict[str, object]]] = {}

    for table in tables:
        if table.get("table_type") not in accepted:
            continue
        page = int(table["page"])
        for item in _canonical_rows(table):
            if any(item.get(key) is not None for key in FACTOR_KEYS) or item.get("case_unit_price") is not None:
                by_page.setdefault(page, []).append(item)

    output: list[dict[str, Any]] = []
    for page, items in sorted(by_page.items()):
        if not items:
            continue
        summary = max(items, key=_score)
        merged = dict(summary)
        for item in items:
            merged = _merge(merged, item)

        required = [merged.get("overall_individual_factor")]
        if merged.get("case_unit_price") is not None:
            required.extend(
                [
                    merged.get("time_adjustment"),
                    merged.get("regional_factor"),
                    merged.get("converted_reference_price"),
                ]
            )

        output.append(
            {
                "appraisal_company": company,
                "source_page": page,
                "case_id": f"semantic-p{page}",
                "case_lot_number": merged.get("lot_number"),
                "case_unit_price": merged.get("case_unit_price"),
                "case_price_date": merged.get("case_price_date"),
                "reference_lot_number": merged.get("reference_lot_number"),
                "time_adjustment": merged.get("time_adjustment"),
                "regional_factor": merged.get("regional_factor"),
                "street_condition": merged.get("street_condition"),
                "access_condition": merged.get("access_condition"),
                "environment_condition": merged.get("environment_condition"),
                "parcel_condition": merged.get("parcel_condition"),
                "administrative_condition": merged.get("administrative_condition"),
                "other_condition": merged.get("other_condition"),
                "overall_individual_factor": merged.get("overall_individual_factor"),
                "converted_reference_price": merged.get("converted_reference_price"),
                "review_status": "PASS" if all(value is not None for value in required) else "REVIEW_REQUIRED",
                "raw_excerpt": json.dumps(items, ensure_ascii=False),
                "extraction_path": "semantic_layout_page_merge",
            }
        )
    return output
