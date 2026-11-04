# -*- coding: utf-8 -*-
"""최종단가에서 누락된 종합 개별요인을 복원하는 분리형 감사 모듈.

역산값은 원문 추출값이 아니다. 이 모듈은 입력값의 출처 상태를 보존하고,
복원된 종합값을 ``REVERSE_INFERENCE``로 표시하며 6개 세부요인을 분해하지 않는다.
"""
from __future__ import annotations

import re
from collections import defaultdict
from math import isfinite
from typing import Any


SOURCE_CONFIRMED = "SOURCE_CONFIRMED"
ARITHMETIC_DERIVED = "ARITHMETIC_DERIVED"
REVERSE_INFERENCE = "REVERSE_INFERENCE"
REVIEW_REQUIRED = "REVIEW_REQUIRED"
NOT_IDENTIFIABLE = "NOT_IDENTIFIABLE"
ASSUMED_NEUTRAL = "ASSUMED_NEUTRAL"

FORMULA = (
    "applied_unit_price = official_price * time_adjustment * regional_factor "
    "* subject_individual_factor * other_factor"
)


def _positive_number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    value = float(value)
    return value if isfinite(value) and value > 0 else None


def _field_value(value: Any):
    if hasattr(value, "value"):
        return value.value
    if isinstance(value, dict) and "value" in value and "status" in value:
        return value.get("value")
    return value


def _field_status(value: Any) -> str:
    if hasattr(value, "status"):
        return SOURCE_CONFIRMED if value.status == "EXTRACTED" else REVIEW_REQUIRED
    if isinstance(value, dict) and "status" in value:
        return SOURCE_CONFIRMED if value.get("status") == "EXTRACTED" else REVIEW_REQUIRED
    return SOURCE_CONFIRMED


def audit_candidate(candidate: dict, applied_unit_price: int | float, company: str | None = None) -> dict:
    """후보 표준지 1건으로 종합 개별요인을 역산한다.

    ``candidate``는 특정 사건에 종속되지 않는 일반 입력 구조다. 후보 표준지의
    실제 적용 여부가 원문에서 확인되지 않은 경우 ``selection_status``를
    ``REVIEW_REQUIRED``로 전달해야 한다.
    """
    raw_inputs = {
        "official_price": candidate.get("official_price"),
        "time_adjustment": candidate.get("time_adjustment"),
        "regional_factor": candidate.get("regional_factor"),
        "other_factor": candidate.get("other_factor"),
        "applied_unit_price": applied_unit_price,
    }
    values = {key: _positive_number(value) for key, value in raw_inputs.items()}
    missing = [key for key, value in values.items() if value is None]
    identity = {
        "candidate_id": candidate.get("candidate_id"),
        "company": company or candidate.get("company"),
        "standard_symbol": candidate.get("standard_symbol"),
        "standard_dong": candidate.get("standard_dong"),
        "standard_lot": candidate.get("standard_lot"),
        "selection_status": candidate.get("selection_status", REVIEW_REQUIRED),
    }
    if missing:
        return {
            **identity,
            "status": NOT_IDENTIFIABLE,
            "formula": FORMULA,
            "missing_fields": missing,
            "note": "역산에 필요한 양수 입력값이 모두 확보되지 않음",
        }

    source_statuses = candidate.get("input_statuses") or {}
    formula_inputs = {
        key: {
            "value": raw_inputs[key],
            "status": source_statuses.get(key, SOURCE_CONFIRMED),
        }
        for key in raw_inputs
    }
    denominator = (
        values["official_price"]
        * values["time_adjustment"]
        * values["regional_factor"]
        * values["other_factor"]
    )
    implied = values["applied_unit_price"] / denominator
    roundtrip = denominator * implied
    rel_error = abs(roundtrip - values["applied_unit_price"]) / values["applied_unit_price"]

    stated = _positive_number(candidate.get("stated_subject_individual_factor"))
    stated_comparison = None
    if stated is not None:
        stated_comparison = {
            "stated_value": stated,
            "stated_status": candidate.get("stated_factor_status", SOURCE_CONFIRMED),
            "reverse_inferred_value": round(implied, 6),
            "absolute_difference": round(abs(stated - implied), 6),
        }

    return {
        **identity,
        "status": "INFERRED_CANDIDATE",
        "provenance_status": REVERSE_INFERENCE,
        "formula": FORMULA,
        "formula_inputs": formula_inputs,
        "derived_base_unit_price": {
            "value": round(denominator, 3),
            "status": ARITHMETIC_DERIVED,
        },
        "implied_subject_individual_factor": {
            "value": round(implied, 6),
            "status": REVERSE_INFERENCE,
        },
        "roundtrip_check": {
            "recomposed_unit_price": round(roundtrip, 3),
            "relative_error": round(rel_error, 9),
            "status": ARITHMETIC_DERIVED,
            "note": "산술 자기검산이며 원문 독립검증을 의미하지 않음",
        },
        "stated_factor_comparison": stated_comparison,
        "individual_factor_breakdown": {
            "status": NOT_IDENTIFIABLE,
            "items": None,
            "note": "종합 개별요인만 역산 가능하며 6개 세부요인은 원문 없이 분해하지 않음",
        },
        "limitations": [
            "후보 비교표준지의 실제 적용 여부는 selection_status에 따름",
            "중간값 및 최종단가의 반올림 영향이 포함될 수 있음",
            "역산값은 감정평가 판단이나 적정성 판정을 대체하지 않음",
        ],
    }


