"""Phase 2. 나라장터(조달청) 4종 → EARLY_SIGNAL 통합.

대상: 발주계획현황 / 사전규격정보 / 입찰공고정보 / 계약과정통합공개.

처리: API 수집 → 정규화 → 키워드/기관/지역 기반 후보 판별 → EARLY_SIGNAL
→ 사람 검수 → 신규사업 모니터링 시트 편입.

나라장터 신호만으로 사업 확정·수임가능 판정을 하지 않는다. 모든 신호는
signal_type=EARLY_SIGNAL, review_required=True 이며 사람 검수 전 단계다.

주의: 조달청 나라장터 OpenAPI 는 서비스 경로 변경 이력이 있어 단계별로
실호출 확인이 필요하다(VERIFIED_STAGES 참조). 미확인 단계는 응답 메타의
confidence=ENDPOINT_UNVERIFIED 로 표시되며, 경로는 생성자 인자 또는
환경변수(PUBLIC_DATA_G2B_*_ENDPOINT)로 교체할 수 있다.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional

from .core import (
    FetchResult,
    FreshnessGrade,
    ProviderError,
    PublicDataProvider,
    SourceMeta,
    find_first,
    parse_standard_body,
    raw_hash,
)

# 단계별 endpoint 검증 상태. 실호출로 정상 응답(데이터 수신)을 확인한 단계만 넣는다.
# 2026-08-19 실호출 확인:
#   BID_NOTICE  정상(13건)  / PRE_SPEC 정상(5건)
#   CONTRACT    경로는 존재(ao prefix, returnReasonCode=30 = 활용신청 필요)
#   ORDER_PLAN  returnReasonCode=12 = 해당 오픈API 서비스 없음/폐기 → 명세 재확인 필요
VERIFIED_STAGES = frozenset({"BID_NOTICE", "PRE_SPEC"})

# 경로는 확인됐으나 인증키가 해당 서비스에 활용신청되지 않은 단계.
# 승인만 되면 그대로 동작한다(코드 변경 불필요).
PENDING_SUBSCRIPTION_STAGES = frozenset({"CONTRACT"})

G2B_ENDPOINT_CANDIDATES = {
    # 발주계획현황서비스 (data.go.kr 15129462)
    # 주의: ao/ad/at/무접두 4종 모두 returnReasonCode=12(서비스 없음/폐기).
    # 서비스명 자체가 다를 가능성이 높아 공식 활용명세 확인 전까지 후보값으로만 둔다.
    "ORDER_PLAN": "https://apis.data.go.kr/1230000/ao/OrderPlanSttusService/getOrderPlanSttusList",
    # 사전규격정보서비스
    "PRE_SPEC": "https://apis.data.go.kr/1230000/ao/HrcspSsstndrdInfoService/getPublicPrcureThngInfoServc",
    # 입찰공고정보서비스 (data.go.kr 15129394) — 용역 조회
    "BID_NOTICE": "https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoServcPPSSrch",
    # 계약과정통합공개서비스 (data.go.kr 15129459)
    # 경로 확인됨: at/ad/무접두는 12(서비스 없음)이나 ao 는 30(서비스키 미등록)을
    # 반환 → ao prefix 가 실재하는 경로. 활용신청 승인 후 바로 동작한다.
    "CONTRACT": "https://apis.data.go.kr/1230000/ao/CntrctInfoService/getCntrctInfoListServcPPSSrch",
}

ENV_ENDPOINT_OVERRIDES = {
    "ORDER_PLAN": "PUBLIC_DATA_G2B_ORDER_PLAN_ENDPOINT",
    "PRE_SPEC": "PUBLIC_DATA_G2B_PRE_SPEC_ENDPOINT",
    "BID_NOTICE": "PUBLIC_DATA_G2B_BID_NOTICE_ENDPOINT",
    "CONTRACT": "PUBLIC_DATA_G2B_CONTRACT_ENDPOINT",
}


class G2BStage(str, Enum):
    ORDER_PLAN = "ORDER_PLAN"  # 발주계획
    PRE_SPEC = "PRE_SPEC"  # 사전규격
    BID_NOTICE = "BID_NOTICE"  # 입찰공고
    CONTRACT = "CONTRACT"  # 계약


# 신규사업(보상 관련) 후보 판별 키워드 — 지시서 기준.
NEW_BUSINESS_KEYWORDS = (
    "보상",
    "손실보상",
    "지장물",
    "기본조사",
    "감정평가",
    "토지조서",
    "물건조서",
    "사업인정",
    "실시계획",
    "공공주택",
    "산업단지",
    "도시개발",
    "도로",
    "철도",
    "측량",
    "보상업무",
)

# 단계 간 연결키 후보(제공 필드에 존재하는 것만 보존).
LINK_KEY_FIELDS = (
    "orderPlanUntyNo",
    "orderPlanNo",
    "bfSpecRgstNo",
    "bidNtceNo",
    "bidNtceOrd",
    "refNo",
    "cntrctNo",
    "untyCntrctNo",
    "dminsttCd",
    "dminsttNm",
)


def classify_keywords(*texts: Optional[str], keywords: tuple[str, ...] = NEW_BUSINESS_KEYWORDS) -> list[str]:
    """제목·품명 등 텍스트에서 일치 키워드 목록을 반환(판정 아님, 후보 표시용)."""
    matched: list[str] = []
    joined = " ".join(t for t in texts if t)
    for keyword in keywords:
        if keyword and keyword in joined and keyword not in matched:
            matched.append(keyword)
    return matched


@dataclass(frozen=True)
class EarlySignal:
    signal_type: str  # 항상 "EARLY_SIGNAL"
    stage: str  # G2BStage
    title: Optional[str]  # 공고명/품명/계약명
    institution: Optional[str]  # 수요기관/발주기관
    region: Optional[str]  # 지역 정보(제공 시)
    notice_date: Optional[str]
    matched_keywords: tuple[str, ...]
    link_keys: Mapping[str, str]  # 발주계획→사전규격→입찰공고→계약 연결키
    detail_url: Optional[str] = None
    review_required: bool = True
    human_review_state: str = "PENDING_HUMAN_REVIEW"
    raw_record_hash: Optional[str] = None


def normalize_g2b_item(stage: G2BStage, item: Mapping[str, Any]) -> EarlySignal:
    title = find_first(
        item,
        "bidNtceNm", "prdctClsfcNoNm", "bfSpecNm", "orderPlanPrdctNm",
        "cntrctNm", "ntceKindNm", "prodNm", "bizNm", "excutTypeNm",
    )
    institution = find_first(item, "dminsttNm", "ntceInsttNm", "orderInsttNm", "cntrctInsttNm", "rlDminsttNm")
    region = find_first(item, "prtcptLmtRgnNm", "rgnNm", "dminsttRgnNm")
    notice_date = find_first(item, "bidNtceDt", "rgstDt", "orderMnth", "cntrctCnclsDate", "specRgstDt")
    link_keys = {
        key: str(item[key]).strip()
        for key in LINK_KEY_FIELDS
        if item.get(key) not in (None, "")
    }
    matched = classify_keywords(
        str(title) if title else None,
        str(find_first(item, "bidNtceDtlUrl", "ntceCont", "specDocCont") or "") or None,
        str(institution) if institution else None,
    )
    return EarlySignal(
        signal_type="EARLY_SIGNAL",
        stage=stage.value,
        title=str(title) if title else None,
        institution=str(institution) if institution else None,
        region=str(region) if region else None,
        notice_date=str(notice_date) if notice_date else None,
        matched_keywords=tuple(matched),
        link_keys=link_keys,
        detail_url=(str(find_first(item, "bidNtceDtlUrl", "specDtlUrl", "cntrctDtlUrl") or "") or None),
        raw_record_hash=raw_hash(dict(item)),
    )


class G2BClient:
    def __init__(
        self,
        provider: PublicDataProvider,
        *,
        endpoints: Mapping[str, str] | None = None,
        page_size: int = 100,
    ):
        self._provider = provider
        self._endpoints = dict(G2B_ENDPOINT_CANDIDATES)
        for stage_name, env_name in ENV_ENDPOINT_OVERRIDES.items():
            override = os.getenv(env_name)
            if override:
                self._endpoints[stage_name] = override
        if endpoints:
            self._endpoints.update(endpoints)
        self._page_size = page_size

    def signals(
        self,
        stage: G2BStage,
        *,
        inqry_bgn_dt: str,
        inqry_end_dt: str,
        page: int = 1,
        keyword_filter: bool = True,
        extra_params: Mapping[str, Any] | None = None,
        project_id: str | None = None,
    ) -> FetchResult:
        """단계별 EARLY_SIGNAL 수집. 조회기간은 YYYYMMDDHHMM 형식.

        keyword_filter=True 면 키워드 일치 신호만 남긴다(불일치분은 버리지 않고
        기록 수만 줄인다 — 판정이 아니라 후보 축소). 실패는 fail-safe.
        """
        endpoint = self._endpoints[stage.value]
        params: dict[str, Any] = {
            "type": "json",
            "inqryDiv": "1",
            "inqryBgnDt": inqry_bgn_dt,
            "inqryEndDt": inqry_end_dt,
            "numOfRows": self._page_size,
            "pageNo": page,
        }
        if extra_params:
            params.update(extra_params)
        try:
            payload = self._provider.get_json(endpoint, params)
            items, total = parse_standard_body(payload, dataset=f"G2B_{stage.value}")
        except ProviderError as exc:
            return FetchResult.failure(exc.code, str(exc), self._meta(stage, endpoint, project_id, None))
        except Exception as exc:  # noqa: BLE001
            return FetchResult.failure(f"G2B_{stage.value}_INTERNAL_ERROR", self._provider.redact(exc), self._meta(stage, endpoint, project_id, None))

        signals = [normalize_g2b_item(stage, item) for item in items]
        if keyword_filter:
            signals = [signal for signal in signals if signal.matched_keywords]
        result = FetchResult(
            ok=True,
            records=signals,
            meta=self._meta(stage, endpoint, project_id, signals),
            status="SUCCESS_REVIEW_REQUIRED" if signals else "REVIEW_REQUIRED",
        )
        if total > page * self._page_size:
            result.status = "PARTIAL"
        return result

    def _meta(self, stage: G2BStage, endpoint: str, project_id: str | None, records: list[EarlySignal] | None) -> SourceMeta:
        return SourceMeta(
            source_dataset=f"G2B_{stage.value}",
            source_provider="조달청 나라장터(공공데이터포털)",
            freshness_grade=FreshnessGrade.DAILY,
            project_id=project_id,
            raw_hash=raw_hash([r.raw_record_hash for r in records]) if records else None,
            review_required=True,
            source_url=endpoint,
            normalization_status="NORMALIZED" if records else None,
            confidence=None if stage.value in VERIFIED_STAGES else "ENDPOINT_UNVERIFIED",
        )


def to_monitoring_rows(signals: list[EarlySignal]) -> list[dict[str, Any]]:
    """신규사업 모니터링 시트 편입용 행 변환(사람 검수 전제).

    기존 모니터링 시트의 상태 구분(완료/진행/보류/변경/확인 필요)과 충돌하지
    않도록 상태는 '확인 필요'로만 넣는다.
    """
    rows: list[dict[str, Any]] = []
    for signal in signals:
        rows.append(
            {
                "구분": "EARLY_SIGNAL",
                "단계": signal.stage,
                "공고명": signal.title,
                "발주기관": signal.institution,
                "지역": signal.region,
                "일자": signal.notice_date,
                "일치키워드": "|".join(signal.matched_keywords),
                "연결키": ";".join(f"{k}={v}" for k, v in signal.link_keys.items()),
                "상세URL": signal.detail_url,
                "상태": "확인 필요",
                "검수": "사람 검수 대기",
            }
        )
    return rows
