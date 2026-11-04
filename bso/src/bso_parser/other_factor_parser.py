# -*- coding: utf-8 -*-
"""그 밖의 요인 산정표에서 사례행·표준지행·명시적 결정값을 추출한다."""
import re
from .models import Field, Evidence
from .textnorm import parse_date, detect_stance, find_factor_sequence


def normalize_decimals(text: str) -> str:
    text = re.sub(r"(?<![\d.])(\d{1,3}) (\d{3,6})(?![\d,])", r"\1.\2", text)
    return re.sub(r"(?<![\d.])(\d),(\d{2})(?!\d)", r"\1.\2", text)


CASE_ROW_RE = re.compile(
    r'([①-⑳\d]{1,3}|["""]?\d["""]?|거래[#\d]*\d)\s+([\d,]{6,12})\s+(?:-\s+)?'
    r'(1\.\d{2,6})\s+(\d\.\d{1,6})\s+(\d\.\d{2,4})\s+([\d,]{6,12})'
    r'(?:\s+(\d\.\d{2,4}))?'
)
STD_ROW_RE = re.compile(r"([A-Z가-힣])\s+([\d,]{6,12})\s+(?:-\s+)?(1\.\d{3,6})\s+(?:-\s+)*([\d,]{6,12})")
DECIDED_TABLE_RE = re.compile(r"([A-Z가-힣])\s+(\d\.\d{2,4})\b")
HEADER_MARKER_RE = re.compile(r"비교표준지\s*[‘’'\"(]?\s*([A-Z가-힣])\s*[‘’'\")]")
LINE_BLOCK_RE = re.compile(
    r"사례기준\s+([\d,]{6,12})\s+(1[.,]\d{3,6})\s+(\d[.,]\d{1,4})\s+"
    r"(\d[.,]\d{2,4})\s+([\d,]{6,12})\s+([A-Z가-힣])\s+([A-Za-z가-힣0-9#]+)\s+"
    r"구분\s+표준지\s+시점수정\s+산출단가\s+(\d[.,]\d{2,4})\s+"
    r"표준지가액\s+([\d,]{6,12})\s+(1[.,]\d{3,6})\s+([\d,]{6,12})"
)
PRIME_BLOCK_RE = re.compile(
    r"(거래[#]?\d+|평가[#]?\d+)\s+([\d,]{6,12})\s+(\d[.,]\d{1,4})\s+"
    r"(1[.,]\d{3,6})\s+(\d[.,]\d{1,4})\s+(\d[.,]\d{2,4})\s+([\d,]{6,12})\s+"
    r"표준지평가\s+(\d[.,]\d{2,4})\s+표준지공시지가\s+표준지\s+"
    r"([\d,]{6,12})\s+-\s+(1[.,]\d{3,6})\s+-\s+-\s+([\d,]{6,12})"
)


def _integer(value):
    return int(value.replace(",", ""))


def _decimal(value):
    return float(value.replace(",", "."))


def _target_block_candidates(doc, pages: list) -> tuple[list[dict], dict[int, str]]:
    candidates = []
    raw_by_page = {}
    for page_number in pages:
        raw = doc.page_text_tabular(page_number - 1) if hasattr(doc, "page_text_tabular") else doc.page_text(page_number - 1)
        if not raw.strip():
            continue
        raw_by_page[page_number] = raw
        text = normalize_decimals(" ".join(raw.split()))
        method = doc.page_method(page_number - 1)

        for match in LINE_BLOCK_RE.finditer(text):
            candidates.append({
                "page": page_number,
                "method": method,
                "snippet": match.group(0)[:240],
                "case_marker": match.group(7),
                "case_unit_price": _integer(match.group(1)),
                "time_adjustment": _decimal(match.group(2)),
                "regional_factor": _decimal(match.group(3)),
                "individual_factor_total": _decimal(match.group(4)),
                "case_adjusted_unit_price": _integer(match.group(5)),
                "standard_marker": match.group(6),
                "gap_ratio": _decimal(match.group(8)),
                "official_price": _integer(match.group(9)),
                "standard_time_adjustment": _decimal(match.group(10)),
                "standard_adjusted_unit_price": _integer(match.group(11)),
            })

        header = HEADER_MARKER_RE.search(text)
        if header:
            for match in PRIME_BLOCK_RE.finditer(text):
                candidates.append({
                    "page": page_number,
                    "method": method,
                    "snippet": match.group(0)[:240],
                    "case_marker": match.group(1),
                    "case_unit_price": _integer(match.group(2)),
                    "case_adjustment": _decimal(match.group(3)),
                    "time_adjustment": _decimal(match.group(4)),
                    "regional_factor": _decimal(match.group(5)),
                    "individual_factor_total": _decimal(match.group(6)),
                    "case_adjusted_unit_price": _integer(match.group(7)),
                    "standard_marker": header.group(1),
                    "gap_ratio": _decimal(match.group(8)),
                    "official_price": _integer(match.group(9)),
                    "standard_time_adjustment": _decimal(match.group(10)),
                    "standard_adjusted_unit_price": _integer(match.group(11)),
                })
    return candidates, raw_by_page


