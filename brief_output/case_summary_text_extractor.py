from __future__ import annotations

import re
from typing import Any

import fitz


def _number(value: str) -> float:
    return float(value.replace(",", ""))


def extract_case_summary(pdf_path: str, company: str) -> list[dict[str, Any]]:
    """Extract compact other-factor case summary rows missed by header-based tables.

    This is deliberately narrow: it only emits a row when a page contains both a
    case-price calculation and a reference-price calculation with internally
    consistent numeric structure. It does not infer missing values.
    """
    output: list[dict[str, Any]] = []
    document = fitz.open(pdf_path)
    try:
        for page_index, page in enumerate(document, start=1):
            text = " ".join(page.get_text("text").split())
            case_match = re.search(
                r"사례\s*[②2]?\s*([\d,]+)\s*-?\s*(1\.\d{4,6})\s*(1\.\d{1,5})\s*(1\.\d{2,5})\s*([\d,]+)",
                text,
            )
            reference_match = re.search(
                r"(?:공시지가\s*)?[D라]\s*([\d,]+)\s*-?\s*(1\.\d{4,6})\s*-?\s*-?\s*([\d,]+)",
                text,
            )
            other_match = re.search(r"\b(2\.\d{2,4})\b", text)
            if not case_match or not reference_match:
                continue

            case_unit = _number(case_match.group(1))
            time_adjustment = _number(case_match.group(2))
            regional_factor = _number(case_match.group(3))
            individual_factor = _number(case_match.group(4))
            converted = _number(case_match.group(5))
            calculated = case_unit * time_adjustment * regional_factor * individual_factor
            relative_error = abs(calculated - converted) / max(converted, 1.0)
            if relative_error > 0.03:
                continue

            output.append(
                {
                    "appraisal_company": company,
                    "source_page": page_index,
                    "case_id": f"text-summary-p{page_index}",
                    "case_lot_number": None,
                    "case_unit_price": case_unit,
                    "case_price_date": None,
                    "reference_lot_number": None,
                    "time_adjustment": time_adjustment,
                    "regional_factor": regional_factor,
                    "street_condition": None,
                    "access_condition": None,
                    "environment_condition": None,
                    "parcel_condition": None,
                    "administrative_condition": None,
                    "other_condition": None,
                    "overall_individual_factor": individual_factor,
                    "converted_reference_price": converted,
                    "reference_unit_price": _number(reference_match.group(1)),
                    "reference_time_adjustment": _number(reference_match.group(2)),
                    "reference_converted_price": _number(reference_match.group(3)),
                    "other_factor": _number(other_match.group(1)) if other_match else None,
                    "formula_relative_error": relative_error,
                    "review_status": "PASS",
                    "raw_excerpt": text[:1500],
                    "extraction_path": "pymupdf_text_case_summary",
                }
            )
    finally:
        document.close()
    return output
