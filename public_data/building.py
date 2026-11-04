"""P0-B. 국토교통부 건축HUB 건축물대장정보 (BldRgstHubService).

우선 엔드포인트: 기본개요, 표제부, 총괄표제부, 층별개요, 부속지번, 지역지구구역.

보상전략 OS 적용: 평가서 기재사항과 공적자료(건축물대장) 교차검증 후보 제공.
자동 법률·감정평가 판단은 하지 않으며, 불일치는 Flag(REVIEW_REQUIRED)로만 남긴다.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
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

BUILDING_HUB_BASE = "https://apis.data.go.kr/1613000/BldRgstHubService"
DATASET = "MOLIT_BLD_RGST_HUB"


class BuildingLedgerOp(str, Enum):
    BASIS = "getBrBasisOulnInfo"  # 기본개요
    TITLE = "getBrTitleInfo"  # 표제부
    RECAP_TITLE = "getBrRecapTitleInfo"  # 총괄표제부
    FLOOR = "getBrFlrOulnInfo"  # 층별개요
    ATTACHED_JIBUN = "getBrAtchJibunInfo"  # 부속지번
    JIJIGU = "getBrJijiguInfo"  # 지역지구구역


def pnu_to_ledger_params(pnu: str) -> dict[str, str]:
    """PNU(19자리) → 건축물대장 조회 파라미터.

    PNU = 법정동코드(10) + 필지구분(1: 일반 '1', 산 '2') + 본번(4) + 부번(4)
    건축물대장 platGbCd: 0=대지, 1=산, 2=블록.
    """
    if not re.fullmatch(r"\d{19}", pnu or ""):
        raise ProviderError("PNU_INVALID", "PNU must be exactly 19 digits")
    gubun = pnu[10]
    if gubun == "1":
        plat_gb = "0"
    elif gubun == "2":
        plat_gb = "1"
    else:
        raise ProviderError("PNU_INVALID", "PNU parcel-type digit must be 1 or 2")
    return {
        "sigunguCd": pnu[:5],
        "bjdongCd": pnu[5:10],
        "platGbCd": plat_gb,
        "bun": pnu[11:15],
        "ji": pnu[15:19],
    }


@dataclass(frozen=True)
class BuildingRecord:
    """건축물대장 공통 정규화 레코드(오퍼레이션별 원본 필드는 raw_hash 로 대조)."""

    op: str
    mgm_bldrgst_pk: Optional[str]  # 관리건축물대장PK (오퍼레이션간 연결키)
    plat_plc: Optional[str]  # 대지위치(지번주소)
    new_plat_plc: Optional[str]  # 도로명대지위치
    bld_nm: Optional[str]
    main_purps_nm: Optional[str]  # 주용도
    etc_purps: Optional[str]
    tot_area: Optional[float]  # 연면적(㎡)
    arch_area: Optional[float]  # 건축면적(㎡)
    grnd_flr_cnt: Optional[int]  # 지상층수
    ugrnd_flr_cnt: Optional[int]  # 지하층수
    flr_no: Optional[int] = None  # 층별개요: 층번호
    flr_gb_nm: Optional[str] = None  # 층별개요: 지상/지하
    atch_bun: Optional[str] = None  # 부속지번: 본번
    atch_ji: Optional[str] = None  # 부속지번: 부번
    atch_regstr_gb_nm: Optional[str] = None
    jiyuk_nm: Optional[str] = None  # 지역
    jigu_nm: Optional[str] = None  # 지구
    guyuk_nm: Optional[str] = None  # 구역
    use_apr_day: Optional[str] = None  # 사용승인일
    raw_record_hash: Optional[str] = None


def _to_float(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        return float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None


def _to_int(value: Any) -> Optional[int]:
    if value in (None, ""):
        return None
    try:
        return int(float(str(value).replace(",", "")))
    except (TypeError, ValueError):
        return None


def normalize_building_item(op: BuildingLedgerOp, item: Mapping[str, Any]) -> BuildingRecord:
    return BuildingRecord(
        op=op.name,
        mgm_bldrgst_pk=(str(find_first(item, "mgmBldrgstPk") or "") or None),
        plat_plc=(str(find_first(item, "platPlc") or "") or None),
        new_plat_plc=(str(find_first(item, "newPlatPlc") or "") or None),
        bld_nm=(str(find_first(item, "bldNm") or "") or None),
        main_purps_nm=(str(find_first(item, "mainPurpsCdNm", "mainPurpsNm") or "") or None),
        etc_purps=(str(find_first(item, "etcPurps") or "") or None),
        tot_area=_to_float(find_first(item, "totArea")),
        arch_area=_to_float(find_first(item, "archArea")),
        grnd_flr_cnt=_to_int(find_first(item, "grndFlrCnt")),
        ugrnd_flr_cnt=_to_int(find_first(item, "ugrndFlrCnt")),
        flr_no=_to_int(find_first(item, "flrNo")),
        flr_gb_nm=(str(find_first(item, "flrGbCdNm", "flrGbNm") or "") or None),
        atch_bun=(str(find_first(item, "atchBun", "bun") or "") or None) if op is BuildingLedgerOp.ATTACHED_JIBUN else None,
        atch_ji=(str(find_first(item, "atchJi", "ji") or "") or None) if op is BuildingLedgerOp.ATTACHED_JIBUN else None,
        atch_regstr_gb_nm=(str(find_first(item, "regstrGbCdNm", "atchRegstrGbCdNm") or "") or None),
        jiyuk_nm=(str(find_first(item, "jiyukCdNm", "jiyukNm") or "") or None),
        jigu_nm=(str(find_first(item, "jiguCdNm", "jiguNm") or "") or None),
        guyuk_nm=(str(find_first(item, "guyukCdNm", "guyukNm") or "") or None),
        use_apr_day=(str(find_first(item, "useAprDay") or "") or None),
        raw_record_hash=raw_hash(dict(item)),
    )


class BuildingLedgerClient:
    def __init__(
        self,
        provider: PublicDataProvider,
        *,
        base_endpoint: str = BUILDING_HUB_BASE,
        page_size: int = 100,
    ):
        self._provider = provider
        self._base = base_endpoint.rstrip("/")
        self._page_size = page_size

    def fetch(self, op: BuildingLedgerOp, pnu: str, *, page: int = 1, project_id: str | None = None) -> FetchResult:
        """PNU 기준 건축물대장 조회. fail-safe: 실패해도 예외를 던지지 않는다."""
        try:
            params = pnu_to_ledger_params(pnu)
            params.update({"_type": "json", "numOfRows": self._page_size, "pageNo": page})
            payload = self._provider.get_json(f"{self._base}/{op.value}", params)
            items, total = parse_standard_body(payload, dataset=DATASET)
        except ProviderError as exc:
            return FetchResult.failure(exc.code, str(exc), self._meta(pnu, project_id, None))
        except Exception as exc:  # noqa: BLE001
            return FetchResult.failure("BUILDING_HUB_INTERNAL_ERROR", self._provider.redact(exc), self._meta(pnu, project_id, None))

        records = [normalize_building_item(op, item) for item in items]
        meta = self._meta(pnu, project_id, records)
        result = FetchResult(
            ok=True,
            records=records,
            meta=meta,
            status="SUCCESS_REVIEW_REQUIRED" if records else "REVIEW_REQUIRED",
        )
        if total > len(records):
            result.status = "PARTIAL"  # 페이지 초과분 존재: 자동 확정 금지, 추가 조회 필요
        return result

    def _meta(self, pnu: str, project_id: str | None, records: list[BuildingRecord] | None) -> SourceMeta:
        return SourceMeta(
            source_dataset=DATASET,
            source_provider="국토교통부 건축HUB(공공데이터포털)",
            freshness_grade=FreshnessGrade.PERIODIC,
            pnu=pnu,
            project_id=project_id,
            raw_hash=raw_hash([r.raw_record_hash for r in records]) if records else None,
            review_required=True,
            source_url=self._base,
            normalization_status="NORMALIZED" if records else None,
        )


class CrosscheckState(str, Enum):
    MATCH = "MATCH"
    MISMATCH = "MISMATCH"
    NOT_COMPARABLE = "NOT_COMPARABLE"


@dataclass(frozen=True)
class CrosscheckFlag:
    field: str
    reported_value: Optional[str]
    ledger_value: Optional[str]
    state: CrosscheckState
    review_required: bool = True
    note: str = "공부(건축물대장) 대조 후보값입니다. 전문가 검토가 필요합니다."


def _flag(field: str, reported: Any, ledger: Any, *, numeric_tolerance: float | None = None) -> CrosscheckFlag:
    if reported in (None, "") or ledger in (None, ""):
        return CrosscheckFlag(field, _s(reported), _s(ledger), CrosscheckState.NOT_COMPARABLE)
    if numeric_tolerance is not None:
        try:
            same = abs(float(reported) - float(ledger)) <= numeric_tolerance
        except (TypeError, ValueError):
            return CrosscheckFlag(field, _s(reported), _s(ledger), CrosscheckState.NOT_COMPARABLE)
    else:
        same = str(reported).strip() == str(ledger).strip()
    return CrosscheckFlag(field, _s(reported), _s(ledger), CrosscheckState.MATCH if same else CrosscheckState.MISMATCH)


def _s(value: Any) -> Optional[str]:
    return None if value in (None, "") else str(value)


def crosscheck_building(reported: Mapping[str, Any], ledger: BuildingRecord) -> list[CrosscheckFlag]:
    """평가서 기재사항(reported)과 건축물대장 표제부(ledger)의 교차검증 Flag.

    reported 지원 키: building_use(용도), total_floor_area_m2(연면적),
    ground_floors(지상층수), underground_floors(지하층수).
    판단·결론은 만들지 않는다. MISMATCH 도 '검토 필요' 플래그일 뿐이다.
    """
    return [
        _flag("building_use", reported.get("building_use"), ledger.main_purps_nm),
        _flag("total_floor_area_m2", reported.get("total_floor_area_m2"), ledger.tot_area, numeric_tolerance=0.05),
        _flag("ground_floors", reported.get("ground_floors"), ledger.grnd_flr_cnt, numeric_tolerance=0.0),
        _flag("underground_floors", reported.get("underground_floors"), ledger.ugrnd_flr_cnt, numeric_tolerance=0.0),
    ]
