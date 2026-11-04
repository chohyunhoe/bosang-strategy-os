# -*- coding: utf-8 -*-
from __future__ import annotations

import json
from pathlib import Path

SLOTS = {
    "PAGE1_HERO_GRAPHIC": "overview.png",
    "PAGE3_SUBJECT_GRAPHIC": "subject_vs_standard.png",
    "PAGE3_STANDARD_GRAPHIC": "standard_vs_case.png",
    "PAGE4_FLOW_GRAPHIC": "other_factor_flow.png",
}

_FALLBACKS = {
    "PAGE1_HERO_GRAPHIC": ("review-map.png", "subject_vs_standard.png"),
    "PAGE3_SUBJECT_GRAPHIC": ("review-map.png",),
}


def write_slot_map(output_dir: Path, issues: list[dict]) -> Path:
    issue_codes = {item.get("code") for item in issues}
    payload = {"schema_version": "bso_brief_graphics_slots_v0.1", "slots": {}}
    for slot, filename in SLOTS.items():
        path = output_dir / filename
        if not path.exists():
            for alt in _FALLBACKS.get(slot, ()):
                candidate = output_dir / alt
                if candidate.exists():
                    path = candidate
                    break
        if path.exists():
            status = "READY"
            reason = None
        elif slot == "PAGE3_STANDARD_GRAPHIC" and issue_codes & {
            "CASE_LOT_MISSING", "CASE_REVIEW_REQUIRED", "OUTPUT_BLOCKED"
        }:
            status = "REVIEW_REQUIRED"
            reason = "사례 위치/PNU 검토 미해결"
        else:
            status = "NOT_GENERATED"
            reason = "출력 파일 없음"
        payload["slots"][slot] = {
            "status": status,
            "file": str(path) if path.exists() else None,
            "reason": reason,
        }
    target = output_dir / "brief_graphics_slots.json"
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return target
