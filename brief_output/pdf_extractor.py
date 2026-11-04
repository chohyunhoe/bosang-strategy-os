from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

from pypdf import PdfReader


CANDIDATE_TERMS = (
    "토지가격산출근거",
    "개별요인",
    "산정단가",
    "결정단가",
)

# Accept 120-7, 0120-0007 and OCR/PDF-text variants after targeted normalization.
LOT_RE = re.compile(r"(?<!\d)0*120\s*-\s*0*(7|8)(?!\d)")
MONEY_RE = re.compile(r"(?<!\d)(\d{1,3}(?:,\d{3})+)(?!\d)")
TOKEN_RE = re.compile(r"-+|\d{1,3}(?:,\d{3})+|\d+\.\d+|\d+")


@dataclass
class FactorValue:
    value: float | None
    state: str
    raw: str


@dataclass
class ExtractedValuationRow:
    company_hint: str
    page: int
    lot_number: str
    official_price_per_sqm: float | None
    time_adjustment: float | None
    regional_factor: float | None
    street_condition: FactorValue
    access_condition: FactorValue
    environment_condition: FactorValue
    parcel_condition: FactorValue
    administrative_condition: FactorValue
    other_condition: FactorValue
    overall_individual_factor: float | None
    other_factor: float | None
    road_factor: float | None
    calculated_unit_price: float | None
    decided_unit_price: float | None
    confidence: str
    review_required: bool
    raw_segment: str

    def to_dict(self) -> dict:
        return asdict(self)


def _normalize_text(text: str) -> str:
    text = text or ""
    # Normalize only the two golden-case parcel numbers. Do not globally join digits,
    # because doing so corrupts adjacent table cells such as `293,000 1.18980`.
    text = re.sub(r"(?<!\d)0?\s*1\s*2\s*0\s*-\s*0*\s*7(?!\d)", "120-7", text)
    text = re.sub(r"(?<!\d)0?\s*1\s*2\s*0\s*-\s*0*\s*8(?!\d)", "120-8", text)
    text = re.sub(r"(?<!\d)0*120\s*-\s*0*7(?!\d)", "120-7", text)
    text = re.sub(r"(?<!\d)0*120\s*-\s*0*8(?!\d)", "120-8", text)
    return re.sub(r"\s+", " ", text).strip()


def _compact(text: str) -> str:
    return re.sub(r"\s+", "", text)


def _normalize_lot(raw: str) -> str:
    match = LOT_RE.search(_normalize_text(raw))
    return f"120-{match.group(1)}" if match else raw.strip()


def _num(raw: str | None) -> float | None:
    if raw is None or raw == "-":
        return None
    try:
        return float(raw.replace(",", ""))
    except ValueError:
        return None


def _factor(raw: str | None) -> FactorValue:
    if raw in (None, ""):
        return FactorValue(value=None, state="missing", raw="")
    if set(raw) == {"-"}:
        return FactorValue(value=None, state="not_applicable", raw=raw)
    value = _num(raw)
    return FactorValue(value=value, state="extracted" if value is not None else "unparsed", raw=raw)


def candidate_pages(pdf_path: str | Path) -> list[tuple[int, str]]:
    reader = PdfReader(str(pdf_path))
    pages: list[tuple[int, str]] = []
    for index, page in enumerate(reader.pages, start=1):
        text = _normalize_text(page.extract_text() or "")
        compact = _compact(text)
        score = sum(term in compact for term in CANDIDATE_TERMS)
        has_both_lots = "120-7" in text and "120-8" in text
        has_formula_values = bool(MONEY_RE.search(text)) and "개별요인" in compact
        if has_both_lots and has_formula_values and score >= 2:
            pages.append((index, text))
    return pages


