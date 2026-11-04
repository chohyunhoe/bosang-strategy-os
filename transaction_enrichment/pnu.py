from __future__ import annotations

import html
import http.client
import os
import re
import ssl
import urllib.error
import urllib.parse
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

from .providers import ProviderError, default_json_transport, redact_secrets


VWORLD_ADDRESS_SEARCH_ENDPOINT = "https://api.vworld.kr/req/search"


@dataclass(frozen=True)
class PnuResolution:
    pnu: str
    matched_parcel_address: str
    candidate_count: int


class PnuResolutionError(ProviderError):
    pass


def normalize_parcel_address(value: str) -> str:
    cleaned = html.unescape(re.sub(r"<[^>]+>", "", value or ""))
    cleaned = re.sub(r"[(),]", " ", cleaned)
    return re.sub(r"\s+", " ", cleaned).strip()


def parse_vworld_address_candidates(payload: Mapping[str, Any], *, expected_address: str) -> PnuResolution:
    response = payload.get("response")
    if not isinstance(response, Mapping):
        raise PnuResolutionError("PNU_SEARCH_SCHEMA_CHANGED", "VWorld address-search response root was not found")
    status = str(((response.get("status") or "") if isinstance(response, Mapping) else "")).upper()
    if status and status not in {"OK", "SUCCESS"}:
        raise PnuResolutionError("PNU_SEARCH_FAILED", "VWorld address search did not return success")
    result = response.get("result")
    items = result.get("items") if isinstance(result, Mapping) else []
    if isinstance(items, Mapping):
        items = [items]
    if not isinstance(items, list):
        items = []

    expected = normalize_parcel_address(expected_address)
    exact: dict[str, str] = {}
    for item in items:
        if not isinstance(item, Mapping):
            continue
        pnu = str(item.get("id") or item.get("pnu") or "")
        address = item.get("address")
        parcel = address.get("parcel") if isinstance(address, Mapping) else None
        candidate_address = str(parcel or item.get("title") or "")
        if re.fullmatch(r"\d{19}", pnu) and normalize_parcel_address(candidate_address) == expected:
            exact[pnu] = normalize_parcel_address(candidate_address)

    if not exact:
        raise PnuResolutionError("PNU_EXACT_MATCH_NOT_FOUND", "No exact parcel-address/PNU candidate was found")
    if len(exact) != 1:
        raise PnuResolutionError("PNU_MULTIPLE_EXACT_MATCHES", "Multiple exact parcel-address/PNU candidates require review")
    pnu, address = next(iter(exact.items()))
    return PnuResolution(pnu=pnu, matched_parcel_address=address, candidate_count=1)


SearchTransport = Callable[[str, float], Mapping[str, Any]]


class VWorldAddressPnuResolver:
    """Exact parcel-address resolver; fuzzy or first-result selection is prohibited."""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        timeout: float = 10.0,
        transport: SearchTransport | None = None,
    ):
        self._api_key = api_key or os.getenv("VWORLD_API_KEY")
        self._timeout = timeout
        self._transport = transport or default_json_transport

    def resolve(self, address: str) -> PnuResolution:
        if not self._api_key:
            raise PnuResolutionError("VWORLD_API_KEY_MISSING", "VWORLD_API_KEY is not configured")
        params = {
            "service": "search",
            "request": "search",
            "version": "2.0",
            "crs": "EPSG:4326",
            "size": "10",
            "page": "1",
            "query": address,
            "type": "address",
            "category": "parcel",
            "format": "json",
            "errorformat": "json",
            "key": self._api_key,
        }
        url = f"{VWORLD_ADDRESS_SEARCH_ENDPOINT}?{urllib.parse.urlencode(params)}"
        try:
            payload = self._transport(url, self._timeout)
            return parse_vworld_address_candidates(payload, expected_address=address)
        except PnuResolutionError:
            raise
        except (TimeoutError, urllib.error.URLError, urllib.error.HTTPError, ssl.SSLError, ConnectionError, http.client.RemoteDisconnected) as exc:
            safe = redact_secrets(exc, (self._api_key,))
            raise PnuResolutionError("PNU_SEARCH_TRANSPORT_ERROR", f"PNU search failed safely: {safe}") from None
        except Exception:
            raise PnuResolutionError("PNU_SEARCH_INTERNAL_ERROR", "An unexpected internal error occurred during PNU search") from None
