# -*- coding: utf-8 -*-
"""그 밖의 요인 산정 사례(평가사례/거래사례) 파서."""
import re
from .models import Field, Evidence
from .textnorm import DONG_LOT_RE, LOT_ONLY_RE, parse_date

PRICE_RE = re.compile(r"\b(\d{1,3}(?:,\d{3})+)\b")
DATE_RE = re.compile(r"(?<!\d)(?:19|20)\d{2}[.\s/-]+\d{1,2}[.\s/-]+\d{1,2}(?!\d)")
USE_RE = re.compile(r"\b(전|답|대|임야|잡종지|공장용지|과수원|목장용지)\b")
ZONING_RE = re.compile(r"(자연\s*녹지|생산녹지|보전녹지|계획관리|일반상업|준공업|1종일주)")
PURPOSE_RE = re.compile(r"보상\s*\(?\s*(협의|수용)\s*\)?|경매|담보|일반거래")
DONG_RE = re.compile(r"([가-힣]{1,11}[동리])\b")
STRICT_CONTEXT_LOT_RE = re.compile(r"\b(산?\d{1,4}-\d{1,4})\b")
CASE_MARKER_RE = re.compile(r"(?:^|\s)(#[0-9]+|[a-z])(?:\s|$)")


def _norm_line(value: str) -> str:
    return " ".join((value or "").split())


def _valid_lot(token: str, text: str) -> bool:
    plain = (token or "").removeprefix("산")
    main = plain.split("-", 1)[0]
    if len(main) == 4 and main.isdigit() and 1900 <= int(main) <= 2100:
        return False
    date_match = DATE_RE.search(text or "")
    if date_match and token and token in date_match.group(0):
        return False
    if PRICE_RE.search(text or "") and "-" not in (token or ""):
        return False
    return bool(token)


def _page_case_type(compact: str) -> str | None:
    """Return the first case section represented on the page.

    Some appraisal reports put both transaction and appraisal cases on the
    same page.  In that layout the row loop below changes the active type at
    each subsection heading; this value is only the starting state.
    """
    transaction_positions = [
        position for position in (compact.find("거래사례"), compact.find("실거래가"))
        if position >= 0
    ]
    appraisal_positions = [
        position for position in (compact.find("감정평가사례"), compact.find("평가사례"))
        if position >= 0
    ]
    first_transaction = min(transaction_positions) if transaction_positions else None
    first_appraisal = min(appraisal_positions) if appraisal_positions else None
    if first_transaction is None:
        return "appraisal_case" if first_appraisal is not None else None
    if first_appraisal is None or first_transaction <= first_appraisal:
        return "transaction_case"
    return "appraisal_case"


def _marker_from_context(lines: list[str], index: int, lookahead: int = 2) -> str | None:
    """Prefer a marker on the value row, then following rows, then prior rows.

    Table extraction often emits a row's lot and marker after its price/date.
    Looking backward first can incorrectly attach the preceding case marker.
    """
    indexes = [index]
    indexes.extend(range(index + 1, min(len(lines), index + lookahead + 1)))
    indexes.extend(range(index - 1, max(-1, index - 4), -1))
    for candidate_index in indexes:
        match = CASE_MARKER_RE.search(_norm_line(lines[candidate_index]))
        if match:
            return match.group(1)
    return None


