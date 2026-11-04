# -*- coding: utf-8 -*-
"""개별요인 비교 파서.

페이지 번호나 특정 지번을 전제하지 않고, 표 머리글과 행 구조를 함께 사용한다.
조건 셀은 값뿐 아니라 NOT_APPLICABLE / NOT_FOUND 상태를 보존한다.
"""
import re
from .models import Field, Evidence, REVIEW_REQUIRED, NOT_APPLICABLE, NOT_FOUND
from .textnorm import detect_stance

FACTOR_LABELS = ["street", "access", "environment", "parcel", "administrative", "other"]
HEADER_ALIASES = {
    "street": ("가로조건", "가로 조건", "가로"),
    "access": ("접근조건", "접근 조건", "접근"),
    "environment": ("환경조건", "자연환경조건", "환경 자연 조건", "환경"),
    "parcel": ("획지조건", "획지 조건", "획지"),
    "administrative": ("행정적조건", "행정적 조건", "행정조건", "행정"),
    "other": ("기타조건", "기타 조건", "기타"),
    "total": ("개별요인비교치", "개별요인 비교치", "개별요인계", "개별요인 계", "누계"),
}
LOT_RE = re.compile(r"(?<!\d)(산?\s*\d{1,4}\s*-\s*\d{1,4})(?!\d)")
NUMBER_TOKEN_RE = re.compile(r"(?<!\d)(-|[01][.,]\d{2,3})(?!\d)")
TOTAL_RE = re.compile(r"(?<!\d)([01])[.,](\d{3})(?!\d)")
OTHER_FACTOR_RE = re.compile(r"(?<!\d)([1-9][.,]\d{2})(?!\d)")


def _compact(text: str) -> str:
    return re.sub(r"\s+", "", text or "")


def _norm_lot(lot: str) -> str:
    text = re.sub(r"\s+", "", lot or "")
    m = re.match(r"(산?)(\d+)-(\d+)$", text)
    if not m:
        return text
    return f"{m.group(1)}{int(m.group(2))}-{int(m.group(3))}"


def _header_score(text: str) -> tuple[int, list[str]]:
    compact = _compact(text)
    hits = []
    for key, aliases in HEADER_ALIASES.items():
        if any(_compact(alias) in compact for alias in aliases):
            hits.append(key)
    return len(hits), hits


def _cell(raw: str) -> dict:
    raw = (raw or "").strip()
    if raw in {"-", "–", "—"}:
        return {"value": None, "state": NOT_APPLICABLE, "raw": raw}
    if not raw:
        return {"value": None, "state": NOT_FOUND, "raw": raw}
    try:
        return {"value": float(raw.replace(",", ".")), "state": "EXTRACTED", "raw": raw}
    except ValueError:
        return {"value": None, "state": NOT_FOUND, "raw": raw}


def _parse_factor_tokens(segment: str) -> tuple[dict | None, float | None, list[str]]:
    tokens = NUMBER_TOKEN_RE.findall(segment)
    # find the first seven-token window whose final token is a three-decimal total
    for start in range(0, max(0, len(tokens) - 6)):
        window = tokens[start:start + 7]
        if len(window) < 7 or not re.fullmatch(r"[01][.,]\d{3}", window[-1]):
            continue
        cells = {name: _cell(raw) for name, raw in zip(FACTOR_LABELS, window[:6])}
        total = float(window[-1].replace(",", "."))
        return cells, total, window
    return None, None, []


