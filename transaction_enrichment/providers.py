from __future__ import annotations

import http.client
import json
import os
import re
import ssl
import urllib.error
import urllib.parse
import urllib.request
from abc import ABC, abstractmethod
from collections.abc import Callable, Mapping
from datetime import date
from typing import Any, Optional

from .models import LandCharacteristics, Provenance


VWORLD_LAND_CHARACTERISTICS_ENDPOINT = "https://api.vworld.kr/ned/data/getLandCharacteristics"
_SUCCESS_CODES = {"", "0", "00", "000", "SUCCESS"}


def _vworld_result_message(result_code: str) -> str:
    """VWorld 결과코드(예: INCORRECT_KEY)만 메시지에 남긴다. 키·URL 등 다른 값은 넣지 않는다."""
    code = re.sub(r"[^A-Z0-9_]", "", str(result_code or "").upper())[:40] or "UNKNOWN"
    return f"VWorld returned a non-success result code (resultCode={code})"


class ProviderError(RuntimeError):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def redact_secrets(value: object, secrets: tuple[str, ...] = ()) -> str:
    text = str(value)
    for secret in secrets:
        if secret:
            text = text.replace(secret, "[REDACTED]")
    return re.sub(
        r"(?i)(key|api[_-]?key|service[_-]?key)=([^&\s]+)",
        lambda match: f"{match.group(1)}=[REDACTED]",
        text,
    )


def _runtime_secret(explicit: str | None, env_name: str) -> str | None:
    """Return a runtime-only secret without logging or serializing it."""
    return explicit or os.getenv(env_name)


