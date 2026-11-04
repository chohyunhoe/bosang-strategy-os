# -*- coding: utf-8 -*-
"""killerkit 사건 JSON → BriefOutput 문서 산출 계층 어댑터 (Output Center P0).

브라우저가 들고 있는 사건 데이터(killerkit case JSON)를 이미 구현된 문서 산출 계층
(`brief_output.generator.build_output` → `brief_output.docx_binder.bind_docx`)이 받을 수 있는
`BriefOutput` 번들로 옮기기만 한다.

이 모듈이 하지 않는 것:

- 새 분석·새 판단·새 수치 생성 (원문에 없는 값은 만들지 않는다)
- 누락값 추정·보간·역산 (개별요인 누계에서 세부값을 쪼개지 않고, 세부값에서 누계를 곱하지 않는다)
- 입력 dict 변경 (`adapt_case` 는 입력을 읽기만 한다)
- 기존 스키마 개편

fail-closed 원칙: 목표 필드에 넣을 근거가 없으면 **비운다**. 0 이나 빈 문자열로 채우지 않고,
어떤 필드가 왜 비었는지를 `analysis_bundle["adapter_report"]` 에 사유 코드로 남긴다.
행 자체를 만들 수 없으면 그 행을 내보내지 않고 차단 사유를 기록한다.
"""
from __future__ import annotations

import math
import re
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from typing import Any, Iterable

from .models import (
    BriefOutput,
    DocumentMeta,
    IndividualFactorBreakdown,
    PagePayload,
    ProjectMeta,
    ReferenceParcel,
    ReviewStatus,
    RunMeta,
    SourceRef,
    SubjectParcel,
)

ADAPTER_ID = "killerkit_case → bso_brief_output_v0.1"
ADAPTER_VERSION = "1"

PAGE_IDS = (
    "page1_summary",
    "page2_analysis",
    "page3_analysis",
    "page4_analysis",
    "page5_conclusion",
)

# killerkit 검토상태 → BriefOutput 검토상태. 모르는 값은 검토필요로 내린다(위로 올리지 않는다).
REVIEW_STATUS_MAP = {
    "NEEDS_REVIEW": ReviewStatus.REVIEW_REQUIRED,
    "REVIEW_REQUIRED": ReviewStatus.REVIEW_REQUIRED,
    "PENDING": ReviewStatus.REVIEW_REQUIRED,
    "CONFIRMED": ReviewStatus.PASS,
    "MISSING": ReviewStatus.FAIL,
    "CONFLICT": ReviewStatus.FAIL,
    "FAILED": ReviewStatus.FAIL,
}

# 개별요인 6조건: killerkit subject_to_standard_factor_comparisons → BriefOutput 필드명
FACTOR_FIELD_MAP = (
    ("street_condition", "street_condition"),
    ("access_condition", "access_condition"),
    ("environment_or_natural_condition", "environment_condition"),
    ("parcel_condition", "parcel_condition"),
    ("administrative_condition", "administrative_condition"),
    ("other_condition", "other_condition"),
)

# parser 개별요인 세부계수 category → BriefOutput 필드명
FACTOR_CATEGORY_MAP = {
    "접근조건": "access_condition",
    "환경조건": "environment_condition",
    "획지조건": "parcel_condition",
    "행정적조건": "administrative_condition",
    "기타조건": "other_condition",
}

_FILE_NAME_SAFE = re.compile(r"[^0-9A-Za-z가-힣]+")


class AdapterError(ValueError):
    """어댑터가 fail-closed 로 중단한 경우."""


class AdapterSafetyError(AdapterError):
    """자동확정 금지 등 안전 경계를 위반한 입력."""


# --------------------------------------------------------------------------- #
# 값 변환 (추정 금지)
# --------------------------------------------------------------------------- #

def _text(value: Any) -> str | None:
    if value is None or isinstance(value, bool):
        return None
    text = str(value).strip()
    return text or None


