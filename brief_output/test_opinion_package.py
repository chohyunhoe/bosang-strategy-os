# -*- coding: utf-8 -*-
"""재결·이의 의견서 작성자료 계약 테스트."""
from __future__ import annotations

import copy
import base64
import json
import tempfile
import unittest
from pathlib import Path

from .opinion_package import DOCUMENT_TITLE, FORBIDDEN_PHRASES, NO_PROVENANCE
from .opinion_package_entry import run
from .test_numeric_table import coverage_gap_case

SECTION_HEADINGS = [
    "1. 사건/대상 개요",
    "2. 대상토지 현황",
    "3. 평가법인별 수치 비교",
    "4. 개별요인 비교",
    "5. 그 밖의 요인 검토",
    "6. 쟁점 후보",
    "7. 의견서 작성 참고문안",
    "8. 지도·그래픽",
    "9. 원문근거 목록",
    "10. 확인 필요사항",
]


def opinion_case() -> dict:
    case = coverage_gap_case()
    case["issue_candidates"] = [{
        "issue_id": "ISSUE_001",
        "related_land_ids": ["LAND_001", "LAND_002"],
        "confirmed_fact": "평가법인별 적용단가 차이 확인",
        "interpretation_note": "표준지 선택·개별요인 검토 필요",
        "required_evidence": "토지가격 산출근거",
        "issue_grade": "A",
        "reflection_status": "READY_FOR_DRAFT",
    }]
    case["draft_sentences"] = [{
        "draft_sentence_id": "DS_001", "issue_id": "ISSUE_001", "template_id": "TPL_001",
        "draft_sentence_raw": "원문 생성문장입니다.", "draft_sentence_safe": "안전화된 보조문안입니다.",
        "filter_result_code": "PASS", "draft_reflection_status": "PENDING_REVIEW",
    }]
    case["risk_warnings"] = [{
        "risk_id": "RISK_001", "risk_type": "PROHIBITED_INTERPRETATION", "risk_level": "HIGH",
        "related_issue_id": "ISSUE_001", "message": "단가 차이를 평가 오류로 단정 금지",
        "required_action": "산정 구조 차이 중심 표현",
    }]
    return case


def generate(case: dict):
    workspace = tempfile.TemporaryDirectory()
    case_path = Path(workspace.name) / "case.json"
    case_path.write_text(json.dumps(case, ensure_ascii=False), encoding="utf-8")
    return workspace, run(case_path, Path(workspace.name) / "out")


def document_text(path: str) -> str:
    import docx

    document = docx.Document(path)
    parts = [paragraph.text for paragraph in document.paragraphs]
    parts += [cell.text for table in document.tables for row in table.rows for cell in row.cells]
    return "\n".join(parts)


class OpinionPackageTest(unittest.TestCase):
    def test_builds_all_ten_sections(self):
        workspace, summary = generate(opinion_case())
        with workspace:
            import docx

            document = docx.Document(summary["docx_path"])
            headings = [p.text for p in document.paragraphs if p.style.name.startswith("Heading") or p.style.name == "Title"]
        self.assertEqual(headings[0], DOCUMENT_TITLE)
        self.assertEqual(headings[1:], SECTION_HEADINGS)
        self.assertEqual(summary["sections"], 10)
        self.assertEqual(summary["document_title"], DOCUMENT_TITLE)

    def test_never_uses_forbidden_expressions(self):
        workspace, summary = generate(opinion_case())
        with workspace:
            text = document_text(summary["docx_path"])
        for phrase in FORBIDDEN_PHRASES:
            self.assertNotIn(phrase, text, phrase)

    def test_copies_issues_and_sentences_verbatim(self):
        case = opinion_case()
        workspace, summary = generate(case)
        with workspace:
            text = document_text(summary["docx_path"])
        # 사건 데이터의 문구가 그대로 들어간다. 새 쟁점·문안을 만들지 않는다.
        self.assertIn("평가법인별 적용단가 차이 확인", text)
        self.assertIn("안전화된 보조문안입니다.", text)
        self.assertIn("단가 차이를 평가 오류로 단정 금지", text)
        self.assertEqual(summary["counts"]["issues"], len(case["issue_candidates"]))
        self.assertEqual(summary["counts"]["sentences"], len(case["draft_sentences"]))
        self.assertEqual(summary["counts"]["risks"], len(case["risk_warnings"]))

    def test_keeps_unlinked_parcel_without_inventing_values(self):
        workspace, summary = generate(opinion_case())
        with workspace:
            text = document_text(summary["docx_path"])
        self.assertEqual(summary["unlinked_subject_parcels"], ["LAND_002"])
        self.assertEqual(summary["counts"]["subject_parcels"], 2)
        self.assertEqual(summary["counts"]["valuation_rows"], 1)
        self.assertIn("익명시 샘플동 20-2", text)
        self.assertIn("확인 필요", text)
        self.assertIn("평가행을 자동 생성·복제하지 않았습니다", text)
        self.assertIn("APPRAISAL_ROW_COVERAGE_GAP", text)
        self.assertEqual(summary["output_status"], "partial")

    def test_marks_records_without_provenance(self):
        case = opinion_case()
        for row in case["standard_lands"]:
            row.pop("source_refs", None)
        workspace, summary = generate(case)
        with workspace:
            text = document_text(summary["docx_path"])
        self.assertGreater(summary["counts"]["provenance_missing"], 0)
        self.assertIn(NO_PROVENANCE, text)

    def test_reports_missing_map_without_fabricating_one(self):
        workspace, summary = generate(opinion_case())
        with workspace:
            text = document_text(summary["docx_path"])
        self.assertFalse(summary["map_embedded"])
        self.assertIn("지도 데이터 필요", text)
        self.assertIn("좌표를 추정해 그리지 않습니다", text)

    def test_embeds_all_supplied_report_maps_in_order(self):
        workspace = tempfile.TemporaryDirectory()
        with workspace:
            root = Path(workspace.name)
            case_path = root / "case.json"
            case_path.write_text(json.dumps(opinion_case(), ensure_ascii=False), encoding="utf-8")
            png = base64.b64decode(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
            )
            first = root / "overview.png"
            second = root / "pair.png"
            first.write_bytes(png)
            second.write_bytes(png)
            summary = run(
                case_path,
                root / "out",
                map_images=[
                    {"path": str(first), "title": "전체 위치도"},
                    {"path": str(second), "title": "편입토지–비교표준지 1"},
                ],
            )
            text = document_text(summary["docx_path"])
            self.assertTrue(summary["map_embedded"])
            self.assertEqual(summary["map_count"], 2)
            self.assertIn("전체 위치도", text)
            self.assertIn("편입토지–비교표준지 1", text)

    def test_does_not_mutate_input(self):
        case = opinion_case()
        snapshot = copy.deepcopy(case)
        workspace, _ = generate(case)
        workspace.cleanup()
        self.assertEqual(case, snapshot)

    def test_review_queue_and_qa_land_in_the_check_section(self):
        workspace, summary = generate(opinion_case())
        with workspace:
            text = document_text(summary["docx_path"])
        self.assertGreater(summary["counts"]["check_rows"], 0)
        self.assertIn("review-unlinked-subject-parcels", text)
        self.assertIn("QA-ADAPTER-SUBJECT-COVERAGE", text)
        self.assertIn("NEEDS_REVIEW", text)


if __name__ == "__main__":
    unittest.main()