def _factor_items_for_candidate(
    candidate: dict,
    raw_by_page: dict[int, str],
) -> tuple[list[float] | None, int | None, str | None]:
    marker = candidate["standard_marker"]
    total = candidate["individual_factor_total"]
    page_order = [candidate["page"], *[page for page in raw_by_page if page != candidate["page"]]]
    for page_number in page_order:
        for raw_line in raw_by_page[page_number].splitlines():
            line = " ".join(raw_line.split())
            if page_number != candidate["page"] and not re.match(rf"^{re.escape(marker)}\s+", line):
                continue
            values = [_decimal(value) for value in re.findall(r"(?<!\d)([01][.,]\d{2,3})(?!\d)", line)]
            if len(values) >= 7 and abs(values[6] - total) <= 0.002:
                return values[:6], page_number, line[:240]
    return None, None, None


def _decided_for_marker(marker: str, raw_by_page: dict[int, str]):
    pattern = re.compile(rf"^\s*{re.escape(marker)}\s+(\d[.,]\d{{1,4}})(?:\s+(\d[.,]\d{{1,4}}))?\s*$")
    for page_number, raw in raw_by_page.items():
        for raw_line in raw.splitlines():
            line = " ".join(raw_line.split())
            match = pattern.match(line)
            if match:
                value = _decimal(match.group(2) or match.group(1))
                if 1.0 <= value <= 10.0:
                    return value, page_number, line
    return None


def parse_for_standard(doc, pages: list, *, marker: str | None, official_price: int | None) -> dict | None:
    """산출근거의 표준지 기호·공시지가로 정확한 그 밖의 요인 블록을 선택한다."""
    if marker is None and official_price is None:
        return None
    candidates, raw_by_page = _target_block_candidates(doc, pages)
    matches = [
        candidate for candidate in candidates
        if (marker is None or candidate["standard_marker"] == marker)
        and (official_price is None or candidate["official_price"] == official_price)
    ]
    if len(matches) != 1:
        return None
    candidate = matches[0]
    evidence = [Evidence(
        page=candidate["page"], method=candidate["method"], snippet=candidate["snippet"]
    )]
    case_row = {
        "case_marker": Field.ok(candidate["case_marker"], evidence),
        "case_unit_price": Field.ok(candidate["case_unit_price"], evidence),
        "time_adjustment": Field.ok(candidate["time_adjustment"], evidence),
        "regional_factor": Field.ok(candidate["regional_factor"], evidence),
        "individual_factor_total": Field.ok(candidate["individual_factor_total"], evidence),
        "adjusted_unit_price": Field.ok(candidate["case_adjusted_unit_price"], evidence),
        "gap_ratio": Field.ok(candidate["gap_ratio"], evidence),
    }
    standard_row = {
        "standard_marker": Field.ok(candidate["standard_marker"], evidence),
        "official_price": Field.ok(candidate["official_price"], evidence),
        "time_adjustment": Field.ok(candidate["standard_time_adjustment"], evidence),
        "adjusted_unit_price": Field.ok(candidate["standard_adjusted_unit_price"], evidence),
    }
    items, factor_page, factor_snippet = _factor_items_for_candidate(candidate, raw_by_page)
    factors = Field.missing()
    if items is not None:
        factors = Field.ok(
            {"items": items, "total": candidate["individual_factor_total"]},
            [Evidence(
                page=factor_page or candidate["page"],
                method=doc.page_method((factor_page or candidate["page"]) - 1),
                snippet=factor_snippet or "",
            )],
        )
    decided = Field.missing()
    decision = _decided_for_marker(candidate["standard_marker"], raw_by_page)
    if decision:
        value, page_number, snippet = decision
        decided = Field.ok(value, [Evidence(
            page=page_number, method=doc.page_method(page_number - 1), snippet=snippet,
        )])
    return {
        "case_row": case_row,
        "standard_row": standard_row,
        "case_time_adjustment_period": Field.missing(),
        "case_individual_factors": factors,
        "case_comparison_stance": Field.missing(),
        "decided_value": decided,
        "raw_pages": pages,
        "selection_basis": "target_standard_marker_and_official_price",
    }