def audit_appraisal_candidates(appraisal: dict) -> dict:
    company = appraisal.get("company") or appraisal.get("appraisal_company")
    applied = appraisal.get("applied_unit_price")
    candidates = [
        audit_candidate(candidate, applied, company=company)
        for candidate in appraisal.get("reverse_factor_candidates", [])
    ]
    usable = [item for item in candidates if item.get("status") == "INFERRED_CANDIDATE"]
    return {
        "company": company,
        "target_lot": appraisal.get("subject_lot"),
        "applied_unit_price": applied,
        "status": "INFERRED_CANDIDATE" if usable else NOT_IDENTIFIABLE,
        "candidates": candidates,
        "note": "후보 순위는 원문상 실제 선정 표준지 확정을 의미하지 않음",
    }


def compare_cross_appraiser(appraisal_audits: list[dict], convergence_abs_tol: float = 0.01) -> dict:
    """동일 표준지 후보의 법인별 역산값 수렴도를 비교한다."""
    groups: dict[tuple[str | None, str | None], list[dict]] = defaultdict(list)
    for audit in appraisal_audits:
        for candidate in audit.get("candidates", []):
            if candidate.get("status") != "INFERRED_CANDIDATE":
                continue
            if not candidate.get("standard_lot"):
                continue
            key = (candidate.get("standard_dong"), candidate.get("standard_lot"))
            groups[key].append(candidate)

    results = []
    for (dong, lot), candidates in groups.items():
        values = [item["implied_subject_individual_factor"]["value"] for item in candidates]
        companies = sorted({item.get("company") for item in candidates if item.get("company")})
        spread = max(values) - min(values) if len(values) >= 2 else None
        if len(companies) < 2:
            status = "SINGLE_APPRAISER"
        elif spread is not None and spread <= convergence_abs_tol:
            status = "CONVERGENT_CANDIDATE"
        else:
            status = "DIVERGENT_CANDIDATE"
        results.append({
            "standard_dong": dong,
            "standard_lot": lot,
            "companies": companies,
            "implied_values": values,
            "absolute_spread": round(spread, 6) if spread is not None else None,
            "status": status,
            "selection_status": REVIEW_REQUIRED,
        })

    ranked = sorted(
        results,
        key=lambda item: (
            0 if len(item["companies"]) >= 2 else 1,
            item["absolute_spread"] if item["absolute_spread"] is not None else float("inf"),
            item.get("standard_lot") or "",
        ),
    )
    return {
        "status": REVIEW_REQUIRED if ranked else NOT_IDENTIFIABLE,
        "convergence_absolute_tolerance": convergence_abs_tol,
        "ranking_basis": "cross_appraiser_absolute_spread_only",
        "groups": ranked,
        "best_supported_candidate": (
            ranked[0] if ranked and ranked[0]["status"] == "CONVERGENT_CANDIDATE" else None
        ),
        "note": "수렴도 순위는 후보 표준지의 실제 적용을 확정하지 않음",
    }


def build_batch_reverse_audit(appraisals: list[dict]) -> dict:
    audits = [audit_appraisal_candidates(item) for item in appraisals]
    return {
        "appraisals": audits,
        "cross_appraiser_comparison": compare_cross_appraiser(audits),
    }


_LOT_NORM_RE = re.compile(r"(산?)(\d+)(?:-(\d+))?$")


def _norm_lot(lot: str | None) -> str | None:
    if not lot:
        return lot
    match = _LOT_NORM_RE.match(lot.strip())
    if not match:
        return lot.strip()
    main = str(int(match.group(2)))
    return f"{match.group(1)}{main}-{int(match.group(3))}" if match.group(3) else f"{match.group(1)}{main}"


