"""Phase 2. 국토교통부 매매 실거래가 3종 → '거래사례 후보' 생성 전용.

- 토지: RTMSDataSvcLandTrade
- 공장·창고 등(산업용): RTMSDataSvcInduTrade
- 상업업무용: RTMSDataSvcNrgTrade

금지: 자동 비교사례 확정. 모든 후보는 review_required=True 로 생성되며
감정평가상 비교사례 선정·보정은 전문가 판단 사항이다.

응답은 XML 기본이므로 ElementTree 로 파싱한다. 공개범위 제한(지번 일부 비공개
등)은 제공 필드 그대로 두고 보완 생성하지 않는다.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from enum import Enum
from typing import Optional

from .core import (
    FetchResult,
    FreshnessGrade,
    ProviderError,
    PublicDataProvider,
    SourceMeta,
    raw_hash,
    redact_secrets,
)

RTMS_ENDPOINTS = {
    "LAND": "https://apis.data.go.kr/1613000/RTMSDataSvcLandTrade/getRTMSDataSvcLandTrade",
    "INDUSTRIAL": "https://apis.data.go.kr/1613000/RTMSDataSvcInduTrade/getRTMSDataSvcInduTrade",
    "COMMERCIAL": "https://apis.data.go.kr/1613000/RTMSDataSvcNrgTrade/getRTMSDataSvcNrgTrade",
}


class RtmsTradeType(str, Enum):
    LAND = "LAND"  # 토지 매매
    INDUSTRIAL = "INDUSTRIAL"  # 공장 및 창고 등
    COMMERCIAL = "COMMERCIAL"  # 상업업무용


@dataclass(frozen=True)
class TradeCandidate:
    """거래사례 '후보' 레코드. 비교사례 확정값이 아니다."""

    trade_type: str
    sigungu_cd: Optional[str]  # LAWD_CD 5자리
    sigungu_nm: Optional[str]
    legal_dong_nm: Optional[str]  # 법정동(공개범위 내)
    contract_date: Optional[str]  # YYYY-MM-DD
    land_category: Optional[str] = None  # 지목(토지)
    zoning: Optional[str] = None  # 용도지역
    building_use: Optional[str] = None  # 건물주용도(공장/상업)
    land_area_m2: Optional[float] = None
    building_area_m2: Optional[float] = None
    deal_amount_won: Optional[int] = None  # 거래금액(원)
    unit_price_won_m2: Optional[float] = None  # 단가 계산 가능 시(토지면적 기준)
    unit_price_basis: Optional[str] = None  # 단가 산정 기준 설명
    share_dealing: Optional[str] = None  # 지분거래 여부(제공 시)
    is_building_included: Optional[bool] = None
    review_required: bool = True
    raw_record_hash: Optional[str] = None


def _text(node: ET.Element, *tags: str) -> Optional[str]:
    for tag in tags:
        found = node.findtext(tag)
        if found is not None and str(found).strip() != "":
            return str(found).strip()
    return None


def _to_float(value: Optional[str]) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        return float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None


def _amount_won(value: Optional[str]) -> Optional[int]:
    """거래금액(만원, 콤마 포함) → 원. 해석 불가 시 None."""
    if value in (None, ""):
        return None
    try:
        return int(str(value).replace(",", "").strip()) * 10_000
    except (TypeError, ValueError):
        return None


def _contract_date(node: ET.Element) -> Optional[str]:
    year = _text(node, "dealYear")
    month = _text(node, "dealMonth")
    day = _text(node, "dealDay")
    if not (year and month and day):
        return None
    try:
        return f"{int(year):04d}-{int(month):02d}-{int(day):02d}"
    except (TypeError, ValueError):
        return None


def normalize_trade_item(trade_type: RtmsTradeType, node: ET.Element) -> TradeCandidate:
    land_area = _to_float(_text(node, "dealArea", "landAr", "plottageAr"))
    building_area = _to_float(_text(node, "buildingAr", "totalFloorAr"))
    amount = _amount_won(_text(node, "dealAmount"))

    unit_price: Optional[float] = None
    unit_basis: Optional[str] = None
    if amount is not None:
        if trade_type is RtmsTradeType.LAND and land_area and land_area > 0:
            unit_price = amount / land_area
            unit_basis = "거래금액(원)/토지면적(㎡) — 검토 보조 단가, 확정값 아님"
        elif trade_type is not RtmsTradeType.LAND and building_area and building_area > 0:
            unit_price = amount / building_area
            unit_basis = "거래금액(원)/건물연면적(㎡) — 토지·건물 일괄거래 단가, 확정값 아님"

    raw = {child.tag: (child.text or "").strip() for child in node}
    return TradeCandidate(
        trade_type=trade_type.value,
        sigungu_cd=_text(node, "sggCd", "regionalCd"),
        sigungu_nm=_text(node, "sggNm", "sigunguNm"),
        legal_dong_nm=_text(node, "umdNm", "dongNm", "legalDongNm"),
        contract_date=_contract_date(node),
        land_category=_text(node, "jimok", "landCategory"),
        zoning=_text(node, "landUse", "useArea", "zoning"),
        building_use=_text(node, "buildingUse", "mainPurps"),
        land_area_m2=land_area,
        building_area_m2=building_area,
        deal_amount_won=amount,
        unit_price_won_m2=unit_price,
        unit_price_basis=unit_basis,
        share_dealing=_text(node, "shareDealingType", "dealingGbn"),
        is_building_included=None if trade_type is RtmsTradeType.LAND else True,
        review_required=True,
        raw_record_hash=raw_hash(raw),
    )


def parse_rtms_xml(trade_type: RtmsTradeType, text: str) -> tuple[list[TradeCandidate], int]:
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        raise ProviderError("RTMS_RESPONSE_ERROR", "RTMS response is not valid XML") from None

    result_code = (root.findtext(".//resultCode") or "").strip()
    if result_code not in ("", "0", "00", "000"):
        message = (root.findtext(".//resultMsg") or "RTMS non-success result").strip()
        raise ProviderError("RTMS_API_ERROR", redact_secrets(f"{message} (resultCode={result_code})"))

    items = root.findall(".//item")
    total_raw = (root.findtext(".//totalCount") or "").strip()
    try:
        total = int(total_raw) if total_raw else len(items)
    except ValueError:
        total = len(items)
    return [normalize_trade_item(trade_type, node) for node in items], total


class RtmsTradeClient:
    def __init__(self, provider: PublicDataProvider, *, endpoints: dict[str, str] | None = None, page_size: int = 200):
        self._provider = provider
        self._endpoints = dict(RTMS_ENDPOINTS)
        if endpoints:
            self._endpoints.update(endpoints)
        self._page_size = page_size

    def trade_candidates(
        self,
        trade_type: RtmsTradeType,
        *,
        lawd_cd: str,
        deal_ymd: str,
        page: int = 1,
        project_id: str | None = None,
    ) -> FetchResult:
        """지역(LAWD_CD 5자리)·계약월(YYYYMM) 기준 거래사례 후보 생성. fail-safe."""
        endpoint = self._endpoints[trade_type.value]
        if not re.fullmatch(r"\d{5}", lawd_cd or ""):
            return FetchResult.failure("RTMS_LAWD_CD_INVALID", "LAWD_CD must be 5 digits", self._meta(trade_type, endpoint, project_id, None, deal_ymd))
        if not re.fullmatch(r"\d{6}", deal_ymd or ""):
            return FetchResult.failure("RTMS_DEAL_YMD_INVALID", "DEAL_YMD must be YYYYMM", self._meta(trade_type, endpoint, project_id, None, deal_ymd))
        try:
            text = self._provider.get_text(
                endpoint,
                {"LAWD_CD": lawd_cd, "DEAL_YMD": deal_ymd, "numOfRows": self._page_size, "pageNo": page},
            )
            records, total = parse_rtms_xml(trade_type, text)
        except ProviderError as exc:
            return FetchResult.failure(exc.code, str(exc), self._meta(trade_type, endpoint, project_id, None, deal_ymd))
        except Exception as exc:  # noqa: BLE001
            return FetchResult.failure("RTMS_INTERNAL_ERROR", self._provider.redact(exc), self._meta(trade_type, endpoint, project_id, None, deal_ymd))

        result = FetchResult(
            ok=True,
            records=records,
            meta=self._meta(trade_type, endpoint, project_id, records, deal_ymd),
            status="SUCCESS_REVIEW_REQUIRED" if records else "REVIEW_REQUIRED",
        )
        if total > page * self._page_size:
            result.status = "PARTIAL"
        return result

    def _meta(self, trade_type: RtmsTradeType, endpoint: str, project_id: str | None, records: list[TradeCandidate] | None, deal_ymd: str | None) -> SourceMeta:
        return SourceMeta(
            source_dataset=f"MOLIT_RTMS_{trade_type.value}",
            source_provider="국토교통부 실거래가(공공데이터포털)",
            freshness_grade=FreshnessGrade.PERIODIC,  # 신고·정정 반영 지연 존재: 실시간 아님
            effective_date=deal_ymd,
            project_id=project_id,
            raw_hash=raw_hash([r.raw_record_hash for r in records]) if records else None,
            review_required=True,
            source_url=endpoint,
            normalization_status="NORMALIZED" if records else None,
        )
