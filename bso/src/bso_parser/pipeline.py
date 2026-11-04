# -*- coding: utf-8 -*-
"""범용 감정평가서 해석 파이프라인."""
import os
import re
import warnings

from .models import Field, Evidence, fdict
from . import document_structure_analyzer as dsa
from .page_role_classifier import classify_document
from .section_boundary_detector import detect_sections, pages_for_role
from . import standard_selection_parser, factor_comparison_parser, case_selection_parser
from . import other_factor_parser, land_schedule_parser, formula_verifier, reverse_factor_audit
from . import evidence_linker, review_queue_builder, gis_export_builder
from .canonical_schema import validate_canonical

SCHEMA_VERSION = "bso_canonical_appraisal_v0.2"

_COMP_LOT_RE = re.compile(r"\b(산?\d{1,4}-\d{1,4})\b")
_COMP_MARKER_PRICE_TIME_RE = re.compile(
    r"([A-Z가-힣])\s+([\d,]{6,12})\s*[|｜)]*\s*(1[.,]\d{3,6})"
)
_COMP_TAIL_RE = re.compile(
    r"(\d[.,]\d{2,4})\s+([\d,]{6,12})\s+([\d,]{6,12})\b"
)


def _extract_computation_summary(doc, pages, target_lot, target_dong=None):
    """산출근거표에서 target_lot에 해당하는 모든 후보를 수집한다."""
    if not target_lot:
        return []
    norm_target = re.sub(r"^(산?)0*(\d+)-0*(\d+)$", r"\1\2-\3", target_lot.strip())
    candidates = []
    for page_number in pages:
        raw = doc.page_text_tabular(page_number - 1) if hasattr(doc, 'page_text_tabular') else doc.page_text(page_number - 1)
        for raw_line in raw.splitlines():
            line = re.sub(r"[|｜]", " ", raw_line)
            lot_m = _COMP_LOT_RE.search(line)
            if not lot_m:
                continue
            found_lot = re.sub(r"^(산?)0*(\d+)-0*(\d+)$", r"\1\2-\3", lot_m.group(1))
            if found_lot != norm_target:
                continue
            dong_confirmed = bool(target_dong and target_dong in line)
            if target_dong and not dong_confirmed:
                if doc.pages[page_number - 1]["has_text_layer"]:
                    continue
            std_m = _COMP_MARKER_PRICE_TIME_RE.search(line)
            tail_m = _COMP_TAIL_RE.search(line)
            if std_m and tail_m:
                price = int(std_m.group(2).replace(",", ""))
                time_adj = float(std_m.group(3).replace(",", "."))
                decided_price = int(tail_m.group(3).replace(",", ""))
                if decided_price >= price:
                    candidates.append({
                        "marker": std_m.group(1),
                        "official_price": price,
                        "time_adjustment": time_adj,
                        "adjusted_unit_price": int(tail_m.group(2).replace(",", "")),
                        "decided_unit_price": decided_price,
                        "dong_confirmed": dong_confirmed,
                        "page": page_number,
                        "method": doc.page_method(page_number - 1),
                        "snippet": line[:180],
                    })
    return candidates


_MARKER_PRICE_PATTERNS = [
    re.compile(r"([A-Z가-힣])\s+[a-z]?\s*구분\s+표준지\s+시점수정\s+산출단가"),
    re.compile("비교표준지\\s+['‘’']([A-Z가-힣])['‘’']"),
]
_STD_PRICE_LINE_RE = re.compile(r"([\d,]{4,12})\s+[-\s]*1\.\d{3,6}")
_DECIDED_VALUE_RE = re.compile(r"([A-Z가-힣])\s+(\d\.\d{1,4})(?:\s+(\d\.\d{1,4}))?(?:\s|$)")


