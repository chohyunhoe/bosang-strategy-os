from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .models import (
    BriefOutput,
    GraphicAsset,
    IssueCandidate,
    PagePayload,
    QAResult,
    ReviewItem,
    ReviewStatus,
    SlotBinding,
    TablePayload,
)


def fmt_number(value: float | None, suffix: str = "") -> str:
    if value is None:
        return "확인 필요"
    return f"{value:,.0f}{suffix}"


def build_valuation_structure_table(rows: list[Any]) -> TablePayload:
    return TablePayload(
        table_id="valuation_structure_comparison",
        columns=[
            "평가법인",
            "대상토지",
            "비교표준지",
            "공시지가",
            "시점수정",
            "지역요인",
            "개별요인",
            "그 밖의 요인",
            "결정단가",
        ],
        rows=[
            [
                row.appraisal_company,
                row.subject_parcel_id,
                row.reference_parcel_id or "확인 필요",
                fmt_number(row.official_price_per_sqm, "원/㎡"),
                row.time_adjustment if row.time_adjustment is not None else "확인 필요",
                row.regional_factor if row.regional_factor is not None else "확인 필요",
                row.individual_factors.overall_individual_factor
                if row.individual_factors.overall_individual_factor is not None
                else "확인 필요",
                row.other_factor if row.other_factor is not None else "확인 필요",
                fmt_number(row.decided_unit_price, "원/㎡"),
            ]
            for row in rows
        ],
    )


def build_subject_table(rows: list[Any]) -> TablePayload:
    return TablePayload(
        table_id="subject_appraisal_summary",
        columns=["평가법인", "대상토지", "결정단가", "평가액"],
        rows=[
            [
                row.appraisal_company,
                row.subject_parcel_id,
                fmt_number(row.decided_unit_price, "원/㎡"),
                fmt_number(row.appraised_amount, "원"),
            ]
            for row in rows
        ],
    )


def build_factor_table(rows: list[Any]) -> TablePayload:
    return TablePayload(
        table_id="individual_factor_comparison",
        columns=[
            "평가법인",
            "가로",
            "접근",
            "환경",
            "획지",
            "행정",
            "기타",
            "종합",
            "검토상태",
        ],
        rows=[
            [
                row.appraisal_company,
                row.individual_factors.street_condition,
                row.individual_factors.access_condition,
                row.individual_factors.environment_condition,
                row.individual_factors.parcel_condition,
                row.individual_factors.administrative_condition,
                row.individual_factors.other_condition,
                row.individual_factors.overall_individual_factor,
                row.individual_factors.review_status.value,
            ]
            for row in rows
        ],
    )


def build_other_factor_table(rows: list[Any]) -> TablePayload:
    return TablePayload(
        table_id="other_factor_comparison",
        columns=["평가법인", "그 밖의 요인", "결정단가", "근거"],
        rows=[
            [
                row.appraisal_company,
                row.other_factor if row.other_factor is not None else "확인 필요",
                fmt_number(row.decided_unit_price, "원/㎡"),
                ", ".join(
                    f"{ref.document_id} p.{ref.page}" if ref.page else ref.document_id
                    for ref in row.source_refs
                )
                or "확인 필요",
            ]
            for row in rows
        ],
    )


def derive_fact_sentences(rows: list[Any]) -> list[str]:
    sentences: list[str] = []
    reference_ids = {row.reference_parcel_id for row in rows if row.reference_parcel_id}
    if len(reference_ids) == 1 and len(rows) > 1:
        sentences.append("각 평가결과는 동일한 비교표준지를 적용한 것으로 구조화되었다.")

    decided_prices = [row.decided_unit_price for row in rows if row.decided_unit_price is not None]
    if len(decided_prices) >= 2:
        price_gap = max(decided_prices) - min(decided_prices)
        sentences.append(f"평가법인 간 결정단가 차이는 {price_gap:,.0f}원/㎡이다.")

    complete_factors = [
        row.individual_factors.overall_individual_factor
        for row in rows
        if row.individual_factors.overall_individual_factor is not None
    ]
    if len(complete_factors) == len(rows) and len(set(complete_factors)) == 1:
        sentences.append("평가법인별 종합 개별요인 값은 동일하다.")
    else:
        sentences.append("개별요인 수치의 누락 또는 차이가 있어 원문 대조가 필요하다.")

    other_factors = [row.other_factor for row in rows if row.other_factor is not None]
    if len(other_factors) >= 2 and len(set(other_factors)) > 1:
        sentences.append("그 밖의 요인 값은 평가법인별로 차이가 확인된다.")

    return sentences


