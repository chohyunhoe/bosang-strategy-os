"""P0-C(1). 소상공인시장진흥공단 상가(상권)정보 (B553077 sdsc2).

현장후보 선별용. 주유소에 한정하지 않고 업종 전반을 수집할 수 있는 구조.
활용 필드: 상호, 업종 대/중/소, 표준산업분류, 도로명/지번주소, 위경도.

2026-08-19 실호출로 확인된 제약:
- 이 API 는 XML 만 반환한다. ``type=json`` 을 붙이면 응답이 깨진다.
- ``storeListInDong`` 의 divId 는 ctprvnCd(시도)/signguCd(시군구)/adongCd(행정동)
  만 허용한다. **법정동코드(ldongCd)는 미지원**이며 resultCode=10
  (INVALID_REQUEST_PARAMETER)로 거절된다.
- 따라서 법정동 기준 수집은 (1) 시군구 단위 수집 후 사업지구 경계·좌표로 필터,
  (2) PNU 단위 조회(storeListInPnu), (3) 반경/폴리곤 조회 경로를 사용한다.
"""

from __future__ import annotations

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
    parse_standard_xml_body,
    raw_hash,
)

STORE_BASE = "https://apis.data.go.kr/B553077/api/open/sdsc2"
DATASET = "SEMAS_STORE_INFO"


@dataclass(frozen=True)
class StoreRecord:
    bizes_id: Optional[str]
    name: Optional[str]  # 상호(bizesNm)
    branch_name: Optional[str]
    category_large_cd: Optional[str]
    category_large_nm: Optional[str]
    category_medium_cd: Optional[str]
    category_medium_nm: Optional[str]
    category_small_cd: Optional[str]
    category_small_nm: Optional[str]
    ksic_cd: Optional[str]  # 표준산업분류
    ksic_nm: Optional[str]
    road_address: Optional[str]  # rdnmAdr
    jibun_address: Optional[str]  # lnoAdr
    lon: Optional[float]
    lat: Optional[float]
    ldong_cd: Optional[str]  # 법정동코드(10)
    adong_cd: Optional[str]  # 행정동코드
    pnu_candidate: Optional[str]  # lnoCd 가 19자리면 PNU 후보
    floor_no: Optional[str] = None
    raw_record_hash: Optional[str] = None


