# -*- coding: utf-8 -*-
"""Canonical output shape validation without external schema dependencies."""
from typing import Any

REQUIRED_ROOT_KEYS = (
    "schema_version",
    "source",
    "page_roles",
    "sections",
    "standard_selection",
    "subject_to_standard_factors",
    "case_selection",
    "standard_to_case_factors",
    "other_factor",
    "land_schedule",
    "verification",
    "comparison_set",
    "review_queue",
)


def validate_canonical(payload: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    for key in REQUIRED_ROOT_KEYS:
        if key not in payload:
            errors.append(f"missing root key: {key}")
    if not isinstance(payload.get("page_roles", []), list):
        errors.append("page_roles must be a list")
    if not isinstance(payload.get("sections", []), list):
        errors.append("sections must be a list")
    if not isinstance(payload.get("comparison_set", []), list):
        errors.append("comparison_set must be a list")
    if not isinstance(payload.get("review_queue", []), list):
        errors.append("review_queue must be a list")
    reverse_audit = (payload.get("verification") or {}).get("reverse_factor_audit")
    if reverse_audit is not None and not isinstance(reverse_audit, dict):
        errors.append("verification.reverse_factor_audit must be an object")

    source = payload.get("source") or {}
    if not isinstance(source.get("pages"), int) or source.get("pages", 0) < 1:
        errors.append("source.pages must be a positive integer")

    for idx, role in enumerate(payload.get("page_roles", [])):
        for key in ("page", "primary", "confidence", "role_evidence"):
            if key not in role:
                errors.append(f"page_roles[{idx}] missing {key}")
        confidence = role.get("confidence")
        if not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1:
            errors.append(f"page_roles[{idx}].confidence must be between 0 and 1")

    for idx, item in enumerate(payload.get("comparison_set", [])):
        for key in ("role", "gis_ready", "blocking_fields"):
            if key not in item:
                errors.append(f"comparison_set[{idx}] missing {key}")
        if item.get("gis_ready") and item.get("blocking_fields"):
            errors.append(f"comparison_set[{idx}] cannot be GIS-ready with blocking fields")
    return errors