def build_issue_candidates(rows: list[Any], special_phrases: list[dict[str, Any]]) -> list[IssueCandidate]:
    candidates: list[IssueCandidate] = []

    for item in special_phrases:
        phrase = str(item.get("phrase", ""))
        value = item.get("linked_value")
        if "우세" in phrase and value == 1.0:
            candidates.append(
                IssueCandidate(
                    issue_id="issue-factor-wording-value",
                    priority=1,
                    title="개별요인 문언과 적용값 정합성",
                    summary="우세 취지의 문언과 1.00 적용값이 함께 추출되어 원문 표 구조 확인이 필요하다.",
                    evidence=[phrase, f"연결값: {value}"],
                    additional_review=["개별요인표 원문 행·열 확인", "해당 문언의 적용 대상 필지 확인"],
                )
            )
            break

    if any(row.individual_factors.review_status == ReviewStatus.FAIL for row in rows):
        candidates.append(
            IssueCandidate(
                issue_id="issue-factor-values-missing",
                priority=1 if not candidates else 2,
                title="개별요인 수치 추출 누락",
                summary="대상토지와 비교표준지의 개별요인 세부값 또는 종합값이 누락되어 자동 비교를 완료할 수 없다.",
                evidence=[row.valuator_id for row in rows if row.individual_factors.review_status == ReviewStatus.FAIL],
                additional_review=["개별요인표 페이지 확인", "OCR 행·열 복원", "평가법인·필지 매핑 확인"],
            )
        )

    other_values = [row.other_factor for row in rows if row.other_factor is not None]
    if len(other_values) >= 2 and len(set(other_values)) > 1:
        candidates.append(
            IssueCandidate(
                issue_id="issue-other-factor-crosscheck",
                priority=min(len(candidates) + 1, 3),
                title="그 밖의 요인 보정 근거 교차검증",
                summary="평가법인별 그 밖의 요인 값 차이가 최종 단가 차이에 미친 영향을 검토할 필요가 있다.",
                evidence=[f"{row.appraisal_company}: {row.other_factor}" for row in rows],
                additional_review=["사례선정 및 가격시점 확인", "사례 대비 표준지 개별요인 확인"],
            )
        )

    return candidates[:3]


