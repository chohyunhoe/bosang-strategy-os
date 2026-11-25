from __future__ import annotations

import json
import re
import sys
from dataclasses import asdict, is_dataclass
from enum import Enum
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from public_data import LegalDongCodeClient, PublicDataProvider, build_pnu, load_env_file
from public_data.work_ops import (
    build_building_response,
    build_early_signal_response,
    build_field_candidate_response,
    build_rtms_response,
)
from transaction_enrichment.standard_lands import lookup_standard_traits, search_standard_lands
from transaction_enrichment.providers import ProviderError, VWorldCadastralGeometryProvider, VWorldCadastralParcelProvider, VWorldLandCharacteristicsProvider, fetch_cadastral_tile


LOT_TAIL = re.compile(r"(?P<mountain>산\s*)?(?P<bun>\d{1,4})(?:-(?P<ji>\d{1,4}))?(?:번지)?\s*$")
ADMIN_SUFFIX = re.compile(r"(특별자치시|특별자치도|광역시|특별시|도|시|군|구|읍|면)$")


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


def read_request_payload(stream: Any = None) -> dict[str, Any]:
    """Read the Node bridge request as UTF-8 regardless of the Windows console codepage."""
    source = stream if stream is not None else sys.stdin.buffer
    raw = source.read()
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8-sig")
    return json.loads(raw or "{}")


def status() -> dict[str, Any]:
    provider = PublicDataProvider()
    vworld = VWorldLandCharacteristicsProvider()
    return {
        "ok": True,
        "public_data_configured": provider.configured,
        "public_data_key_form": provider.key_form,
        "vworld_configured": vworld.configured,
        "capabilities": {
            "PNU_RESOLVER": True,
            "VWORLD_LAND_CHARACTERISTICS": vworld.configured,
            "STANDARD_TRAITS": vworld.configured,
            "FIELD_CANDIDATES": provider.configured,
            "EARLY_SIGNAL": provider.configured,
            "RTMS": provider.configured,
            "BUILDING_LEDGER": provider.configured,
        },
        "review_required": True,
        "secrets_exposed": False,
    }


def legal_dong(payload: dict[str, Any]) -> dict[str, Any]:
    query = str(payload.get("address_name") or "").strip()
    if not query:
        return {"ok": False, "error_code": "ADDRESS_REQUIRED", "records": []}
    provider = PublicDataProvider()
    if not provider.configured:
        return {"ok": False, "error_code": "PUBLIC_DATA_KEY_MISSING", "records": []}
    result = LegalDongCodeClient(provider).search(query)
    return {
        "ok": bool(result.ok),
        "status": result.status,
        "error_code": result.error_code,
        "error_message": result.error_message,
        "records": plain(result.records),
        "meta": plain(result.meta),
        "review_required": True,
    }


def narrow_legal_dong_by_context(records: list[Any], context: str) -> list[Any]:
    normalized = " ".join(str(context or "").split())
    if not normalized or len(records) < 2:
        return records
    scored: list[tuple[int, Any]] = []
    for record in records:
        tokens = str(record.locatadd_nm or "").split()[:-1]
        score = 0
        for token in tokens:
            base = ADMIN_SUFFIX.sub("", token)
            if token and token in normalized:
                score += 2
            elif len(base) >= 2 and base in normalized:
                score += 1
        scored.append((score, record))
    best = max((score for score, _record in scored), default=0)
    return [record for score, record in scored if best > 0 and score == best]


