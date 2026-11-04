from __future__ import annotations

from typing import Any


def verified_subject_rows() -> list[dict[str, Any]]:
    """Human-verified rows from the golden-case final appraisal schedule pages.

    These rows are intentionally explicit and provenance-tagged. They are not a
    substitute for OCR; they let the MVP distinguish verified page evidence from
    machine-extracted values while the selective OCR path is being completed.
    """
    return [
        {
            "company_hint": "중앙감정평가법인",
            "page": 48,
            "lot_number": "120-7",
            "official_price_per_sqm": None,
            "time_adjustment": None,
            "regional_factor": None,
            "street_condition": None,
            "access_condition": None,
            "environment_condition": None,
            "parcel_condition": None,
            "administrative_condition": None,
            "other_condition": None,
            "overall_individual_factor": None,
            "other_factor": None,
            "calculated_unit_price": None,
            "decided_unit_price": 882000.0,
            "appraised_amount": 392931000.0,
            "confidence": "verified",
            "review_required": True,
            "raw_segment": "일련번호 584 / 과림동 120-7 / 891㎡ × 1/2 / 882,000원/㎡ / 392,931,000원",
            "extraction_path": "verified_page_capture",
        },
        {
            "company_hint": "중앙감정평가법인",
            "page": 49,
            "lot_number": "120-8",
            "official_price_per_sqm": None,
            "time_adjustment": None,
            "regional_factor": None,
            "street_condition": None,
            "access_condition": None,
            "environment_condition": None,
            "parcel_condition": None,
            "administrative_condition": None,
            "other_condition": None,
            "overall_individual_factor": None,
            "other_factor": None,
            "calculated_unit_price": None,
            "decided_unit_price": 882000.0,
            "appraised_amount": 1766646000.0,
            "confidence": "verified",
            "review_required": True,
            "raw_segment": "일련번호 585 / 과림동 120-8 / 4,006㎡ × 1/2 / 882,000원/㎡ / 1,766,646,000원",
            "extraction_path": "verified_page_capture",
        },
    ]
