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
from transaction_enrichment.providers import ProviderError, VWorldLandCharacteristicsProvider


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
    try:
        record = provider.get_by_pnu(pnu, standard_year=year)
    except ProviderError as exc:
        return {"ok": False, "error_code": exc.code, "error_message": str(exc), "record": None}
    if record is None:
        return {"ok": True, "status": "NO_DATA", "record": None, "review_required": True}
    return {"ok": True, "status": "SUCCESS_REVIEW_REQUIRED", "record": plain(record), "review_required": True}


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
