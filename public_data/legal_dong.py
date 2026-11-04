"""P0-A. 행정안전부 법정동코드 조회 (행정표준코드 StanReginCd).

용도: 주소 정규화, 시군구/법정동 코드 매핑, 타 API JOIN 기준.

endpoint 는 공공데이터포털 '행정안전부_행정표준코드_법정동코드'
(https://www.data.go.kr/data/15077871/openapi.do) 의 표준 경로를 기본값으로
사용하며, 운영 스펙 변경 시 생성자 인자로 교체할 수 있다.
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
    as_record_list,
    find_first,
    raw_hash,
)

LEGAL_DONG_ENDPOINT = "https://apis.data.go.kr/1741000/StanReginCd/getStanReginCdList"
DATASET = "MOIS_STAN_REGIN_CD"


@dataclass(frozen=True)
class LegalDongRecord:
    region_cd: str  # 10자리 법정동코드
    locatadd_nm: str  # 지역주소명 (예: 서울특별시 강남구 대치동)
    sido_cd: Optional[str] = None
    sgg_cd: Optional[str] = None
    umd_cd: Optional[str] = None
    ri_cd: Optional[str] = None
    is_deleted: bool = False  # 말소(폐지)된 코드 여부

    @property
    def sigungu_cd5(self) -> Optional[str]:
        return self.region_cd[:5] if len(self.region_cd) == 10 else None

    @property
    def bjdong_cd5(self) -> Optional[str]:
        return self.region_cd[5:10] if len(self.region_cd) == 10 else None


def parse_stan_regin_payload(payload: Mapping[str, Any]) -> tuple[list[dict[str, Any]], int]:
    """StanReginCd 특유의 envelope 파싱.

    형태: {"StanReginCd": [{"head": [{"totalCount": n}, {"RESULT": {...}}]}, {"row": [...]}]}
    데이터 없음: {"RESULT": {"resultCode": "INFO-200", ...}} 또는 row 부재.
    """
    result = payload.get("RESULT")
    if isinstance(result, Mapping):
        code = str(result.get("resultCode") or "")
        if code == "INFO-200":  # 해당하는 데이터가 없습니다
            return [], 0
        if code not in ("INFO-0", "INFO-00", ""):
            raise ProviderError(f"{DATASET}_API_ERROR", f"StanReginCd error resultCode={code}")

    root = payload.get("StanReginCd")
    if not isinstance(root, list):
        raise ProviderError(f"{DATASET}_SCHEMA_CHANGED", "StanReginCd root array was not found")

    total = 0
    rows: list[dict[str, Any]] = []
    for part in root:
        if not isinstance(part, Mapping):
            continue
        head = part.get("head")
        if isinstance(head, list):
            for head_item in head:
                if isinstance(head_item, Mapping):
                    if "totalCount" in head_item:
                        try:
                            total = int(str(head_item["totalCount"]))
                        except (TypeError, ValueError):
                            total = 0
                    result = head_item.get("RESULT")
                    if isinstance(result, Mapping):
                        code = str(result.get("resultCode") or "")
                        if code == "INFO-200":
                            return [], 0
                        if code not in ("INFO-0", "INFO-00", ""):
                            raise ProviderError(
                                f"{DATASET}_API_ERROR", f"StanReginCd error resultCode={code}"
                            )
        if "row" in part:
            rows.extend(as_record_list(part.get("row")))
    return rows, total or len(rows)


def normalize_row(row: Mapping[str, Any]) -> LegalDongRecord | None:
    region_cd = str(find_first(row, "region_cd", "regionCd") or "").strip()
    name = str(find_first(row, "locatadd_nm", "locataddNm") or "").strip()
    if not re.fullmatch(r"\d{10}", region_cd) or not name:
        return None
    return LegalDongRecord(
        region_cd=region_cd,
        locatadd_nm=name,
        sido_cd=str(find_first(row, "sido_cd", "sidoCd") or "") or None,
        sgg_cd=str(find_first(row, "sgg_cd", "sggCd") or "") or None,
        umd_cd=str(find_first(row, "umd_cd", "umdCd") or "") or None,
        ri_cd=str(find_first(row, "ri_cd", "riCd") or "") or None,
    )


def build_pnu(region_cd: str, *, mountain: bool, bun: int, ji: int = 0) -> str:
    """법정동코드(10) + 대장구분(1:일반, 2:산) + 본번(4) + 부번(4) = PNU 19자리."""
    if not re.fullmatch(r"\d{10}", region_cd or ""):
        raise ProviderError("PNU_BUILD_INVALID_REGION", "region_cd must be 10 digits")
    if not (0 < int(bun) <= 9999) or not (0 <= int(ji) <= 9999):
        raise ProviderError("PNU_BUILD_INVALID_LOT", "bun must be 1..9999 and ji 0..9999")
    gubun = "2" if mountain else "1"
    return f"{region_cd}{gubun}{int(bun):04d}{int(ji):04d}"


class LegalDongCodeClient:
    def __init__(
        self,
        provider: PublicDataProvider,
        *,
        endpoint: str = LEGAL_DONG_ENDPOINT,
        page_size: int = 100,
    ):
        self._provider = provider
        self._endpoint = endpoint
        self._page_size = page_size

    def _meta(self, records: list[Any]) -> SourceMeta:
        return SourceMeta(
            source_dataset=DATASET,
            source_provider="행정안전부(공공데이터포털)",
            freshness_grade=FreshnessGrade.PERIODIC,
            raw_hash=raw_hash([r.__dict__ for r in records]) if records else None,
            review_required=True,
            source_url=self._endpoint,
            normalization_status="NORMALIZED",
        )

    def search(self, address_name: str, *, page: int = 1) -> FetchResult:
        """지역주소명(부분일치)으로 법정동코드 조회. fail-safe."""
        try:
            payload = self._provider.get_json(
                self._endpoint,
                {
                    "type": "json",
                    "pageNo": page,
                    "numOfRows": self._page_size,
                    "flag": "Y",
                    "locatadd_nm": address_name,
                },
            )
            rows, _total = parse_stan_regin_payload(payload)
        except ProviderError as exc:
            return FetchResult.failure(exc.code, str(exc))
        except Exception as exc:  # noqa: BLE001
            return FetchResult.failure("LEGAL_DONG_INTERNAL_ERROR", self._provider.redact(exc))

        records = [record for record in (normalize_row(row) for row in rows) if record]
        return FetchResult(
            ok=True,
            records=records,
            meta=self._meta(records),
            status="SUCCESS_REVIEW_REQUIRED" if records else "REVIEW_REQUIRED",
        )

    def resolve_exact(self, address_name: str) -> FetchResult:
        """정확히 일치하는 법정동 1건만 확정 후보로. 복수/0건이면 review 로 남긴다."""
        result = self.search(address_name)
        if not result.ok:
            return result
        exact = [r for r in result.records if r.locatadd_nm == address_name.strip()]
        if len(exact) == 1:
            return FetchResult(ok=True, records=exact, meta=result.meta, status="SUCCESS_REVIEW_REQUIRED")
        code = "LEGAL_DONG_NOT_FOUND" if not exact else "LEGAL_DONG_MULTIPLE_CANDIDATES"
        failure = FetchResult.failure(code, f"exact match count={len(exact)} for review", result.meta)
        failure.records = result.records  # 후보는 사람 검수용으로 보존
        return failure
