# -*- coding: utf-8 -*-
"""killerkit 사건 JSON → BriefOutput 어댑터 계약 테스트."""
from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

from .build_case_brief import apply_adapter_qa
from .generator import build_output
from .killerkit_adapter import AdapterError, AdapterSafetyError, adapt_case
from .models import ReviewStatus

REPO_ROOT = Path(__file__).resolve().parent.parent


def minimal_case() -> dict:
    return {
        "meta": {"schema_version": "v0.2.1"},
        "case": {"case_id": "CASE_T", "project_name": "테스트 지구", "price_date": "2025-11-01"},
        "appraisals": [
            {"appraisal_id": "APP_001", "appraisal_company": "가람", "file_name": "홍길동(감정평가서).pdf"}
        ],
        "lands": [
            {
                "land_id": "LAND_001",
                "parcel_address": "익명시 샘플동 10-1",
                "land_category": "답",
                "area": 900,
                "review_status_code": "NEEDS_REVIEW",
                "auto_confirmed": False,
                "source_refs": [
                    {
                        "appraisal_id": "APP_001",
                        "page_no": 1,
                        "line_start": 7,
                        "line_end": 7,
                        "source_label": "편입토지 목록",
                        "raw_text_excerpt": "1 익명시 샘플동 10-1 답 900",
                    }
                ],
            }
        ],
        "standard_lands": [
            {
                "standard_land_id": "STD_001",
                "appraisal_id": "APP_001",
                "standard_land_symbol": "A",
                "parcel_address": "익명시 샘플동 100-1",
                "official_price": 350000,
            }
        ],
        "land_appraisal_results": [
            {
                "appraisal_id": "APP_001",
                "land_id": "LAND_001",
                "subject_link_status": "LINKED",
                "standard_land_symbol": "A",
                "official_price": 350000,
                "time_correction": 1.012,
                "individual_factor_total": 0.98,
                "other_factor": 1.05,
                "calculated_unit_price": 364000,
                "unit_price": 364000,
                "amount": 327600000,
                "review_status_code": "NEEDS_REVIEW",
                "auto_confirmed": False,
                "source_refs": [
                    {
                        "appraisal_id": "APP_001",
                        "page_no": 2,
                        "line_start": 3,
                        "line_end": 3,
                        "source_label": "토지가액 산출근거",
                        "raw_text_excerpt": "1 익명시 샘플동 10-1 답 900 A 350,000",
                    }
                ],
            }
        ],
        "subject_to_standard_factor_comparisons": [],
    }