def _select_schedule_row(
    schedule_values: list,
    target_dong: str | None = None,
    target_lot: str | None = None,
    target_serial: str | None = None,
) -> tuple[list, dict | None]:
    has_target = target_dong or target_lot or target_serial
    if not has_target:
        if len(schedule_values) == 1:
            return schedule_values, None
        return [], {
            "status": NOT_IDENTIFIABLE,
            "candidates": [],
            "missing_fields": ["unique_land_schedule_row"],
            "note": "대상토지 평가행이 정확히 1건일 때만 자동 역산",
        }
    norm_target = _norm_lot(target_lot)
    matches = []
    for value, status in schedule_values:
        if target_dong and value.get("dong") != target_dong:
            continue
        if norm_target and _norm_lot(value.get("lot")) != norm_target:
            continue
        if target_serial and str(value.get("serial")) != str(target_serial):
            continue
        matches.append((value, status))
    if len(matches) == 0:
        return [], {
            "status": NOT_IDENTIFIABLE,
            "candidates": [],
            "note": f"대상토지 {target_dong or ''} {target_lot or ''} 일치 행 없음",
        }
    if len(matches) == 1:
        return matches, None
    return [], {
        "status": REVIEW_REQUIRED,
        "candidates": [],
        "note": (
            f"대상토지 {target_dong or ''} {target_lot or ''} 일치 행 {len(matches)}건 — "
            "분할평가·지분평가·일단지 가능성을 수동검토"
        ),
    }


def build_from_canonical(
    canonical: dict,
    *,
    target_dong: str | None = None,
    target_lot: str | None = None,
    target_serial: str | None = None,
) -> dict:
    """현재 canonical 1건에서 가능한 범위만 역산 감사한다."""
    selected = canonical.get("standard_selection", {}).get("selected_standard")
    selected_value = _field_value(selected) or {}
    standard_row = canonical.get("other_factor", {}).get("standard_row") or {}
    decided = canonical.get("other_factor", {}).get("decided_value")

    schedule_values = []
    for row in canonical.get("land_schedule", {}).get("rows", []):
        value = _field_value(row)
        if isinstance(value, dict) and value.get("unit_price"):
            schedule_values.append((value, _field_status(row)))

    selected_rows, failure = _select_schedule_row(
        schedule_values,
        target_dong=target_dong,
        target_lot=target_lot,
        target_serial=target_serial,
    )

    target_comp = canonical.get("verification", {}).get("target_computation_summary")
    if failure is not None and target_comp:
        comp_unit = target_comp.get("decided_unit_price")
        if comp_unit:
            comp_value = {
                "dong": target_comp.get("dong"),
                "lot": target_comp.get("lot"),
                "serial": target_comp.get("serial"),
                "unit_price": comp_unit,
                "area_sqm": target_comp.get("area_sqm"),
                "amount": target_comp.get("amount"),
            }
            selected_rows = [(comp_value, REVIEW_REQUIRED)]
            failure = None

    if failure is not None:
        return failure

    official_field = standard_row.get("official_price")
    official = _field_value(official_field)
    if official is None:
        official = selected_value.get("official_price")
        official_status = _field_status(selected)
    else:
        official_status = _field_status(official_field)
    time_field = standard_row.get("time_adjustment")
    time_adjustment = _field_value(time_field)

    stated_totals = []
    for row in canonical.get("subject_to_standard_factors", {}).get("rows", []):
        value = _field_value(row)
        if not isinstance(value, dict):
            continue
        if target_lot and _norm_lot(value.get("lot")) != _norm_lot(target_lot):
            continue
        if value.get("factor_total") is not None:
            stated_totals.append(value.get("factor_total"))

    schedule_value, schedule_status = selected_rows[0]
    candidate = {
        "candidate_id": "canonical_selected_standard",
        "standard_symbol": _field_value(standard_row.get("standard_marker")),
        "standard_dong": selected_value.get("dong"),
        "standard_lot": selected_value.get("lot"),
        "official_price": official,
        "time_adjustment": time_adjustment,
        "regional_factor": 1.0,
        "other_factor": _field_value(decided),
        "selection_status": _field_status(selected),
        "input_statuses": {
            "official_price": official_status,
            "time_adjustment": _field_status(time_field),
            "regional_factor": ASSUMED_NEUTRAL,
            "other_factor": _field_status(decided),
            "applied_unit_price": schedule_status,
        },
        "stated_subject_individual_factor": stated_totals[0] if len(stated_totals) == 1 else None,
        "stated_factor_status": SOURCE_CONFIRMED,
    }
    audit = audit_candidate(candidate, schedule_value["unit_price"])
    return {
        "status": audit.get("status"),
        "target_lot": schedule_value.get("lot"),
        "candidates": [audit],
        "note": "regional_factor=1.0은 중립 가정으로 표시되며 원문값으로 승격하지 않음",
    }
