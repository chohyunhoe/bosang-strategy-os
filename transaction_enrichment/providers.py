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


def parse_vworld_land_characteristics(
    payload: Mapping[str, Any], *, expected_pnu: str, expected_year: int
) -> LandCharacteristics | None:
    """Parse one exact VWorld PNU/year result; zero or multiple rows fail closed."""
    root = payload.get("landCharacteristicss") or payload.get("landCharacteristics")
    if not isinstance(root, Mapping):
        response = payload.get("response")
        if isinstance(response, Mapping):
            result_code = str(_first(response, "resultCode", "resultCd", "errorCode") or "")
            if result_code.upper() not in _SUCCESS_CODES:
                raise ProviderError("VWORLD_API_ERROR", "VWorld returned a non-success result code")
        raise ProviderError("VWORLD_SCHEMA_CHANGED", "VWorld land-characteristics root was not found")

    result_code = str(_first(root, "resultCode", "resultCd", "errorCode") or "")
    if result_code.upper() not in _SUCCESS_CODES:
        raise ProviderError("VWORLD_API_ERROR", "VWorld returned a non-success result code")

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
    if len(exact) != 1:
        raise ProviderError("VWORLD_MULTIPLE_EXACT_MATCHES", "Multiple exact PNU/year response rows require review")

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


def default_json_transport(url: str, timeout: float) -> Mapping[str, Any]:
    request = urllib.request.Request(url, headers={"User-Agent": "bosang-strategy-os/transaction-enrichment"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, Mapping):
        raise ValueError("JSON root must be an object")
    return payload


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
        self._domain = domain if domain is not None else os.getenv("VWORLD_DOMAIN", "")
        self._default_year = default_year or (date.today().year - 1)
        self._timeout = timeout
        self._transport = transport or default_json_transport

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
        if self._domain:
            params["domain"] = self._domain
        return f"{VWORLD_LAND_CHARACTERISTICS_ENDPOINT}?{urllib.parse.urlencode(params)}"

    def get_by_pnu(self, pnu: str, *, standard_year: int | None = None) -> Optional[LandCharacteristics]:
        if not self.configured:
            raise ProviderError("VWORLD_API_KEY_MISSING", f"{self.ENV_NAME} is not configured")
        if not re.fullmatch(r"\d{19}", pnu):
            raise ProviderError("PNU_INVALID", "PNU must be exactly 19 digits")
        year = standard_year or self._default_year
        try:
            payload = self._transport(self._request_url(pnu, year), self._timeout)
            return parse_vworld_land_characteristics(payload, expected_pnu=pnu, expected_year=year)
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
