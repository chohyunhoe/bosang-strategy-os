"""P0-C(2). 한국산업단지공단 FactoryOn 공장등록 조회.

- 공장등록 필지정보조회서비스 (data.go.kr 15087615)
- 공장등록 생산정보조회서비스 (data.go.kr 15087611)

**조회 모델 (공식 명세 기준, 2026-08-19 확인)**

필지정보는 지역 전체조회가 아니라 **회사명(cmpnyNm) 필수**의 단건 조회 API다.

    GET /B550624/fctryRegistLndpclInfo/getFctryLndpclService
    필수: serviceKey, cmpnyNm
    선택: pageNo, numOfRows, fctryManageNo, rprsntvNm

따라서 이 어댑터는 "사업지구 내 공장 전체를 훑는" 용도로 쓸 수 없다.
현장후보 발굴은 상가(상권)정보의 폴리곤/반경 조회로 하고, FactoryOn 은
**이미 확보한 회사명·공장관리번호를 보강·확인**하는 용도로 쓴다.

생산정보 endpoint 는 공식 명세를 아직 확보하지 못했으므로 미검증 상태로 둔다
(confidence=ENDPOINT_UNVERIFIED). 실패는 모두 fail-safe(PARTIAL)로 처리된다.
"""

from __future__ import annotations

import os
import re
from collections.abc import Mapping
from dataclasses import dataclass
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
from .legal_dong import build_pnu

# 필지정보: 공식 명세로 확인된 요청주소(2026-08-19). 실호출 검증은 별도.
FACTORY_PARCEL_ENDPOINT = "https://apis.data.go.kr/B550624/fctryRegistLndpclInfo/getFctryLndpclService"
# 생산정보: 공식 명세 미확보. 서비스 기본 경로만 알고 오퍼레이션은 미확정.
FACTORY_PROD_ENDPOINT_CANDIDATE = "https://apis.data.go.kr/B550624/fctryRegistInfo"

# 실호출로 정상 응답을 확인한 데이터셋만 여기 넣는다.
# 2026-08-19 확인: 필지정보 cmpnyNm 조회 정상(totalCount=14).
VERIFIED_DATASETS: frozenset[str] = frozenset({"KICOX_FACTORY_PARCEL"})

# 하위호환 별칭(기존 import 보호).
FACTORY_PARCEL_ENDPOINT_CANDIDATE = FACTORY_PARCEL_ENDPOINT
ENDPOINT_VERIFIED = False

DATASET_PROD = "KICOX_FACTORY_PRODUCT"
DATASET_PARCEL = "KICOX_FACTORY_PARCEL"


@dataclass(frozen=True)
class FactoryRecord:
    """공장등록 생산정보 정규화 레코드."""

    factory_name: Optional[str]  # 공장명
    company_name: Optional[str]  # 회사명
    industry_cd: Optional[str]  # 업종코드
    industry_nm: Optional[str]  # 업종명
    products: Optional[str]  # 생산품
    road_address: Optional[str]
    jibun_address: Optional[str]
    sigungu_nm: Optional[str] = None
    registration_type: Optional[str] = None  # 등록구분(공개 필드 범위 내)
    raw_record_hash: Optional[str] = None


@dataclass(frozen=True)
class FactoryParcelRecord:
    """공장등록 필지정보 정규화 레코드(공장↔필지 연결, PNU 변환 후보)."""

    factory_key: Optional[str]  # 공장관리번호 등 연결키(제공 필드에 따름)
    company_name: Optional[str]
    jibun_address: Optional[str]
    legal_dong_cd: Optional[str]  # 법정동코드(10) 확보 시
    mountain: Optional[bool]
    bun: Optional[int]
    ji: Optional[int]
    pnu_candidate: Optional[str]
    raw_record_hash: Optional[str] = None


def _first_str(item: Mapping[str, Any], *keys: str) -> Optional[str]:
    value = find_first(item, *keys)
    return None if value in (None, "") else str(value).strip()