def _find_decided_by_price(doc, pages, official_price):
    """공시지가로 표준지 기호를 찾고, 보정치결정표에서 해당 기호의 결정값을 모두 수집한다."""
    markers = []
    for page_number in pages:
        raw = doc.page_text_tabular(page_number - 1) if hasattr(doc, 'page_text_tabular') else doc.page_text(page_number - 1)
        price_found = any(
            int(m.group(1).replace(",", "")) == official_price
            for m in _STD_PRICE_LINE_RE.finditer(raw)
        )
        if not price_found:
            continue
        lines = raw.splitlines()
        for idx, line in enumerate(lines):
            sm = _STD_PRICE_LINE_RE.search(line)
            if not sm or int(sm.group(1).replace(",", "")) != official_price:
                continue
            found = None
            for back in range(max(0, idx - 3), idx + 1):
                for pat in _MARKER_PRICE_PATTERNS:
                    pm = pat.search(lines[back])
                    if pm:
                        found = pm.group(1)
                        break
                if found:
                    break
            if not found:
                cm = _COMP_MARKER_PRICE_TIME_RE.search(line)
                if cm and int(cm.group(2).replace(",", "")) == official_price:
                    found = cm.group(1)
            if found and found not in markers:
                markers.append(found)
    if not markers:
        return []
    candidates = []
    for page_number in pages:
        raw = doc.page_text_tabular(page_number - 1) if hasattr(doc, 'page_text_tabular') else doc.page_text(page_number - 1)
        if not re.search(r"보정치\s*결정|그\s*밖.*결정", raw):
            continue
        method = doc.page_method(page_number - 1)
        for line in raw.splitlines():
            dm = _DECIDED_VALUE_RE.search(line)
            if dm and dm.group(1) in markers:
                val = float(dm.group(3) or dm.group(2))
                if 1.0 <= val <= 10.0:
                    candidates.append({
                        "marker": dm.group(1),
                        "value": val,
                        "page": page_number,
                        "method": method,
                        "snippet": line[:180],
                    })
    return candidates


def _resolve_decided_candidates(candidates):
    """결정값 후보를 단일 Field로 해소한다."""
    if not candidates:
        return None
    if len(candidates) == 1:
        c = candidates[0]
        return Field.review(c["value"],
            [Evidence(page=c["page"], method=c["method"], snippet=c["snippet"])],
            note="보정치결정표에서 추출 — 표준지가액 연결",
        )
    evidence = [Evidence(page=c["page"], method=c["method"], snippet=c["snippet"]) for c in candidates]
    return Field.review(candidates[0]["value"], evidence,
        note=f"보정치결정표 후보 {len(candidates)}건 — 수동검토 필요",
    )


def _resolve_comp_candidates(candidates, target_dong):
    """산출근거 후보를 해소하여 (std_row, decided_unit_price, status_note) 반환."""
    if not candidates:
        return None, None, None
    if len(candidates) == 1:
        c = candidates[0]
        note_suffix = ""
        if target_dong and not c["dong_confirmed"]:
            note_suffix = " — 동 확인 불가"
        extracted = not target_dong or c["dong_confirmed"]
        return _comp_to_std_row(c, note_suffix, extracted=extracted), c["decided_unit_price"], None
    evidence_lines = [f"{c['marker']}(p{c['page']})" for c in candidates]
    note = f"산출근거 후보 {len(candidates)}건: {', '.join(evidence_lines)}"
    c = candidates[0]
    return _comp_to_std_row(c, " — 복수 후보 중 첫 건"), c["decided_unit_price"], note


def _comp_to_std_row(c, note_suffix="", *, extracted=False):
    method = c["method"]
    page = c["page"]
    snippet = c["snippet"]
    base_note = "산출근거표에서 추출" + note_suffix
    ev = [Evidence(page=page, method=method, snippet=snippet)]
    field = Field.ok if extracted else lambda value, evidence, note="": Field.review(value, evidence, note)
    return {
        "standard_marker": field(c["marker"], ev, note=base_note),
        "official_price": field(c["official_price"], ev, note=base_note),
        "time_adjustment": field(c["time_adjustment"], ev, note=base_note),
        "adjusted_unit_price": field(c["adjusted_unit_price"], ev, note=base_note),
    }


def _build_target_computation_summary(comp_candidates, target_dong, target_lot):
    """산출근거 후보로부터 verification.target_computation_summary를 구축한다."""
    if not comp_candidates:
        return None
    norm_lot = re.sub(r"^(산?)0*(\d+)-0*(\d+)$", r"\1\2-\3", target_lot.strip()) if target_lot else None
    if len(comp_candidates) == 1:
        c = comp_candidates[0]
        status = "EXTRACTED" if (not target_dong or c["dong_confirmed"]) else "REVIEW_REQUIRED"
    else:
        c = comp_candidates[0]
        status = "REVIEW_REQUIRED"
    evidence = [
        Evidence(page=cc["page"], method=cc["method"], snippet=cc["snippet"])
        for cc in comp_candidates
    ]
    return {
        "status": status,
        "source_section": "COMPUTATION_SUMMARY",
        "dong": target_dong,
        "lot": norm_lot,
        "serial": None,
        "official_price": c["official_price"],
        "time_adjustment": c["time_adjustment"],
        "calculated_unit_price": c["adjusted_unit_price"],
        "decided_unit_price": c["decided_unit_price"],
        "amount": None,
        "area_sqm": None,
        "evidence": evidence,
        "note": f"산출근거표 후보 {len(comp_candidates)}건" if len(comp_candidates) > 1 else "산출근거표에서 추출",
        "candidates": comp_candidates if len(comp_candidates) > 1 else None,
    }


