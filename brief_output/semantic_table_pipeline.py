from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum
from math import prod
from typing import Iterable


class TableType(str, Enum):
    SUBJECT_TO_STANDARD = "SUBJECT_TO_STANDARD"
    STANDARD_TO_COMP_CASE = "STANDARD_TO_COMP_CASE"
    OTHER_FACTOR_CALCULATION = "OTHER_FACTOR_CALCULATION"
    LAND_APPRAISAL_RESULT = "LAND_APPRAISAL_RESULT"
    REFERENCE_LAND_INFO = "REFERENCE_LAND_INFO"
    CASE_INFO = "CASE_INFO"
    UNKNOWN = "UNKNOWN"


HEADER_ALIASES: dict[str, tuple[str, ...]] = {
    "lot_number": ("지번", "소재지", "토지소재지"),
    "official_price_per_sqm": ("공시지가", "표준지공시지가", "공시지가단가"),
    "time_adjustment": ("시점수정", "지가변동률", "시점수정치"),
    "regional_factor": ("지역요인", "지역요인비교"),
    "street_condition": ("가로조건", "도로조건", "가로"),
    "access_condition": ("접근조건", "교통조건", "접근"),
    "environment_condition": ("환경조건", "자연조건", "환경"),
    "parcel_condition": ("획지조건", "형상조건", "획지"),
    "administrative_condition": ("행정조건", "행정적조건", "공법상제한"),
    "other_condition": ("기타조건", "기타"),
    "overall_individual_factor": ("개별요인", "개별요인누계", "누계", "소계"),
    "other_factor": ("그밖의요인", "기타요인", "그밖의요인보정치"),
    "calculated_unit_price": ("산정단가", "시산단가", "산출단가"),
    "decided_unit_price": ("결정단가", "적용단가"),
    "case_unit_price": ("사례단가", "거래사례단가", "보상사례단가"),
    "case_price_date": ("가격시점", "거래시점", "사례시점"),
    "converted_reference_price": ("표준지환산단가", "환산단가", "표준지가격"),
}

FACTOR_FIELDS = {
    "street_condition",
    "access_condition",
    "environment_condition",
    "parcel_condition",
    "administrative_condition",
    "other_condition",
    "overall_individual_factor",
}


def normalize_label(value: str) -> str:
    return "".join(ch for ch in str(value or "").lower() if ch.isalnum() or "가" <= ch <= "힣")


def map_headers(headers: Iterable[str]) -> dict[int, str]:
    normalized = [normalize_label(item) for item in headers]
    mapping: dict[int, str] = {}
    for index, header in enumerate(normalized):
        best: tuple[int, str] | None = None
        for canonical, aliases in HEADER_ALIASES.items():
            for alias in aliases:
                alias_norm = normalize_label(alias)
                if not alias_norm:
                    continue
                score = 2 if header == alias_norm else 1 if alias_norm in header or header in alias_norm else 0
                if score and (best is None or score > best[0]):
                    best = (score, canonical)
        if best:
            mapping[index] = best[1]
    return mapping


@dataclass
class TableCandidate:
    page: int
    headers: list[str]
    rows: list[list[str]]
    bbox: tuple[float, float, float, float] | None = None
    source: str = "layout"
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass
class ClassifiedTable:
    table_type: TableType
    header_map: dict[int, str]
    confidence: float
    reasons: list[str]
    candidate: TableCandidate


SUBJECT_REQUIRED = {
    "lot_number",
    "official_price_per_sqm",
    "time_adjustment",
    "overall_individual_factor",
    "other_factor",
    "decided_unit_price",
}
CASE_REQUIRED = {
    "case_unit_price",
    "time_adjustment",
    "regional_factor",
    "overall_individual_factor",
}


