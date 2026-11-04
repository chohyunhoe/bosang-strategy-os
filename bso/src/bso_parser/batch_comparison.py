# -*- coding: utf-8 -*-
"""동일 대상토지에 대한 복수 평가법인 결과를 시용 비교표로 압축한다."""
from __future__ import annotations

import re
from typing import Any

from .reverse_factor_audit import audit_appraisal_candidates, compare_cross_appraiser


FIELDS = (
    "company",
    "standard_symbol",
    "standard_lot",
    "official_price",
    "time_adjustment",
    "subject_individual_factor",
    "other_factor",
    "calculated_unit_price",
    "applied_unit_price",
    "amount",
)

_LOT_NORM_RE = re.compile(r"(산?)(\d+)(?:-(\d+))?$")


def _norm_lot(lot):
    if not lot:
        return lot
    match = _LOT_NORM_RE.match(str(lot).strip())
    if not match:
        return str(lot).strip()
    main = str(int(match.group(2)))
    return f"{match.group(1)}{main}-{int(match.group(3))}" if match.group(3) else f"{match.group(1)}{main}"


def _field_value(value: Any):
    if hasattr(value, "value"):
        return value.value
    if isinstance(value, dict) and "value" in value and "status" in value:
        return value.get("value")
    return value


def _select_schedule_value(canonical: dict) -> dict:
    target = canonical.get("target") or {}
    target_dong = target.get("dong")
    target_lot = target.get("lot")
    rows = canonical.get("land_schedule", {}).get("rows", [])
    values = [_field_value(r) for r in rows]
    values = [v for v in values if isinstance(v, dict) and v.get("unit_price")]
    if not values:
        return {}
    if not target_dong and not target_lot:
        return values[0] if len(values) == 1 else {}
    norm_target = _norm_lot(target_lot)
    matches = []
    for v in values:
        if target_dong and v.get("dong") != target_dong:
            continue
        if norm_target and _norm_lot(v.get("lot")) != norm_target:
            continue
        matches.append(v)
    return matches[0] if len(matches) == 1 else {}


def summarize_canonical(canonical: dict, company: str) -> dict:
    standard = canonical.get("standard_selection", {}).get("selected_standard")
    std_value = _field_value(standard) or {}
    other = canonical.get("other_factor", {})
    decided = _field_value(other.get("decided_value"))

    schedule_value = _select_schedule_value(canonical)

    subject_factor = None
    for row in canonical.get("subject_to_standard_factors", {}).get("rows", []):
        val = _field_value(row)
        if isinstance(val, dict) and val.get("factor_total") is not None:
            subject_factor = val.get("factor_total")
            break

    calculated = schedule_value.get("calculated_unit_price")
    if calculated is None:
        calculated = schedule_value.get("unit_price_before_rounding")
    target_comp = canonical.get("verification", {}).get("target_computation_summary") or {}
    if target_comp.get("calculated_unit_price") is not None:
        calculated = target_comp["calculated_unit_price"]

    return {
        "company": company,
        "standard_symbol": std_value.get("symbol") or std_value.get("marker"),
        "standard_lot": std_value.get("lot"),
        "official_price": std_value.get("official_price"),
        "time_adjustment": _field_value(
            (other.get("standard_row") or {}).get("time_adjustment")
        ),
        "subject_individual_factor": subject_factor,
        "other_factor": decided,
        "calculated_unit_price": calculated,
        "applied_unit_price": schedule_value.get("unit_price"),
        "amount": schedule_value.get("amount"),
        "review_count": len(canonical.get("review_queue", [])),
        "schema_valid": canonical.get("schema_validation", {}).get("valid"),
    }


def build_batch_comparison(items: list[dict]) -> dict:
    """회사별 canonical 결과를 비교 가능한 단일 payload로 만든다."""
    rows = []
    reverse_audits = []
    for item in items:
        if "canonical" in item:
            rows.append(summarize_canonical(item["canonical"], item["company"]))
            audit = item["canonical"].get("verification", {}).get("reverse_factor_audit")
            if audit:
                reverse_audits.append({
                    "company": item["company"],
                    "status": audit.get("status"),
                    "candidates": [dict(candidate, company=item["company"]) for candidate in audit.get("candidates", [])],
                })
        else:
            rows.append({key: item.get(key) for key in FIELDS})
            if item.get("reverse_factor_candidates"):
                reverse_audits.append(audit_appraisal_candidates(item))

    applied = [row["applied_unit_price"] for row in rows if row.get("applied_unit_price")]
    amounts = [row["amount"] for row in rows if row.get("amount")]
    result = {
        "appraisal_count": len(rows),
        "rows": rows,
        "summary": {
            "applied_unit_price_min": min(applied) if applied else None,
            "applied_unit_price_max": max(applied) if applied else None,
            "applied_unit_price_spread": max(applied) - min(applied) if len(applied) >= 2 else None,
            "amount_min": min(amounts) if amounts else None,
            "amount_max": max(amounts) if amounts else None,
            "amount_spread": max(amounts) - min(amounts) if len(amounts) >= 2 else None,
        },
    }
    if reverse_audits:
        result["reverse_factor_audit"] = {
            "appraisals": reverse_audits,
            "cross_appraiser_comparison": compare_cross_appraiser(reverse_audits),
        }
    return result
