# -*- coding: utf-8 -*-
"""Build the two-page graphics brief payload from parser canonical JSON.

Parcel geometry/PNU configuration remains an independently verified manifest
input.  Appraisal values, formula rows, and comparison claims are populated
from canonical parser output so the PDF is not maintained as a second fixture.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any


FACTOR_KEYS = ("street", "access", "environment", "parcel", "administrative", "other")
BRIEF_FACTOR_KEYS = ("street", "access", "environment", "parcel", "admin", "other")


def _field_value(value: Any):
    if isinstance(value, dict) and "value" in value and "status" in value:
        return value.get("value")
    return value


def _field_status(value: Any) -> str | None:
    return value.get("status") if isinstance(value, dict) else None


def _fmt_int(value: Any) -> str:
    return "—" if value is None else f"{int(round(float(value))):,}"


def _fmt_factor(value: Any, digits: int = 2) -> str:
    return "—" if value is None else f"{float(value):.{digits}f}"


def _norm_marker(value: Any) -> str | None:
    marker = str(value or "").strip()
    if marker.startswith("거래"):
        marker = marker.removeprefix("거래").strip()
    return marker or None


def _target_factor_row(canonical: dict) -> tuple[dict, dict]:
    target_lot = (canonical.get("target") or {}).get("lot")
    matches = []
    for row in canonical.get("subject_to_standard_factors", {}).get("rows", []):
        value = _field_value(row)
        if not isinstance(value, dict):
            continue
        if target_lot and value.get("lot") != target_lot:
            continue
        matches.append((value, row))
    if len(matches) != 1:
        raise ValueError(f"target factor row must be exact-one: lot={target_lot}, matches={len(matches)}")
    return matches[0]


def _target_schedule_row(canonical: dict) -> dict:
    target = canonical.get("target") or {}
    matches = []
    for row in canonical.get("land_schedule", {}).get("rows", []):
        value = _field_value(row)
        if not isinstance(value, dict):
            continue
        if target.get("dong") and value.get("dong") != target["dong"]:
            continue
        if target.get("lot") and value.get("lot") != target["lot"]:
            continue
        if value.get("unit_price") is not None:
            matches.append(value)
    if len(matches) != 1:
        raise ValueError(f"target schedule row must be exact-one: target={target}, matches={len(matches)}")
    return matches[0]


def _selected_standard(canonical: dict) -> tuple[dict, str | None]:
    field = canonical.get("standard_selection", {}).get("selected_standard") or {}
    value = _field_value(field)
    if not isinstance(value, dict) or not value.get("lot"):
        raise ValueError("selected standard is missing")
    return value, _field_status(field)


def _applied_case(canonical: dict) -> tuple[dict, str]:
    other = canonical.get("other_factor") or {}
    marker = _norm_marker(_field_value((other.get("case_row") or {}).get("case_marker")))
    matches = []
    for item in canonical.get("case_selection", {}).get("cases", []):
        value = item.get("data") or _field_value(item.get("field")) or {}
        if _norm_marker(value.get("case_marker")) == marker:
            matches.append(value)
    if len(matches) != 1:
        raise ValueError(f"applied case marker must resolve exact-one: marker={marker}, matches={len(matches)}")
    return matches[0], marker


def _evidence_pages(value: Any) -> list[int]:
    if not isinstance(value, dict):
        return []
    pages = []
    for evidence in value.get("evidence") or []:
        page = evidence.get("page")
        if isinstance(page, int) and page not in pages:
            pages.append(page)
    return pages


def _company_payload(company: str, canonical: dict) -> dict:
    standard, standard_status = _selected_standard(canonical)
    factor_value, factor_field = _target_factor_row(canonical)
    schedule = _target_schedule_row(canonical)
    case, marker = _applied_case(canonical)
    other = canonical.get("other_factor") or {}
    case_row = other.get("case_row") or {}
    standard_row = other.get("standard_row") or {}
    decided = _field_value(other.get("decided_value"))
    std_case_field = canonical.get("standard_to_case_factors", {}).get("factors") or {}
    std_case = _field_value(std_case_field) or {}
    std_case_items = std_case.get("items") or []
    if len(std_case_items) != 6:
        raise ValueError(f"standard-to-case factors must contain six items: company={company}")
    subject_factors = factor_value.get("factors") or {}
    if any(subject_factors.get(key) is None for key in FACTOR_KEYS):
        raise ValueError(f"subject factors must contain six items: company={company}")
    target_comp = canonical.get("verification", {}).get("target_computation_summary") or {}
    reverse = canonical.get("verification", {}).get("reverse_factor_audit") or {}
    reverse_candidates = reverse.get("candidates") or []
    reverse_value = None
    if len(reverse_candidates) == 1:
        reverse_value = ((reverse_candidates[0].get("implied_subject_individual_factor") or {}).get("value"))
    return {
        "company": company,
        "canonical": canonical,
        "standard": standard,
        "standard_status": standard_status,
        "subject_factors": subject_factors,
        "subject_total": factor_value.get("factor_total"),
        "subject_evidence_pages": _evidence_pages(factor_field),
        "schedule": schedule,
        "case": case,
        "case_marker": marker,
        "case_row": case_row,
        "standard_row": standard_row,
        "decided": decided,
        "std_case_items": std_case_items,
        "std_case_total": std_case.get("total"),
        "std_case_evidence_pages": _evidence_pages(std_case_field),
        "target_comp": target_comp,
        "reverse_value": reverse_value,
    }


def build_manifest(base_manifest: dict, appraisals: list[tuple[str, dict]]) -> dict:
    if not appraisals:
        raise ValueError("at least one canonical appraisal is required")
    payloads = [_company_payload(company, canonical) for company, canonical in appraisals]
    manifest = deepcopy(base_manifest)
    prior = deepcopy(manifest.get("sample_brief") or {})
    targets = {(p["canonical"].get("target") or {}).get("lot") for p in payloads}
    standards = {p["standard"].get("lot") for p in payloads}
    cases = {p["case"].get("lot") for p in payloads}
    if len(targets) != 1 or len(standards) != 1 or len(cases) != 1:
        raise ValueError(f"cross-appraiser parcel mismatch: target={targets}, standard={standards}, case={cases}")
    target_lot = next(iter(targets))
    standard_lot = next(iter(standards))
    case_lot = next(iter(cases))
    target_dong = (payloads[0]["canonical"].get("target") or {}).get("dong")
    standard_dong = payloads[0]["standard"].get("dong") or target_dong
    case_dong = payloads[0]["case"].get("dong") or target_dong

    summary = list(prior.get("page1_summary") or ["—"] * 12)
    summary.extend(["—"] * (12 - len(summary)))
    summary[0] = " ".join(filter(None, (target_dong, target_lot)))
    summary[4] = " ".join(filter(None, (standard_dong, standard_lot)))
    markers = [p["standard"].get("marker") for p in payloads if p["standard"].get("marker")]
    summary[8] = " / ".join(dict.fromkeys(markers)) or "—"
    prices = {p["standard"].get("official_price") for p in payloads}
    summary[9] = _fmt_int(next(iter(prices))) if len(prices) == 1 else "검토 필요"
    roads = [p["standard"].get("road") for p in payloads if p["standard"].get("road")]
    summary[10] = "·".join(dict.fromkeys(roads)) or summary[10]
    shapes = []
    for p in payloads:
        shapes.extend(value for value in (p["standard"].get("shape"), p["standard"].get("topo")) if value)
    summary[11] = "·".join(dict.fromkeys(shapes)) or summary[11]

    page1_rows = []
    page2_calc_rows = []
    page2_rows = []
    for p in payloads:
        subject = p["subject_factors"]
        page1_rows.append({
            "company": p["company"],
            **{
                brief_key: _fmt_factor(subject[source_key], 2)
                for source_key, brief_key in zip(FACTOR_KEYS, BRIEF_FACTOR_KEYS)
            },
            "total": _fmt_factor(p["subject_total"], 3),
            "other_factor": _fmt_factor(p["decided"], 2),
            "applied_price": _fmt_int(p["schedule"].get("unit_price")),
        })
        cr = p["case_row"]
        page2_calc_rows.append({
            "type": f"{p['company']} 사례{p['case_marker']}",
            "lot": " ".join(filter(None, (case_dong, case_lot))),
            "price": _fmt_int(_field_value(cr.get("case_unit_price"))),
            "time_factor": _fmt_factor(_field_value(cr.get("time_adjustment")), 5),
            "regional_factor": _fmt_factor(_field_value(cr.get("regional_factor")), 2),
            "individual_factor": _fmt_factor(_field_value(cr.get("individual_factor_total")), 3),
            "calculated_price": _fmt_int(_field_value(cr.get("adjusted_unit_price"))),
        })
        page2_rows.append({
            "company": p["company"],
            **{
                brief_key: _fmt_factor(value, 2)
                for value, brief_key in zip(p["std_case_items"], BRIEF_FACTOR_KEYS)
            },
            "total": _fmt_factor(p["std_case_total"], 3),
            "gap_ratio": _fmt_factor(_field_value(cr.get("gap_ratio")), 3),
            "decision": _fmt_factor(p["decided"], 2),
        })

    first_standard_row = payloads[0]["standard_row"]
    page2_calc_rows.append({
        "type": "비교표준지",
        "lot": " ".join(filter(None, (standard_dong, standard_lot))),
        "price": _fmt_int(_field_value(first_standard_row.get("official_price"))),
        "time_factor": _fmt_factor(_field_value(first_standard_row.get("time_adjustment")), 5),
        "regional_factor": "—",
        "individual_factor": "—",
        "calculated_price": _fmt_int(_field_value(first_standard_row.get("adjusted_unit_price"))),
    })

    factor_totals = "·".join(_fmt_factor(p["subject_total"], 3) for p in payloads)
    decisions = "·".join(_fmt_factor(p["decided"], 2) for p in payloads)
    calc_prices = "·".join(_fmt_int(p["target_comp"].get("calculated_unit_price")) for p in payloads)
    evidence_page_text = ", ".join(
        f"{p['company']} PDF " + "·".join(f"{page}면" for page in p["subject_evidence_pages"])
        for p in payloads
    )
    case_page_text = ", ".join(
        f"{p['company']} PDF " + "·".join(f"{page}면" for page in p["std_case_evidence_pages"])
        for p in payloads
    )
    generated_missing = any(
        value in (None, "—")
        for p in payloads
        for value in (p["subject_total"], p["decided"], p["target_comp"].get("calculated_unit_price"))
    )
    page1_review = bool(prior.get("page1_review_required")) or generated_missing
    page2_review = bool(prior.get("page2_review_required")) or generated_missing
    manifest["sample_brief"] = {
        "page1_title": f"자동표1 – {target_dong} {target_lot} 대상토지·비교표준지 품등비교",
        "page1_summary": summary[:12],
        "page1_rows": page1_rows,
        "page1_claims": (
            f"두 평가서는 대상토지 {target_lot}에 비교표준지 {standard_lot}를 적용했습니다. "
            f"대상 개별요인 누계는 {factor_totals}, 그 밖의 요인은 {decisions}이며, "
            f"정방향 산정단가는 {calc_prices}원/㎡입니다. 원문 위치: {evidence_page_text}."
        ),
        "page1_review_required": page1_review,
        "page2_title": f"자동표2 – 비교표준지 {standard_lot}·거래사례 {case_lot} 품등비교",
        "page2_calc_rows": page2_calc_rows,
        "page2_rows": page2_rows,
        "page2_claims": (
            f"두 평가서는 그 밖의 요인 산정에 거래사례 {case_lot}를 사용했습니다. "
            f"사례 비교 개별요인과 격차율의 차이는 법인별 산정값으로 분리했습니다. "
            f"원문 위치: {case_page_text}."
        ),
        "page2_review_required": page2_review,
    }
    manifest["e2e_provenance"] = {
        "mode": "PARSER_CANONICAL_TO_VERIFIED_GEOMETRY_BRIEF",
        "canonical_sources": [
            {
                "company": p["company"],
                "source_file": Path(str((p["canonical"].get("source") or {}).get("file") or "")).name,
                "schema_valid": (p["canonical"].get("schema_validation") or {}).get("valid"),
                "standard_status": p["standard_status"],
                "target_formula_status": p["target_comp"].get("status"),
                "reverse_inferred_factor": p["reverse_value"],
            }
            for p in payloads
        ],
        "geometry_source": "parcel_verification exact-one result",
    }
    return manifest