def normalize_factory_item(item: Mapping[str, Any]) -> FactoryRecord:
    return FactoryRecord(
        factory_name=_first_str(item, "factoryNm", "fctryNm", "공장명"),
        company_name=_first_str(item, "cmpnyNm", "companyNm", "회사명"),
        industry_cd=_first_str(item, "indutyCd", "indsCd", "업종코드"),
        industry_nm=_first_str(item, "indutyNm", "indsNm", "업종명"),
        products=_first_str(item, "prdct", "product", "생산품"),
        road_address=_first_str(item, "rnAdres", "rdnmAdr", "도로명주소"),
        jibun_address=_first_str(item, "adres", "lnmAdres", "지번주소"),
        sigungu_nm=_first_str(item, "signguNm", "sigunguNm"),
        registration_type=_first_str(item, "registSe", "registSeNm", "등록구분"),
        raw_record_hash=raw_hash(dict(item)),
    )


_LOT_PATTERN = re.compile(r"^(산)?\s*(\d{1,4})(?:-(\d{1,4}))?$")


def parse_lot_number(value: str | None) -> tuple[Optional[bool], Optional[int], Optional[int]]:
    """'산 3-1' / '123-4' / '77' → (산 여부, 본번, 부번). 해석 불가면 (None, None, None)."""
    if not value:
        return (None, None, None)
    match = _LOT_PATTERN.match(str(value).strip())
    if not match:
        return (None, None, None)
    mountain = match.group(1) == "산"
    bun = int(match.group(2))
    ji = int(match.group(3)) if match.group(3) else 0
    return (mountain, bun, ji)


def normalize_parcel_item(item: Mapping[str, Any]) -> FactoryParcelRecord:
    legal_dong_cd = _first_str(item, "ldongCd", "bjdongCd", "legalDongCd", "법정동코드")
    lot_raw = _first_str(item, "lnbr", "jibun", "lotNo", "지번")
    mountain, bun, ji = parse_lot_number(lot_raw)
    pnu_candidate: Optional[str] = None
    if legal_dong_cd and re.fullmatch(r"\d{10}", legal_dong_cd) and bun is not None and mountain is not None:
        try:
            pnu_candidate = build_pnu(legal_dong_cd, mountain=mountain, bun=bun, ji=ji or 0)
        except ProviderError:
            pnu_candidate = None
    return FactoryParcelRecord(
        factory_key=_first_str(item, "factoryMngNo", "fctryMngNo", "mngNo", "공장관리번호"),
        company_name=_first_str(item, "cmpnyNm", "companyNm", "회사명"),
        jibun_address=_first_str(item, "adres", "lnmAdres", "지번주소"),
        legal_dong_cd=legal_dong_cd if legal_dong_cd and re.fullmatch(r"\d{10}", legal_dong_cd) else None,
        mountain=mountain,
        bun=bun,
        ji=ji,
        pnu_candidate=pnu_candidate,
        raw_record_hash=raw_hash(dict(item)),
    )


