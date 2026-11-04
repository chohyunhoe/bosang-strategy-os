# -*- coding: utf-8 -*-
"""수치 비교표 시트 구성 (Output Center P1).

이미 어댑터가 만든 `BriefOutput` 번들을 표 형태로 옮기기만 한다.
새 분석·새 수치·역산이 없고, 값이 없으면 `확인 필요` 로 남긴다(0 으로 채우지 않는다).

원천 검토상태(`review_status_code`)는 `BriefOutput` 에 담을 필드가 없으므로
사건 JSON 에서 그대로 읽어 옮긴다. 상태를 새로 판정하지 않는다.
"""
from __future__ import annotations

import csv
from pathlib import Path
from typing import Any

from .models import BriefOutput

UNKNOWN = "확인 필요"
NO_APPRAISAL_ROW = "평가행 없음"

SHEET_SUBJECT = "1_대상토지"
SHEET_VALUATION = "2_법인별 평가 비교"
SHEET_FACTORS = "3_개별요인"
SHEET_REVIEW = "4_검토사항"


def _value(number: float | None) -> Any:
    """없는 값은 비우지 않고 '확인 필요' 로 표기한다. 0 으로 대체하지 않는다.

    정수로 떨어지는 값은 정수로 적는다(350000.0 → 350000). 값을 바꾸는 것이 아니라 표기만 맞춘다.
    """
    if number is None:
        return UNKNOWN
    return int(number) if float(number).is_integer() else number


def _source_reference(refs: list[Any]) -> str:
    parts = []
    for ref in refs or []:
        piece = ref.document_id
        if ref.page:
            piece += f" p.{ref.page}"
        if ref.locator:
            piece += f" {ref.locator}"
        parts.append(piece)
    return "; ".join(parts) or UNKNOWN


def _review_status_by_land(case: dict) -> dict[str, str]:
    statuses: dict[str, str] = {}
    for land in case.get("lands") or []:
        if isinstance(land, dict) and land.get("land_id"):
            statuses[str(land["land_id"])] = str(land.get("review_status_code") or "NEEDS_REVIEW")
    return statuses


