from __future__ import annotations

import json
import unittest
from pathlib import Path

from .generator import build_output
from .models import BriefOutput, ReviewStatus
from .other_factor_extractor import parse_candidate_page


ROOT = Path(__file__).resolve().parent


class BriefOutputTests(unittest.TestCase):
    def load_case(self) -> BriefOutput:
        raw = json.loads((ROOT / "golden_case_shinmh_input.json").read_text(encoding="utf-8"))
        return BriefOutput.model_validate(raw)

    def test_golden_case_generates_five_pages_and_three_or_fewer_issues(self) -> None:
        output = build_output(self.load_case())
        self.assertEqual(len(output.page_payloads), 5)
        self.assertLessEqual(len(output.analysis_bundle["issue_candidates"]), 3)
        self.assertEqual(output.page_payloads[1].tables[0].table_id, "valuation_structure_comparison")
        self.assertIn("45,000원/㎡", " ".join(output.analysis_bundle["fact_sentences"]))

    def test_individual_factor_values_are_not_silently_passed(self) -> None:
        case = self.load_case()
        for row in case.valuation_bundle:
            row.individual_factors.street_condition = None
            row.individual_factors.access_condition = None
            row.individual_factors.environment_condition = None
            row.individual_factors.parcel_condition = None
            row.individual_factors.administrative_condition = None
            row.individual_factors.other_condition = None
            row.individual_factors.overall_individual_factor = None
            row.individual_factors.review_status = ReviewStatus.FAIL
        output = build_output(case)
        qa = next(item for item in output.qa_bundle if item.rule_id == "QA-INDIVIDUAL-FACTOR-VALUES")
        self.assertEqual(qa.status, ReviewStatus.FAIL)
        self.assertEqual(output.run_meta.status, "partial")

    def test_docx_slots_are_unique(self) -> None:
        output = build_output(self.load_case())
        slots = [item.slot_name for item in output.docx_assembly]
        self.assertEqual(len(slots), len(set(slots)))
        self.assertEqual(len(slots), 16)

    def test_standard_to_case_factor_sequence_is_structured(self) -> None:
        text = (
            "그 밖의 요인 거래사례 표준지 개별요인 사례단가 1,250,000원/㎡ "
            "과림동 210-3 과림동 130-7 1.0150 1.0000 0.9800 1.0100 "
            "1.0000 1.0200 1.0000 1.0000 1.0096"
        )
        row = parse_candidate_page(42, text, "중앙감정평가법인")
        self.assertEqual(row.source_page, 42)
        self.assertEqual(row.case_lot_number, "과림동 210-3")
        self.assertEqual(row.reference_lot_number, "과림동 130-7")
        self.assertAlmostEqual(row.time_adjustment or 0, 1.0150)
        self.assertAlmostEqual(row.overall_individual_factor or 0, 1.0096)
        self.assertEqual(row.review_status, "PASS")


if __name__ == "__main__":
    unittest.main()
