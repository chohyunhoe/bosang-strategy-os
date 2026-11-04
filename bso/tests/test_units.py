import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from bso_parser.models import Field, NOT_APPLICABLE, OCR_FAILED
from bso_parser.page_role_classifier import classify_page
from bso_parser.gis_export_builder import _row
from bso_parser.formula_verifier import verify_unit_price


def test_field_states_are_distinct():
    assert Field.not_applicable().status == NOT_APPLICABLE
    assert Field.ocr_failed().status == OCR_FAILED


def test_schedule_header_classification():
    result = classify_page("토지평가명세표 일련번호 소재지 지번 지목 면적 단가 평가액")
    assert result["primary"] == "LAND_APPRAISAL_SCHEDULE"
    assert result["confidence"] > 0.5


def test_explanatory_keyword_page_is_not_table():
    result = classify_page("개별요인을 검토하고 그 밖의 요인을 고려하여 평가하였다")
    assert result["primary"] == "IRRELEVANT"


def test_gis_requires_dong_and_lot():
    blocked = _row("case", None, "10-2", {}, "EXTRACTED")
    ready = _row("case", "과림동", "10-2", {}, "EXTRACTED")
    assert blocked["gis_ready"] is False
    assert blocked["blocking_fields"] == ["dong"]
    assert ready["gis_ready"] is True


def test_formula_verifier():
    result = verify_unit_price(100000, 1.1, 1.0, 1.2, 2.0, 264000)
    assert result["status"] == "pass"
