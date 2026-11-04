# -*- coding: utf-8 -*-
"""Requirement 3: cross-hint provenance status capping in standard_selection_parser.
Requirement 4: decided value priority ordering."""
from bso_parser.standard_selection_parser import parse
from bso_parser.models import Field


class _FakeDoc:
    def __init__(self, pages_text):
        self._pages = pages_text
        self.pages = [{"has_text_layer": True}] * len(pages_text)

    def page_text(self, idx):
        return self._pages[idx] if 0 <= idx < len(self._pages) else ""

    def page_method(self, idx):
        return "text"


def test_review_required_hint_blocks_extracted():
    text = "비교표준지 선정  가동 100-1  세로불  가장형  평지  자연녹지  500,000  선정"
    doc = _FakeDoc([text])
    hint = {"official_price": 500000, "status": "REVIEW_REQUIRED"}
    result = parse(doc, [1], cross_hint=hint)
    assert result["selected_standard"].status == "REVIEW_REQUIRED"


def test_two_same_price_candidates_no_auto_select():
    text = (
        "비교표준지 선정\n"
        "가동 100-1  세로불  가장형  평지  자연녹지  500,000\n"
        "나동 200-2  소로한면  정방형  완경사  계획관리  500,000\n"
    )
    doc = _FakeDoc([text])
    hint = {"official_price": 500000, "status": "SOURCE_CONFIRMED"}
    result = parse(doc, [1], cross_hint=hint)
    assert result["selected_standard"].status == "REVIEW_REQUIRED"
    assert "자동선택 금지" in (result["selected_standard"].note or "")


def test_two_selected_marks_no_auto_select():
    text = (
        "비교표준지 선정\n"
        "가동 100-1  세로불  가장형  평지  자연녹지  500,000  선정\n"
        "나동 200-2  소로한면  정방형  완경사  계획관리  600,000  선정\n"
    )
    doc = _FakeDoc([text])
    result = parse(doc, [1])
    assert result["selected_standard"].status == "REVIEW_REQUIRED"
    assert "선정표시" in (result["selected_standard"].note or "")


def test_unique_direct_source_extracted():
    text = "비교표준지 선정  가동 100-1  세로불  가장형  평지  자연녹지  500,000  선정"
    doc = _FakeDoc([text])
    result = parse(doc, [1])
    assert result["selected_standard"].status == "EXTRACTED"


# --- Requirement 4: decided value priority ---

def test_decided_table_review_required_not_replaced_by_fallback():
    decided = Field.review(2.0, [], note="보정치결정표에서 추출")
    assert decided.status == "REVIEW_REQUIRED"
    assert decided.value == 2.0
    gap_ratio = Field.ok(1.8, [])
    assert gap_ratio.status == "EXTRACTED"
    assert decided.status != "NOT_FOUND"


def test_fallback_only_when_not_found():
    decided_not_found = Field.missing()
    assert decided_not_found.status == "NOT_FOUND"

    decided_review = Field.review(2.0, [], note="test")
    assert decided_review.status == "REVIEW_REQUIRED"
    assert decided_review.status != "NOT_FOUND"

    decided_extracted = Field.ok(2.0, [])
    assert decided_extracted.status == "EXTRACTED"
    assert decided_extracted.status != "NOT_FOUND"