class FactoryOnClient:
    def __init__(
        self,
        provider: PublicDataProvider,
        *,
        product_endpoint: str | None = None,
        parcel_endpoint: str | None = None,
        page_size: int = 100,
    ):
        self._provider = provider
        self._product_endpoint = (
            product_endpoint
            or os.getenv("PUBLIC_DATA_FACTORYON_PROD_ENDPOINT")
            or FACTORY_PROD_ENDPOINT_CANDIDATE
        )
        self._parcel_endpoint = (
            parcel_endpoint
            or os.getenv("PUBLIC_DATA_FACTORYON_PARCEL_ENDPOINT")
            or FACTORY_PARCEL_ENDPOINT
        )
        self._page_size = page_size

    def _fetch(self, endpoint: str, dataset: str, params: dict[str, Any], normalize, *, project_id: str | None, page: int) -> FetchResult:
        try:
            query = {"type": "json", "_type": "json", "numOfRows": self._page_size, "pageNo": page}
            query.update(params)
            payload = self._provider.get_json(endpoint, query)
            items, total = parse_standard_body(payload, dataset=dataset)
        except ProviderError as exc:
            return FetchResult.failure(exc.code, str(exc), self._meta(dataset, endpoint, project_id, None))
        except Exception as exc:  # noqa: BLE001
            return FetchResult.failure(f"{dataset}_INTERNAL_ERROR", self._provider.redact(exc), self._meta(dataset, endpoint, project_id, None))

        records = [normalize(item) for item in items]
        result = FetchResult(
            ok=True,
            records=records,
            meta=self._meta(dataset, endpoint, project_id, records),
            status="SUCCESS_REVIEW_REQUIRED" if records else "REVIEW_REQUIRED",
        )
        if total > page * self._page_size:
            result.status = "PARTIAL"
        return result

    def parcels_by_company(
        self,
        company_name: str,
        *,
        factory_manage_no: str | None = None,
        representative_name: str | None = None,
        page: int = 1,
        project_id: str | None = None,
        extra_params: Mapping[str, Any] | None = None,
    ) -> FetchResult:
        """공장등록 필지정보 조회. 공식 명세상 ``cmpnyNm`` 이 필수다."""
        if not (company_name or "").strip():
            return FetchResult.failure(
                "FACTORYON_COMPANY_NAME_REQUIRED",
                "필지정보 조회는 회사명(cmpnyNm)이 필수입니다.",
                self._meta(DATASET_PARCEL, self._parcel_endpoint, project_id, None),
            )
        params: dict[str, Any] = {"cmpnyNm": company_name.strip()}
        if factory_manage_no:
            params["fctryManageNo"] = factory_manage_no
        if representative_name:
            params["rprsntvNm"] = representative_name
        if extra_params:
            params.update(extra_params)
        return self._fetch(
            self._parcel_endpoint, DATASET_PARCEL, params, normalize_parcel_item,
            project_id=project_id, page=page,
        )

    def factories_by_company(
        self,
        company_name: str,
        *,
        page: int = 1,
        project_id: str | None = None,
        extra_params: Mapping[str, Any] | None = None,
    ) -> FetchResult:
        """공장등록 생산정보 조회. endpoint·파라미터 명세 미확보 상태이므로
        실패해도 fail-safe 로만 처리된다(confidence=ENDPOINT_UNVERIFIED)."""
        if not (company_name or "").strip():
            return FetchResult.failure(
                "FACTORYON_COMPANY_NAME_REQUIRED",
                "생산정보 조회는 회사명(cmpnyNm)이 필수입니다.",
                self._meta(DATASET_PROD, self._product_endpoint, project_id, None),
            )
        params: dict[str, Any] = {"cmpnyNm": company_name.strip()}
        if extra_params:
            params.update(extra_params)
        return self._fetch(
            self._product_endpoint, DATASET_PROD, params, normalize_factory_item,
            project_id=project_id, page=page,
        )

    # 지역 전체조회는 이 API 의 제공 모델이 아니다 — 조용히 잘못된 조회를 보내지 않는다.
    def parcels_by_region(self, *_args: Any, **_kwargs: Any) -> FetchResult:
        return self._region_unsupported(DATASET_PARCEL, self._parcel_endpoint)

    def factories_by_region(self, *_args: Any, **_kwargs: Any) -> FetchResult:
        return self._region_unsupported(DATASET_PROD, self._product_endpoint)

    def _region_unsupported(self, dataset: str, endpoint: str) -> FetchResult:
        return FetchResult.failure(
            "FACTORYON_REGION_QUERY_UNSUPPORTED",
            "FactoryOn 은 지역 단위 전체조회를 제공하지 않습니다(회사명 필수). "
            "현장후보 발굴은 상가정보 폴리곤/반경 조회로 하고, FactoryOn 은 "
            "확보된 회사명·공장관리번호 보강에 사용하세요.",
            self._meta(dataset, endpoint, None, None),
        )

    def _meta(self, dataset: str, endpoint: str, project_id: str | None, records: list[Any] | None) -> SourceMeta:
        return SourceMeta(
            source_dataset=dataset,
            source_provider="한국산업단지공단 FactoryOn(공공데이터포털)",
            freshness_grade=FreshnessGrade.PERIODIC,
            project_id=project_id,
            raw_hash=raw_hash([r.raw_record_hash for r in records]) if records else None,
            review_required=True,
            source_url=endpoint,
            normalization_status="NORMALIZED" if records else None,
            confidence=None if dataset in VERIFIED_DATASETS else "ENDPOINT_UNVERIFIED",
        )