def run(pdf_path: str, *, password: str | None = None,
        target_dong: str | None = None, target_lot: str | None = None,
        target_serial: str | None = None) -> dict:
    if password is not None:
        warnings.warn(
            "password 파라미터는 deprecated입니다. BSO_PDF_PASSWORD 환경변수를 사용하세요.",
            DeprecationWarning, stacklevel=2,
        )
    effective_password = password or os.environ.get("BSO_PDF_PASSWORD")
    doc = dsa.DocumentStructure(pdf_path, password=effective_password)
    page_roles = classify_document(doc)
    sections = detect_sections(page_roles)
    p_std = pages_for_role(sections, "STANDARD_SELECTION")
    p_subj = pages_for_role(sections, "SUBJECT_TO_STANDARD_FACTORS")
    p_case = pages_for_role(sections, "STANDARD_TO_CASE_FACTORS")
    p_other = sorted(set(pages_for_role(sections, "OTHER_FACTOR_CALCULATION")) | set(p_case) | set(p_subj))
    p_sched = pages_for_role(sections, "LAND_APPRAISAL_SCHEDULE")

    other = other_factor_parser.parse(doc, p_other)

    comp_pages = sorted(set(p_sched) | set(p_other))
    comp_candidates = _extract_computation_summary(doc, comp_pages, target_lot, target_dong)
    if not comp_candidates:
        all_pages = sorted(set(range(1, doc.page_count + 1)) - set(comp_pages))
        comp_candidates = _extract_computation_summary(doc, all_pages, target_lot, target_dong)

    summary_std, summary_unit_price, comp_note = _resolve_comp_candidates(comp_candidates, target_dong)

    if summary_std:
        marker_value = summary_std["standard_marker"].value
        official_value = summary_std["official_price"].value
        targeted_other = other_factor_parser.parse_for_standard(
            doc,
            p_other,
            marker=marker_value,
            official_price=official_value,
        )
        if targeted_other is not None:
            other = targeted_other
        else:
            other["standard_row"] = summary_std
        decided_candidates = _find_decided_by_price(
            doc, p_other, official_value,
        )
        decided_from_table = _resolve_decided_candidates(decided_candidates)
        if decided_from_table and other["decided_value"].status != "EXTRACTED":
            other["decided_value"] = decided_from_table

    cases = case_selection_parser.parse(doc, sorted(set(p_case) | set(p_other)))
    std_case = factor_comparison_parser.structure_standard_to_case(other)
    hint = {}
    if other.get("standard_row"):
        hint["official_price"] = other["standard_row"]["official_price"].value
        hint["status"] = other["standard_row"]["official_price"].status
    if summary_std:
        hint["marker"] = summary_std["standard_marker"].value
    standard = standard_selection_parser.parse(doc, p_std, cross_hint=hint or None)
    comp_factor_pages = [candidate["page"] for candidate in comp_candidates]
    subj_std = factor_comparison_parser.parse_subject_to_standard(
        doc,
        sorted(set(p_subj) | set(comp_factor_pages)),
        target_lot=target_lot,
    )
    schedule = land_schedule_parser.parse(doc, p_sched)
    if target_lot and not any(
        row.value and row.value.get("lot") == target_lot
        and (not target_dong or row.value.get("dong") == target_dong)
        for row in schedule.get("rows", [])
    ):
        image_pages = [
            page["page"] for page in doc.pages
            if not page["has_text_layer"] and page["page"] not in p_sched
        ]
        fallback_schedule = land_schedule_parser.parse(doc, image_pages)
        schedule["rows"].extend(fallback_schedule.get("rows", []))
        schedule["raw_pages"] = sorted(set(schedule.get("raw_pages", [])) | set(image_pages))

    decided = other.get("decided_value")
    if decided is not None and decided.status == "NOT_FOUND" and other.get("case_row"):
        gap_ratio_field = other["case_row"].get("gap_ratio")
        if gap_ratio_field and gap_ratio_field.status == "EXTRACTED":
            ratio = gap_ratio_field.value
            candidates = {}
            for row in subj_std.get("rows", []):
                value = (row.value or {}).get("other_factor_col")
                if value is not None:
                    candidates.setdefault(value, []).append(row)
            for value, rows in candidates.items():
                if abs(value - ratio) <= 0.15:
                    source = rows[0].evidence[0]
                    other["decided_value"] = Field.review(
                        value,
                        [Evidence(page=source.page, method=source.method, snippet=source.snippet)],
                        note="명시적 결정표/헤더-열 관계 미확인. 검토 후보로만 유지",
                    )
                    break

    target_comp_summary = _build_target_computation_summary(comp_candidates, target_dong, target_lot)

    checks = formula_verifier.verify_other_factor(other)
    unit_check = _target_unit_price_check(other, subj_std, target_comp_summary, target_lot)
    if unit_check is None:
        unit_check = _unit_price_check(other, subj_std, schedule)
    if unit_check:
        checks.append(unit_check)

    canonical = {
        "schema_version": SCHEMA_VERSION,
        "target": {"dong": target_dong, "lot": target_lot, "serial": target_serial},
        "source": {
            "file": os.path.basename(pdf_path),
            "pages": doc.page_count,
            "text_layer_pages": sum(1 for page in doc.pages if page["has_text_layer"]),
        },
        "page_roles": [
            {key: page[key] for key in (
                "page", "labels", "primary", "classified_from", "confidence", "role_evidence"
            )}
            for page in page_roles
        ],
        "sections": [
            {key: section[key] for key in ("role", "page_start", "page_end")}
            for section in sections
        ],
        "standard_selection": standard,
        "subject_to_standard_factors": subj_std,
        "case_selection": cases,
        "standard_to_case_factors": std_case,
        "other_factor": other,
        "land_schedule": schedule,
        "verification": {"formula_checks": checks},
    }
    if target_comp_summary:
        canonical["verification"]["target_computation_summary"] = target_comp_summary
    canonical["verification"]["reverse_factor_audit"] = reverse_factor_audit.build_from_canonical(
        canonical, target_dong=target_dong, target_lot=target_lot, target_serial=target_serial,
    )
    canonical["comparison_set"] = gis_export_builder.build(canonical)
    evidence_linker.link(canonical)
    canonical["review_queue"] = review_queue_builder.build(canonical)
    canonical["source"]["ocr_pages_used"] = sorted(doc.ocr_pages_used)
    canonical["schema_validation"] = {
        "valid": not bool(validate_canonical(canonical)),
        "errors": validate_canonical(canonical),
    }
    return canonical