class AdapterContractTest(unittest.TestCase):
    def test_maps_minimal_case(self):
        base = adapt_case(minimal_case())
        self.assertEqual(base.project_meta.project_name, "테스트 지구")
        self.assertEqual(str(base.project_meta.report_date), "2025-11-01")
        self.assertEqual(len(base.valuation_bundle), 1)
        row = base.valuation_bundle[0]
        self.assertEqual(row.valuator_id, "APP_001__LAND_001")
        self.assertEqual(row.appraisal_company, "가람")
        self.assertEqual(row.subject_parcel_id, "LAND_001")
        self.assertEqual(row.reference_parcel_id, "STD_001")
        self.assertEqual(row.decided_unit_price, 364000)
        self.assertEqual(row.appraised_amount, 327600000)
        self.assertEqual(row.individual_factors.overall_individual_factor, 0.98)

    def test_does_not_mutate_input(self):
        case = minimal_case()
        snapshot = copy.deepcopy(case)
        adapt_case(case)
        self.assertEqual(case, snapshot)

    def test_preserves_provenance(self):
        base = adapt_case(minimal_case())
        ref = base.valuation_bundle[0].source_refs[0]
        self.assertEqual(ref.document_id, "APP_001")
        self.assertEqual(ref.page, 2)
        self.assertEqual(ref.locator, "토지가액 산출근거 L3")
        self.assertIn("익명시 샘플동 10-1", ref.excerpt)
        self.assertEqual(base.analysis_bundle["adapter_report"]["provenance"]["source_refs_mapped"], 3)

    def test_preserves_needs_review_state(self):
        base = adapt_case(minimal_case())
        self.assertEqual(base.valuation_bundle[0].individual_factors.review_status, ReviewStatus.REVIEW_REQUIRED)
        # 편입토지 1건 + 평가행 1건. 목표 스키마에 검토상태 필드가 없는 레코드도 집계에 남는다.
        self.assertEqual(base.analysis_bundle["adapter_report"]["review_status_preserved"]["NEEDS_REVIEW"], 2)

    def test_unconfirmed_source_state_surfaces_as_qa(self):
        output = apply_adapter_qa(build_output(adapt_case(minimal_case())))
        rule = next(item for item in output.qa_bundle if item.rule_id == "QA-ADAPTER-REVIEW-STATE")
        self.assertEqual(rule.status, ReviewStatus.REVIEW_REQUIRED)
        self.assertIn("NEEDS_REVIEW", rule.message)

    def test_masks_owner_name_in_file_name(self):
        base = adapt_case(minimal_case())
        self.assertNotIn("홍길동", base.document_meta[0].file_name_masked)
        self.assertIsNone(base.project_meta.client_name_masked)

    def test_rejects_auto_confirmed_records(self):
        case = minimal_case()
        case["land_appraisal_results"][0]["auto_confirmed"] = True
        with self.assertRaises(AdapterSafetyError):
            adapt_case(case)

    def test_fail_closed_on_missing_numbers(self):
        case = minimal_case()
        case["land_appraisal_results"][0]["unit_price"] = ""
        case["land_appraisal_results"][0]["amount"] = "-"
        base = adapt_case(case)
        row = base.valuation_bundle[0]
        self.assertIsNone(row.decided_unit_price)
        self.assertIsNone(row.appraised_amount)

    def test_fail_closed_on_out_of_contract_value(self):
        case = minimal_case()
        case["land_appraisal_results"][0]["other_factor"] = 0
        base = adapt_case(case)
        self.assertIsNone(base.valuation_bundle[0].other_factor)
        self.assertIn(
            "valuation.other_factor:OUT_OF_CONTRACT_RANGE",
            base.analysis_bundle["adapter_report"]["field_gaps"],
        )

    def test_blocks_row_without_appraisal_company(self):
        case = minimal_case()
        case["appraisals"][0].pop("appraisal_company")
        with self.assertRaises(AdapterError):
            adapt_case(case)

    def test_blocks_row_pointing_at_unknown_land(self):
        case = minimal_case()
        case["land_appraisal_results"][0]["land_id"] = "LAND_999"
        with self.assertRaises(AdapterError):
            adapt_case(case)

    def test_reports_subject_parcel_without_valuation_row(self):
        """Gate A 의 편입토지 4 : 평가행 3 상황. 비교대상에서 빠진 필지를 숨기지 않는다."""
        case = minimal_case()
        case["lands"].append(
            {
                "land_id": "LAND_002",
                "parcel_address": "익명시 샘플동 20-2",
                "land_category": "전",
                "area": 500,
                "review_status_code": "NEEDS_REVIEW",
            }
        )
        output = apply_adapter_qa(build_output(adapt_case(case)))
        self.assertEqual(
            output.analysis_bundle["adapter_report"]["unlinked_subject_parcels"], ["LAND_002"]
        )
        coverage = next(item for item in output.qa_bundle if item.rule_id == "QA-ADAPTER-SUBJECT-COVERAGE")
        self.assertEqual(coverage.status, ReviewStatus.FAIL)
        self.assertEqual(output.run_meta.status, "partial")

    def test_does_not_split_individual_factor_total(self):
        base = adapt_case(minimal_case())
        factors = base.valuation_bundle[0].individual_factors
        self.assertEqual(factors.overall_individual_factor, 0.98)
        for field in (
            "street_condition",
            "access_condition",
            "environment_condition",
            "parcel_condition",
            "administrative_condition",
            "other_condition",
        ):
            self.assertIsNone(getattr(factors, field), field)

    def test_maps_six_conditions_when_comparison_exists(self):
        case = minimal_case()
        case["subject_to_standard_factor_comparisons"] = [
            {
                "appraisal_id": "APP_001",
                "land_id": "LAND_001",
                "street_condition": 0.98,
                "access_condition": 0.9,
                "environment_or_natural_condition": 0.87,
                "parcel_condition": 0.97,
                "administrative_condition": 0.99,
                "other_condition": 1,
                "total_factor": 0.737,
                "factor_reason": "대상물건은 비교표준지 대비 가로조건에서 열등함.",
            }
        ]
        base = adapt_case(case)
        factors = base.valuation_bundle[0].individual_factors
        self.assertEqual(factors.street_condition, 0.98)
        self.assertEqual(factors.environment_condition, 0.87)
        self.assertEqual(factors.overall_individual_factor, 0.737)
        self.assertEqual(base.analysis_bundle["special_phrases"][0]["linked_value"], 0.737)

    def test_ambiguous_comparison_rows_are_not_guessed(self):
        case = minimal_case()
        duplicate = {
            "appraisal_id": "APP_001",
            "land_id": "LAND_001",
            "street_condition": 0.98,
            "total_factor": 0.737,
        }
        case["subject_to_standard_factor_comparisons"] = [duplicate, dict(duplicate, street_condition=1.02)]
        base = adapt_case(case)
        factors = base.valuation_bundle[0].individual_factors
        self.assertIsNone(factors.street_condition)
        self.assertEqual(factors.overall_individual_factor, 0.98)  # 평가행 누계로만 되돌아간다
        self.assertIn(
            "individual_factors:AMBIGUOUS_COMPARISON_ROWS",
            base.analysis_bundle["adapter_report"]["field_gaps"],
        )

    def test_preserves_browser_side_candidates(self):
        case = minimal_case()
        case["issue_candidates"] = [{"issue_id": "ISSUE_1", "title": "브라우저 쟁점"}]
        case["draft_sentences"] = [{"sentence_id": "S1", "text": "문안"}]
        base = adapt_case(case)
        self.assertEqual(base.analysis_bundle["browser_issue_candidates"][0]["issue_id"], "ISSUE_1")
        self.assertEqual(base.analysis_bundle["browser_draft_sentences"][0]["sentence_id"], "S1")

    def test_fails_closed_without_lands(self):
        case = minimal_case()
        case["lands"] = []
        with self.assertRaises(AdapterError):
            adapt_case(case)