def _number(value: Any) -> float | None:
    """숫자만 숫자로 본다. 빈값·'-'·해석불가 문자열은 None (0 으로 채우지 않는다)."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        return number if math.isfinite(number) else None
    if isinstance(value, str):
        text = value.replace(",", "").replace("㎡", "").replace("원", "").strip()
        if not text or text == "-":
            return None
        try:
            number = float(text)
        except ValueError:
            return None
        return number if math.isfinite(number) else None
    return None


def _parse_date(value: Any) -> date | None:
    text = _text(value)
    if not text:
        return None
    normalized = text.replace(".", "-").replace("/", "-").strip().rstrip("-")
    match = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", normalized)
    if not match:
        return None
    try:
        return date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
    except ValueError:
        return None


def _rows(case: dict, key: str) -> list[dict]:
    value = case.get(key)
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


# --------------------------------------------------------------------------- #
# 어댑터 기록
# --------------------------------------------------------------------------- #

class AdapterReport:
    """어떤 값이 왜 비었는지, 어떤 행이 왜 차단됐는지를 남긴다."""

    def __init__(self) -> None:
        self.blocked_rows: list[dict[str, str]] = []
        self.field_gaps: Counter[str] = Counter()
        self.unlinked_subject_parcels: list[str] = []
        self.source_refs_mapped = 0
        self.records_without_source_ref = 0
        self.review_status_counts: Counter[str] = Counter()
        self.notes: list[str] = []

    def block(self, row_id: str, reason: str) -> None:
        self.blocked_rows.append({"row_id": row_id, "reason": reason})

    def gap(self, field: str) -> None:
        self.field_gaps[field] += 1

    def to_dict(self) -> dict[str, Any]:
        return {
            "adapter": ADAPTER_ID,
            "adapter_version": ADAPTER_VERSION,
            "blocked_rows": self.blocked_rows,
            "field_gaps": dict(sorted(self.field_gaps.items())),
            "unlinked_subject_parcels": self.unlinked_subject_parcels,
            "provenance": {
                "source_refs_mapped": self.source_refs_mapped,
                "records_without_source_ref": self.records_without_source_ref,
            },
            "review_status_preserved": dict(sorted(self.review_status_counts.items())),
            "notes": self.notes,
        }


def _bounded(
    value: float | None,
    *,
    minimum: float,
    exclusive: bool,
    field: str,
    report: AdapterReport,
) -> float | None:
    """목표 스키마의 범위를 벗어난 값은 잘라 맞추지 않고 비운다."""
    if value is None:
        report.gap(field)
        return None
    if (exclusive and value <= minimum) or (not exclusive and value < minimum):
        report.gap(f"{field}:OUT_OF_CONTRACT_RANGE")
        return None
    return value


# --------------------------------------------------------------------------- #
# provenance
# --------------------------------------------------------------------------- #

def _source_refs(record: dict, report: AdapterReport, *, fallback_document_id: str | None = None) -> list[SourceRef]:
    """parser source_ref → BriefOutput SourceRef. 근거가 없으면 만들어내지 않는다."""
    refs: list[SourceRef] = []
    for raw in record.get("source_refs") or []:
        if not isinstance(raw, dict):
            continue
        document_id = _text(raw.get("appraisal_id")) or fallback_document_id
        if not document_id:
            continue
        page = raw.get("page_no")
        page_no = int(page) if isinstance(page, int) and page >= 1 else None
        line_start = raw.get("line_start")
        line_end = raw.get("line_end")
        locator_parts = [part for part in [_text(raw.get("source_label"))] if part]
        if isinstance(line_start, int):
            span = f"L{line_start}" if line_end == line_start or line_end is None else f"L{line_start}-{line_end}"
            locator_parts.append(span)
        refs.append(
            SourceRef(
                document_id=document_id,
                page=page_no,
                locator=" ".join(locator_parts) or None,
                excerpt=_text(raw.get("raw_text_excerpt")),
            )
        )
    if refs:
        report.source_refs_mapped += len(refs)
    else:
        report.records_without_source_ref += 1
    return refs


def _review_status(record: dict, report: AdapterReport) -> ReviewStatus:
    code = _text(record.get("review_status_code")) or ""
    status = REVIEW_STATUS_MAP.get(code.upper(), ReviewStatus.REVIEW_REQUIRED)
    report.review_status_counts[code or "UNSET"] += 1
    return status


def _assert_no_auto_confirmed(case: dict) -> None:
    """auto_confirmed=true 는 v1.0 안전 경계 위반이다. 문서로 흘려보내지 않는다."""
    offenders: list[str] = []
    scanned: Iterable[tuple[str, Any]] = (
        ("case", case.get("case")),
        *((key, case.get(key)) for key in (
            "appraisals",
            "lands",
            "standard_lands",
            "land_appraisal_results",
            "subject_to_standard_factor_comparisons",
        )),
    )
    for key, value in scanned:
        records = value if isinstance(value, list) else [value]
        for record in records:
            if isinstance(record, dict) and record.get("auto_confirmed") is True:
                offenders.append(f"{key}:{record.get('land_id') or record.get('appraisal_id') or '?'}")
    if offenders:
        raise AdapterSafetyError(
            "auto_confirmed=true 레코드는 문서 산출로 전달할 수 없습니다: " + ", ".join(sorted(set(offenders))[:10])
        )


# --------------------------------------------------------------------------- #
# 개별요인
# --------------------------------------------------------------------------- #

def _factors_from_comparison(comparison: dict, report: AdapterReport) -> dict[str, float | None]:
    values: dict[str, float | None] = {}
    for source_field, target_field in FACTOR_FIELD_MAP:
        values[target_field] = _bounded(
            _number(comparison.get(source_field)),
            minimum=0,
            exclusive=True,
            field=f"individual_factors.{target_field}",
            report=report,
        )
    return values


def _factors_from_parser_details(result: dict, report: AdapterReport) -> dict[str, float | None]:
    """parser 세부계수는 category 당 항목이 정확히 1개일 때만 채운다.

    한 조건에 항목이 여러 개면 소계를 곱해 만들지 않는다(추정 금지). 비우고 사유를 남긴다.
    """
    grouped: dict[str, list[float]] = defaultdict(list)
    for detail in result.get("individual_factor_details") or []:
        if not isinstance(detail, dict):
            continue
        target = FACTOR_CATEGORY_MAP.get(_text(detail.get("category")) or "")
        value = _number(detail.get("factor_value"))
        if target and value is not None:
            grouped[target].append(value)

    values: dict[str, float | None] = {}
    for target, found in grouped.items():
        if len(found) == 1 and found[0] > 0:
            values[target] = found[0]
        else:
            report.gap(f"individual_factors.{target}:AMBIGUOUS_PARSER_DETAILS")
    return values


def _individual_factors(
    result: dict,
    comparison: dict | None,
    report: AdapterReport,
) -> IndividualFactorBreakdown:
    values: dict[str, float | None] = {target: None for _, target in FACTOR_FIELD_MAP}
    source_refs: list[SourceRef] = []
    overall: float | None = None

    if comparison is not None:
        values.update(_factors_from_comparison(comparison, report))
        overall = _bounded(
            _number(comparison.get("total_factor")),
            minimum=0,
            exclusive=True,
            field="individual_factors.overall_individual_factor",
            report=report,
        )
        source_refs = _source_refs(comparison, report, fallback_document_id=_text(comparison.get("appraisal_id")))

    for target, value in _factors_from_parser_details(result, report).items():
        if values.get(target) is None:
            values[target] = value

    if overall is None:
        overall = _bounded(
            _number(result.get("individual_factor_total")),
            minimum=0,
            exclusive=True,
            field="individual_factors.overall_individual_factor",
            report=report,
        )

    if not source_refs:
        source_refs = _source_refs(result, report, fallback_document_id=_text(result.get("appraisal_id")))

    breakdown = IndividualFactorBreakdown(
        **values,
        overall_individual_factor=overall,
        source_refs=source_refs,
        review_status=_review_status(result, report),
    )
    return breakdown


# --------------------------------------------------------------------------- #
# 본체
# --------------------------------------------------------------------------- #

def adapt_case(
    case: dict,
    *,
    run_id: str | None = None,
    generated_at: datetime | None = None,
) -> BriefOutput:
    """killerkit 사건 JSON 을 BriefOutput base 번들로 옮긴다.

    입력 dict 은 읽기만 한다. 반환값은 `brief_output.generator.build_output` 에 그대로 넣을 수 있다.
    """
    if not isinstance(case, dict):
        raise AdapterError("사건 데이터가 dict 이 아닙니다.")

    _assert_no_auto_confirmed(case)
    report = AdapterReport()

    case_meta = case.get("case") if isinstance(case.get("case"), dict) else {}
    appraisals = _rows(case, "appraisals")
    lands = _rows(case, "lands")
    standard_lands = _rows(case, "standard_lands")
    results = _rows(case, "land_appraisal_results")
    comparisons = _rows(case, "subject_to_standard_factor_comparisons")

    if not lands:
        raise AdapterError("편입토지가 없습니다. 분석보고서를 생성할 근거가 없습니다.")
    if not results:
        raise AdapterError("평가행이 없습니다. 분석보고서를 생성할 근거가 없습니다.")

    project_name = _text(case_meta.get("project_name")) or _text(case_meta.get("case_name"))
    if not project_name:
        raise AdapterError("사업명·사건명이 모두 비어 있어 보고서 표제를 만들 수 없습니다.")

    # --- 문서 ---------------------------------------------------------------
    uploads_by_id: dict[str, dict] = {}
    for upload in _rows(case, "document_uploads"):
        key = _text(upload.get("appraisal_id")) or _text(upload.get("file_name"))
        if key:
            uploads_by_id[key] = upload

    document_meta: list[DocumentMeta] = []
    company_by_appraisal: dict[str, str] = {}
    for appraisal in appraisals:
        appraisal_id = _text(appraisal.get("appraisal_id"))
        if not appraisal_id:
            report.block("appraisals:?", "MISSING_APPRAISAL_ID")
            continue
        company = _text(appraisal.get("appraisal_company"))
        if company:
            company_by_appraisal[appraisal_id] = company
        upload = uploads_by_id.get(appraisal_id) or uploads_by_id.get(_text(appraisal.get("file_name")) or "") or {}
        page_count = _number(upload.get("page_count") or appraisal.get("page_count"))
        document_meta.append(
            DocumentMeta(
                document_id=appraisal_id,
                file_name_masked=_masked_file_name(appraisal_id, company),
                appraisal_company=company,
                page_count=int(page_count) if page_count is not None and page_count >= 1 else None,
                extraction_method=_text(appraisal.get("extraction_method")) or _text(appraisal.get("parse_status")),
            )
        )
    if not document_meta:
        raise AdapterError("평가서 문서 정보가 없습니다.")

    # --- 대상토지 / 비교표준지 ------------------------------------------------
    ownership_by_land = _ownership_by_land(results)
    subject_parcels: list[SubjectParcel] = []
    land_ids: set[str] = set()
    for land in lands:
        land_id = _text(land.get("land_id"))
        if not land_id:
            report.block("lands:?", "MISSING_LAND_ID")
            continue
        lot_number = _text(land.get("parcel_address")) or _text(land.get("lot_number"))
        if not lot_number:
            report.block(land_id, "MISSING_PARCEL_ADDRESS")
            continue
        land_ids.add(land_id)
        # SubjectParcel 에는 검토상태 필드가 없다(스키마 개편 금지). 상태가 조용히 사라지지 않도록
        # 어댑터 기록에 집계해 QA-ADAPTER-REVIEW-STATE 로 문서 계층에 올린다.
        _review_status(land, report)
        subject_parcels.append(
            SubjectParcel(
                parcel_id=land_id,
                lot_number=lot_number,
                area_sqm=_bounded(
                    _number(land.get("area")), minimum=0, exclusive=True, field="subject.area_sqm", report=report
                ),
                land_category=_text(land.get("land_category")),
                current_use=_text(land.get("appraisal_use_status")) or _text(land.get("use_note")),
                ownership_share=ownership_by_land.get(land_id),
                source_refs=_source_refs(land, report),
            )
        )
    if not subject_parcels:
        raise AdapterError("구조화된 편입토지가 없습니다.")

    reference_parcels: list[ReferenceParcel] = []
    reference_by_key: dict[tuple[str, str], str] = {}
    for standard in standard_lands:
        reference_id = _text(standard.get("standard_land_id"))
        lot_number = _text(standard.get("parcel_address")) or _text(standard.get("lot_number"))
        if not reference_id or not lot_number:
            report.block(reference_id or "standard_lands:?", "MISSING_REFERENCE_IDENTITY")
            continue
        reference_parcels.append(
            ReferenceParcel(
                reference_id=reference_id,
                lot_number=lot_number,
                official_price_per_sqm=_bounded(
                    _number(standard.get("official_price")),
                    minimum=0,
                    exclusive=False,
                    field="reference.official_price_per_sqm",
                    report=report,
                ),
                source_refs=_source_refs(standard, report),
            )
        )
        _review_status(standard, report)
        appraisal_id = _text(standard.get("appraisal_id"))
        symbol = _text(standard.get("standard_land_symbol"))
        if appraisal_id and symbol:
            reference_by_key[(appraisal_id, symbol)] = reference_id

    # --- 평가행 --------------------------------------------------------------
    comparison_index = _comparison_index(comparisons, report)
    valuation_bundle = []
    linked_land_ids: set[str] = set()

    for result in results:
        appraisal_id = _text(result.get("appraisal_id"))
        land_id = _text(result.get("land_id"))
        row_id = f"{appraisal_id or '?'}__{land_id or '?'}"

        if not appraisal_id or not land_id:
            report.block(row_id, "MISSING_ROW_IDENTITY")
            continue
        if land_id not in land_ids:
            report.block(row_id, "UNLINKED_SUBJECT_PARCEL")
            continue
        link_status = _text(result.get("subject_link_status"))
        if link_status is not None and link_status != "LINKED":
            report.block(row_id, f"SUBJECT_LINK_NOT_LINKED:{link_status}")
            continue
        company = _text(result.get("appraisal_company")) or company_by_appraisal.get(appraisal_id)
        if not company:
            report.block(row_id, "MISSING_APPRAISAL_COMPANY")
            continue

        symbol = _text(result.get("standard_land_symbol"))
        reference_id = reference_by_key.get((appraisal_id, symbol)) if symbol else None
        if symbol and reference_id is None:
            report.gap("valuation.reference_parcel_id:SYMBOL_NOT_RESOLVED")

        comparison = comparison_index.get((appraisal_id, land_id))
        valuation_bundle.append(
            _valuator_result(
                result=result,
                row_id=row_id,
                company=company,
                land_id=land_id,
                reference_id=reference_id,
                comparison=comparison,
                report=report,
            )
        )
        linked_land_ids.add(land_id)

    if not valuation_bundle:
        raise AdapterError(
            "문서 산출로 넘길 수 있는 평가행이 하나도 없습니다. 차단 사유: "
            + ", ".join(sorted({row["reason"] for row in report.blocked_rows}))
        )

    report.unlinked_subject_parcels = sorted(land_ids - linked_land_ids)
    if report.unlinked_subject_parcels:
        report.notes.append(
            "평가행이 연결되지 않은 편입토지가 있어 보고서는 해당 필지를 비교대상에서 제외했습니다. "
            "원문 대조 전에는 완결된 비교로 볼 수 없습니다."
        )

    # --- 번들 조립 ------------------------------------------------------------
    ownership_values = {value for value in ownership_by_land.values() if value}
    base = BriefOutput(
        run_meta=RunMeta(
            run_id=run_id or _run_id(case_meta),
            generated_at=generated_at or datetime.now(timezone.utc),
            status="partial",
            local_processing=True,
        ),
        project_meta=ProjectMeta(
            project_name=project_name,
            client_name_masked=None,  # 소유자 실명은 문서 산출 계층으로 넘기지 않는다.
            report_date=_parse_date(case_meta.get("price_date")) or _parse_date(case_meta.get("base_date")),
            ownership_share=next(iter(ownership_values)) if len(ownership_values) == 1 else None,
            output_mode="internal",
        ),
        document_meta=document_meta,
        source_bundle={
            "input_mode": "killerkit_case_json",
            "adapter": ADAPTER_ID,
            "adapter_version": ADAPTER_VERSION,
            "source_schema_version": _text((case.get("meta") or {}).get("schema_version"))
            or _text((case.get("meta") or {}).get("parser_stage")),
            "case_id": _text(case_meta.get("case_id")),
            "original_pdf_stored": False,
            "counts": {
                "appraisals": len(appraisals),
                "lands": len(lands),
                "land_appraisal_results": len(results),
                "standard_lands": len(standard_lands),
                "subject_to_standard_factor_comparisons": len(comparisons),
            },
        },
        subject_bundle={"subject_parcels": subject_parcels, "reference_parcels": reference_parcels},
        valuation_bundle=valuation_bundle,
        analysis_bundle={
            "special_phrases": _special_phrases(comparisons),
            "issue_candidates": [],
            # 브라우저가 이미 들고 있던 후보는 덮어쓰지 않고 그대로 보존한다.
            "browser_issue_candidates": _rows(case, "issue_candidates"),
            "browser_draft_sentences": _rows(case, "draft_sentences"),
            "browser_risk_warnings": _rows(case, "risk_warnings"),
            "adapter_report": report.to_dict(),
        },
        graphics_bundle=[],
        page_payloads=[PagePayload(page_id=page_id, title="대기") for page_id in PAGE_IDS],
        docx_assembly=[],
        qa_bundle=[],
        review_queue=[],
    )
    return base


def _valuator_result(
    *,
    result: dict,
    row_id: str,
    company: str,
    land_id: str,
    reference_id: str | None,
    comparison: dict | None,
    report: AdapterReport,
):
    from .models import ValuatorResult  # 지역 import: 모듈 상단 순환 방지용이 아니라 가독성 목적

    return ValuatorResult(
        valuator_id=row_id,
        appraisal_company=company,
        subject_parcel_id=land_id,
        reference_parcel_id=reference_id,
        official_price_per_sqm=_bounded(
            _number(result.get("official_price")),
            minimum=0,
            exclusive=False,
            field="valuation.official_price_per_sqm",
            report=report,
        ),
        time_adjustment=_bounded(
            _number(result.get("time_correction")),
            minimum=0,
            exclusive=True,
            field="valuation.time_adjustment",
            report=report,
        ),
        regional_factor=_bounded(
            _number(result.get("regional_factor")),
            minimum=0,
            exclusive=True,
            field="valuation.regional_factor",
            report=report,
        ),
        individual_factors=_individual_factors(result, comparison, report),
        other_factor=_bounded(
            _number(result.get("other_factor")),
            minimum=0,
            exclusive=True,
            field="valuation.other_factor",
            report=report,
        ),
        calculated_unit_price=_bounded(
            _number(result.get("calculated_unit_price")),
            minimum=0,
            exclusive=False,
            field="valuation.calculated_unit_price",
            report=report,
        ),
        decided_unit_price=_bounded(
            _number(result.get("unit_price")),
            minimum=0,
            exclusive=False,
            field="valuation.decided_unit_price",
            report=report,
        ),
        appraised_amount=_bounded(
            _number(result.get("amount")),
            minimum=0,
            exclusive=False,
            field="valuation.appraised_amount",
            report=report,
        ),
        source_refs=_source_refs(result, report, fallback_document_id=_text(result.get("appraisal_id"))),
    )


def _comparison_index(comparisons: list[dict], report: AdapterReport) -> dict[tuple[str, str], dict]:
    """(평가서, 필지) 조합이 정확히 1건일 때만 개별요인 비교행을 쓴다."""
    grouped: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for comparison in comparisons:
        appraisal_id = _text(comparison.get("appraisal_id"))
        land_id = _text(comparison.get("land_id"))
        if appraisal_id and land_id:
            grouped[(appraisal_id, land_id)].append(comparison)

    index: dict[tuple[str, str], dict] = {}
    for key, found in grouped.items():
        if len(found) == 1:
            index[key] = found[0]
        else:
            report.gap("individual_factors:AMBIGUOUS_COMPARISON_ROWS")
    return index


def _ownership_by_land(results: list[dict]) -> dict[str, str]:
    """지분 표기가 필지별로 유일할 때만 승계한다."""
    grouped: dict[str, set[str]] = defaultdict(set)
    for result in results:
        land_id = _text(result.get("land_id"))
        share = _text(result.get("ownership_share_text"))
        if land_id and share:
            grouped[land_id].add(share)
    return {land_id: next(iter(shares)) for land_id, shares in grouped.items() if len(shares) == 1}


def _special_phrases(comparisons: list[dict]) -> list[dict[str, Any]]:
    """평가서에 이미 기재된 개별요인 사유 문언만 옮긴다. 새 문장을 쓰지 않는다."""
    phrases: list[dict[str, Any]] = []
    for comparison in comparisons:
        reason = _text(comparison.get("factor_reason"))
        if not reason:
            continue
        phrases.append(
            {
                "phrase": reason,
                "linked_value": _number(comparison.get("total_factor")),
                "source_ref": " ".join(
                    part for part in [_text(comparison.get("appraisal_id")), _text(comparison.get("land_id"))] if part
                ),
            }
        )
    return phrases


def _masked_file_name(appraisal_id: str, company: str | None) -> str:
    """원본 파일명에는 소유자 실명이 들어 있다. 파일명을 그대로 넘기지 않는다."""
    stem = f"{appraisal_id}_{company}" if company else appraisal_id
    return f"{_FILE_NAME_SAFE.sub('_', stem).strip('_')}.pdf"


def _run_id(case_meta: dict) -> str:
    case_id = _text(case_meta.get("case_id")) or "case"
    return f"bso-adapter-{_FILE_NAME_SAFE.sub('-', case_id).strip('-').lower()}"