def build_sheets(output: BriefOutput, case: dict) -> list[dict[str, Any]]:
    subject_parcels = output.subject_bundle.get("subject_parcels", [])
    reference_parcels = {item.reference_id: item for item in output.subject_bundle.get("reference_parcels", [])}
    report = output.analysis_bundle.get("adapter_report", {})
    unlinked = list(report.get("unlinked_subject_parcels", []))
    land_status = _review_status_by_land(case)
    lot_by_id = {parcel.parcel_id: parcel.lot_number for parcel in subject_parcels}

    subject_rows = [
        [
            parcel.parcel_id,
            parcel.lot_number,
            parcel.land_category or UNKNOWN,
            _value(parcel.area_sqm),
            parcel.current_use or UNKNOWN,
            land_status.get(parcel.parcel_id, "NEEDS_REVIEW"),
        ]
        for parcel in subject_parcels
    ]

    valuation_rows = []
    factor_rows = []
    for row in output.valuation_bundle:
        reference = reference_parcels.get(row.reference_parcel_id or "")
        valuation_rows.append([
            lot_by_id.get(row.subject_parcel_id, row.subject_parcel_id),
            row.appraisal_company,
            reference.lot_number if reference else UNKNOWN,
            _value(row.official_price_per_sqm),
            _value(row.time_adjustment),
            _value(row.individual_factors.overall_individual_factor),
            _value(row.other_factor),
            _value(row.calculated_unit_price),
            _value(row.decided_unit_price),
            _value(row.appraised_amount),
            _source_reference(row.source_refs),
            row.individual_factors.review_status.value,
        ])
        factors = row.individual_factors
        factor_rows.append([
            lot_by_id.get(row.subject_parcel_id, row.subject_parcel_id),
            row.appraisal_company,
            _value(factors.street_condition),
            _value(factors.access_condition),
            _value(factors.environment_condition),
            _value(factors.parcel_condition),
            _value(factors.administrative_condition),
            _value(factors.other_condition),
            _value(factors.overall_individual_factor),
            factors.review_status.value,
        ])

    # 평가행이 없는 편입토지도 표에서 감추지 않는다. 값은 만들지 않고 '확인 필요' 로 남긴다.
    for land_id in unlinked:
        lot = lot_by_id.get(land_id, land_id)
        valuation_rows.append([lot, UNKNOWN, UNKNOWN] + [UNKNOWN] * 7 + [UNKNOWN, f"NEEDS_REVIEW / {NO_APPRAISAL_ROW}"])
        factor_rows.append([lot, UNKNOWN] + [UNKNOWN] * 7 + [f"NEEDS_REVIEW / {NO_APPRAISAL_ROW}"])

    review_rows = []
    for warning in report.get("review_warnings", []):
        target = ", ".join(warning.get("land_ids", [])) or "사건 전체"
        review_rows.append([
            warning.get("code", ""),
            target,
            warning.get("detail", ""),
            "원문 산출근거 표에서 해당 필지 행의 존재 여부를 대조합니다. 평가행을 만들어 채우지 않습니다."
            if warning.get("code") == "APPRAISAL_ROW_COVERAGE_GAP"
            else "원문 페이지·행 근거를 포함하는 구조화 결과로 다시 생성합니다.",
            "NEEDS_REVIEW",
        ])
    for item in output.review_queue:
        review_rows.append([item.review_id, item.priority, item.reason, item.verification_method, "NEEDS_REVIEW"])
    for qa in output.qa_bundle:
        if qa.status.value in ("FAIL", "REVIEW_REQUIRED"):
            review_rows.append([
                qa.rule_id,
                ", ".join(qa.source_keys) or "사건 전체",
                qa.message,
                "해당 항목을 원문과 대조합니다.",
                "NEEDS_REVIEW",
            ])

    return [
        {
            "name": SHEET_SUBJECT,
            "columns": ["land_id", "소재지·지번", "지목", "면적(㎡)", "현황", "검토상태"],
            "rows": subject_rows,
        },
        {
            "name": SHEET_VALUATION,
            "columns": [
                "대상토지", "평가법인", "비교표준지", "공시지가", "시점수정", "개별요인 누계",
                "그 밖의 요인", "산출단가", "적용단가", "평가액", "source reference", "review status",
            ],
            "rows": valuation_rows,
        },
        {
            "name": SHEET_FACTORS,
            "columns": ["대상토지", "평가법인", "가로", "접근", "환경", "획지", "행정", "기타", "누계", "검토상태"],
            "rows": factor_rows,
        },
        {
            "name": SHEET_REVIEW,
            "columns": ["review code", "대상", "detail", "verification method", "상태"],
            "rows": review_rows,
        },
    ]


def write_xlsx(sheets: list[dict[str, Any]], path: Path) -> Path:
    from openpyxl import Workbook
    from openpyxl.styles import Font
    from openpyxl.utils import get_column_letter

    workbook = Workbook()
    workbook.remove(workbook.active)
    header_font = Font(bold=True)
    for sheet in sheets:
        worksheet = workbook.create_sheet(title=sheet["name"][:31])
        worksheet.append(sheet["columns"])
        for cell in worksheet[1]:
            cell.font = header_font
        for row in sheet["rows"]:
            worksheet.append(row)
        worksheet.freeze_panes = "A2"
        for index, column in enumerate(sheet["columns"], start=1):
            width = max([len(str(column))] + [len(str(row[index - 1])) for row in sheet["rows"]] or [0])
            worksheet.column_dimensions[get_column_letter(index)].width = min(max(width + 2, 10), 48)
    path.parent.mkdir(parents=True, exist_ok=True)
    workbook.save(path)
    return path


def write_csv(sheet: dict[str, Any], path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    # Excel 이 한글 CSV 를 깨뜨리지 않도록 BOM 을 붙인다.
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(sheet["columns"])
        writer.writerows(sheet["rows"])
    return path


def valuation_sheet(sheets: list[dict[str, Any]]) -> dict[str, Any]:
    return next(sheet for sheet in sheets if sheet["name"] == SHEET_VALUATION)
