"""XLSX -> TransactionCase bundle converter for live enrichment.

Reads a Korean land transaction XLSX (국토교통부 실거래가 등),
filters to pure-land pre-announcement target-combo rows (all source rows
preserved; POSSIBLE_SAME_TRANSACTION_EVENT flagged, not deleted), and
outputs a JSON bundle compatible with load_bundle().

Requirements: pip install openpyxl

Usage:
    python -m transaction_enrichment.xlsx_converter \
        --xlsx "<시군구_법정동_지번>.xlsx" \
        --output live_case_bundle.json \
        [--sheet "토지"] \
        [--standards standards.json]

Output bundle is LOCAL ONLY — never commit real addresses or PNU.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Any

try:
    from openpyxl import load_workbook
except ImportError:
    sys.exit("openpyxl required: pip install openpyxl")

from .precheck import ANNOUNCEMENT_DATE

LOOKBACK_YEARS = 3
LOOKBACK_START = date(
    ANNOUNCEMENT_DATE.year - LOOKBACK_YEARS,
    ANNOUNCEMENT_DATE.month,
    ANNOUNCEMENT_DATE.day,
)

TARGET_COMBOS: dict[tuple[str, str], list[str]] = {
    ("개발제한구역", "전"): [
        "S_GB_FIELD_01", "S_GB_FIELD_02", "S_GB_FIELD_03", "S_GB_FIELD_04", "S_GB_FIELD_05",
        "S_GB_FIELD_06", "S_GB_FIELD_07", "S_GB_FIELD_08", "S_GB_FIELD_09", "S_GB_FIELD_10",
        "S_GB_FIELD_11", "S_GB_FIELD_12", "S_GB_FIELD_13", "S_GB_FIELD_14", "S_GB_FIELD_15",
        "S_GB_FIELD_16", "S_GB_FIELD_17", "S_GB_FIELD_18", "S_GB_FIELD_19", "S_GB_FIELD_20",
        "S_GB_FIELD_21", "S_GB_FIELD_22", "S_GB_FIELD_23", "S_GB_FIELD_24", "S_GB_FIELD_25",
        "S_GB_FIELD_26", "S_GB_FIELD_27",
    ],
    ("개발제한구역", "답"): ["S_GB_PADDY_01", "S_GB_PADDY_02", "S_GB_PADDY_03"],
    ("개발제한구역", "잡종지"): [
        "S_GB_MISC_01", "S_GB_MISC_02", "S_GB_MISC_03", "S_GB_MISC_04", "S_GB_MISC_05",
        "S_GB_MISC_06", "S_GB_MISC_07", "S_GB_MISC_08", "S_GB_MISC_09", "S_GB_MISC_10",
    ],
    ("제1종일반주거지역", "전"): ["S_R1_FIELD_01"],
    ("제1종일반주거지역", "잡종지"): ["S_R1_MISC_01"],
    ("제1종일반주거지역", "대"): [
        "S_R1_SITE_01", "S_R1_SITE_02", "S_R1_SITE_03", "S_R1_SITE_04", "S_R1_SITE_05",
    ],
}

_HEADER_PATTERNS: dict[str, list[str]] = {
    "sigungu": ["시군구"],
    "dong": ["법정동", "읍면동"],
    "jibun": ["지번"],
    "bonbun": ["본번"],
    "bubun": ["부번"],
    "address": ["소재지주소", "소재지", "주소"],
    "zoning": ["용도지역"],
    "category": ["지목"],
    "area": ["거래면적", "면적", "토지면적"],
    "price": ["거래금액", "거래대금"],
    "date": ["거래년월일", "계약년월일", "거래일자", "계약일자", "거래년월", "계약년월"],
    "year": ["년", "거래년", "계약년도", "거래년도"],
    "month": ["월", "거래월", "계약월"],
    "day": ["일", "거래일", "계약일"],
    "cancel": ["해제여부"],
    "property_type": ["물건종류", "거래유형", "유형"],
}

# YYYY / YYYYMM / YYYYMMDD with any single separator (2024.3.5, 2024-03-15, 202403).
_COMBINED_DATE = re.compile(r"(\d{4})\D?(\d{1,2})(?:\D?(\d{1,2}))?")

# 국토교통부 실거래가/공시지가 소스는 용도지역을 축약형으로 기록하는 경우가 있다
# (예: "개발제한", "1종일주"). TARGET_COMBOS는 정식 명칭을 키로 사용하므로,
# 매칭 전에 정규화한다. 매핑에 없는 값은 원문 그대로 두어 조용히 틀리게
# 정규화하지 않는다 (fail closed — 미매칭이면 그냥 대상 조합에서 제외됨).
_ZONING_ABBREVIATIONS: dict[str, str] = {
    "개발제한": "개발제한구역",
    "1종전주": "제1종전용주거지역",
    "2종전주": "제2종전용주거지역",
    "1종일주": "제1종일반주거지역",
    "2종일주": "제2종일반주거지역",
    "3종일주": "제3종일반주거지역",
    "준주거": "준주거지역",
    "일반상업": "일반상업지역",
    "근린상업": "근린상업지역",
    "유통상업": "유통상업지역",
    "중심상업": "중심상업지역",
    "전용공업": "전용공업지역",
    "일반공업": "일반공업지역",
    "준공업": "준공업지역",
    "보전녹지": "보전녹지지역",
    "생산녹지": "생산녹지지역",
    "자연녹지": "자연녹지지역",
}


def _normalize_zoning(value: str) -> str:
    stripped = value.strip()
    return _ZONING_ABBREVIATIONS.get(stripped, stripped)


def _strip(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", "", str(value)).strip()


def _detect_header_row(sheet: Any, max_scan: int = 30) -> tuple[int, list[str]]:
    for row_idx in range(1, max_scan + 1):
        values = [str(cell.value or "") for cell in sheet[row_idx]]
        joined = "".join(values)
        if "법정동" in joined and ("지목" in joined or "용도" in joined):
            return row_idx, values
        if "시군구" in joined and "면적" in joined:
            return row_idx, values
        has_address = "소재지" in joined or "주소" in joined
        has_price = "거래금액" in joined or "거래대금" in joined
        if has_address and "면적" in joined and has_price:
            return row_idx, values
    raise ValueError(f"헤더를 {max_scan}행 내에서 찾지 못했습니다. --header-row로 직접 지정하세요.")


def _map_columns(headers: list[str]) -> dict[str, int]:
    """Map each column to at most one field; a claimed column is never reused.

    Exclusivity matters for combined headers such as 거래년월, which otherwise
    satisfies both "년" and "월" and yields an unparseable year/month pair.
    """
    mapping: dict[str, int] = {}
    for i, raw in enumerate(headers):
        h = _strip(raw)
        if not h:
            continue
        for field, patterns in _HEADER_PATTERNS.items():
            if field in mapping:
                continue
            if any(_strip(pat) == h or _strip(pat) in h for pat in patterns):
                mapping[field] = i
                break
    return mapping


def _get(values: list[Any], col_map: dict[str, int], field: str) -> Any:
    idx = col_map.get(field)
    if idx is None or idx >= len(values):
        return None
    return values[idx]


def _build_jibun(values: list[Any], col_map: dict[str, int]) -> str:
    jibun = str(_get(values, col_map, "jibun") or "").strip()
    if jibun:
        return jibun
    bonbun = str(_get(values, col_map, "bonbun") or "").strip()
    bubun = str(_get(values, col_map, "bubun") or "").strip()
    if bonbun:
        return f"{bonbun}-{bubun}" if bubun and bubun != "0" else bonbun
    return ""


def _build_address(values: list[Any], col_map: dict[str, int]) -> str:
    """Compose the parcel address from split columns, or read a single address column."""
    if "dong" in col_map:
        dong = str(_get(values, col_map, "dong") or "").strip()
        if not dong:
            return ""
        sigungu = str(_get(values, col_map, "sigungu") or "").strip()
        jibun = _build_jibun(values, col_map)
        return " ".join(part for part in [sigungu, dong, jibun] if part)
    raw = str(_get(values, col_map, "address") or "")
    return re.sub(r"\s+", " ", raw).strip()


def _parse_combined_date(value: Any, day_value: Any) -> date | None:
    """Parse one date cell. Year-month only cells take the day column, else day 1."""
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = re.sub(r"\s+", "", str(value or ""))
    if text.endswith(".0"):
        text = text[:-2]
    match = _COMBINED_DATE.fullmatch(text)
    if not match:
        return None
    year, month, day = match.groups()
    if day is None:
        day = str(day_value or 1)
    try:
        return date(int(year), int(month), int(day))
    except (ValueError, TypeError):
        return None


def _parse_date(values: list[Any], col_map: dict[str, int]) -> date | None:
    if "date" in col_map:
        return _parse_combined_date(
            _get(values, col_map, "date"), _get(values, col_map, "day")
        )
    try:
        y = int(_get(values, col_map, "year") or 0)
        m = int(_get(values, col_map, "month") or 0)
        d = int(_get(values, col_map, "day") or 1)
        if y < 2000 or not 1 <= m <= 12:
            return None
        return date(y, m, d)
    except (ValueError, TypeError):
        return None


def _parse_float(value: Any) -> float | None:
    if value is None or str(value).strip() == "":
        return None
    try:
        return float(str(value).replace(",", ""))
    except (ValueError, TypeError):
        return None


PRICE_UNIT_MULTIPLIERS: dict[str, float] = {"won": 1.0, "manwon": 10000.0}


def _price_unit_from_header(header: str) -> str | None:
    """Read the 거래금액 unit off the header. Anything ambiguous stays unresolved."""
    text = _strip(header)
    if "만원" in text:
        return "manwon"
    if "억" in text or "천원" in text:
        return None
    if "원" in text:
        return "won"
    return None


def resolve_price_unit(
    headers: list[str], col_map: dict[str, int], explicit: str | None = None
) -> str:
    """Resolve the 거래금액 unit from the operator or the source header, else fail closed."""
    if explicit:
        if explicit not in PRICE_UNIT_MULTIPLIERS:
            raise ValueError(
                f"거래금액 단위는 {sorted(PRICE_UNIT_MULTIPLIERS)} 중 하나여야 합니다: {explicit}"
            )
        return explicit
    idx = col_map.get("price")
    header = headers[idx] if idx is not None and idx < len(headers) else ""
    unit = _price_unit_from_header(header)
    if unit is None:
        raise ValueError(
            "거래금액 단위를 소스 헤더에서 확정할 수 없습니다. "
            "--price-unit won|manwon 으로 명시하세요."
        )
    return unit


PYEONG_TO_M2 = 400.0 / 121.0


def _parse_area_m2(value: Any) -> float | None:
    """Area in ㎡. A 평 suffix is converted; an unrecognised unit fails closed."""
    text = re.sub(r"\s+", "", str(value or ""))
    if not text:
        return None
    in_pyeong = text.endswith("평")
    if in_pyeong:
        text = text[:-1]
    else:
        text = re.sub(r"(㎡|m²|m2|제곱미터)$", "", text)
    number = _parse_float(text)
    if number is None:
        return None
    return number * PYEONG_TO_M2 if in_pyeong else number


def read_rows(
    sheet: Any,
    header_row: int,
    col_map: dict[str, int],
    *,
    price_unit: str | None = None,
) -> list[dict[str, Any]]:
    required = {"category", "zoning", "area", "price"}
    missing = required - set(col_map.keys())
    if missing:
        raise ValueError(f"필수 컬럼 미감지: {missing}. 헤더: {list(col_map.keys())}")

    if price_unit not in PRICE_UNIT_MULTIPLIERS:
        raise ValueError(
            "거래금액 단위가 확정되지 않았습니다. resolve_price_unit()으로 확정한 뒤 "
            f"price_unit={sorted(PRICE_UNIT_MULTIPLIERS)} 중 하나를 전달하세요."
        )
    price_multiplier = PRICE_UNIT_MULTIPLIERS[price_unit]

    if "dong" not in col_map and "address" not in col_map:
        raise ValueError("주소 컬럼(법정동 또는 단일 소재지/주소)을 찾지 못했습니다.")

    has_date_cols = ("year" in col_map and "month" in col_map) or "date" in col_map
    if not has_date_cols:
        raise ValueError("거래년/월 컬럼을 찾지 못했습니다.")

    rows: list[dict[str, Any]] = []
    for row in sheet.iter_rows(min_row=header_row + 1, values_only=True):
        values = list(row)
        address = _build_address(values, col_map)
        if not address:
            continue

        tx_date = _parse_date(values, col_map)
        if tx_date is None:
            continue

        area = _parse_area_m2(_get(values, col_map, "area"))
        price = _parse_float(_get(values, col_map, "price"))
        if not area or area <= 0 or not price or price <= 0:
            continue

        category = str(_get(values, col_map, "category") or "").strip()
        zoning = _normalize_zoning(str(_get(values, col_map, "zoning") or ""))
        cancel = str(_get(values, col_map, "cancel") or "").strip()
        prop_type = str(_get(values, col_map, "property_type") or "").strip()

        rows.append({
            "address": address,
            "transaction_date": tx_date,
            "land_category": category,
            "zoning": zoning,
            "area_m2": area,
            "unit_price_m2": round((price * price_multiplier) / area, 2),
            "_cancel": cancel,
            "_property_type": prop_type,
        })
    return rows


def filter_pure_land(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result = []
    for row in rows:
        cancel = row["_cancel"]
        if cancel and cancel not in ("", "None", "-"):
            continue
        pt = row["_property_type"]
        if pt and pt not in ("", "None", "토지"):
            continue
        result.append(row)
    return result


def filter_pre_announcement(
    rows: list[dict[str, Any]], start: date, end: date
) -> list[dict[str, Any]]:
    return [r for r in rows if start <= r["transaction_date"] < end]


def _event_key(row: dict[str, Any]) -> tuple[str, ...]:
    tokens = re.sub(r"[(),]", " ", row["address"]).split()
    dong_tokens = [t for t in tokens if re.search(r"(동|리|가)$", t)]
    dong_key = " ".join(tokens[:2] + dong_tokens[-1:]) if tokens else ""
    return (
        dong_key,
        row["transaction_date"].isoformat(),
        row["zoning"].strip(),
        row["land_category"].strip(),
        f"{row['unit_price_m2']:.6f}",
    )


def dedupe_events(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[tuple[str, ...]] = set()
    for row in rows:
        key = _event_key(row)
        row["_possible_same_transaction_event"] = key in seen
        seen.add(key)
    return rows


def filter_target_combos(
    rows: list[dict[str, Any]], combos: dict[tuple[str, str], list[str]]
) -> list[dict[str, Any]]:
    result = []
    for row in rows:
        key = (row["zoning"].strip(), row["land_category"].strip())
        if key in combos:
            row["_standard_candidate_ids"] = combos[key]
            result.append(row)
    return result


def build_bundle(
    rows: list[dict[str, Any]],
    standard_candidates: list[dict[str, Any]],
    standards_source: str = "SYNTHETIC_DEFAULT",
) -> dict[str, Any]:
    sorted_rows = sorted(rows, key=lambda r: (r["transaction_date"], r["address"]))
    transactions = []
    for i, row in enumerate(sorted_rows, 1):
        transactions.append({
            "case_id": f"topyeong2-{i:04d}",
            "address": row["address"],
            "transaction_date": row["transaction_date"].isoformat(),
            "land_category": row["land_category"],
            "zoning": row["zoning"],
            "area_m2": row["area_m2"],
            "unit_price_m2": row["unit_price_m2"],
            "pnu": None,
            "standard_candidate_ids": row.get("_standard_candidate_ids", []),
        })
    return {
        "fixture_notice": "LIVE_ENRICHMENT_BUNDLE — PNU resolved at runtime. Never commit.",
        "standards_source": standards_source,
        "transactions": transactions,
        "land_characteristics": {},
        "standard_candidates": standard_candidates,
    }


DEFAULT_STANDARDS = [
    {"standard_id": "S_GB_FIELD", "official_price_m2": 500000,
     "land_category": "전", "zoning": "개발제한구역", "land_use": "전",
     "road_access": "세로(가)", "shape": "사다리형", "elevation": "평지"},
    {"standard_id": "S_GB_PADDY", "official_price_m2": 480000,
     "land_category": "답", "zoning": "개발제한구역", "land_use": "답",
     "road_access": "세로(불)", "shape": "부정형", "elevation": "평지"},
    {"standard_id": "S_GB_MISC", "official_price_m2": 620000,
     "land_category": "잡종지", "zoning": "개발제한구역", "land_use": "잡종지",
     "road_access": "중로한면", "shape": "부정형", "elevation": "평지"},
    {"standard_id": "S_R1_FIELD", "official_price_m2": 900000,
     "land_category": "전", "zoning": "제1종일반주거지역", "land_use": "전",
     "road_access": "소로한면", "shape": "사다리형", "elevation": "완경사"},
    {"standard_id": "S_R1_MISC", "official_price_m2": 980000,
     "land_category": "잡종지", "zoning": "제1종일반주거지역", "land_use": "잡종지",
     "road_access": "소로각지", "shape": "부정형", "elevation": "평지"},
    {"standard_id": "S_R1_SITE", "official_price_m2": 1200000,
     "land_category": "대", "zoning": "제1종일반주거지역", "land_use": "단독주택",
     "road_access": "중로각지", "shape": "정방형", "elevation": "평지"},
]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="XLSX → TransactionCase bundle converter (local only)"
    )
    parser.add_argument("--xlsx", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--sheet", default=None, help="Sheet name (default: first)")
    parser.add_argument("--header-row", type=int, default=None, help="Header row (1-based)")
    parser.add_argument("--standards", type=Path, default=None, help="Standard candidates JSON")
    parser.add_argument(
        "--price-unit",
        choices=sorted(PRICE_UNIT_MULTIPLIERS),
        default=None,
        help="거래금액 단위. 헤더에 단위 표기가 없으면 필수",
    )
    args = parser.parse_args(argv)

    wb = load_workbook(args.xlsx, read_only=True, data_only=True)
    sheet = wb[args.sheet] if args.sheet else wb.active
    print(f"Sheet: {sheet.title}")

    if args.header_row:
        header_row = args.header_row
        headers = [str(cell.value or "") for cell in sheet[header_row]]
    else:
        header_row, headers = _detect_header_row(sheet)
    col_map = _map_columns(headers)
    print(f"Header row {header_row}: {[h for h in headers if h.strip()]}")
    print(f"Column mapping: { {k: headers[v] for k, v in col_map.items()} }")

    price_unit = resolve_price_unit(headers, col_map, args.price_unit)
    print(f"Price unit: {price_unit}")

    all_rows = read_rows(sheet, header_row, col_map, price_unit=price_unit)
    print(f"\n[Step 0] Total rows read: {len(all_rows)}")

    land = filter_pure_land(all_rows)
    print(f"[Step 1] Pure land transactions: {len(land)}")

    pre_ann = filter_pre_announcement(land, LOOKBACK_START, ANNOUNCEMENT_DATE)
    print(f"[Step 2] Pre-announcement 3yr ({LOOKBACK_START} ~ {ANNOUNCEMENT_DATE}): {len(pre_ann)}")

    deduped = dedupe_events(pre_ann)
    dup_count = sum(1 for r in deduped if r.get("_possible_same_transaction_event"))
    print(f"[Step 3] Event flag: {len(deduped)} rows ({dup_count} flagged POSSIBLE_SAME_TRANSACTION_EVENT)")

    filtered = filter_target_combos(deduped, TARGET_COMBOS)
    print(f"[Step 4] Target zoning/category combos (6): {len(filtered)}")

    combo_counts: dict[tuple[str, str], int] = {}
    for row in filtered:
        key = (row["zoning"], row["land_category"])
        combo_counts[key] = combo_counts.get(key, 0) + 1
    for combo, count in sorted(combo_counts.items()):
        print(f"         {combo[0]}/{combo[1]}: {count}건")

    standards = DEFAULT_STANDARDS
    standards_source = "SYNTHETIC_DEFAULT"
    if args.standards and args.standards.exists():
        raw = json.loads(args.standards.read_text(encoding="utf-8"))
        standards = raw if isinstance(raw, list) else raw.get("standard_candidates", raw)
        standards_source = "VERIFIED_INPUT"
        print(f"\nStandard candidates loaded: {len(standards)}")
    else:
        print(f"\nUsing default standard candidates ({len(standards)})")
        print("WARNING: synthetic DEFAULT_STANDARDS — bundle not valid for live enrichment.", file=sys.stderr)

    bundle = build_bundle(filtered, standards, standards_source=standards_source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(bundle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"\nBundle written: {args.output}")
    print(f"  Transactions: {len(bundle['transactions'])}")
    print(f"  PNU: all null (resolved at runtime by VWorld)")
    print(f"  Standard candidates: {len(bundle['standard_candidates'])}")
    print("\n⚠ This file contains real addresses. Never commit to repository.")
    wb.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
