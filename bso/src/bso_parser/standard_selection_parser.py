# -*- coding: utf-8 -*-
"""비교표준지·기준연도·공시지가 추출."""
import re
from .models import Field, Evidence
from .textnorm import DONG_LOT_RE, LOT_ONLY_RE

BASE_YEAR_RE = re.compile(r"공시[기키]준일\s*[:：]?\s*(\d{4})")
PRICE_RE = re.compile(r"\b(\d{1,3}(?:,\d{3})+)\b")
ROAD_RE = re.compile(r"(세로\s*[\(\[]?[가불][\)\]]?|소로한면|소로각지|중로한면|중로각지|대로한면|대로각지|맹지)")
SHAPE_RE = re.compile(r"(가장형|세장형|정방형|장방형|사다리|부정형|자루형)")
TOPO_RE = re.compile(r"(평지|완경사|급경사|저지|고지)")
ZONING_RE = re.compile(r"(자연녹지|생산녹지|보전녹지|계획관리|생산관리|보전관리|준주거|일반상업|준공업|일반공업|농림)")
DONG_RE = re.compile(r"([가-힣]{2,10}[동리])\b")
DIRECT_MARKER_RE = re.compile(r"^\s*([A-Z]|[가-힣])\s+(?=[가-힣]{1,11}[동리]\b)")
ROW_MARKER_RE = re.compile(r"^\s*([A-Z]|[가-힣])\s+")


def _norm_lot(lot):
    match = re.match(r"(산?)(\d+)(?:-(\d+))?$", lot or "")
    if not match:
        return lot
    return f"{match.group(1)}{int(match.group(2))}-{int(match.group(3))}" if match.group(3) else f"{match.group(1)}{int(match.group(2))}"


def _selected_value(candidate: dict) -> dict:
    return {
        key: candidate.get(key)
        for key in ("marker", "dong", "lot", "road", "shape", "topo", "zoning", "official_price")
    }