def resolve_pnu(payload: dict[str, Any]) -> dict[str, Any]:
    address = " ".join(str(payload.get("parcel_address") or "").split()).strip()
    address_context = " ".join(str(payload.get("address_context") or "").split()).strip()
    match = LOT_TAIL.search(address)
    if not address or match is None:
        return {"ok": False, "error_code": "PARCEL_ADDRESS_FORMAT_UNRESOLVED", "candidate": None}

    region_query = address[: match.start()].strip()
    if not region_query:
        return {"ok": False, "error_code": "LEGAL_DONG_NAME_MISSING", "candidate": None}

    provider = PublicDataProvider()
    if not provider.configured:
        return {"ok": False, "error_code": "PUBLIC_DATA_KEY_MISSING", "candidate": None}

    result = LegalDongCodeClient(provider).search(region_query)
    if not result.ok:
        return {
            "ok": False,
            "error_code": result.error_code or "LEGAL_DONG_LOOKUP_FAILED",
            "candidate": None,
            "review_required": True,
        }

    candidates = [
        record
        for record in result.records
        if record.locatadd_nm == region_query or record.locatadd_nm.endswith(f" {region_query}")
    ]
    context_narrowed = False
    if len(candidates) > 1 and address_context:
        narrowed = narrow_legal_dong_by_context(candidates, address_context)
        if len(narrowed) == 1:
            candidates = narrowed
            context_narrowed = True
    if len(candidates) != 1:
        return {
            "ok": False,
            "error_code": "LEGAL_DONG_NOT_FOUND" if not candidates else "LEGAL_DONG_MULTIPLE_CANDIDATES",
            "candidate": None,
            "candidate_count": len(candidates),
            "review_required": True,
        }

    record = candidates[0]
    bun = int(match.group("bun"))
    ji = int(match.group("ji") or 0)
    mountain = bool(match.group("mountain"))
    pnu = build_pnu(record.region_cd, mountain=mountain, bun=bun, ji=ji)
    return {
        "ok": True,
        "status": "CANDIDATE_REVIEW_REQUIRED",
        "candidate": {
            "parcel_address": address,
            "legal_dong_name": record.locatadd_nm,
            "legal_dong_code": record.region_cd,
            "lot_number": ("산" if mountain else "") + str(bun) + (f"-{ji}" if ji else ""),
            "pnu": pnu,
            "origin": "MOIS_LEGAL_DONG_CONTEXT_UNIQUE" if context_narrowed else "MOIS_LEGAL_DONG_EXACT_OR_UNIQUE_SUFFIX",
            "resolution_basis": "DOCUMENT_CONTEXT_UNIQUE_REVIEW_REQUIRED" if context_narrowed else "EXACT_OR_UNIQUE_SUFFIX_REVIEW_REQUIRED",
            "review_status_code": "NEEDS_REVIEW",
            "auto_confirmed": False,
        },
        "review_required": True,
    }


def vworld_land(payload: dict[str, Any]) -> dict[str, Any]:
    pnu = str(payload.get("pnu") or "").strip()
    if len(pnu) != 19 or not pnu.isdigit():
        return {"ok": False, "error_code": "PNU_INVALID", "record": None}
    year_raw = payload.get("standard_year")
    year = int(year_raw) if year_raw not in (None, "") else None
    provider = VWorldLandCharacteristicsProvider()
    if not provider.configured:
        return {"ok": False, "error_code": "VWORLD_API_KEY_MISSING", "record": None}
    # 상담 시뮬레이터만 dedupe_revisions=true를 보낸다. Release v1 요청은 기존 계약(복수 행 보류) 그대로.
    collapse = payload.get("dedupe_revisions") is True
    diagnostics: dict[str, Any] = {}
    try:
        record = provider.get_by_pnu(pnu, standard_year=year, collapse_revisions=collapse, diagnostics=diagnostics if collapse else None)
    except ProviderError as exc:
        result = {"ok": False, "error_code": exc.code, "error_message": str(exc), "record": None}
        if collapse and diagnostics:
            result["selection"] = diagnostics
        return result
    if record is None:
        return {"ok": True, "status": "NO_DATA", "record": None, "review_required": True}
    result = {"ok": True, "status": "SUCCESS_REVIEW_REQUIRED", "record": plain(record), "review_required": True}
    if collapse and diagnostics:
        result["selection"] = diagnostics
    return result


def pnu_parcel(payload: dict[str, Any]) -> dict[str, Any]:
    """PNU 직접입력 검증: 연속지적도에 그 PNU 필지가 있는지와 지번주소만 돌려준다(도형·소유 정보 없음)."""
    pnu = str(payload.get("pnu") or "").strip()
    if len(pnu) != 19 or not pnu.isdigit():
        return {"ok": False, "error_code": "PNU_INVALID", "parcel": None}
    provider = VWorldCadastralParcelProvider()
    if not provider.configured:
        return {"ok": False, "error_code": "VWORLD_API_KEY_MISSING", "parcel": None}
    try:
        parcel = provider.get_by_pnu(pnu)
    except ProviderError as exc:
        return {"ok": False, "error_code": exc.code, "error_message": str(exc), "parcel": None}
    if parcel is None:
        return {"ok": True, "status": "NOT_FOUND", "parcel": None, "review_required": True}
    return {"ok": True, "status": "FOUND_REVIEW_REQUIRED", "parcel": parcel, "review_required": True}


# 화면 범위 지적경계: 요청당 칸 4개·VWorld 호출 8회·응답 6MB(브리지 출력 상한 8MB 안) 상한.
TILE_REQUEST_MAX = 4
TILE_CALL_BUDGET = 8
TILE_BYTES_BUDGET = 6 * 1024 * 1024


