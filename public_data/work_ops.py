from __future__ import annotations

import base64
import csv
import io
import re
from collections import defaultdict
from dataclasses import asdict, is_dataclass
from enum import Enum
from typing import Any

from .building import BuildingLedgerClient, BuildingLedgerOp
from .candidates import normalize_address, point_in_polygon
from .core import PublicDataProvider
from .factoryon import FactoryOnClient
from .g2b import G2BClient, G2BStage, to_monitoring_rows
from .rtms import RtmsTradeClient, RtmsTradeType
from .stores import StoreInfoClient

PNU_RE = re.compile(r"^\d{19}$")
FUEL_RE = re.compile(r"주유소|연료|LPG|엘피지|가스\s*충전|자동차\s*연료", re.I)
FLOWER_RE = re.compile(r"꽃|화훼|원예|식물|묘목|다육", re.I)


def plain(value: Any) -> Any:
    if is_dataclass(value):
        return plain(asdict(value))
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, dict):
        return {str(key): plain(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [plain(item) for item in value]
    return value


def csv_base64(rows: list[dict[str, Any]], columns: list[str]) -> str:
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=columns, extrasaction="ignore", lineterminator="\n")
    writer.writeheader()
    for row in rows:
        writer.writerow({key: row.get(key) for key in columns})
    return base64.b64encode(("\ufeff" + stream.getvalue()).encode("utf-8")).decode("ascii")


def _boundary_ring(payload: dict[str, Any]) -> list[tuple[float, float]] | None:
    raw = payload.get("boundary_ring")
    if not isinstance(raw, list) or len(raw) < 3:
        return None
    ring: list[tuple[float, float]] = []
    for point in raw:
        if not isinstance(point, (list, tuple)) or len(point) < 2:
            return None
        try:
            ring.append((float(point[0]), float(point[1])))
        except (TypeError, ValueError):
            return None
    return ring


def _polygon_wkt(ring: list[tuple[float, float]]) -> str:
    points = list(ring)
    if points[0] != points[-1]:
        points.append(points[0])
    return "POLYGON((" + ",".join(f"{lon:.8f} {lat:.8f}" for lon, lat in points) + "))"


def _fetch_store_pages(client: StoreInfoClient, *, kind: str, value: str, max_pages: int, project_id: str | None) -> tuple[list[Any], list[str], Any]:
    records: list[Any] = []
    failures: list[str] = []
    last_meta = None
    for page in range(1, max_pages + 1):
        if kind == "polygon":
            result = client.stores_in_polygon(value, page=page, project_id=project_id)
        elif kind == "sigungu":
            result = client.stores_in_sigungu(value, page=page, project_id=project_id)
        else:
            result = client.stores_in_admin_dong(value, page=page, project_id=project_id)
        if not result.ok:
            failures.append(f"STORE {kind}={value[:48]} p{page}: {result.error_code}")
            break
        records.extend(result.records)
        last_meta = result.meta
        if result.status != "PARTIAL":
            break
    else:
        failures.append(f"STORE {kind}={value[:48]}: MAX_PAGES_REACHED(p{max_pages})")
    return records, failures, last_meta


def _category_text(record: Any) -> str:
    return " | ".join(
        str(value)
        for value in (
            getattr(record, "category_large_nm", None),
            getattr(record, "category_medium_nm", None),
            getattr(record, "category_small_nm", None),
            getattr(record, "ksic_nm", None),
        )
        if value
    )


def _group_key(record: Any) -> str:
    pnu = str(getattr(record, "pnu_candidate", None) or "").strip()
    if PNU_RE.fullmatch(pnu):
        return f"PNU:{pnu}"
    address = normalize_address(getattr(record, "jibun_address", None))
    if address:
        return f"ADDR:{address}"
    lon = getattr(record, "lon", None)
    lat = getattr(record, "lat", None)
    if lon is not None and lat is not None:
        return f"XY:{float(lon):.6f},{float(lat):.6f}"
    return f"BIZ:{getattr(record, 'bizes_id', None) or id(record)}"


def _priority(records: list[Any]) -> tuple[str, str, str, str]:
    joined = " | ".join(_category_text(record) for record in records)
    if FUEL_RE.search(joined):
        return ("P1", "주유소·연료", "FIELD_ACTIVE", "영업·설비·인허가·진출입 현황 확인")
    if FLOWER_RE.search(joined):
        if len(records) >= 2:
            return ("P4", "화훼·원예", "FIELD_ACTIVE", "영업주체 수·시설재배·수목/시설물 현황 확인")
        return ("P4", "화훼·원예", "REVIEW", "동일 PNU 복수 영업레코드 여부와 실제 영업 현황 확인")
    return ("P5", "일반 영업시설", "REVIEW", "현재 전략상 후순위 · 현장 필요성 검토")


def build_field_candidate_response(payload: dict[str, Any]) -> dict[str, Any]:
    provider = PublicDataProvider()
    if not provider.configured:
        return {"ok": False, "error_code": "PUBLIC_DATA_KEY_MISSING", "candidates": []}

    max_pages = max(1, min(int(payload.get("max_pages") or 5), 20))
    project_id = str(payload.get("project_id") or "").strip() or None
    sigungu_codes = [str(value).strip() for value in payload.get("sigungu_codes", []) if str(value).strip()]
    adong_codes = [str(value).strip() for value in payload.get("adong_codes", []) if str(value).strip()]
    company_names = [str(value).strip() for value in payload.get("company_names", []) if str(value).strip()]
    ring = _boundary_ring(payload)

    client = StoreInfoClient(provider)
    stores: list[Any] = []
    failures: list[str] = []
    source_meta = None
    used_polygon = False
    if ring:
        fetched, failed, meta = _fetch_store_pages(client, kind="polygon", value=_polygon_wkt(ring), max_pages=max_pages, project_id=project_id)
        if fetched:
            stores.extend(fetched)
            source_meta = meta
            used_polygon = True
        failures.extend(failed)
    if not used_polygon:
        for code in sigungu_codes:
            fetched, failed, meta = _fetch_store_pages(client, kind="sigungu", value=code, max_pages=max_pages, project_id=project_id)
            stores.extend(fetched)
            failures.extend(failed)
            source_meta = meta or source_meta
        for code in adong_codes:
            fetched, failed, meta = _fetch_store_pages(client, kind="adong", value=code, max_pages=max_pages, project_id=project_id)
            stores.extend(fetched)
            failures.extend(failed)
            source_meta = meta or source_meta

    deduped: list[Any] = []
    seen_store: set[str] = set()
    for record in stores:
        key = str(getattr(record, "bizes_id", None) or getattr(record, "raw_record_hash", None) or _group_key(record))
        if key in seen_store:
            continue
        seen_store.add(key)
        deduped.append(record)
    stores = deduped

    grouped: dict[str, list[Any]] = defaultdict(list)
    outside_count = 0
    unknown_boundary_count = 0
    for record in stores:
        lon = getattr(record, "lon", None)
        lat = getattr(record, "lat", None)
        if ring:
            if lon is None or lat is None:
                unknown_boundary_count += 1
            elif not point_in_polygon(float(lon), float(lat), ring):
                outside_count += 1
                continue
        grouped[_group_key(record)].append(record)

    rows: list[dict[str, Any]] = []
    for group_records in grouped.values():
        first = group_records[0]
        priority, candidate_type, field_status, next_check = _priority(group_records)
        pnu = next(
            (str(getattr(record, "pnu_candidate", "") or "") for record in group_records if PNU_RE.fullmatch(str(getattr(record, "pnu_candidate", "") or ""))),
            "",
        )
        lon = next((getattr(record, "lon", None) for record in group_records if getattr(record, "lon", None) is not None), None)
        lat = next((getattr(record, "lat", None) for record in group_records if getattr(record, "lat", None) is not None), None)
        in_boundary = None if not ring or lon is None or lat is None else point_in_polygon(float(lon), float(lat), ring)
        if ring and in_boundary is None:
            field_status = "REVIEW"
            next_check = f"경계판정불가 · {next_check}"
        names = [str(getattr(record, "name", "") or "").strip() for record in group_records]
        names = [name for index, name in enumerate(names) if name and name not in names[:index]]
        categories = [_category_text(record) for record in group_records]
        categories = [value for index, value in enumerate(categories) if value and value not in categories[:index]]
        rows.append(
            {
                "priority": priority,
                "candidate_type": candidate_type,
                "field_status": field_status,
                "review_required": True,
                "auto_confirmed": False,
                "pnu": pnu or None,
                "jibun_address": normalize_address(getattr(first, "jibun_address", None)) or getattr(first, "jibun_address", None),
                "road_address": getattr(first, "road_address", None),
                "business_count": len(group_records),
                "business_names": " | ".join(names),
                "business_category": " | ".join(categories),
                "lon": lon,
                "lat": lat,
                "in_boundary": in_boundary,
                "next_check": next_check,
                "source_dataset": getattr(source_meta, "source_dataset", None),
                "retrieved_at": getattr(source_meta, "retrieved_at", None),
            }
        )

    factory_client = FactoryOnClient(provider)
    for company in company_names:
        result = factory_client.parcels_by_company(company, project_id=project_id)
        if not result.ok:
            failures.append(f"FACTORY_PARCEL {company}: {result.error_code}")
            continue
        for parcel in result.records:
            rows.append(
                {
                    "priority": "REVIEW",
                    "candidate_type": "공장·산업시설",
                    "field_status": "REVIEW_REQUIRED",
                    "review_required": True,
                    "auto_confirmed": False,
                    "pnu": getattr(parcel, "pnu_candidate", None),
                    "jibun_address": normalize_address(getattr(parcel, "jibun_address", None)) or getattr(parcel, "jibun_address", None),
                    "road_address": None,
                    "business_count": 1,
                    "business_names": getattr(parcel, "company_name", None),
                    "business_category": "FactoryOn 필지정보",
                    "lon": None,
                    "lat": None,
                    "in_boundary": None,
                    "next_check": "공장-필지 연결 및 사업지 경계 현장 확인",
                    "source_dataset": getattr(result.meta, "source_dataset", None),
                    "retrieved_at": getattr(result.meta, "retrieved_at", None),
                }
            )

    priority_order = {"P1": 1, "P4": 4, "P5": 5, "REVIEW": 9}
    rows.sort(key=lambda row: (priority_order.get(str(row["priority"]), 99), str(row.get("jibun_address") or "")))
    columns = [
        "priority", "candidate_type", "field_status", "review_required", "pnu", "jibun_address",
        "road_address", "business_count", "business_names", "business_category", "lon", "lat",
        "in_boundary", "next_check",
    ]
    return {
        "ok": True,
        "status": "PARTIAL" if failures else "DONE_REVIEW_REQUIRED",
        "total": len(rows),
        "field_active": sum(1 for row in rows if row["field_status"] == "FIELD_ACTIVE"),
        "priority_counts": {key: sum(1 for row in rows if row["priority"] == key) for key in ("P1", "P4", "P5", "REVIEW")},
        "outside_boundary": outside_count,
        "unknown_boundary": unknown_boundary_count,
        "candidates": rows,
        "failures": failures,
        "csv_base64": csv_base64(rows, columns),
        "csv_file_name": "bso-field-candidates.csv",
        "review_required": True,
        "auto_confirmed": False,
        "safety_boundary": "FIELD_ACTIVE는 현장확인 우선순위이며 편입·보상대상 확정이 아닙니다.",
    }


def build_early_signal_response(payload: dict[str, Any]) -> dict[str, Any]:
    provider = PublicDataProvider()
    if not provider.configured:
        return {"ok": False, "error_code": "PUBLIC_DATA_KEY_MISSING", "signals": []}
    begin = str(payload.get("begin") or "").strip()
    end = str(payload.get("end") or "").strip()
    if not re.fullmatch(r"\d{12}", begin) or not re.fullmatch(r"\d{12}", end):
        return {"ok": False, "error_code": "EARLY_SIGNAL_DATE_INVALID", "signals": []}
    stage_names = payload.get("stages") or ["ORDER_PLAN", "PRE_SPEC", "BID_NOTICE", "CONTRACT"]
    max_pages = max(1, min(int(payload.get("max_pages") or 3), 10))
    project_id = str(payload.get("project_id") or "").strip() or None
    client = G2BClient(provider)
    signals: list[Any] = []
    failures: list[str] = []
    for stage_name in [str(value).strip() for value in stage_names if str(value).strip()]:
        try:
            stage = G2BStage(stage_name)
        except ValueError:
            failures.append(f"{stage_name}: UNKNOWN_STAGE")
            continue
        for page in range(1, max_pages + 1):
            result = client.signals(stage, inqry_bgn_dt=begin, inqry_end_dt=end, page=page, project_id=project_id)
            if not result.ok:
                failures.append(f"{stage.value}: {result.error_code}")
                break
            signals.extend(result.records)
            if result.status != "PARTIAL":
                break
        else:
            failures.append(f"{stage.value}: MAX_PAGES_REACHED(p{max_pages})")
    deduped: list[Any] = []
    seen: set[str] = set()
    for signal in signals:
        key = str(getattr(signal, "raw_record_hash", None) or (getattr(signal, "stage", ""), getattr(signal, "title", ""), getattr(signal, "notice_date", "")))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(signal)
    rows = to_monitoring_rows(deduped)
    columns = ["구분", "단계", "공고명", "발주기관", "지역", "일자", "일치키워드", "연결키", "상세URL", "상태", "검수"]
    return {
        "ok": True,
        "status": "PARTIAL" if failures else "DONE_REVIEW_REQUIRED",
        "signals": plain(deduped),
        "monitoring_rows": rows,
        "failures": failures,
        "csv_base64": csv_base64(rows, columns),
        "csv_file_name": "bso-early-signals.csv",
        "review_required": True,
        "auto_confirmed": False,
        "safety_boundary": "EARLY_SIGNAL은 신규사업 후보 신호이며 사업 확정·수임가능 판정이 아닙니다.",
    }


def build_rtms_response(payload: dict[str, Any]) -> dict[str, Any]:
    provider = PublicDataProvider()
    if not provider.configured:
        return {"ok": False, "error_code": "PUBLIC_DATA_KEY_MISSING", "records": []}
    try:
        trade_type = RtmsTradeType(str(payload.get("trade_type") or "LAND").strip().upper())
    except ValueError:
        return {"ok": False, "error_code": "RTMS_TRADE_TYPE_INVALID", "records": []}
    lawd_cd = str(payload.get("lawd_cd") or "").strip()
    deal_ymd = str(payload.get("deal_ymd") or "").strip()
    project_id = str(payload.get("project_id") or "").strip() or None
    max_pages = max(1, min(int(payload.get("max_pages") or 3), 10))
    client = RtmsTradeClient(provider)
    records: list[Any] = []
    failures: list[str] = []
    for page in range(1, max_pages + 1):
        result = client.trade_candidates(trade_type, lawd_cd=lawd_cd, deal_ymd=deal_ymd, page=page, project_id=project_id)
        if not result.ok:
            return {"ok": False, "error_code": result.error_code, "error_message": result.error_message, "records": []}
        records.extend(result.records)
        if result.status != "PARTIAL":
            break
    else:
        failures.append(f"MAX_PAGES_REACHED(p{max_pages})")
    rows = plain(records)
    columns = [
        "trade_type", "sigungu_cd", "sigungu_nm", "legal_dong_nm", "contract_date", "land_category",
        "zoning", "building_use", "land_area_m2", "building_area_m2", "deal_amount_won",
        "unit_price_won_m2", "unit_price_basis", "share_dealing", "is_building_included", "review_required",
    ]
    return {
        "ok": True,
        "status": "PARTIAL" if failures else "DONE_REVIEW_REQUIRED",
        "records": rows,
        "failures": failures,
        "csv_base64": csv_base64(rows, columns),
        "csv_file_name": f"bso-rtms-{trade_type.value.lower()}-{deal_ymd or 'period'}.csv",
        "review_required": True,
        "auto_confirmed": False,
    }


def build_building_response(payload: dict[str, Any]) -> dict[str, Any]:
    provider = PublicDataProvider()
    if not provider.configured:
        return {"ok": False, "error_code": "PUBLIC_DATA_KEY_MISSING", "records": {}}
    pnu = str(payload.get("pnu") or "").strip()
    if not PNU_RE.fullmatch(pnu):
        return {"ok": False, "error_code": "PNU_INVALID", "records": {}}
    op_names = payload.get("ops") or ["TITLE", "BASIS", "JIJIGU"]
    project_id = str(payload.get("project_id") or "").strip() or None
    client = BuildingLedgerClient(provider)
    records: dict[str, Any] = {}
    failures: list[str] = []
    for op_name in [str(value).strip().upper() for value in op_names if str(value).strip()]:
        try:
            op = BuildingLedgerOp[op_name]
        except KeyError:
            failures.append(f"{op_name}: UNKNOWN_BUILDING_OP")
            continue
        result = client.fetch(op, pnu, project_id=project_id)
        records[op_name] = plain(result.records) if result.ok else []
        if not result.ok:
            failures.append(f"{op_name}: {result.error_code}")
    return {
        "ok": True,
        "status": "PARTIAL" if failures else "DONE_REVIEW_REQUIRED",
        "pnu": pnu,
        "records": records,
        "failures": failures,
        "review_required": True,
        "auto_confirmed": False,
    }