def parse(doc, pages: list, cross_hint: dict | None = None) -> dict:
    output = {"applied_base_year": Field.missing(), "selected_standard": Field.missing(),
              "candidates": [], "exclusion_notes": [], "raw_pages": pages}
    hint_price = (cross_hint or {}).get("official_price")
    hint_marker = (cross_hint or {}).get("marker")
    hint_status = (cross_hint or {}).get("status")
    for page_number in pages:
        raw = doc.page_text_tabular(page_number - 1) if hasattr(doc, 'page_text_tabular') else doc.page_text(page_number - 1)
        if not raw.strip():
            continue
        method = doc.page_method(page_number - 1)
        year_match = BASE_YEAR_RE.search(raw)
        if year_match and output["applied_base_year"].status == "NOT_FOUND":
            output["applied_base_year"] = Field.ok(int(year_match.group(1)),
                [Evidence(page=page_number, method=method, snippet=year_match.group(0))])
        lines = raw.splitlines()
        last_dong = None
        for idx, raw_line in enumerate(lines):
            line = " ".join(raw_line.split())
            dong_match = DONG_RE.search(line)
            if dong_match:
                last_dong = dong_match.group(1)
            lot_match = DONG_LOT_RE.search(line)
            prices = [int(value.replace(",", "")) for value in PRICE_RE.findall(line)]
            prices = [value for value in prices if 1000 <= value <= 500_000_000]
            if not lot_match or not prices:
                continue
            marker_match = DIRECT_MARKER_RE.search(line)
            candidate = {
                "marker": marker_match.group(1) if marker_match else None,
                "dong": lot_match.group(1), "lot": _norm_lot(lot_match.group(2)),
                "road": ROAD_RE.search(line).group(1).replace(" ", "") if ROAD_RE.search(line) else None,
                "shape": SHAPE_RE.search(line).group(1) if SHAPE_RE.search(line) else None,
                "topo": TOPO_RE.search(line).group(1) if TOPO_RE.search(line) else None,
                "zoning": ZONING_RE.search(line).group(1) if ZONING_RE.search(line) else None,
                "official_price": prices[-1], "page": page_number, "method": method,
                "snippet": line[:180], "selected_mark": "선정" in line and "배제" not in line,
            }
            output["candidates"].append(candidate)
        last_dong = None
        for idx, raw_line in enumerate(lines):
            line = " ".join(raw_line.split())
            dong_match = DONG_RE.search(line)
            if dong_match:
                last_dong = dong_match.group(1)
            if DONG_LOT_RE.search(line):
                continue
            lot_only = LOT_ONLY_RE.search(line)
            if not lot_only:
                continue
            lot_str = lot_only.group(1)
            if not re.search(r"\d+-\d+", lot_str):
                continue
            prices = [int(v.replace(",", "")) for v in PRICE_RE.findall(line)]
            prices = [v for v in prices if 1000 <= v <= 500_000_000]
            marker = None
            if not prices:
                for adj in (max(0, idx - 1), min(len(lines) - 1, idx + 1)):
                    adj_line = " ".join(lines[adj].split())
                    adj_prices = [int(v.replace(",", "")) for v in PRICE_RE.findall(adj_line)]
                    prices = [v for v in adj_prices if 1000 <= v <= 500_000_000]
                    if prices:
                        marker_match = ROW_MARKER_RE.search(adj_line)
                        marker = marker_match.group(1) if marker_match else None
                        line = adj_line + " " + line
                        break
            if not prices:
                continue
            candidate = {
                "marker": marker,
                "dong": last_dong,
                "lot": _norm_lot(lot_str),
                "road": ROAD_RE.search(line).group(1).replace(" ", "") if ROAD_RE.search(line) else None,
                "shape": SHAPE_RE.search(line).group(1) if SHAPE_RE.search(line) else None,
                "topo": TOPO_RE.search(line).group(1) if TOPO_RE.search(line) else None,
                "zoning": ZONING_RE.search(line).group(1) if ZONING_RE.search(line) else None,
                "official_price": prices[-1], "page": page_number, "method": method,
                "snippet": line[:180], "selected_mark": False,
            }
            output["candidates"].append(candidate)

    unique = []
    seen = set()
    for candidate in output["candidates"]:
        key = (
            candidate.get("page"), candidate.get("marker"), candidate.get("dong"),
            candidate.get("lot"), candidate.get("official_price"),
        )
        if key not in seen:
            seen.add(key)
            unique.append(candidate)
    output["candidates"] = unique
    pool = output["candidates"]
    hint_present = hint_price is not None or hint_marker is not None
    matching = [
        item for item in pool
        if (hint_price is None or item["official_price"] == hint_price)
        and (hint_marker is None or item.get("marker") == hint_marker)
    ]
    if hint_present:
        if matching:
            pool = matching
    marked = [item for item in pool if item["selected_mark"]]

    if len(marked) > 1:
        value = _selected_value(marked[0])
        evidence = [Evidence(page=marked[0]["page"], method=marked[0]["method"], snippet=marked[0]["snippet"])]
        output["selected_standard"] = Field.review(value, evidence, f"선정표시 {len(marked)}건 — 자동선택 금지")
    elif len(marked) == 1:
        chosen = marked[0]
        value = _selected_value(chosen)
        evidence = [Evidence(page=chosen["page"], method=chosen["method"], snippet=chosen["snippet"])]
        if hint_status in ("EXTRACTED", "SOURCE_CONFIRMED"):
            output["selected_standard"] = Field.ok(value, evidence)
        elif hint_status == "REVIEW_REQUIRED":
            output["selected_standard"] = Field.review(value, evidence, "교차가격 출처 REVIEW_REQUIRED")
        else:
            output["selected_standard"] = Field.ok(value, evidence)
    elif pool:
        if hint_present:
            if len(matching) == 1:
                chosen = matching[0]
                value = _selected_value(chosen)
                evidence = [Evidence(page=chosen["page"], method=chosen["method"], snippet=chosen["snippet"])]
                if hint_status == "REVIEW_REQUIRED":
                    output["selected_standard"] = Field.review(value, evidence, "교차가격 출처 REVIEW_REQUIRED")
                else:
                    output["selected_standard"] = Field.ok(value, evidence)
            elif len(matching) > 1:
                value = _selected_value(matching[0])
                evidence = [Evidence(page=matching[0]["page"], method=matching[0]["method"], snippet=matching[0]["snippet"])]
                output["selected_standard"] = Field.review(value, evidence,
                    f"동일 공시지가 후보 {len(matching)}건 — 자동선택 금지")
            else:
                chosen = pool[0]
                value = _selected_value(chosen)
                evidence = [Evidence(page=chosen["page"], method=chosen["method"], snippet=chosen["snippet"])]
                output["selected_standard"] = Field.review(value, evidence, "선정표시 또는 교차가격 확인 필요")
        else:
            chosen = pool[0]
            value = _selected_value(chosen)
            evidence = [Evidence(page=chosen["page"], method=chosen["method"], snippet=chosen["snippet"])]
            output["selected_standard"] = Field.review(value, evidence, "선정표시 또는 교차가격 확인 필요")
    elif output["candidates"]:
        output["selected_standard"] = Field.review(None, [], "후보 존재하나 선정 표준지 확정 불가")
    return output