def classify_table(candidate: TableCandidate) -> ClassifiedTable:
    header_map = map_headers(candidate.headers)
    fields = set(header_map.values())
    reasons: list[str] = []

    subject_score = len(fields & SUBJECT_REQUIRED) / len(SUBJECT_REQUIRED)
    case_score = len(fields & CASE_REQUIRED) / len(CASE_REQUIRED)
    factor_score = len(fields & FACTOR_FIELDS) / len(FACTOR_FIELDS)

    if subject_score >= 0.67:
        reasons.append(f"subject_fields={sorted(fields & SUBJECT_REQUIRED)}")
        return ClassifiedTable(TableType.SUBJECT_TO_STANDARD, header_map, subject_score, reasons, candidate)

    if factor_score >= 0.71 and "overall_individual_factor" in fields:
        reasons.append(f"factor_only_fields={sorted(fields & FACTOR_FIELDS)}")
        return ClassifiedTable(TableType.STANDARD_TO_COMP_CASE, header_map, factor_score, reasons, candidate)

    if case_score >= 0.75:
        remapped = dict(header_map)
        for index, field_name in list(remapped.items()):
            if field_name == "calculated_unit_price":
                remapped[index] = "converted_reference_price"
        reasons.append(f"case_fields={sorted(fields & CASE_REQUIRED)}")
        return ClassifiedTable(TableType.STANDARD_TO_COMP_CASE, remapped, case_score, reasons, candidate)

    if "other_factor" in fields and "converted_reference_price" in fields:
        reasons.append("other_factor and converted_reference_price detected")
        return ClassifiedTable(TableType.OTHER_FACTOR_CALCULATION, header_map, 0.7, reasons, candidate)
    if "lot_number" in fields and "decided_unit_price" in fields:
        reasons.append("lot_number and decided_unit_price detected")
        return ClassifiedTable(TableType.LAND_APPRAISAL_RESULT, header_map, 0.6, reasons, candidate)
    return ClassifiedTable(
        TableType.UNKNOWN,
        header_map,
        max(subject_score, case_score, factor_score),
        ["insufficient semantic fields"],
        candidate,
    )


def parse_number(value: object) -> float | None:
    raw = str(value or "").strip().replace(",", "")
    if raw in {"", "-", "–", "—", "확인필요"}:
        return None

    spaced_decimal = re.fullmatch(r"([+-]?\d{1,2})\s+(\d{3,5})", raw)
    if spaced_decimal:
        raw = f"{spaced_decimal.group(1)}.{spaced_decimal.group(2)}"
    else:
        raw = re.sub(r"\s+", "", raw)

    try:
        return float(raw)
    except ValueError:
        return None


def row_to_canonical(row: list[str], header_map: dict[int, str]) -> dict[str, object]:
    canonical: dict[str, object] = {}
    for index, field_name in header_map.items():
        if index >= len(row):
            continue
        value = row[index]
        if field_name in {
            "official_price_per_sqm",
            "time_adjustment",
            "regional_factor",
            "street_condition",
            "access_condition",
            "environment_condition",
            "parcel_condition",
            "administrative_condition",
            "other_condition",
            "overall_individual_factor",
            "other_factor",
            "calculated_unit_price",
            "decided_unit_price",
            "case_unit_price",
            "converted_reference_price",
        }:
            canonical[field_name] = parse_number(value)
            canonical[f"{field_name}_raw"] = value
        else:
            canonical[field_name] = str(value).strip()
    return canonical


def validate_subject_formula(item: dict[str, object], tolerance: float = 0.02) -> dict[str, object]:
    factors = [
        parse_number(item.get("official_price_per_sqm")),
        parse_number(item.get("time_adjustment")),
        parse_number(item.get("regional_factor")),
        parse_number(item.get("overall_individual_factor")),
        parse_number(item.get("other_factor")),
    ]
    target = parse_number(item.get("calculated_unit_price")) or parse_number(item.get("decided_unit_price"))
    if any(value is None for value in factors) or target is None:
        return {"status": "REVIEW_REQUIRED", "reason": "formula inputs missing"}
    calculated = prod(value for value in factors if value is not None)
    relative_error = abs(calculated - target) / max(abs(target), 1.0)
    return {
        "status": "PASS" if relative_error <= tolerance else "WARN",
        "calculated": calculated,
        "target": target,
        "relative_error": relative_error,
    }


def validate_case_formula(item: dict[str, object], tolerance: float = 0.03) -> dict[str, object]:
    factors = [
        parse_number(item.get("case_unit_price")),
        parse_number(item.get("time_adjustment")),
        parse_number(item.get("regional_factor")),
        parse_number(item.get("overall_individual_factor")),
    ]
    target = parse_number(item.get("converted_reference_price"))
    if any(value is None for value in factors) or target is None:
        return {"status": "REVIEW_REQUIRED", "reason": "case formula inputs missing"}
    calculated = prod(value for value in factors if value is not None)
    relative_error = abs(calculated - target) / max(abs(target), 1.0)
    return {
        "status": "PASS" if relative_error <= tolerance else "WARN",
        "calculated": calculated,
        "target": target,
        "relative_error": relative_error,
    }