def parse(doc, pages: list) -> dict:
    output = {
        "case_row": None,
        "standard_row": None,
        "case_time_adjustment_period": Field.missing(),
        "case_individual_factors": Field.missing(),
        "case_comparison_stance": Field.missing(),
        "decided_value": Field.missing(),
        "raw_pages": pages,
    }
    joined = []
    for page_number in pages:
        raw = doc.page_text_tabular(page_number - 1) if hasattr(doc, 'page_text_tabular') else doc.page_text(page_number - 1)
        if raw.strip():
            joined.append((page_number, doc.page_method(page_number - 1), normalize_decimals(" ".join(raw.split()))))

    case_page = None
    for page_number, method, text in joined:
        evidence = lambda snippet: [Evidence(page=page_number, method=method, snippet=snippet[:180])]
        if output["case_row"] is None:
            match = CASE_ROW_RE.search(text)
            if match:
                output["case_row"] = {
                    "case_marker": Field.ok(match.group(1).strip('\"""'), evidence(match.group(0))),
                    "case_unit_price": Field.ok(_integer(match.group(2)), evidence(match.group(0))),
                    "time_adjustment": Field.ok(float(match.group(3)), evidence(match.group(0))),
                    "regional_factor": Field.ok(float(match.group(4)), evidence(match.group(0))),
                    "individual_factor_total": Field.ok(float(match.group(5)), evidence(match.group(0))),
                    "adjusted_unit_price": Field.ok(_integer(match.group(6)), evidence(match.group(0))),
                    "gap_ratio": Field.ok(float(match.group(7)), evidence(match.group(0))) if match.group(7) else Field.missing(),
                }
                case_page = page_number
        if output["standard_row"] is None:
            for match in STD_ROW_RE.finditer(text):
                price, time, adjusted = _integer(match.group(2)), float(match.group(3)), _integer(match.group(4))
                if output["case_row"] and price == output["case_row"]["case_unit_price"].value:
                    continue
                if adjusted >= price:
                    output["standard_row"] = {
                        "standard_marker": Field.ok(match.group(1), evidence(match.group(0))),
                        "official_price": Field.ok(price, evidence(match.group(0))),
                        "time_adjustment": Field.ok(time, evidence(match.group(0))),
                        "adjusted_unit_price": Field.ok(adjusted, evidence(match.group(0))),
                    }
                    break

    for page_number, method, text in joined:
        evidence = lambda snippet: [Evidence(page=page_number, method=method, snippet=snippet[:180])]
        if output["case_individual_factors"].status == "NOT_FOUND" and output["case_row"] and page_number == case_page:
            total = output["case_row"]["individual_factor_total"].value
            for match in re.finditer(r"개별요인", text):
                segment = text[match.start():match.start() + 450]
                sequence = find_factor_sequence(segment, min_len=4)
                if sequence and total in sequence:
                    cut = sequence.index(total)
                    output["case_individual_factors"] = Field.ok({"items": sequence[:cut], "total": total}, evidence(segment))
                    break
        if output["case_comparison_stance"].status == "NOT_FOUND":
            match = re.search(r"(비교?표준지는?\s*사례\s*대비[^.]*)", text)
            if match:
                output["case_comparison_stance"] = Field.ok(
                    {"phrase": match.group(1)[:200], "stances": detect_stance(match.group(1))}, evidence(match.group(1)))
        if output["decided_value"].status == "NOT_FOUND" and output["case_row"]:
            match = re.search(r"산정치\s*(\d\.\d{2,4}).{0,30}?결정치\s*(\d\.\d{1,3})", text)
            if match and output["case_row"].get("gap_ratio") and output["case_row"]["gap_ratio"].status == "EXTRACTED":
                if abs(float(match.group(1)) - output["case_row"]["gap_ratio"].value) < 0.02:
                    output["decided_value"] = Field.ok(float(match.group(2)), evidence(match.group(0)))

    if output["decided_value"].status == "NOT_FOUND":
        for page_number, method, text in joined:
            if not re.search(r"보정|결정|그\s*밖|산정", text):
                continue
            evidence = lambda snippet: [Evidence(page=page_number, method=method, snippet=snippet[:180])]
            for m in DECIDED_TABLE_RE.finditer(text):
                val = float(m.group(2))
                if 1.0 <= val <= 10.0:
                    output["decided_value"] = Field.review(
                        val, evidence(m.group(0)),
                        note="결정표 형식에서 추출 — 산정/결정치 쌍 미확인",
                    )
                    break
            if output["decided_value"].status != "NOT_FOUND":
                break
    return output