def parcel_map_tiles(pnu: str, tiles: Any, provider: Any) -> dict[str, Any]:
    if not isinstance(tiles, list) or not tiles or len(tiles) > TILE_REQUEST_MAX:
        return {"ok": False, "error_code": "TILES_INVALID", "error_message": f"tiles must be 1..{TILE_REQUEST_MAX} [ix, iy] pairs"}
    keys = []
    for t in tiles:
        if not (isinstance(t, list) and len(t) == 2 and all(isinstance(v, int) and not isinstance(v, bool) for v in t)):
            return {"ok": False, "error_code": "TILES_INVALID"}
        if tuple(t) not in keys:
            keys.append(tuple(t))
    budget = [TILE_CALL_BUDGET]; used_bytes = 0; out = []
    for ix, iy in keys:
        if budget[0] <= 0 or used_bytes >= TILE_BYTES_BUDGET:
            out.append({"tile": [ix, iy], "status": "NOT_QUERIED", "reason": "CALL_BUDGET" if budget[0] <= 0 else "BYTES_BUDGET", "features": []})
            continue
        try:
            r = fetch_cadastral_tile(provider, ix, iy, pnu, call_budget=budget)
        except ProviderError as exc:
            r = {"tile": [ix, iy], "status": "FAILED", "reason": exc.code, "features": []}
        size = len(json.dumps(r["features"], ensure_ascii=False))
        if used_bytes + size > TILE_BYTES_BUDGET:
            r = {**r, "status": "NOT_QUERIED", "reason": "BYTES_BUDGET", "features": []}
        else:
            used_bytes += size
        out.append(r)
    calls = TILE_CALL_BUDGET - budget[0]  # 실패한 칸이 쓴 호출도 포함(예산에서 실제로 뺀 수)
    return {"ok": True, "mode": "TILES", "pnu": pnu, "tiles": out, "request_count": calls, "source": "VWorld 연속지적도(LP_PA_CBND_BUBUN)", "review_required": True}


def parcel_map(payload: dict[str, Any]) -> dict[str, Any]:
    """대상 PNU의 지적경계(exact-one)와 선택적으로 주변 지적경계. 소유 정보 없음.
    tiles가 있으면 대상 조회 없이 0.01° 격자 칸 단위 지적경계만(화면 범위 조회)."""
    pnu = str(payload.get("pnu") or "").strip()
    if len(pnu) != 19 or not pnu.isdigit():
        return {"ok": False, "error_code": "PNU_INVALID"}
    provider = VWorldCadastralGeometryProvider()
    if not provider.configured:
        return {"ok": False, "error_code": "VWORLD_API_KEY_MISSING"}
    if "tiles" in payload:
        return parcel_map_tiles(pnu, payload.get("tiles"), provider)
    try:
        target = provider.target(pnu)
        neighbors = []
        bbox = payload.get("neighbors_bbox")
        if target["status"] == "EXACT_ONE" and payload.get("neighbors") is True and not bbox:
            # 대상 경계 범위에서 0.002° 여유(최대 0.01°) — 화면 영상 범위와 비슷한 주변만
            pts = [pt for poly in target["geometry"]["coordinates"] for ring in poly for pt in ring]
            xs = [pt[0] for pt in pts]; ys = [pt[1] for pt in pts]
            cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
            hx = min(0.005, (max(xs) - min(xs)) / 2 + 0.002); hy = min(0.005, (max(ys) - min(ys)) / 2 + 0.0016)
            bbox = [cx - hx, cy - hy, cx + hx, cy + hy]
        if target["status"] == "EXACT_ONE" and isinstance(bbox, list) and len(bbox) == 4:
            neighbors = provider.neighbors(bbox, pnu)
    except ProviderError as exc:
        return {"ok": False, "error_code": exc.code, "error_message": str(exc)}
    return {"ok": True, "target": target, "neighbors": neighbors, "source": "VWorld 연속지적도(LP_PA_CBND_BUBUN)", "review_required": True}


def main() -> int:
    load_env_file()
    try:
        payload = read_request_payload()
    except (UnicodeDecodeError, json.JSONDecodeError):
        print(json.dumps({"ok": False, "error_code": "INVALID_JSON"}, ensure_ascii=False))
        return 2
    operation = str(payload.get("operation") or "status")
    try:
        if operation == "status":
            result = status()
        elif operation == "legal_dong":
            result = legal_dong(payload)
        elif operation == "resolve_pnu":
            result = resolve_pnu(payload)
        elif operation == "vworld_land":
            result = vworld_land(payload)
        elif operation == "pnu_parcel":
            result = pnu_parcel(payload)
        elif operation == "parcel_map":
            result = parcel_map(payload)
        elif operation == "standard_lands":
            result = search_standard_lands(payload)
        elif operation == "standard_traits":
            result = lookup_standard_traits(payload)
        elif operation == "field_candidates":
            result = build_field_candidate_response(payload)
        elif operation == "early_signals":
            result = build_early_signal_response(payload)
        elif operation == "rtms":
            result = build_rtms_response(payload)
        elif operation == "building":
            result = build_building_response(payload)
        else:
            result = {"ok": False, "error_code": "UNSUPPORTED_OPERATION"}
    except Exception as exc:
        result = {"ok": False, "error_code": "PUBLIC_DATA_BRIDGE_INTERNAL", "error_message": type(exc).__name__}
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
