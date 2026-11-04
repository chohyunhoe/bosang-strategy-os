from __future__ import annotations

import unittest

from .layout_table_extractor import TextFragment, cluster_lines, detect_table_candidates
from .semantic_table_pipeline import TableType, classify_table, row_to_canonical


class LayoutTableExtractorTests(unittest.TestCase):
    def fragment(self, x: float, y: float, text: str) -> TextFragment:
        return TextFragment(page=1, x=x, y=y, text=text)

    def test_subject_table_detected_with_arbitrary_coordinates_and_order(self) -> None:
        fragments = [
            self.fragment(510, 700, "결정단가"),
            self.fragment(30, 700, "지번"),
            self.fragment(380, 700, "그 밖의 요인"),
            self.fragment(290, 700, "개별요인"),
            self.fragment(200, 700, "시점수정"),
            self.fragment(110, 700, "표준지공시지가"),
            self.fragment(510, 680, "882,000"),
            self.fragment(30, 680, "과림동 120-7"),
            self.fragment(380, 680, "2.53"),
            self.fragment(290, 680, "1.000"),
            self.fragment(200, 680, "1.18980"),
            self.fragment(110, 680, "293,000"),
        ]
        candidates = detect_table_candidates(cluster_lines(fragments))
        self.assertEqual(len(candidates), 1)
        classified = classify_table(candidates[0])
        self.assertEqual(classified.table_type, TableType.SUBJECT_TO_STANDARD)
        canonical = row_to_canonical(candidates[0].rows[0], classified.header_map)
        self.assertEqual(canonical["decided_unit_price"], 882000)
        self.assertEqual(canonical["lot_number"], "과림동 120-7")

    def test_multirow_individual_factor_header_reaches_numeric_row(self) -> None:
        fragments = [
            self.fragment(40, 700, "지번"),
            self.fragment(130, 700, "공시지가"),
            self.fragment(210, 700, "시점수정"),
            self.fragment(290, 700, "가로"),
            self.fragment(340, 700, "접근"),
            self.fragment(390, 700, "환경"),
            self.fragment(440, 700, "획지"),
            self.fragment(490, 700, "행정적"),
            self.fragment(540, 700, "기타"),
            self.fragment(590, 700, "개별요인"),
            self.fragment(290, 684, "조건"),
            self.fragment(340, 684, "조건"),
            self.fragment(390, 684, "조건"),
            self.fragment(440, 684, "조건"),
            self.fragment(490, 684, "조건"),
            self.fragment(540, 684, "조건"),
            self.fragment(590, 684, "비교치"),
            self.fragment(40, 640, "과림동 120-7"),
            self.fragment(130, 640, "293,000"),
            self.fragment(210, 640, "1.18980"),
            self.fragment(290, 640, "1.00"),
            self.fragment(340, 640, "1.00"),
            self.fragment(390, 640, "1.00"),
            self.fragment(440, 640, "1.00"),
            self.fragment(490, 640, "1.00"),
            self.fragment(540, 640, "1.00"),
            self.fragment(590, 640, "1.000"),
        ]
        candidates = detect_table_candidates(cluster_lines(fragments))
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0].metadata["header_rows"], 2)
        self.assertEqual(candidates[0].metadata["data_rows"], 1)
        canonical = row_to_canonical(candidates[0].rows[0], classify_table(candidates[0]).header_map)
        self.assertEqual(canonical["lot_number"], "과림동 120-7")
        self.assertEqual(canonical["overall_individual_factor"], 1.0)

    def test_case_table_skips_units_and_symbol_rows(self) -> None:
        fragments = [
            self.fragment(50, 700, "사례단가"),
            self.fragment(180, 700, "시점수정"),
            self.fragment(270, 700, "지역요인"),
            self.fragment(360, 700, "개별요인"),
            self.fragment(480, 700, "환산단가"),
            self.fragment(50, 684, "기호 원/㎡"),
            self.fragment(180, 684, "①"),
            self.fragment(270, 684, "②"),
            self.fragment(360, 684, "③"),
            self.fragment(480, 684, "원/㎡"),
            self.fragment(50, 630, "850,000"),
            self.fragment(180, 630, "1.0123"),
            self.fragment(270, 630, "1.0000"),
            self.fragment(360, 630, "0.9898"),
            self.fragment(480, 630, "841,330"),
        ]
        candidates = detect_table_candidates(cluster_lines(fragments))
        self.assertEqual(len(candidates), 1)
        classified = classify_table(candidates[0])
        self.assertEqual(classified.table_type, TableType.STANDARD_TO_COMP_CASE)
        canonical = row_to_canonical(candidates[0].rows[0], classified.header_map)
        self.assertEqual(canonical["case_unit_price"], 850000)
        self.assertEqual(canonical["overall_individual_factor"], 0.9898)

    def test_line_clustering_does_not_depend_on_exact_y(self) -> None:
        lines = cluster_lines([
            self.fragment(20, 500.0, "지번"),
            self.fragment(100, 501.5, "결정단가"),
            self.fragment(20, 480.0, "120-7"),
            self.fragment(100, 479.0, "882,000"),
        ])
        self.assertEqual(len(lines), 2)


if __name__ == "__main__":
    unittest.main()
