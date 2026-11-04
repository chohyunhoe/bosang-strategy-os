# -*- coding: utf-8 -*-
"""수치 비교표 시트 계약 테스트."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from .numeric_table_entry import run
from .test_killerkit_adapter import minimal_case

SHEET_NAMES = ["1_대상토지", "2_법인별 평가 비교", "3_개별요인", "4_검토사항"]


def coverage_gap_case() -> dict:
    """편입토지 2필지 : 평가행 1행. Gate 판정 B 와 같은 형태."""
    case = minimal_case()
    case["lands"].append(
        {
            "land_id": "LAND_002",
            "parcel_address": "익명시 샘플동 20-2",
            "land_category": "전",
            "area": 500,
            "appraisal_use_status": "전",
            "review_status_code": "NEEDS_REVIEW",
        }
    )
    return case


def generate(case: dict, formats=("xlsx", "csv")):
    workspace = tempfile.TemporaryDirectory()
    case_path = Path(workspace.name) / "case.json"
    case_path.write_text(json.dumps(case, ensure_ascii=False), encoding="utf-8")
    return workspace, run(case_path, Path(workspace.name) / "out", set(formats))


class NumericTableTest(unittest.TestCase):
    def test_builds_four_sheets_with_required_columns(self):
        workspace, summary = generate(coverage_gap_case())
        with workspace:
            import openpyxl

            book = openpyxl.load_workbook(summary["xlsx_path"])
            self.assertEqual(book.sheetnames, SHEET_NAMES)

            subject = list(book["1_대상토지"].iter_rows(values_only=True))
            self.assertEqual(
                list(subject[0]), ["land_id", "소재지·지번", "지목", "면적(㎡)", "현황", "검토상태"]
            )
            self.assertEqual(len(subject) - 1, 2)
            self.assertEqual(subject[1][0], "LAND_001")
            self.assertEqual(subject[1][3], 900)
            self.assertEqual(subject[1][5], "NEEDS_REVIEW")

            valuation = list(book["2_법인별 평가 비교"].iter_rows(values_only=True))
            self.assertEqual(
                list(valuation[0]),
                [
                    "대상토지", "평가법인", "비교표준지", "공시지가", "시점수정", "개별요인 누계",
                    "그 밖의 요인", "산출단가", "적용단가", "평가액", "source reference", "review status",
                ],
            )
            self.assertEqual(valuation[1][9], 327600000, "평가액은 원문값 그대로여야 한다")
            self.assertEqual(valuation[1][10], "APP_001 p.2 토지가액 산출근거 L3")

            factors = list(book["3_개별요인"].iter_rows(values_only=True))
            self.assertEqual(
                list(factors[0]),
                ["대상토지", "평가법인", "가로", "접근", "환경", "획지", "행정", "기타", "누계", "검토상태"],
            )
            # 세부 6조건이 원문에 없으면 누계만 남고 나머지는 확인 필요.
            self.assertEqual(factors[1][8], 0.98)
            for index in range(2, 8):
                self.assertEqual(factors[1][index], "확인 필요")

            review = list(book["4_검토사항"].iter_rows(values_only=True))
            self.assertEqual(
                list(review[0]), ["review code", "대상", "detail", "verification method", "상태"]
            )
            self.assertTrue(all(row[4] == "NEEDS_REVIEW" for row in review[1:]))

    def test_unlinked_parcel_is_listed_without_invented_values(self):
        workspace, summary = generate(coverage_gap_case())
        with workspace:
            import openpyxl

            book = openpyxl.load_workbook(summary["xlsx_path"])
            valuation = list(book["2_법인별 평가 비교"].iter_rows(values_only=True))
            self.assertEqual(len(valuation) - 1, 2, "평가행 1건 + 평가행이 없는 필지 1건")
            gap_row = valuation[-1]
            self.assertEqual(gap_row[0], "익명시 샘플동 20-2")
            # 값 칸은 전부 '확인 필요'. 0 이나 빈 문자열로 채우지 않는다.
            for index in range(1, 11):
                self.assertEqual(gap_row[index], "확인 필요", f"column {index}")
            self.assertEqual(gap_row[11], "NEEDS_REVIEW / 평가행 없음")

        self.assertEqual(summary["output_status"], "partial")
        self.assertEqual(summary["counts"]["subject_parcels"], 2)
        self.assertEqual(summary["counts"]["valuation_rows"], 1)
        self.assertEqual(summary["unlinked_subject_parcels"], ["LAND_002"])

    def test_coverage_gap_is_written_into_the_review_sheet(self):
        workspace, summary = generate(coverage_gap_case())
        with workspace:
            import openpyxl

            rows = list(openpyxl.load_workbook(summary["xlsx_path"])["4_검토사항"].iter_rows(values_only=True))
        codes = [row[0] for row in rows[1:]]
        self.assertIn("APPRAISAL_ROW_COVERAGE_GAP", codes)
        warning = next(row for row in rows[1:] if row[0] == "APPRAISAL_ROW_COVERAGE_GAP")
        self.assertEqual(warning[1], "LAND_002")
        self.assertIn("평가행을 만들어 채우지 않습니다", warning[3])
        self.assertEqual(
            [item["code"] for item in summary["review_warnings"]], ["APPRAISAL_ROW_COVERAGE_GAP"]
        )

    def test_csv_matches_the_valuation_sheet(self):
        workspace, summary = generate(coverage_gap_case(), formats=("csv",))
        with workspace:
            text = Path(summary["csv_path"]).read_text(encoding="utf-8-sig")
        lines = text.strip().splitlines()
        self.assertEqual(len(lines), 3, "머리글 + 평가행 1건 + 미연결 필지 1건")
        self.assertTrue(lines[0].startswith("대상토지,평가법인,비교표준지"))
        self.assertIn("확인 필요", lines[-1])
        self.assertNotIn("xlsx_path", summary)

    def test_does_not_mutate_input(self):
        import copy

        case = coverage_gap_case()
        snapshot = copy.deepcopy(case)
        workspace, _ = generate(case, formats=("csv",))
        workspace.cleanup()
        self.assertEqual(case, snapshot)

    def test_complete_case_has_no_gap_row(self):
        workspace, summary = generate(minimal_case(), formats=("csv",))
        with workspace:
            lines = Path(summary["csv_path"]).read_text(encoding="utf-8-sig").strip().splitlines()
        self.assertEqual(len(lines), 2)
        self.assertEqual(summary["review_warnings"], [])
        self.assertEqual(summary["unlinked_subject_parcels"], [])


if __name__ == "__main__":
    unittest.main()
