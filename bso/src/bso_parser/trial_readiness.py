# -*- coding: utf-8 -*-
"""시용본 준비도 평가.

완전추출률을 과장하지 않고 핵심 블록의 존재·검토상태·GIS 입력가능 여부를 점검한다.
"""
from __future__ import annotations


def _status(value):
    if isinstance(value, dict):
        return value.get("status")
    return getattr(value, "status", None)


def _value(value):
    if isinstance(value, dict):
        return value.get("value")
    return getattr(value, "value", None)


def evaluate(canonical: dict) -> dict:
    checks = []

    standard = canonical.get("standard_selection", {}).get("selected_standard")
    checks.append({
        "key": "standard_selected",
        "pass": bool(_value(standard)),
        "status": _status(standard),
    })

    subject_rows = canonical.get("subject_to_standard_factors", {}).get("rows", [])
    checks.append({
        "key": "subject_factor_row",
        "pass": any(bool(_value(row)) for row in subject_rows),
        "count": len(subject_rows),
    })

    cases = canonical.get("case_selection", {}).get("cases", [])
    checks.append({
        "key": "comparison_case",
        "pass": any(bool(item.get("data")) for item in cases),
        "count": len(cases),
    })

    other = canonical.get("other_factor", {})
    decided = other.get("decided_value")
    checks.append({
        "key": "other_factor_candidate",
        "pass": _value(decided) is not None,
        "status": _status(decided),
    })

    schedule_rows = canonical.get("land_schedule", {}).get("rows", [])
    checks.append({
        "key": "land_schedule_row",
        "pass": any(bool(_value(row)) for row in schedule_rows),
        "count": len(schedule_rows),
    })

    gis_rows = canonical.get("comparison_set", [])
    checks.append({
        "key": "gis_ready_pair",
        "pass": any(row.get("role") == "standard" and row.get("gis_ready") for row in gis_rows)
        and any(row.get("role") == "subject" and row.get("gis_ready") for row in gis_rows),
        "ready_count": sum(1 for row in gis_rows if row.get("gis_ready")),
    })

    passed = sum(1 for item in checks if item["pass"])
    score = round(passed / len(checks), 3) if checks else 0.0
    return {
        "score": score,
        "passed": passed,
        "total": len(checks),
        "trial_usable": passed >= 4,
        "checks": checks,
        "review_queue_count": len(canonical.get("review_queue", [])),
        "note": "시용 가능 여부이며 감정평가 적정성 또는 보상금 증액 가능성 판단이 아님",
    }
