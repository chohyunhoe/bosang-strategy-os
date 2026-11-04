# -*- coding: utf-8 -*-
"""불확실 추출값, 산식 실패, GIS 주소 누락을 사람 검토 큐로 모은다."""
import re

from .models import Field

HIGH_IMPACT_PATHS = ("other_factor", "unit_price", "land_schedule", "selected_standard")

_LOT_NORM_RE = re.compile(r"(산?)(\d+)(?:-(\d+))?$")


def _norm_lot(lot):
    if not lot:
        return lot
    match = _LOT_NORM_RE.match(str(lot).strip())
    if not match:
        return str(lot).strip()
    main = str(int(match.group(2)))
    return f"{match.group(1)}{main}-{int(match.group(3))}" if match.group(3) else f"{match.group(1)}{main}"


def _field_value(obj):
    if hasattr(obj, "value"):
        return obj.value
    if isinstance(obj, dict) and "value" in obj:
        return obj.get("value")
    return obj


def build(canonical: dict) -> list:
    items = []

    def add(topic, priority, path, note=""):
        items.append({"item_id": f"review_{len(items) + 1:03d}", "topic": topic,
                      "priority": priority, "path": path, "note": note})

    def walk(obj, path):
        if isinstance(obj, Field):
            high = any(token in path for token in HIGH_IMPACT_PATHS)
            if obj.status == "REVIEW_REQUIRED":
                add(f"수동검토: {path}", "high" if high else "medium", path, obj.note)
            elif obj.status in {"NOT_FOUND", "OCR_FAILED"}:
                label = "OCR 실패" if obj.status == "OCR_FAILED" else "미추출"
                add(f"{label}: {path}", "high" if high else "low", path, obj.note)
            return
        if isinstance(obj, dict):
            for key, value in obj.items():
                if key != "evidence_index":
                    walk(value, f"{path}.{key}" if path else key)
        elif isinstance(obj, list):
            for index, value in enumerate(obj):
                walk(value, f"{path}[{index}]")

    walk(canonical, "")
    for check in canonical.get("verification", {}).get("formula_checks", []):
        if check.get("status") == "fail":
            add(f"산식 불일치: {check['check_id']}", "high", "verification.formula_checks",
                f"calculated={check['calculated']} stated={check['stated']}")
    reverse_audit = canonical.get("verification", {}).get("reverse_factor_audit", {})
    if reverse_audit.get("status") == "INFERRED_CANDIDATE":
        add(
            "역산 추정값 수동검토",
            "high",
            "verification.reverse_factor_audit",
            "종합 개별요인은 역산추정이며 후보 표준지 실제 적용 여부와 6개 세부요인 확인 필요",
        )

    target = canonical.get("target") or {}
    target_lot = target.get("lot")
    if target_lot:
        target_dong = target.get("dong")
        norm_target = _norm_lot(target_lot)
        match_count = 0
        for row in canonical.get("land_schedule", {}).get("rows", []):
            val = _field_value(row)
            if not isinstance(val, dict):
                continue
            if target_dong and val.get("dong") != target_dong:
                continue
            if norm_target and _norm_lot(val.get("lot")) != norm_target:
                continue
            match_count += 1
        if match_count == 0:
            add(
                "대상토지 일치 행 없음",
                "high",
                "land_schedule",
                f"대상토지 {target_dong or ''} {target_lot} 일치 행 없음",
            )
        elif match_count > 1:
            add(
                "대상토지 복수 일치",
                "high",
                "land_schedule",
                f"대상토지 {target_dong or ''} {target_lot} 일치 행 {match_count}건 — 수동검토 필요",
            )

    for row in canonical.get("comparison_set", []):
        if not row.get("gis_ready", False):
            add(f"GIS 입력 차단: {row.get('role')}", "high", "comparison_set",
                "필수 주소 필드 누락: " + ", ".join(row.get("blocking_fields", [])))
    return items