def _location_from_context(
    lines: list[str],
    index: int,
    last_dong: str | None,
    lookahead: int = 0,
) -> tuple[str | None, str | None, str]:
    """현재 행과 직전 3개 행에서 동·지번을 복원한다.

    가격·연도 조각을 지번으로 오인하지 않도록 문맥 승계에서는 하이픈 지번만 허용한다.
    """
    if lookahead:
        adjacent = [_norm_line(line) for line in lines[index:min(len(lines), index + lookahead + 1)]]
        for text in adjacent:
            match = DONG_LOT_RE.search(text)
            if match and _valid_lot(match.group(2), text):
                return match.group(1), match.group(2), "same_or_next_line"
        for text in adjacent:
            lot_match = STRICT_CONTEXT_LOT_RE.search(text)
            if lot_match and _valid_lot(lot_match.group(1), text):
                dong_match = DONG_RE.search(text)
                return (
                    dong_match.group(1) if dong_match else last_dong,
                    lot_match.group(1),
                    "adjacent_line",
                )

    start = max(0, index - 3)
    window = [_norm_line(line) for line in lines[start:index + 1]]
    for text in reversed(window):
        match = DONG_LOT_RE.search(text)
        if match and _valid_lot(match.group(2), text):
            return match.group(1), match.group(2), "same_or_previous_line"
    lot = None
    dong = last_dong
    for text in reversed(window):
        if lot is None:
            for lot_match in STRICT_CONTEXT_LOT_RE.finditer(text):
                candidate = lot_match.group(1)
                if _valid_lot(candidate, text):
                    lot = candidate
                    break
        if dong is None:
            dong_match = DONG_RE.search(text)
            if dong_match:
                dong = dong_match.group(1)
        if dong and lot:
            break
    return dong, lot, "context_inheritance" if dong or lot else "not_found"


def parse(doc, pages: list) -> dict:
    output = {"cases": [], "raw_pages": pages}
    for page_number in pages:
        raw = doc.page_text_tabular(page_number - 1) if hasattr(doc, "page_text_tabular") else doc.page_text(page_number - 1)
        if not raw.strip():
            continue
        method = doc.page_method(page_number - 1)
        compact = raw.replace(" ", "")
        case_type = _page_case_type(compact)
        if case_type is None:
            continue
        lines = raw.splitlines()
        last_dong = None
        active_case_type = case_type
        for index, raw_line in enumerate(lines):
            line = _norm_line(raw_line)
            line_compact = line.replace(" ", "")
            transaction_at = min(
                (position for position in (line_compact.find("거래사례"), line_compact.find("실거래가"))
                 if position >= 0),
                default=None,
            )
            appraisal_at = min(
                (position for position in (line_compact.find("감정평가사례"), line_compact.find("평가사례"))
                 if position >= 0),
                default=None,
            )
            if transaction_at is not None and (appraisal_at is None or transaction_at <= appraisal_at):
                active_case_type = "transaction_case"
            elif appraisal_at is not None:
                active_case_type = "appraisal_case"
            dong_only = DONG_RE.search(line)
            if dong_only:
                last_dong = dong_only.group(1)
            date_match = DATE_RE.search(line)
            purpose = PURPOSE_RE.search(line)
            prices = [int(value.replace(",", "")) for value in PRICE_RE.findall(line)]
            prices = [value for value in prices if 10_000 <= value <= 500_000_000]
            if not prices or not (date_match or purpose):
                continue
            dong, lot, location_method = _location_from_context(lines, index, last_dong, lookahead=2)
            context = " ".join(
                _norm_line(value)
                for value in lines[max(0, index - 3):min(len(lines), index + 3)]
            )
            use_match = USE_RE.search(context)
            zoning_match = ZONING_RE.search(context)
            case = {
                "case_type": active_case_type,
                "case_marker": _marker_from_context(lines, index, lookahead=2),
                "dong": dong,
                "lot": lot,
                "land_use": use_match.group(1) if use_match else None,
                "zoning": zoning_match.group(1).replace(" ", "") if zoning_match else None,
                "unit_price": prices[0],
                "price_date": parse_date(date_match.group(0)) if date_match else None,
                "purpose": purpose.group(0) if purpose else None,
                "location_extraction": location_method,
            }
            evidence = [Evidence(page=page_number, method=method, snippet=context[-220:])]
            field = Field.ok(case, evidence) if case["dong"] and case["lot"] else Field.review(
                case, evidence, "사례 소재지 또는 지번 미판독 — GIS 입력 차단")
            duplicate = any(
                item["data"].get("unit_price") == case["unit_price"]
                and item["data"].get("price_date") == case["price_date"]
                and item["data"].get("lot") == case["lot"]
                for item in output["cases"]
            )
            if not duplicate:
                output["cases"].append({"data": case, "field": field})
    return output
