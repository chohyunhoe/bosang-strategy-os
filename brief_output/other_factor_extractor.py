from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from pypdf import PdfReader


FACTOR_NAMES = (
    "street_condition",
    "access_condition",
    "environment_condition",
    "parcel_condition",
    "administrative_condition",
    "other_condition",
)


@dataclass
class CaseFactorComparison:
    appraisal_company: str
    source_page: int
    case_id: str | None
    case_lot_number: str | None
    case_unit_price: float | None
    case_price_date: str | None
    reference_lot_number: str | None
    time_adjustment: float | None
    regional_factor: float | None
    street_condition: float | None
    access_condition: float | None
    environment_condition: float | None
    parcel_condition: float | None
    administrative_condition: float | None
    other_condition: float | None
    overall_individual_factor: float | None
    converted_reference_price: float | None
    review_status: str
    raw_excerpt: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _normalize_text(text: str) -> str:
    text = text or ""
    previous = None
    while previous != text:
        previous = text
        text = re.sub(r"(?<=\d)\s+(?=\d)", "", text)
    text = re.sub(r"\s*-\s*", "-", text)
    return re.sub(r"\s+", " ", text).strip()


def _compact(text: str) -> str:
    return re.sub(r"\s+", "", text)


def _num(token: str | None) -> float | None:
    if token is None:
        return None
    cleaned = token.replace(",", "").strip()
    if cleaned in {"", "-", "–", "—"}:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def _candidate_pages(reader: PdfReader) -> list[tuple[int, str]]:
    candidates: list[tuple[int, str]] = []
    for index, page in enumerate(reader.pages, start=1):
        text = _normalize_text(page.extract_text() or "")
        compact = _compact(text)

        has_other_factor_heading = "그밖의요인" in compact or "기타요인" in compact
        has_case_table_signal = any(
            term in compact
            for term in (
                "거래사례",
                "보상사례",
                "사례가격",
                "사례단가",
                "가격시점",
            )
        )
        has_factor_table_signal = "개별요인" in compact and "시점수정" in compact
        factor_count = len(re.findall(r"(?<!\d)(?:0|1)\.\d{2,4}(?!\d)", text))
        money_count = len(re.findall(r"(?<!\d)\d{1,3}(?:,\d{3})+(?!\d)", text))

        # Exclude general explanatory pages. A real calculation table must contain
        # a heading, a case signal, factor columns, several coefficients, and money values.
        if (
            has_other_factor_heading
            and has_case_table_signal
            and has_factor_table_signal
            and factor_count >= 7
            and money_count >= 1
        ):
            candidates.append((index, text))
    return candidates


def _find_factor_sequence(text: str) -> list[float]:
    tokens = re.findall(r"(?<!\d)(?:0|1)\.\d{2,4}(?!\d)", text)
    values = [_num(token) for token in tokens]
    return [value for value in values if value is not None]


def _money_values(text: str) -> list[float]:
    matches = re.findall(r"(?<!\d)(\d{1,3}(?:,\d{3})+)(?!\d)", text)
    values = [_num(item) for item in matches]
    return [value for value in values if value is not None and value >= 10000]


def _lot_numbers(text: str) -> list[str]:
    # Require a Korean locality or explicit lot marker so document numbers such as
    # 2025-1223 are not treated as transaction-case parcels.
    patterns = (
        r"[가-힣]+(?:동|리)\s*\d{1,4}-\d{1,4}",
        r"(?:소재지|지번)\s*[:：]?\s*(\d{1,4}-\d{1,4})",
    )
    found: list[str] = []
    for pattern in patterns:
        for match in re.finditer(pattern, text):
            value = match.group(1) if match.lastindex else match.group(0)
            if value not in found:
                found.append(value)
    return found


def _price_date(text: str) -> str | None:
    match = re.search(r"(?:가격시점|거래시점|계약일)\s*[:：]?\s*((?:19|20)\d{2}[.\-/년]\s*\d{1,2}[.\-/월]\s*\d{1,2})", text)
    return match.group(1) if match else None


def parse_candidate_page(page: int, text: str, appraisal_company: str) -> CaseFactorComparison:
    factors = _find_factor_sequence(text)
    # Expected table order near the calculation block:
    # time, regional, street, access, environment, parcel, administrative, other, overall.
    tail = factors[-9:] if len(factors) >= 9 else factors
    padded: list[float | None] = [None] * (9 - len(tail)) + tail
    time_adjustment, regional_factor, street, access, environment, parcel, administrative, other, overall = padded

    lots = _lot_numbers(text)
    case_lot = lots[0] if lots else None
    reference_lot = lots[1] if len(lots) > 1 else None
    money = _money_values(text)
    case_price = money[0] if money else None
    converted_reference_price = money[-1] if len(money) >= 2 else None
    price_date = _price_date(text)

    required = [
        case_lot,
        case_price,
        time_adjustment,
        access,
        environment,
        parcel,
        administrative,
        other,
        overall,
    ]
    review_status = "PASS" if all(value is not None for value in required) else "REVIEW_REQUIRED"

    return CaseFactorComparison(
        appraisal_company=appraisal_company,
        source_page=page,
        case_id=f"case-p{page}",
        case_lot_number=case_lot,
        case_unit_price=case_price,
        case_price_date=price_date,
        reference_lot_number=reference_lot,
        time_adjustment=time_adjustment,
        regional_factor=regional_factor,
        street_condition=street,
        access_condition=access,
        environment_condition=environment,
        parcel_condition=parcel,
        administrative_condition=administrative,
        other_condition=other,
        overall_individual_factor=overall,
        converted_reference_price=converted_reference_price,
        review_status=review_status,
        raw_excerpt=text[:1600],
    )


def extract_other_factor_comparisons(pdf_path: str | Path, appraisal_company: str) -> list[CaseFactorComparison]:
    reader = PdfReader(str(pdf_path))
    rows = [parse_candidate_page(page, text, appraisal_company) for page, text in _candidate_pages(reader)]
    # Keep the strongest page only for the golden-case prototype.
    rows.sort(
        key=lambda item: (
            item.review_status == "PASS",
            item.overall_individual_factor is not None,
            item.case_unit_price is not None,
        ),
        reverse=True,
    )
    return rows[:1]
