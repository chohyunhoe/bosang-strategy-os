from __future__ import annotations

import unittest

from .semantic_case_assembler import semantic_case_rows
from .semantic_table_pipeline import (
    TableCandidate,
    TableType,
    classify_table,
    parse_number,
    row_to_canonical,
    validate_case_formula,
    validate_subject_formula,
)


class SemanticTablePipelineTests(unittest.TestCase):
    def test_subject_table_classification_independent_of_column_order(self) -> None:
        candidate = TableCandidate(
            page=39,
            headers=["결정단가", "지번", "그 밖의 요인", "개별요인", "시점수정", "표준지공시지가"],
            rows=[["882,000", "과림동 120-7", "2.53", "1.000", "1.18980", "293,000"]],
        )
        classified = classify_table(candidate)
        self.assertEqual(classified.table_type, TableType.SUBJECT_TO_STANDARD)
        canonical = row_to_canonical(candidate.rows[0], classified.header_map)
        self.assertEqual(canonical["lot_number"], "과림동 120-7")
        self.assertEqual(canonical["decided_unit_price"], 882000)
        self.assertEqual(canonical["other_factor"], 2.53)

    def test_case_table_classification_independent_of_labels(self) -> None:
        candidate = TableCandidate(
            page=31,
            headers=["거래사례단가", "가격시점", "개별요인 누계", "환산단가", "시점수정", "지역요인"],
            rows=[["1,250,000", "2025-03-01", "0.87", "1,100,000", "1.012", "1.00"]],
        )
        classified = classify_table(candidate)
        self.assertEqual(classified.table_type, TableType.STANDARD_TO_COMP_CASE)
        canonical = row_to_canonical(candidate.rows[0], classified.header_map)
        self.assertEqual(canonical["case_unit_price"], 1250000)
        self.assertEqual(canonical["overall_individual_factor"], 0.87)

    def test_factor_only_table_is_case_comparison_component(self) -> None:
        candidate = TableCandidate(
            page=44,
            headers=["가로 조건", "접근 조건", "환경 조건", "획지 조건", "행정적 조건", "기타 조건", "개별요인 비교치"],
            rows=[["-", "1.23", "1.18", "1.00", "1.00", "1.00", "1.451"]],
        )
        classified = classify_table(candidate)
        self.assertEqual(classified.table_type, TableType.STANDARD_TO_COMP_CASE)
        canonical = row_to_canonical(candidate.rows[0], classified.header_map)
        self.assertEqual(canonical["access_condition"], 1.23)
        self.assertEqual(canonical["overall_individual_factor"], 1.451)

    def test_spaced_decimal_normalization(self) -> None:
        self.assertEqual(parse_number("1 21786"), 1.21786)
        self.assertEqual(parse_number("1 000"), 1.0)
        self.assertEqual(parse_number("1 524"), 1.524)
        self.assertEqual(parse_number("928,009"), 928009.0)

    def test_case_page_merge(self) -> None:
        tables = [
            {
                "page": 43,
                "table_type": "STANDARD_TO_COMP_CASE",
                "header_map": {"0": "case_unit_price", "1": "time_adjustment", "2": "regional_factor", "3": "overall_individual_factor", "4": "converted_reference_price"},
                "rows": [["500,000", "1 21786", "1 000", "1 524", "928,009"]],
            },
            {
                "page": 43,
                "table_type": "STANDARD_TO_COMP_CASE",
                "header_map": {"0": "street_condition", "1": "access_condition", "2": "environment_condition", "3": "parcel_condition", "4": "administrative_condition", "5": "other_condition", "6": "overall_individual_factor"},
                "rows": [["-", "1.27", "1.20", "1.00", "1.00", "1.00", "1.524"]],
            },
        ]
        rows = semantic_case_rows(tables, "정해감정평가법인")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["case_unit_price"], 500000.0)
        self.assertEqual(rows[0]["time_adjustment"], 1.21786)
        self.assertEqual(rows[0]["access_condition"], 1.27)
        self.assertEqual(rows[0]["converted_reference_price"], 928009.0)
        self.assertEqual(rows[0]["review_status"], "PASS")

    def test_subject_formula_validation(self) -> None:
        item = {
            "official_price_per_sqm": 293000,
            "time_adjustment": 1.18980,
            "regional_factor": 1.0,
            "overall_individual_factor": 1.0,
            "other_factor": 2.53,
            "calculated_unit_price": 881987,
        }
        result = validate_subject_formula(item)
        self.assertEqual(result["status"], "PASS")

    def test_case_formula_missing_values_requires_review(self) -> None:
        result = validate_case_formula({"case_unit_price": 1200000})
        self.assertEqual(result["status"], "REVIEW_REQUIRED")


if __name__ == "__main__":
    unittest.main()