class RepositorySampleTest(unittest.TestCase):
    def test_full_sample_case_produces_report(self):
        sample = REPO_ROOT / "sample_case_001_v021_full.json"
        case = json.loads(sample.read_text(encoding="utf-8"))
        output = apply_adapter_qa(build_output(adapt_case(case)))
        self.assertEqual(len(output.valuation_bundle), 15)
        self.assertEqual(len(output.subject_bundle["subject_parcels"]), 5)
        self.assertEqual(len(output.page_payloads), 5)
        self.assertEqual(output.analysis_bundle["adapter_report"]["blocked_rows"], [])
        # v0.2.1 샘플에는 source_ref 가 없다. 없는 근거를 만들어내지 않고 FAIL 로 보고한다.
        provenance = next(item for item in output.qa_bundle if item.rule_id == "QA-ADAPTER-PROVENANCE")
        self.assertEqual(provenance.status, ReviewStatus.FAIL)
        self.assertEqual(output.run_meta.status, "partial")


class DocxWarningTest(unittest.TestCase):
    """검토항목이 JSON 에만 남고 DOCX 에서 사라지면 문서를 받은 사람은 볼 수 없다."""

    def test_coverage_gap_is_written_into_the_document(self):
        import tempfile

        import docx

        from .bridge_entry import run

        case = minimal_case()
        case["lands"].append(
            {
                "land_id": "LAND_002",
                "parcel_address": "익명시 샘플동 20-2",
                "land_category": "전",
                "area": 500,
                "review_status_code": "NEEDS_REVIEW",
            }
        )
        with tempfile.TemporaryDirectory() as workspace:
            case_path = Path(workspace) / "case.json"
            case_path.write_text(json.dumps(case, ensure_ascii=False), encoding="utf-8")
            summary = run(case_path, Path(workspace) / "out")
            self.assertEqual(summary["report_status"], "partial")
            self.assertEqual(summary["review_warnings"][0]["code"], "APPRAISAL_ROW_COVERAGE_GAP")
            paragraphs = [p.text for p in docx.Document(summary["docx_path"]).paragraphs]
        text = chr(10).join(paragraphs)
        self.assertIn("APPRAISAL_ROW_COVERAGE_GAP", text)
        self.assertIn("PARTIAL", text)
        self.assertIn("LAND_002", text)
        self.assertIn("편입토지 2필지 / 평가행 1행", text)


if __name__ == "__main__":
    unittest.main()
