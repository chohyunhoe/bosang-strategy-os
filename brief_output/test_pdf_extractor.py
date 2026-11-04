from __future__ import annotations

import unittest

from .other_factor_extractor import _lot_numbers, parse_candidate_page
from .pdf_extractor import _normalize_text, parse_row_segment


CENTRAL_ROW = """
120-7 자연녹지 답 답 891 D 293,000 1.18980 1.000 - 1.00 1.00 1.00 1.00 1.00 1.000
대상토지는 비교표준지 대비 도로의 상태 및 위락과의 접근성 등에서 대등, 자연환경 등에서 대등,
형상, 고저 및 토지이용상황 등에서 대등, 공법상 제한 등에서 대등함.
2.53 1.00 881,987 882,000
"""

JUNGHAE_ROW = """
0120-0007 답 답 891.0 891.0 라 293,000 1.1898 1.00 - 1.00 1.00 1.00 1.00 1.00 1.000
2.66 1.00 927,306 927,000
"""

SPLIT_CENTRAL_ROW = """
1 2 0 - 7 자연녹지 답 답 891 D 293,000 1.18980 1.000 - 1.00 1.00 1.00 1.00 1.00 1.000
2.53 1.00 881,987 882,000
"""

FALSE_CASE_TEXT = """
감정평가액의 산출근거 및 결정의견 122025-1223-006
그 밖의 요인을 종합 참작한다. 거래사례 및 표준지 개별요인을 검토한다.
"""

REAL_CASE_TEXT = """
그 밖의 요인 산출내역 거래사례 가격시점 시점수정 지역요인 개별요인
과림동 200-1 850,000원 2025-01-10 1.0123 1.0000 1.00 0.98 1.01 1.00 1.00 1.00 0.9898 841,330
비교표준지 과림동 130-7
"""


class PdfExtractorTests(unittest.TestCase):
    def test_central_row(self) -> None:
        row = parse_row_segment(CENTRAL_ROW, company_hint="중앙감정평가법인", page=39, raw_lot="120-7")
        self.assertEqual(row.lot_number, "120-7")
        self.assertEqual(row.street_condition.state, "not_applicable")
        self.assertEqual(row.access_condition.value, 1.0)
        self.assertEqual(row.overall_individual_factor, 1.0)
        self.assertEqual(row.other_factor, 2.53)
        self.assertEqual(row.calculated_unit_price, 881987)
        self.assertEqual(row.decided_unit_price, 882000)
        self.assertEqual(row.confidence, "high")

    def test_junghae_row(self) -> None:
        row = parse_row_segment(JUNGHAE_ROW, company_hint="정해감정평가법인", page=39, raw_lot="0120-0007")
        self.assertEqual(row.lot_number, "120-7")
        self.assertEqual(row.other_factor, 2.66)
        self.assertEqual(row.calculated_unit_price, 927306)
        self.assertEqual(row.decided_unit_price, 927000)
        self.assertFalse(row.review_required)

    def test_split_digit_lot_is_normalized(self) -> None:
        normalized = _normalize_text(SPLIT_CENTRAL_ROW)
        self.assertIn("120-7", normalized)
        row = parse_row_segment(normalized, company_hint="중앙감정평가법인", page=39, raw_lot="120-7")
        self.assertEqual(row.decided_unit_price, 882000)

    def test_document_number_is_not_case_lot(self) -> None:
        self.assertEqual(_lot_numbers(FALSE_CASE_TEXT), [])

    def test_real_case_page_extracts_case_and_factor_total(self) -> None:
        row = parse_candidate_page(30, REAL_CASE_TEXT, "중앙감정평가법인")
        self.assertEqual(row.case_lot_number, "과림동 200-1")
        self.assertEqual(row.reference_lot_number, "과림동 130-7")
        self.assertEqual(row.overall_individual_factor, 0.9898)
        self.assertEqual(row.case_unit_price, 850000)


if __name__ == "__main__":
    unittest.main()