def _unit_price_check(other, subj_std, schedule):
    standard_row = other.get("standard_row")
    decided = other.get("decided_value")
    if not (standard_row and decided and decided.status == "EXTRACTED"):
        return None
    unit_prices = {
        row.value["unit_price"]
        for row in schedule.get("rows", [])
        if row.status == "EXTRACTED"
    }
    if len(unit_prices) != 1:
        return None
    totals = {
        row.value["factor_total"]
        for row in subj_std.get("rows", [])
        if row.value and row.value.get("factor_total") is not None
    }
    if len(totals) != 1:
        return None
    return formula_verifier.verify_unit_price(
        standard_row["official_price"].value,
        standard_row["time_adjustment"].value,
        1.0,
        totals.pop(),
        decided.value,
        unit_prices.pop(),
        rel_tol=0.002,
    )


def _target_unit_price_check(other, subj_std, target_comp_summary, target_lot):
    """Verify the target row even when the schedule contains many parcels.

    The computation summary is the authoritative bridge between the appraisal
    formula table and the selected subject parcel.  It prevents unrelated
    schedule rows from suppressing the formula audit.
    """
    if not target_comp_summary:
        return None
    standard_row = other.get("standard_row") or {}
    decided = other.get("decided_value")
    required_fields = (
        standard_row.get("official_price"),
        standard_row.get("time_adjustment"),
        decided,
    )
    if any(field is None or getattr(field, "status", None) != "EXTRACTED" for field in required_fields):
        return None
    totals = []
    for row in subj_std.get("rows", []):
        value = row.value or {}
        if target_lot and value.get("lot") != target_lot:
            continue
        if value.get("factor_total") is not None:
            totals.append(value["factor_total"])
    if len(totals) != 1:
        return None
    return formula_verifier.verify_unit_price(
        standard_row["official_price"].value,
        standard_row["time_adjustment"].value,
        1.0,
        totals[0],
        decided.value,
        target_comp_summary.get("decided_unit_price"),
        rel_tol=0.002,
    )


def to_json_dict(canonical: dict) -> dict:
    return fdict(canonical)