def _f(value: Any) -> Optional[float]:
    try:
        return float(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def normalize_store_item(item: Mapping[str, Any]) -> StoreRecord:
    lno_cd = str(find_first(item, "lnoCd") or "")
    return StoreRecord(
        bizes_id=(str(find_first(item, "bizesId") or "") or None),
        name=(str(find_first(item, "bizesNm") or "") or None),
        branch_name=(str(find_first(item, "brchNm") or "") or None),
        category_large_cd=(str(find_first(item, "indsLclsCd") or "") or None),
        category_large_nm=(str(find_first(item, "indsLclsNm") or "") or None),
        category_medium_cd=(str(find_first(item, "indsMclsCd") or "") or None),
        category_medium_nm=(str(find_first(item, "indsMclsNm") or "") or None),
        category_small_cd=(str(find_first(item, "indsSclsCd") or "") or None),
        category_small_nm=(str(find_first(item, "indsSclsNm") or "") or None),
        ksic_cd=(str(find_first(item, "ksicCd") or "") or None),
        ksic_nm=(str(find_first(item, "ksicNm") or "") or None),
        road_address=(str(find_first(item, "rdnmAdr") or "") or None),
        jibun_address=(str(find_first(item, "lnoAdr") or "") or None),
        lon=_f(find_first(item, "lon")),
        lat=_f(find_first(item, "lat")),
        ldong_cd=(str(find_first(item, "ldongCd") or "") or None),
        adong_cd=(str(find_first(item, "adongCd") or "") or None),
        pnu_candidate=lno_cd if re.fullmatch(r"\d{19}", lno_cd) else None,
        floor_no=(str(find_first(item, "flrNo") or "") or None),
        raw_record_hash=raw_hash(dict(item)),
    )


class StoreInfoClient:
    def __init__(self, provider: PublicDataProvider, *, base_endpoint: str = STORE_BASE, page_size: int = 500):
        self._provider = provider
        self._base = base_endpoint.rstrip("/")
        self._page_size = page_size

    def _fetch(self, op: str, params: dict[str, Any], *, project_id: str | None, page: int) -> FetchResult:
        try:
            # 이 API 는 XML 전용이다. type=json 을 붙이면 응답이 깨지므로 넣지 않는다.
            query = {"numOfRows": self._page_size, "pageNo": page}
            query.update(params)
            text = self._provider.get_text(f"{self._base}/{op}", query)
            items, total = parse_standard_xml_body(text, dataset=DATASET)
        except ProviderError as exc:
            return FetchResult.failure(exc.code, str(exc), self._meta(project_id, None))
        except Exception as exc:  # noqa: BLE001
            return FetchResult.failure("STORE_INFO_INTERNAL_ERROR", self._provider.redact(exc), self._meta(project_id, None))

        records = [normalize_store_item(item) for item in items]
        result = FetchResult(
            ok=True,
            records=records,
            meta=self._meta(project_id, records),
            status="SUCCESS_REVIEW_REQUIRED" if records else "REVIEW_REQUIRED",
        )
        if total > page * self._page_size:
            result.status = "PARTIAL"  # 다음 페이지 존재
        return result

    SUPPORTED_DIV_IDS = ("ctprvnCd", "signguCd", "adongCd")

    def stores_in_legal_dong(self, ldong_cd: str, *, page: int = 1, project_id: str | None = None) -> FetchResult:
        """미지원 경로 — fail-closed.

        상가정보 API 는 법정동코드를 divId 로 받지 않는다(실호출 확인:
        resultCode=10). 잘못된 조회를 조용히 보내지 않고 대체 경로를 안내한다.
        """
        return FetchResult.failure(
            "STORE_LEGAL_DONG_UNSUPPORTED",
            "상가정보 API 는 법정동코드 조회를 지원하지 않습니다. "
            "stores_in_sigungu / stores_in_admin_dong / stores_in_pnu / stores_in_polygon 을 사용하세요.",
            self._meta(project_id, None),
        )

    def stores_in_sigungu(self, sigungu_cd: str, *, page: int = 1, project_id: str | None = None) -> FetchResult:
        """시군구 코드(5자리) 단위 상가업소 조회. 사업지구 수집의 기본 경로."""
        return self._fetch("storeListInDong", {"divId": "signguCd", "key": sigungu_cd}, project_id=project_id, page=page)

    def stores_in_admin_dong(self, adong_cd: str, *, page: int = 1, project_id: str | None = None) -> FetchResult:
        """행정동 코드 단위 조회. 법정동이 아니라 행정동 코드임에 주의."""
        return self._fetch("storeListInDong", {"divId": "adongCd", "key": adong_cd}, project_id=project_id, page=page)

    def stores_in_pnu(self, pnu: str, *, page: int = 1, project_id: str | None = None) -> FetchResult:
        if not re.fullmatch(r"\d{19}", pnu or ""):
            return FetchResult.failure("PNU_INVALID", "PNU must be exactly 19 digits")
        return self._fetch("storeListInPnu", {"key": pnu}, project_id=project_id, page=page)

    def stores_in_radius(self, *, cx: float, cy: float, radius_m: int, page: int = 1, project_id: str | None = None) -> FetchResult:
        return self._fetch(
            "storeListInRadius",
            {"radius": radius_m, "cx": cx, "cy": cy},
            project_id=project_id,
            page=page,
        )

    def stores_in_polygon(self, wkt_polygon: str, *, page: int = 1, project_id: str | None = None) -> FetchResult:
        """사업지구 경계 폴리곤(WKT, EPSG:4326) 내 상가업소 조회."""
        return self._fetch("storeListInPolygon", {"key": wkt_polygon}, project_id=project_id, page=page)

    def _meta(self, project_id: str | None, records: list[StoreRecord] | None) -> SourceMeta:
        return SourceMeta(
            source_dataset=DATASET,
            source_provider="소상공인시장진흥공단(공공데이터포털)",
            freshness_grade=FreshnessGrade.SNAPSHOT,  # 분기 단위 갱신 이력: 실시간 아님
            project_id=project_id,
            raw_hash=raw_hash([r.raw_record_hash for r in records]) if records else None,
            review_required=True,
            source_url=self._base,
            normalization_status="NORMALIZED" if records else None,
        )
