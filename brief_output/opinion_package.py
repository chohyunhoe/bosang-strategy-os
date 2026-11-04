# -*- coding: utf-8 -*-
"""재결·이의 의견서 작성자료 조립 (Output Center P4).

이미 어댑터·QA 계층을 지나온 `BriefOutput` 과, 같은 계층에서 만든 수치 비교표 시트를
하나의 DOCX 로 옮기기만 한다. 새 문서엔진을 만들지 않고 기존 `python-docx` 를 그대로 쓴다.

이 모듈이 하지 않는 것:

- 새 주장·새 쟁점·새 문안 생성 (쟁점·문안은 사건 JSON 의 문구를 그대로 옮긴다)
- 법률판단·증액 주장 (표현 자체를 금지어로 차단한다)
- 원문에 없는 수치 계산·역산
- 누락값 0 채움 (모두 '확인 필요')
- 평가행이 없는 필지 삭제
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from .models import BriefOutput
from .numeric_table import UNKNOWN, build_sheets

DOCUMENT_TITLE = "재결·이의 의견서 작성자료"
NO_PROVENANCE = "원문 근거 확인 필요"

# 주의: 아래 문구는 FORBIDDEN_PHRASES 를 그대로 쓰지 않는다.
# 금지어 검사는 문맥을 보지 않으므로, 부인하는 문장이라도 같은 낱말을 쓰면 스스로 걸린다.
DISCLAIMER = (
    "이 자료는 의견서를 작성하기 위한 검토 보조자료입니다. 완성된 의견서가 아니고 법률적 판단이나 "
    "보상금 증감에 관한 결론을 담고 있지 않습니다. 모든 항목은 사람이 원문과 대조해 확인해야 하며, "
    "제출 전 전문가 검토가 필요합니다."
)

# 문서에 들어가면 안 되는 표현. 조립 결과를 스스로 검사해 fail-closed 로 막는다.
FORBIDDEN_PHRASES = ("최종 의견서", "법률의견", "증액 가능성")


class OpinionPackageError(ValueError):
    """금지 표현이 조립 결과에 섞인 경우 등, fail-closed 중단."""


def _text(value: Any) -> str:
    text = str(value if value is not None else "").strip()
    return text or UNKNOWN


def _source_reference(refs: list[Any]) -> str:
    parts = []
    for ref in refs or []:
        piece = ref.document_id
        if ref.page:
            piece += f" p.{ref.page}"
        if ref.locator:
            piece += f" {ref.locator}"
        parts.append(piece)
    return "; ".join(parts) or NO_PROVENANCE


def _add_table(document, columns: list[str], rows: list[list[Any]]):
    table = document.add_table(rows=1, cols=len(columns))
    table.style = "Table Grid"
    for cell, name in zip(table.rows[0].cells, columns):
        cell.text = str(name)
        for paragraph in cell.paragraphs:
            for run in paragraph.runs:
                run.bold = True
    for row in rows:
        cells = table.add_row().cells
        for cell, value in zip(cells, row):
            cell.text = "" if value is None else str(value)
    return table


def _add_field_list(document, pairs: list[tuple[str, Any]]) -> None:
    for label, value in pairs:
        paragraph = document.add_paragraph()
        run = paragraph.add_run(f"{label}: ")
        run.bold = True
        paragraph.add_run(str(value))


def _sheet(sheets: list[dict], name: str) -> dict:
    return next(sheet for sheet in sheets if sheet["name"] == name)


def _rows(case: dict, key: str) -> list[dict]:
    value = case.get(key)
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def build_opinion_package(
    output: BriefOutput,
    case: dict,
    path: Path,
    *,
    map_image: Path | None = None,
    map_images: list[dict] | None = None,
) -> dict[str, Any]:
    from docx import Document
    from docx.shared import Cm

    sheets = build_sheets(output, case)
    report = output.analysis_bundle.get("adapter_report", {})
    warnings = report.get("review_warnings", [])
    unlinked = list(report.get("unlinked_subject_parcels", []))
    issues = _rows(case, "issue_candidates")
    sentences = _rows(case, "draft_sentences")
    risks = _rows(case, "risk_warnings")
    other_factors = _rows(case, "other_factor_reviews")

    document = Document()
    document.add_heading(DOCUMENT_TITLE, level=0)
    document.add_paragraph(DISCLAIMER)
    if warnings:
        document.add_paragraph("검토항목: " + ", ".join(item["code"] for item in warnings))

    # 1. 사건/대상 개요
    document.add_heading("1. 사건/대상 개요", level=1)
    _add_field_list(document, [
        ("사업지구", _text(output.project_meta.project_name)),
        ("기준시점", _text(output.project_meta.report_date)),
        ("평가법인", f"{len({row.appraisal_company for row in output.valuation_bundle})}곳"),
        ("편입토지", f"{len(output.subject_bundle.get('subject_parcels', []))}필지"),
        ("평가행", f"{len(output.valuation_bundle)}행"),
        ("자료 상태", "부분완료 · 원문 확인 필요" if output.run_meta.status != "complete" else "구조화 완료 · 전문가 검토 필요"),
        ("검토상태", "NEEDS_REVIEW · 자동확정 없음"),
    ])
    _add_table(
        document,
        ["문서", "평가법인", "쪽수", "추출방식"],
        [[doc.document_id, _text(doc.appraisal_company), _text(doc.page_count), _text(doc.extraction_method)]
         for doc in output.document_meta],
    )

    # 2~4. 이미 만든 수치 비교표 시트를 그대로 옮긴다.
    for heading, sheet_name in [
        ("2. 대상토지 현황", "1_대상토지"),
        ("3. 평가법인별 수치 비교", "2_법인별 평가 비교"),
        ("4. 개별요인 비교", "3_개별요인"),
    ]:
        sheet = _sheet(sheets, sheet_name)
        document.add_heading(heading, level=1)
        _add_table(document, sheet["columns"], sheet["rows"])
        if heading.startswith("3.") and unlinked:
            document.add_paragraph(
                f"평가행이 연결되지 않은 편입토지 {len(unlinked)}필지({', '.join(unlinked)})는 표에서 삭제하지 않고 "
                f"값을 '{UNKNOWN}'으로 남겼습니다. 평가행을 자동 생성·복제하지 않았습니다."
            )

    # 5. 그 밖의 요인 검토 — 평가서에 기재된 값만 옮긴다(재계산 없음).
    document.add_heading("5. 그 밖의 요인 검토", level=1)
    if other_factors:
        _add_table(
            document,
            ["평가법인", "비교표준지", "사례", "사례단가", "격차율", "결정 그 밖의 요인"],
            [[
                _text(row.get("appraisal_company")),
                _text(row.get("standard_land_symbol")),
                _text(row.get("comparison_case_symbol")),
                _text(row.get("case_unit_price")),
                _text(row.get("calculated_gap_ratio")),
                _text(row.get("decided_other_factor")),
            ] for row in other_factors],
        )
    else:
        _add_table(
            document,
            ["평가법인", "대상토지", "그 밖의 요인", "적용단가", "source reference"],
            [[
                row.appraisal_company,
                row.subject_parcel_id,
                UNKNOWN if row.other_factor is None else row.other_factor,
                UNKNOWN if row.decided_unit_price is None else row.decided_unit_price,
                _source_reference(row.source_refs),
            ] for row in output.valuation_bundle],
        )
        document.add_paragraph(
            "그 밖의 요인 산정 근거표가 사건 데이터에 없어 평가행에 기재된 값만 옮겼습니다. "
            "격차율·사례 선정 근거는 원문에서 확인이 필요합니다."
        )

    # 6. 쟁점 후보 — 사건 JSON 의 문구를 그대로 옮긴다.
    document.add_heading("6. 쟁점 후보", level=1)
    if issues:
        _add_table(
            document,
            ["쟁점", "대상토지", "확인된 사실", "검토 필요사항", "필요 자료", "상태"],
            [[
                _text(issue.get("issue_id")),
                ", ".join(issue.get("related_land_ids") or []) or UNKNOWN,
                _text(issue.get("confirmed_fact")),
                _text(issue.get("interpretation_note")),
                _text(issue.get("required_evidence")),
                f"{_text(issue.get('reflection_status'))} / NEEDS_REVIEW",
            ] for issue in issues],
        )
    else:
        document.add_paragraph("사건 데이터에 쟁점 후보가 없습니다. 이 자료에서 쟁점을 새로 만들지 않았습니다.")
    if risks:
        document.add_paragraph("표현 주의사항")
        _add_table(
            document,
            ["리스크", "수준", "내용", "조치"],
            [[
                _text(risk.get("risk_id")),
                _text(risk.get("risk_level")),
                _text(risk.get("message")),
                _text(risk.get("required_action")),
            ] for risk in risks],
        )

    # 7. 의견서 작성 참고문안 — 기존 문안을 고치지 않고 그대로 옮긴다.
    document.add_heading("7. 의견서 작성 참고문안", level=1)
    document.add_paragraph(
        "아래 문안은 사건 데이터에 이미 있는 초안입니다. 이 자료에서 문장을 새로 만들거나 고치지 않았습니다. "
        "반영 여부는 작성자가 판단합니다."
    )
    if sentences:
        _add_table(
            document,
            ["문안", "쟁점", "문안 내용", "상태"],
            [[
                _text(sentence.get("draft_sentence_id")),
                _text(sentence.get("issue_id")),
                _text(sentence.get("draft_sentence_safe") or sentence.get("draft_sentence_raw")),
                f"{_text(sentence.get('draft_reflection_status'))} / 필터 {_text(sentence.get('filter_result_code'))}",
            ] for sentence in sentences],
        )
    else:
        document.add_paragraph("사건 데이터에 보조문안이 없습니다. 문안을 새로 생성하지 않았습니다.")

    # 8. 지도·그래픽 — 브라우저가 이미 만든 지도 이미지를 그대로 넣는다.
    document.add_heading("8. 지도·그래픽", level=1)
    map_embedded = False
    map_count = 0
    image_items = list(map_images or [])
    if not image_items and map_image:
        image_items = [{"path": str(map_image), "title": "전체 위치도"}]
    for image_item in image_items:
        image_path = Path(str(image_item.get("path", "")))
        if not image_path.exists():
            continue
        try:
            title = _text(image_item.get("title")) or f"지도 {map_count + 1}"
            document.add_paragraph(title, style="Heading 2")
            document.add_picture(str(image_path), width=Cm(15.5))
            map_embedded = True
            map_count += 1
            document.add_paragraph(
                "VWorld 항공사진과 PNU exact-one 지적경계를 결합한 검토 보조도면입니다. "
                "자동확정 자료가 아니며 제출 전 축척과 표시내용을 검수해야 합니다."
            )
        except Exception:  # noqa: BLE001 - 이미지가 없어도 문서는 나와야 한다
            continue
    if not map_embedded:
        document.add_paragraph(
            "지도 데이터 필요 — 좌표 도형을 불러오지 않았거나 이 사건 필지로 식별되는 도형이 없습니다. "
            "좌표를 추정해 그리지 않습니다."
        )

    # 9. 원문근거 목록
    document.add_heading("9. 원문근거 목록", level=1)
    provenance_rows: list[list[str]] = []
    for parcel in output.subject_bundle.get("subject_parcels", []):
        provenance_rows.append(["편입토지", parcel.parcel_id, parcel.lot_number, _source_reference(parcel.source_refs)])
    for parcel in output.subject_bundle.get("reference_parcels", []):
        provenance_rows.append(["비교표준지", parcel.reference_id, parcel.lot_number, _source_reference(parcel.source_refs)])
    for row in output.valuation_bundle:
        provenance_rows.append(["평가행", row.valuator_id, row.appraisal_company, _source_reference(row.source_refs)])
    _add_table(document, ["구분", "식별자", "대상", "source reference"], provenance_rows)
    missing_provenance = sum(1 for row in provenance_rows if row[3] == NO_PROVENANCE)
    if missing_provenance:
        document.add_paragraph(
            f"원문 근거가 없는 항목 {missing_provenance}건은 '{NO_PROVENANCE}'으로 표시했습니다. 근거를 만들어내지 않았습니다."
        )

    # 10. 확인 필요사항
    document.add_heading("10. 확인 필요사항", level=1)
    check_rows: list[list[str]] = []
    for warning in warnings:
        check_rows.append([
            warning.get("code", ""),
            ", ".join(warning.get("land_ids", [])) or "사건 전체",
            warning.get("detail", ""),
            "NEEDS_REVIEW",
        ])
    for item in output.review_queue:
        check_rows.append([item.review_id, item.priority, f"{item.reason} / {item.verification_method}", "NEEDS_REVIEW"])
    for qa in output.qa_bundle:
        if qa.status.value in ("FAIL", "REVIEW_REQUIRED"):
            check_rows.append([qa.rule_id, ", ".join(qa.source_keys) or "사건 전체", qa.message, "NEEDS_REVIEW"])
    _add_table(document, ["항목", "대상", "내용", "상태"], check_rows)

    path.parent.mkdir(parents=True, exist_ok=True)
    document.save(path)

    assembled = "\n".join(paragraph.text for paragraph in document.paragraphs)
    assembled += "\n" + "\n".join(
        cell.text for table in document.tables for row in table.rows for cell in row.cells
    )
    hit = [phrase for phrase in FORBIDDEN_PHRASES if re.search(re.escape(phrase), assembled)]
    if hit:
        path.unlink(missing_ok=True)
        raise OpinionPackageError("금지 표현이 조립 결과에 포함되었습니다: " + ", ".join(hit))

    return {
        "path": str(path),
        "sections": 10,
        "map_embedded": map_embedded,
        "map_count": map_count,
        "counts": {
            "subject_parcels": len(output.subject_bundle.get("subject_parcels", [])),
            "valuation_rows": len(output.valuation_bundle),
            "issues": len(issues),
            "sentences": len(sentences),
            "risks": len(risks),
            "other_factor_rows": len(other_factors),
            "provenance_rows": len(provenance_rows),
            "provenance_missing": missing_provenance,
            "check_rows": len(check_rows),
        },
        "review_warnings": warnings,
        "unlinked_subject_parcels": unlinked,
    }