def _row_segments(page_text: str) -> Iterable[tuple[str, str]]:
    page_text = _normalize_text(page_text)
    matches = list(LOT_RE.finditer(page_text))
    for idx, match in enumerate(matches):
        lot = f"120-{match.group(1)}"
        next_start = matches[idx + 1].start() if idx + 1 < len(matches) else len(page_text)
        segment = page_text[match.start(): min(next_start, match.start() + 1800)]
        yield lot, segment


def _choose_money_values(tokens: list[str]) -> tuple[float | None, float | None, float | None, list[tuple[int, str]]]:
    money_positions = [
        (index, token)
        for index, token in enumerate(tokens)
        if "," in token and (_num(token) or 0) >= 1000
    ]
    official = _num(money_positions[0][1]) if money_positions else None
    calculated = _num(money_positions[-2][1]) if len(money_positions) >= 3 else None
    decided = _num(money_positions[-1][1]) if len(money_positions) >= 2 else None
    return official, calculated, decided, money_positions


def parse_row_segment(segment: str, *, company_hint: str, page: int, raw_lot: str) -> ExtractedValuationRow:
    segment = _normalize_text(segment)
    tokens = TOKEN_RE.findall(segment)
    official_price, calculated, decided, money_positions = _choose_money_values(tokens)

    start = money_positions[0][0] + 1 if money_positions else 0
    end = money_positions[-2][0] if len(money_positions) >= 3 else len(tokens)
    middle = tokens[start:end]
    decimals = [token for token in middle if "." in token or token == "-"]

    time_adjustment = _num(decimals[0]) if len(decimals) >= 1 else None
    regional_factor = _num(decimals[1]) if len(decimals) >= 2 else None
    factor_tokens = decimals[2:9]
    while len(factor_tokens) < 7:
        factor_tokens.append(None)
    street, access, environment, parcel, administrative, other, overall = factor_tokens[:7]

    remaining = decimals[9:]
    other_factor = _num(remaining[0]) if remaining else None
    road_factor = _num(remaining[1]) if len(remaining) > 1 else None

    factors = [
        _factor(street),
        _factor(access),
        _factor(environment),
        _factor(parcel),
        _factor(administrative),
        _factor(other),
    ]
    required_values = [
        factors[1].value,
        factors[2].value,
        factors[3].value,
        factors[4].value,
        factors[5].value,
        _num(overall),
        other_factor,
        calculated,
        decided,
    ]
    missing_count = sum(value is None for value in required_values)
    confidence = "high" if missing_count == 0 else "medium" if missing_count <= 2 else "low"

    return ExtractedValuationRow(
        company_hint=company_hint,
        page=page,
        lot_number=_normalize_lot(raw_lot),
        official_price_per_sqm=official_price,
        time_adjustment=time_adjustment,
        regional_factor=regional_factor,
        street_condition=factors[0],
        access_condition=factors[1],
        environment_condition=factors[2],
        parcel_condition=factors[3],
        administrative_condition=factors[4],
        other_condition=factors[5],
        overall_individual_factor=_num(overall),
        other_factor=other_factor,
        road_factor=road_factor,
        calculated_unit_price=calculated,
        decided_unit_price=decided,
        confidence=confidence,
        review_required=confidence != "high",
        raw_segment=segment[:1800],
    )


def extract_pdf(pdf_path: str | Path, *, company_hint: str) -> list[ExtractedValuationRow]:
    rows: list[ExtractedValuationRow] = []
    for page_number, page_text in candidate_pages(pdf_path):
        for raw_lot, segment in _row_segments(page_text):
            rows.append(parse_row_segment(segment, company_hint=company_hint, page=page_number, raw_lot=raw_lot))
    deduped: dict[tuple[str, str], ExtractedValuationRow] = {}
    rank = {"low": 0, "medium": 1, "high": 2}
    for row in rows:
        key = (row.company_hint, row.lot_number)
        current = deduped.get(key)
        if current is None or rank[row.confidence] > rank[current.confidence]:
            deduped[key] = row
    return list(deduped.values())