def build_output(base: BriefOutput) -> BriefOutput:
    rows = base.valuation_bundle
    special_phrases = list(base.analysis_bundle.get("special_phrases", []))
    issues = build_issue_candidates(rows, special_phrases)
    facts = derive_fact_sentences(rows)

    base.analysis_bundle["fact_sentences"] = facts
    base.analysis_bundle["issue_candidates"] = [item.model_dump() for item in issues]

    base.page_payloads = [
        PagePayload(
            page_id="page1_summary",
            title=f"{base.project_meta.project_name} 감정평가 1차 분석 브리프",
            paragraphs=facts[:3],
            tables=[build_subject_table(rows)],
            graphic_asset_ids=["overview-map"],
            source_keys=["subject_bundle", "valuation_bundle"],
        ),
        PagePayload(
            page_id="page2_analysis",
            title="평가구조 비교",
            paragraphs=facts,
            tables=[build_valuation_structure_table(rows)],
            source_keys=["valuation_bundle"],
        ),
        PagePayload(
            page_id="page3_analysis",
            title="대상토지·비교표준지 및 개별요인",
            paragraphs=["개별요인 수치는 원문 근거와 함께 검토되어야 한다."],
            tables=[build_factor_table(rows)],
            graphic_asset_ids=["subject-detail-map", "reference-detail-map"],
            source_keys=["subject_bundle", "valuation_bundle.individual_factors"],
        ),
        PagePayload(
            page_id="page4_analysis",
            title="그 밖의 요인 및 단가 차이",
            paragraphs=[sentence for sentence in facts if "그 밖의 요인" in sentence or "결정단가" in sentence],
            tables=[build_other_factor_table(rows)],
            graphic_asset_ids=["other-factor-flow"],
            source_keys=["valuation_bundle.other_factor", "valuation_bundle.decided_unit_price"],
        ),
        PagePayload(
            page_id="page5_conclusion",
            title="핵심 쟁점 및 추가 검토사항",
            paragraphs=[item.summary for item in issues] or ["현재 구조화 데이터에서 별도 쟁점 후보가 생성되지 않았다."],
            source_keys=["analysis_bundle.issue_candidates", "review_queue"],
        ),
    ]

    base.graphics_bundle = [
        GraphicAsset(asset_id="overview-map", asset_type="overview_map"),
        GraphicAsset(asset_id="subject-detail-map", asset_type="subject_detail_map"),
        GraphicAsset(asset_id="reference-detail-map", asset_type="reference_detail_map"),
        GraphicAsset(asset_id="other-factor-flow", asset_type="other_factor_flow"),
    ]

    base.docx_assembly = [
        SlotBinding(slot_name="{{PAGE1_TITLE}}", payload_type="text", payload_key="page1_summary.title"),
        SlotBinding(slot_name="{{PAGE1_HERO_GRAPHIC}}", payload_type="image", payload_key="overview-map"),
        SlotBinding(slot_name="{{PAGE1_SUBJECT_TABLE}}", payload_type="table", payload_key="subject_appraisal_summary"),
        SlotBinding(slot_name="{{PAGE1_SUMMARY}}", payload_type="text", payload_key="page1_summary.paragraphs"),
        SlotBinding(slot_name="{{PAGE2_STRUCTURE_TABLE}}", payload_type="table", payload_key="valuation_structure_comparison"),
        SlotBinding(slot_name="{{PAGE2_ANALYSIS}}", payload_type="text", payload_key="page2_analysis.paragraphs"),
        SlotBinding(slot_name="{{PAGE3_SUBJECT_GRAPHIC}}", payload_type="image", payload_key="subject-detail-map"),
        SlotBinding(slot_name="{{PAGE3_STANDARD_GRAPHIC}}", payload_type="image", payload_key="reference-detail-map"),
        SlotBinding(slot_name="{{PAGE3_FACTOR_TABLE}}", payload_type="table", payload_key="individual_factor_comparison"),
        SlotBinding(slot_name="{{PAGE3_ANALYSIS}}", payload_type="text", payload_key="page3_analysis.paragraphs"),
        SlotBinding(slot_name="{{PAGE4_OTHER_FACTOR_TABLE}}", payload_type="table", payload_key="other_factor_comparison"),
        SlotBinding(slot_name="{{PAGE4_FLOW_GRAPHIC}}", payload_type="image", payload_key="other-factor-flow"),
        SlotBinding(slot_name="{{PAGE4_ANALYSIS}}", payload_type="text", payload_key="page4_analysis.paragraphs"),
        SlotBinding(slot_name="{{PAGE5_ISSUES}}", payload_type="issues", payload_key="analysis_bundle.issue_candidates"),
        SlotBinding(slot_name="{{PAGE5_CONCLUSION}}", payload_type="text", payload_key="page5_conclusion.paragraphs"),
        SlotBinding(slot_name="{{PAGE5_DISCLAIMER}}", payload_type="text", payload_key="disclaimer"),
    ]

    base.qa_bundle = []
    missing_factors = [row for row in rows if row.individual_factors.review_status == ReviewStatus.FAIL]
    base.qa_bundle.append(
        QAResult(
            rule_id="QA-INDIVIDUAL-FACTOR-VALUES",
            status=ReviewStatus.FAIL if missing_factors else ReviewStatus.PASS,
            message=(
                "개별요인 수치가 누락된 평가행이 있다."
                if missing_factors
                else "모든 평가행에 개별요인 수치가 하나 이상 존재한다."
            ),
            source_keys=[row.valuator_id for row in missing_factors],
        )
    )
    base.qa_bundle.append(
        QAResult(
            rule_id="QA-ISSUE-LIMIT",
            status=ReviewStatus.PASS,
            message=f"쟁점 후보 {len(issues)}개 생성",
            source_keys=[item.issue_id for item in issues],
        )
    )

    base.review_queue = [
        ReviewItem(
            review_id="review-individual-factors",
            priority="P0",
            title="개별요인 수치 및 행·열 매핑 확인",
            reason="개별요인 수치는 브리프 핵심 비교값이며 OCR 표 구조 오류 위험이 높다.",
            verification_method="평가서 개별요인표 원문과 필지·평가법인·항목별 값을 대조한다.",
        )
    ]
    if special_phrases:
        base.review_queue.append(
            ReviewItem(
                review_id="review-special-phrases",
                priority="P0",
                title="특이문구와 적용값 정합성 확인",
                reason="우세·열세 등 문언과 실제 적용값이 다르게 연결될 수 있다.",
                verification_method="문언이 기재된 원문 위치와 연결 수치의 행·열을 대조한다.",
            )
        )

    has_fail = any(item.status == ReviewStatus.FAIL for item in base.qa_bundle)
    base.run_meta.status = "partial" if has_fail else "complete"
    base.run_meta.generated_at = datetime.now(timezone.utc)
    return BriefOutput.model_validate(base.model_dump())
