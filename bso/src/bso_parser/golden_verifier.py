# -*- coding: utf-8 -*-
"""시용 배치 canonical 결과를 기대값 fixture와 비교한다.

활성 파서에는 특정 사업·법인·지번·단가를 넣지 않는다. 이 모듈은
회귀검증 단계에서만 fixture를 읽어 추출 결과의 일치 여부를 판정한다.
"""
from __future__ import annotations

import re
from typing import Any

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
    if isinstance(value, dict) and "value" in value:
        return value.get("value")
    return value


def _first_schedule_row(canonical: dict) -> dict:
    target = canonical.get("target") or {}
    target_dong = target.get("dong")
    target_lot = target.get("lot")
    rows = canonical.get("land_schedule", {}).get("rows", [])
    values = []
    for row in rows:
        data = _field_value(row)
        if isinstance(data, dict):
            values.append(data)
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


def _subject_total(canonical: dict):
    rows = canonical.get("subject_to_standard_factors", {}).get("rows", [])
    for row in rows:
        data = _field_value(row)
        if isinstance(data, dict) and data.get("factor_total") is not None:
            return data.get("factor_total")
    return None


def _other_factor(canonical: dict):
    decided = canonical.get("other_factor", {}).get("decided_value")
    return _field_value(decided)


def _standard(canonical: dict) -> dict:
    selected = canonical.get("standard_selection", {}).get("selected_standard")
    data = _field_value(selected)
    return data if isinstance(data, dict) else {}


def extract_trial_metrics(canonical: dict) -> dict:
    schedule = _first_schedule_row(canonical)
    standard = _standard(canonical)
    return {
        "subject_lot": schedule.get("lot"),
        "standard_lot": standard.get("lot"),
        "official_price": standard.get("official_price"),
        "subject_factor_total": _subject_total(canonical),
        "other_factor": _other_factor(canonical),
        "unit_price": schedule.get("unit_price"),
        "amount": schedule.get("amount"),
    }


def verify_against_expected(canonical: dict, expected: dict, rel_tol: float = 0.002) -> dict:
    actual = extract_trial_metrics(canonical)
    checks = []
    for key, expected_value in expected.items():
        if key not in actual:
            continue
        actual_value = actual.get(key)
        if expected_value is None:
            match = actual_value is None
        elif isinstance(expected_value, (int, float)) and isinstance(actual_value, (int, float)):
            denominator = max(abs(float(expected_value)), 1.0)
            match = abs(float(actual_value) - float(expected_value)) / denominator <= rel_tol
        else:
            match = actual_value == expected_value
        checks.append({
            "field": key,
            "expected": expected_value,
            "actual": actual_value,
            "match": match,
        })
    matched = sum(1 for check in checks if check["match"])
    return {
        "valid": bool(checks) and matched == len(checks),
        "matched": matched,
        "total": len(checks),
        "checks": checks,
    }
