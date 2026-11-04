"""Config-driven VWorld parcel geometry adapter.

This module deliberately does not hardcode a production endpoint, layer name, filter
parameter, CRS, quota or credential. PR-04 validates the adapter boundary with a mock
transport only. Official service details must later be supplied from sources.yaml.
"""

from __future__ import annotations

from typing import Any

from pydantic import Field, field_validator

from app.adapters.base import (
    AdapterError,
    AdapterErrorCode,
    FetchKind,
    FetchRequest,
    FetchResult,
    JsonTransport,
    ProvenanceRecord,
    canonical_params_hash,
    utc_now,
    write_raw_payload,
)
from app.models.common import StrictModel


class VWorldGeometryConfig(StrictModel):
    source_id: str = Field(default="vworld_wfs", pattern=r"^[A-Za-z0-9._-]+$")
    endpoint: str = Field(min_length=8, max_length=500)
    static_params: dict[str, str | int | float | bool]
    layer_param: str = Field(min_length=1, max_length=80)
    layer_name: str = Field(min_length=1, max_length=160)
    filter_param: str = Field(min_length=1, max_length=80)
    filter_template: str = Field(min_length=5, max_length=300)
    pnu_property: str = Field(min_length=1, max_length=80)
    source_crs: str | None = Field(default=None, max_length=40)

    @field_validator("endpoint")
    @classmethod
    def validate_endpoint(cls, value: str) -> str:
        if not value.startswith(("https://", "http://127.0.0.1", "http://localhost")):
            raise ValueError("Adapter endpoint must use HTTPS or a local mock endpoint")
        if "?" in value:
            raise ValueError("Credentials and query parameters must not be embedded in endpoint")
        return value.rstrip("/")

    @field_validator("filter_template")
    @classmethod
    def validate_filter_template(cls, value: str) -> str:
        if value.count("{pnu}") != 1:
            raise ValueError("filter_template must contain exactly one {pnu} placeholder")
        return value


class VWorldGeometryAdapter:
    """Fetch one parcel polygon through a configurable JSON transport."""

    auto_apply = True

    def __init__(self, config: VWorldGeometryConfig, transport: JsonTransport) -> None:
        self.config = config
        self.transport = transport
        self.source_id = config.source_id

    def fetch(self, request: FetchRequest) -> FetchResult:
        params = dict(self.config.static_params)
        params[self.config.layer_param] = self.config.layer_name
        params[self.config.filter_param] = self.config.filter_template.format(pnu=request.pnu)
        params.update(request.extra_params)
        params_hash = canonical_params_hash(params)
        fetched_at = utc_now()

        try:
            response = self.transport.get_json(self.config.endpoint, params)
        except Exception as exc:  # transport implementations normalize their own exceptions later
            provenance = self._provenance(
                request=request,
                params_hash=params_hash,
                fetched_at=fetched_at,
                http_status=None,
                raw_path=None,
            )
            return FetchResult(
                ok=False,
                provenance=provenance,
                error=AdapterError(
                    code=AdapterErrorCode.TRANSPORT,
                    message="Geometry transport failed",
                    retryable=True,
                    detail={"exception_type": type(exc).__name__},
                ),
            )

        raw_path = write_raw_payload(
            request.raw_dir,
            source_id=self.source_id,
            pnu=request.pnu,
            params_hash=params_hash,
            payload=response.payload,
        )
        provenance = self._provenance(
            request=request,
            params_hash=params_hash,
            fetched_at=fetched_at,
            http_status=response.status_code,
            raw_path=raw_path,
        )

        if response.status_code in {401, 403}:
            return self._failure(
                provenance,
                AdapterErrorCode.AUTH,
                "VWorld geometry authentication failed",
            )
        if not 200 <= response.status_code < 300:
            return self._failure(
                provenance,
                AdapterErrorCode.HTTP,
                f"VWorld geometry returned HTTP {response.status_code}",
                retryable=response.status_code >= 500,
            )

        parsed = self._parse_feature(request.pnu, response.payload)
        if isinstance(parsed, AdapterError):
            return FetchResult(ok=False, provenance=provenance, error=parsed)
        return FetchResult(ok=True, payload=parsed, provenance=provenance)

    def _parse_feature(
        self,
        expected_pnu: str,
        payload: dict[str, Any],
    ) -> dict[str, Any] | AdapterError:
        if payload.get("type") != "FeatureCollection" or not isinstance(
            payload.get("features"), list
        ):
            return AdapterError(
                code=AdapterErrorCode.MALFORMED_RESPONSE,
                message="Geometry response is not a GeoJSON FeatureCollection",
            )

        features = payload["features"]
        if not features:
            return AdapterError(
                code=AdapterErrorCode.NOT_FOUND,
                message="No parcel geometry was returned",
            )
        if len(features) != 1:
            return AdapterError(
                code=AdapterErrorCode.AMBIGUOUS,
                message="More than one parcel geometry was returned",
                detail={"feature_count": len(features)},
            )

        feature = features[0]
        if not isinstance(feature, dict) or feature.get("type") != "Feature":
            return self._malformed("Geometry item is not a GeoJSON Feature")
        properties = feature.get("properties")
        geometry = feature.get("geometry")
        if not isinstance(properties, dict) or not isinstance(geometry, dict):
            return self._malformed("Geometry feature lacks properties or geometry")

        actual_pnu = properties.get(self.config.pnu_property)
        if actual_pnu is None:
            return self._malformed("Geometry feature lacks the configured PNU property")
        if str(actual_pnu) != expected_pnu:
            return AdapterError(
                code=AdapterErrorCode.PNU_MISMATCH,
                message="Returned geometry belongs to a different PNU",
                detail={"expected": expected_pnu, "actual": str(actual_pnu)},
            )

        geometry_type = geometry.get("type")
        if geometry_type not in {"Polygon", "MultiPolygon"} or not geometry.get("coordinates"):
            return self._malformed("Parcel geometry must be a non-empty Polygon or MultiPolygon")

        return {
            "type": "Feature",
            "geometry": geometry,
            "properties": properties,
            "source_crs": self.config.source_crs,
        }

    def _malformed(self, message: str) -> AdapterError:
        return AdapterError(code=AdapterErrorCode.MALFORMED_RESPONSE, message=message)

    def _failure(
        self,
        provenance: ProvenanceRecord,
        code: AdapterErrorCode,
        message: str,
        *,
        retryable: bool = False,
    ) -> FetchResult:
        return FetchResult(
            ok=False,
            provenance=provenance,
            error=AdapterError(code=code, message=message, retryable=retryable),
        )

    def _provenance(
        self,
        *,
        request: FetchRequest,
        params_hash: str,
        fetched_at: Any,
        http_status: int | None,
        raw_path: str | None,
    ) -> ProvenanceRecord:
        return ProvenanceRecord(
            source_id=self.source_id,
            kind=FetchKind.GEOMETRY,
            pnu=request.pnu,
            endpoint=self.config.endpoint,
            params_hash=params_hash,
            fetched_at=fetched_at,
            http_status=http_status,
            raw_path=raw_path,
        )