def parse_subject_to_standard(doc, pages: list, target_lot: str | None = None) -> dict:
    out = {"rows": [], "raw_pages": pages, "section_status": "EXTRACTED"}
    any_text = False
    active_header = False
    header_pages = []
    seen = set()

    for pno in pages:
        raw = doc.page_text_tabular(pno - 1) if hasattr(doc, "page_text_tabular") else doc.page_text(pno - 1)
        if not raw.strip():
            continue
        any_text = True
        method = doc.page_method(pno - 1)
        lines = [" ".join(line.split()) for line in raw.splitlines() if line.strip()]

        page_header_score, page_header_hits = _header_score(" ".join(lines[:12]))
        if page_header_score >= 4 and "total" in page_header_hits:
            active_header = True
            header_pages.append(pno)

        for idx, line in enumerate(lines):
            local = " ".join(lines[max(0, idx - 2): idx + 1])
            local_score, local_hits = _header_score(local)
            if local_score >= 4 and "total" in local_hits:
                active_header = True
                if pno not in header_pages:
                    header_pages.append(pno)
                continue

            lm = LOT_RE.search(line)
            if not lm or not active_header:
                continue

            after = line[lm.end():]
            cells, factor_total, token_window = _parse_factor_tokens(after)
            if factor_total is None:
                # wrapped row: append up to two following lines
                joined = " ".join(lines[idx:min(len(lines), idx + 3)])
                after = joined[lm.end():] if lm.end() <= len(joined) else joined
                cells, factor_total, token_window = _parse_factor_tokens(after)
            if factor_total is None:
                continue

            reason_m = re.search(
                r"([가-힣][가-힣\s(),·/]*?(?:우세|열세|대등|유사|대동)[가-힣\s().,]*)",
                after,
            )
            reason = " ".join(reason_m.group(1).split()) if reason_m else None
            stances = detect_stance(reason or "")

            tail_index = after.find(token_window[-1]) + len(token_window[-1]) if token_window else 0
            tail = after[tail_index:]
            candidates = [float(x.replace(",", ".")) for x in OTHER_FACTOR_RE.findall(tail)]
            other_factor_col = next((v for v in candidates if 1.0 < v < 9.9), None)

            lot = _norm_lot(lm.group(1))
            if target_lot and lot != _norm_lot(target_lot):
                continue
            key = (pno, lot, factor_total, tuple(token_window))
            if key in seen:
                continue
            seen.add(key)

            row = {
                "lot": lot,
                "factor_cells": cells,
                "factors": {name: cell["value"] for name, cell in (cells or {}).items()} if cells else None,
                "factor_total": factor_total,
                "other_factor_col": other_factor_col,
                "reason_phrase": reason,
                "stances": stances,
                "header_relation": {
                    "header_detected": active_header,
                    "header_pages": list(header_pages),
                    "factor_order": FACTOR_LABELS,
                },
            }
            ev = [Evidence(page=pno, method=method, snippet=line[:240])]
            inconsistent = bool(set(stances) & {"우세", "열세"}) and factor_total == 1.0
            incomplete = cells is None or any(cell["state"] == NOT_FOUND for cell in cells.values())
            if inconsistent:
                out["rows"].append(Field.review(row, ev, note="이유문구와 누계가 표면상 불일치 — 자동 확정 금지"))
            elif incomplete:
                out["rows"].append(Field.review(row, ev, note="조건별 셀 일부 미판독 — 원문 표 확인 필요"))
            else:
                out["rows"].append(Field.ok(row, ev))

    by_lot = {}
    for row in out["rows"]:
        by_lot.setdefault(row.value["lot"], []).append(row)
    for lot, rows in by_lot.items():
        totals = {row.value["factor_total"] for row in rows}
        if len(totals) > 1:
            for row in rows:
                if row.status == "EXTRACTED":
                    row.status = REVIEW_REQUIRED
                    row.note = f"교차페이지 누계 상충 {sorted(totals)} — 원문 확인 필요"

    out["header_detection"] = {
        "detected": bool(header_pages),
        "pages": header_pages,
        "required_headers": FACTOR_LABELS + ["total"],
    }
    if not out["rows"]:
        out["section_status"] = REVIEW_REQUIRED
        out["note"] = "헤더-행 관계 기반 비교행 파싱 실패" if any_text else "해당 섹션 텍스트/OCR 확보 불가"
    return out


def structure_standard_to_case(other_factor_result: dict) -> dict:
    factors = other_factor_result.get("case_individual_factors")
    stance = other_factor_result.get("case_comparison_stance")
    case_row = other_factor_result.get("case_row")
    out = {"factors": factors, "stance": stance, "consistency": None}
    if factors is not None and factors.status == "EXTRACTED" and case_row:
        items = [v for v in factors.value["items"] if v is not None]
        total_ref = case_row["individual_factor_total"].value
        prod = 1.0
        for value in items:
            prod *= value
        ok = total_ref and abs(prod - total_ref) / total_ref < 0.005
        out["consistency"] = {
            "product_of_items": round(prod, 4),
            "declared_total": total_ref,
            "match": bool(ok),
        }
    return out