def _as_list(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if isinstance(value, dict):
        return [value]
    return []


def _first(source: Mapping[str, Any], *keys: str) -> Any:
    for key in keys:
        value = source.get(key)
        if value not in (None, ""):
            return value
    return None


def _to_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None


def _to_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(str(value))
    except (TypeError, ValueError):
        return None


_REVISION_META_FIELDS = frozenset({"lastUpdtDt"})


def collapse_identical_revisions(rows: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    """Same PNU/year rows that differ only in lastUpdtDt collapse to the latest dated row.

    Any other differing field is a conflict: returns (None, diagnostics) and the caller must hold.
    Diagnostics carry row count, rule, conflicting field names and update dates (no values).
    """
    if len(rows) == 1:
        return rows[0], {"row_count": 1, "rule": "SINGLE_ROW"}
    keys = sorted({key for row in rows for key in row.keys()} - _REVISION_META_FIELDS)
    norm = lambda value: "" if value is None else str(value).strip()  # noqa: E731
    conflicts = [key for key in keys if len({norm(row.get(key)) for row in rows}) > 1]
    updated = [norm(row.get("lastUpdtDt")) for row in rows]
    if conflicts:
        return None, {"row_count": len(rows), "rule": "CONFLICT_HOLD", "conflict_fields": conflicts, "last_updated": updated}

    def date_key(value: Any) -> str | None:
        match = re.match(r"^(\d{4})-?(\d{2})-?(\d{2})", norm(value))
        return f"{match.group(1)}-{match.group(2)}-{match.group(3)}" if match else None

    dated = [(row, date_key(row.get("lastUpdtDt"))) for row in rows]
    valid = [(row, key) for row, key in dated if key]
    latest = max((key for _row, key in valid), default=None)
    winners = [row for row, key in valid if key == latest] if latest else []
    chosen = winners[0] if winners else rows[0]
    return chosen, {
        "row_count": len(rows),
        "rule": "IDENTICAL_DATA_REVISIONS",
        "selected_last_updated": latest,
        "same_date_rows": len(winners),
        "unparsed_last_updated": sum(1 for _row, key in dated if not key),
        "last_updated": updated,
    }


def parse_vworld_land_characteristics(
    payload: Mapping[str, Any],
    *,
    expected_pnu: str,
    expected_year: int,
    collapse_revisions: bool = False,
    diagnostics: dict[str, Any] | None = None,
) -> LandCharacteristics | None:
    """Parse one exact VWorld PNU/year result; zero or multiple rows fail closed.

    collapse_revisions=True (opt-in, consultation simulator only) collapses rows that differ
    only in lastUpdtDt and treats ``response.status == NOT_FOUND`` as no data. The default
    keeps the Release v1 contract unchanged.
    """
    root = payload.get("landCharacteristicss") or payload.get("landCharacteristics")
    if not isinstance(root, Mapping):
        response = payload.get("response")
        if collapse_revisions and isinstance(response, Mapping) and str(response.get("status") or "").upper() == "NOT_FOUND":
            return None
        if isinstance(response, Mapping):
            result_code = str(_first(response, "resultCode", "resultCd", "errorCode") or "")
            error = response.get("error")
            if not result_code and isinstance(error, Mapping):
                result_code = str(error.get("code") or "")
            if result_code.upper() not in _SUCCESS_CODES:
                raise ProviderError("VWORLD_API_ERROR", _vworld_result_message(result_code))
        raise ProviderError("VWORLD_SCHEMA_CHANGED", "VWorld land-characteristics root was not found")

    result_code = str(_first(root, "resultCode", "resultCd", "errorCode") or "")
    if result_code.upper() not in _SUCCESS_CODES:
        raise ProviderError("VWORLD_API_ERROR", _vworld_result_message(result_code))

    items = _as_list(root.get("field")) + _as_list(root.get("fields"))
    total_count = _to_int(root.get("totalCount"))
    if total_count == 0 or not items:
        return None

    exact: list[dict[str, Any]] = []
    for item in items:
        item_pnu = str(_first(item, "pnu", "PNU") or "")
        item_year = _to_int(_first(item, "stdrYear", "STD_YEAR", "stdYear", "year"))
        if item_pnu == expected_pnu and item_year == expected_year:
            exact.append(item)

    if not exact:
        raise ProviderError("VWORLD_EXACT_MATCH_NOT_FOUND", "No exact PNU/year response row was found")
    if len(exact) != 1 and not collapse_revisions:
        raise ProviderError("VWORLD_MULTIPLE_EXACT_MATCHES", "Multiple exact PNU/year response rows require review")
    if len(exact) != 1:
        chosen, info = collapse_identical_revisions(exact)
        if diagnostics is not None:
            diagnostics.update(info, excluded_rows=len(items) - len(exact))
        if chosen is None:
            raise ProviderError("VWORLD_REVISION_CONFLICT", "Exact PNU/year rows disagree beyond lastUpdtDt; review required")
        exact = [chosen]
    elif diagnostics is not None:
        diagnostics.update({"row_count": 1, "rule": "SINGLE_ROW", "excluded_rows": len(items) - 1})

    item = exact[0]
    mapped: dict[str, Any] = {
        "legal_dong": _first(item, "ldCodeNm", "legalDong", "dong"),
        "lot_number": _first(item, "mnnmSlno", "parcelNumber", "jibun"),
        "land_category": _first(item, "lndcgrCodeNm", "lndcgrNm", "landCategory", "jimok"),
        "zoning": _first(item, "prposArea1Nm", "prposAreaNm", "zoning", "useRegion"),
        "zoning_secondary": _first(item, "prposArea2Nm", "zoningSecondary", "useRegion2"),
        "land_use": _first(item, "ladUseSittnNm", "landUseSittnNm", "landUseStatus", "useSituation"),
        "road_access": _first(item, "roadSideCodeNm", "roadFrontage", "road"),
        "shape": _first(item, "tpgrphFrmCodeNm", "terrainShape", "shape"),
        "elevation": _first(item, "tpgrphHgCodeNm", "terrainHeight", "height"),
        "individual_official_price": _to_float(_first(item, "pblntfPclnd", "officialLandPrice", "price")),
        "price_year": _to_int(_first(item, "stdrYear", "STD_YEAR", "stdYear", "year")),
        "last_updated_at": _first(item, "lastUpdtDt", "lastUpdateDate", "last_updt_dt"),
    }
    field_provenance = {
        field_name: Provenance.SOURCE_VWORLD_API
        for field_name, field_value in mapped.items()
        if field_value not in (None, "")
    }
    return LandCharacteristics(
        pnu=expected_pnu,
        **mapped,
        field_provenance=field_provenance,
        provenance=Provenance.SOURCE_VWORLD_API,
    )


class LandCharacteristicsProvider(ABC):
    """PNU-keyed provider. Implementations never fuzzy-select a parcel."""

    @abstractmethod
    def get_by_pnu(self, pnu: str, *, standard_year: int | None = None) -> Optional[LandCharacteristics]:
        raise NotImplementedError


class OfflineFixtureProvider(LandCharacteristicsProvider):
    def __init__(self, fixtures: Mapping[str, LandCharacteristics]):
        self._fixtures = dict(fixtures)

    def get_by_pnu(self, pnu: str, *, standard_year: int | None = None) -> Optional[LandCharacteristics]:
        return self._fixtures.get(pnu)


class PublicDataLandCharacteristicsProvider(LandCharacteristicsProvider):
    ENV_NAME = "PUBLIC_DATA_SERVICE_KEY"

    def __init__(self, *, service_key: str | None = None):
        self._service_key = _runtime_secret(service_key, self.ENV_NAME)

    @property
    def configured(self) -> bool:
        return bool(self._service_key)

    def get_by_pnu(self, pnu: str, *, standard_year: int | None = None) -> Optional[LandCharacteristics]:
        if not self.configured:
            raise ProviderError("PUBLIC_DATA_KEY_MISSING", f"{self.ENV_NAME} is not configured")
        raise ProviderError("PUBLIC_DATA_ADAPTER_UNAVAILABLE", "Public-data runtime adapter is not configured")


HttpTransport = Callable[[str, float], Mapping[str, Any]]


def default_json_transport(url: str, timeout: float, *, referer: str | None = None) -> Mapping[str, Any]:
    headers = {"User-Agent": "bosang-strategy-os/transaction-enrichment"}
    if referer:
        headers["Referer"] = referer
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, Mapping):
        raise ValueError("JSON root must be an object")
    return payload


_REAL_JSON_TRANSPORT = default_json_transport


class VWorldLandCharacteristicsProvider(LandCharacteristicsProvider):
    """Runtime VWorld adapter with environment-only credential loading."""

    ENV_NAME = "VWORLD_API_KEY"

    def __init__(
        self,
        *,
        api_key: str | None = None,
        domain: str | None = None,
        default_year: int | None = None,
        timeout: float = 10.0,
        transport: HttpTransport | None = None,
    ):
        self._api_key = _runtime_secret(api_key, self.ENV_NAME)
        # VWorld 서버 호출 인증은 키에 등록한 서비스 URL을 HTTP Referer로 보낼 때 통과한다.
        # 'domain' 쿼리 파라미터만 보내면 2D 데이터·국가중점(토지특성) API가 INCORRECT_KEY를 돌려준다(2026-11-24 실측).
        self._domain = domain if domain is not None else (os.getenv("VWORLD_DOMAIN") or os.getenv("VWORLD_API_DOMAIN") or "")
        self._default_year = default_year or (date.today().year - 1)
        self._timeout = timeout
        if transport is not None:
            self._transport = transport
        else:
            referer = self._domain.strip() or None

            def _vworld_transport(url: str, t: float) -> Mapping[str, Any]:
                fn = default_json_transport  # 모듈 전역(테스트에서 교체 가능)
                return fn(url, t, referer=referer) if fn is _REAL_JSON_TRANSPORT else fn(url, t)

            self._transport = _vworld_transport

    def __repr__(self) -> str:
        return (
            "VWorldLandCharacteristicsProvider(api_key='[REDACTED]', "
            f"domain={self._domain!r}, default_year={self._default_year!r}, timeout={self._timeout!r})"
        )

    @property
    def configured(self) -> bool:
        return bool(self._api_key)

    def _request_url(self, pnu: str, standard_year: int) -> str:
        params = {
            "key": self._api_key or "",
            "pnu": pnu,
            "stdrYear": str(standard_year),
            "format": "json",
            "numOfRows": "10",
            "pageNo": "1",
        }
        # 등록 서비스 URL은 Referer 헤더로만 보낸다. 토지특성 API는 domain 파라미터가 있으면 Referer가 맞아도 거부한다.
        return f"{VWORLD_LAND_CHARACTERISTICS_ENDPOINT}?{urllib.parse.urlencode(params)}"

    def get_by_pnu(
        self,
        pnu: str,
        *,
        standard_year: int | None = None,
        collapse_revisions: bool = False,
        diagnostics: dict[str, Any] | None = None,
    ) -> Optional[LandCharacteristics]:
        if not self.configured:
            raise ProviderError("VWORLD_API_KEY_MISSING", f"{self.ENV_NAME} is not configured")
        if not re.fullmatch(r"\d{19}", pnu):
            raise ProviderError("PNU_INVALID", "PNU must be exactly 19 digits")
        year = standard_year or self._default_year
        try:
            payload = self._transport(self._request_url(pnu, year), self._timeout)
            return parse_vworld_land_characteristics(
                payload, expected_pnu=pnu, expected_year=year, collapse_revisions=collapse_revisions, diagnostics=diagnostics
            )
        except ProviderError:
            raise
        except (TimeoutError, urllib.error.URLError, urllib.error.HTTPError, ssl.SSLError, ConnectionError, http.client.RemoteDisconnected) as exc:
            safe = redact_secrets(exc, (self._api_key or "",))
            raise ProviderError("VWORLD_TRANSPORT_ERROR", f"VWorld request failed safely: {safe}") from None
        except (ValueError, TypeError, json.JSONDecodeError) as exc:
            safe = redact_secrets(exc, (self._api_key or "",))
            raise ProviderError("VWORLD_RESPONSE_ERROR", f"VWorld response could not be parsed safely: {safe}") from None
        except Exception:
            raise ProviderError("VWORLD_INTERNAL_ERROR", "An unexpected internal error occurred during VWorld lookup") from None


VWORLD_DATA_ENDPOINT = "https://api.vworld.kr/req/data"


class VWorldCadastralParcelProvider:
    """연속지적도(LP_PA_CBND_BUBUN)에서 PNU 필지 존재·지번주소를 확인한다(도형 미요청).

    PNU 직접입력의 공식 검증에 쓴다. 인증은 VWorldLandCharacteristicsProvider와 같이 등록 서비스 URL을 Referer로 보낸다.
    """

    def __init__(self, *, api_key: str | None = None, domain: str | None = None, timeout: float = 10.0, transport: HttpTransport | None = None):
        self._api_key = _runtime_secret(api_key, VWorldLandCharacteristicsProvider.ENV_NAME)
        self._domain = domain if domain is not None else (os.getenv("VWORLD_DOMAIN") or os.getenv("VWORLD_API_DOMAIN") or "")
        self._timeout = timeout
        if transport is not None:
            self._transport = transport
        else:
            referer = self._domain.strip() or None

            def _vworld_transport(url: str, t: float) -> Mapping[str, Any]:
                fn = default_json_transport
                return fn(url, t, referer=referer) if fn is _REAL_JSON_TRANSPORT else fn(url, t)

            self._transport = _vworld_transport

    def __repr__(self) -> str:
        return f"VWorldCadastralParcelProvider(api_key='[REDACTED]', domain={self._domain!r})"

    @property
    def configured(self) -> bool:
        return bool(self._api_key)

    def get_by_pnu(self, pnu: str) -> dict[str, Any] | None:
        if not self.configured:
            raise ProviderError("VWORLD_API_KEY_MISSING", "VWORLD_API_KEY is not configured")
        if not re.fullmatch(r"\d{19}", pnu):
            raise ProviderError("PNU_INVALID", "PNU must be exactly 19 digits")
        params = {"service": "data", "request": "GetFeature", "data": "LP_PA_CBND_BUBUN", "attrFilter": f"pnu:=:{pnu}",
                  "geometry": "false", "size": "10", "format": "json", "key": self._api_key or ""}
        try:
            payload = self._transport(f"{VWORLD_DATA_ENDPOINT}?{urllib.parse.urlencode(params)}", self._timeout)
        except (TimeoutError, urllib.error.URLError, urllib.error.HTTPError, ssl.SSLError, ConnectionError, http.client.RemoteDisconnected) as exc:
            safe = redact_secrets(exc, (self._api_key or "",))
            raise ProviderError("VWORLD_TRANSPORT_ERROR", f"VWorld request failed safely: {safe}") from None
        except (ValueError, TypeError, json.JSONDecodeError):
            raise ProviderError("VWORLD_RESPONSE_ERROR", "VWorld cadastral response could not be parsed") from None
        response = payload.get("response") if isinstance(payload, Mapping) else None
        if not isinstance(response, Mapping):
            raise ProviderError("VWORLD_SCHEMA_CHANGED", "VWorld data response root was not found")
        status = str(response.get("status") or "").upper()
        if status == "NOT_FOUND":
            return None
        if status != "OK":
            error = response.get("error") if isinstance(response.get("error"), Mapping) else {}
            raise ProviderError("VWORLD_API_ERROR", _vworld_result_message(str(error.get("code") or status)))
        features = (((response.get("result") or {}).get("featureCollection") or {}).get("features")) or []
        exact = [f.get("properties") or {} for f in features if str((f.get("properties") or {}).get("pnu")) == pnu]
        if len(exact) != 1:
            if not exact:
                return None
            raise ProviderError("VWORLD_MULTIPLE_EXACT_MATCHES", "VWorld cadastral returned multiple exact PNU rows")
        p = exact[0]
        return {"pnu": pnu, "address": str(p.get("addr") or "") or None, "jibun": str(p.get("jibun") or "") or None,
                "price": _to_int(p.get("jiga")), "price_base": f"{p.get('gosi_year') or ''}-{p.get('gosi_month') or ''}".strip("-") or None}
