"""Adapter framework and VWorld geometry mock tests."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from app.adapters import (
    AdapterErrorCode,
    AdapterRegistry,
    AdapterRegistryError,
    FetchRequest,
    TransportResponse,
    VWorldGeometryAdapter,
    VWorldGeometryConfig,
)
from app.adapters.base import canonical_params_hash

PNU = "4139013200101200007"
OTHER_PNU = "4139013200101200008"


class MockTransport:
    def __init__(
        self,
        response: TransportResponse | None = None,
        exception: Exception | None = None,
    ) -> None:
        self.response = response
        self.exception = exception
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def get_json(self, endpoint: str, params: dict[str, Any]) -> TransportResponse:
        self.calls.append((endpoint, params))
        if self.exception:
            raise self.exception
        assert self.response is not None
        return self.response


class ReferenceOnlyAdapter:
    source_id = "value_map"
    auto_apply = False

    def fetch(self, request: FetchRequest) -> None:
        return None


def config() -> VWorldGeometryConfig:
    return VWorldGeometryConfig(
        endpoint="https://mock.example.test/vworld",
        static_params={"service": "WFS", "request": "GetFeature"},
        layer_param="typeName",
        layer_name="OFFICIAL_LAYER_REQUIRED",
        filter_param="filter",
        filter_template="pnu='{pnu}'",
        pnu_property="pnu",
        source_crs="OFFICIAL_CRS_REQUIRED",
    )


def feature_collection(pnu: str = PNU, *, geometry_type: str = "Polygon") -> dict[str, Any]:
    coordinates: Any
    if geometry_type == "Polygon":
        coordinates = [[[0, 0], [1, 0], [1, 1], [0, 0]]]
    else:
        coordinates = [[[[0, 0], [1, 0], [1, 1], [0, 0]]]]
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"pnu": pnu, "label": "과림동 120-7"},
                "geometry": {"type": geometry_type, "coordinates": coordinates},
            }
        ],
    }


def fetch(tmp_path: Path, response: TransportResponse):
    adapter = VWorldGeometryAdapter(config(), MockTransport(response=response))
    return adapter.fetch(FetchRequest(pnu=PNU, raw_dir=tmp_path))


def test_geometry_success_persists_raw_and_provenance(tmp_path: Path) -> None:
    result = fetch(tmp_path, TransportResponse(status_code=200, payload=feature_collection()))

    assert result.ok is True
    assert result.error is None
    assert result.payload is not None
    assert result.payload["geometry"]["type"] == "Polygon"
    assert result.payload["source_crs"] == "OFFICIAL_CRS_REQUIRED"
    assert result.provenance.pnu == PNU
    assert result.provenance.http_status == 200
    assert result.provenance.raw_path is not None
    raw_path = tmp_path / result.provenance.raw_path
    assert raw_path.exists()
    assert json.loads(raw_path.read_text(encoding="utf-8"))["features"][0]["properties"][
        "pnu"
    ] == PNU


def test_request_mapping_is_config_driven(tmp_path: Path) -> None:
    transport = MockTransport(
        response=TransportResponse(status_code=200, payload=feature_collection())
    )
    adapter = VWorldGeometryAdapter(config(), transport)
    adapter.fetch(FetchRequest(pnu=PNU, raw_dir=tmp_path, extra_params={"page": 1}))

    endpoint, params = transport.calls[0]
    assert endpoint == "https://mock.example.test/vworld"
    assert params["typeName"] == "OFFICIAL_LAYER_REQUIRED"
    assert params["filter"] == f"pnu='{PNU}'"
    assert params["page"] == 1


def test_sensitive_parameter_values_do_not_change_provenance_hash() -> None:
    first = canonical_params_hash({"pnu": PNU, "serviceKey": "secret-a"})
    second = canonical_params_hash({"pnu": PNU, "serviceKey": "secret-b"})
    assert first == second


@pytest.mark.parametrize("status_code", [401, 403])
def test_auth_failure_is_not_retryable(tmp_path: Path, status_code: int) -> None:
    result = fetch(tmp_path, TransportResponse(status_code=status_code, payload={"error": "auth"}))
    assert result.ok is False
    assert result.error is not None
    assert result.error.code is AdapterErrorCode.AUTH
    assert result.error.retryable is False


def test_server_failure_is_retryable(tmp_path: Path) -> None:
    result = fetch(tmp_path, TransportResponse(status_code=503, payload={"error": "down"}))
    assert result.error is not None
    assert result.error.code is AdapterErrorCode.HTTP
    assert result.error.retryable is True


def test_empty_feature_collection_becomes_not_found(tmp_path: Path) -> None:
    result = fetch(
        tmp_path,
        TransportResponse(status_code=200, payload={"type": "FeatureCollection", "features": []}),
    )
    assert result.error is not None
    assert result.error.code is AdapterErrorCode.NOT_FOUND


def test_multiple_features_become_ambiguous(tmp_path: Path) -> None:
    payload = feature_collection()
    payload["features"].append(payload["features"][0])
    result = fetch(tmp_path, TransportResponse(status_code=200, payload=payload))
    assert result.error is not None
    assert result.error.code is AdapterErrorCode.AMBIGUOUS


def test_wrong_pnu_is_rejected(tmp_path: Path) -> None:
    result = fetch(
        tmp_path,
        TransportResponse(status_code=200, payload=feature_collection(OTHER_PNU)),
    )
    assert result.error is not None
    assert result.error.code is AdapterErrorCode.PNU_MISMATCH


@pytest.mark.parametrize("geometry_type", ["Point", "LineString"])
def test_non_parcel_geometry_is_rejected(tmp_path: Path, geometry_type: str) -> None:
    result = fetch(
        tmp_path,
        TransportResponse(
            status_code=200,
            payload=feature_collection(geometry_type=geometry_type),
        ),
    )
    assert result.error is not None
    assert result.error.code is AdapterErrorCode.MALFORMED_RESPONSE


def test_transport_exception_is_retryable_and_writes_no_raw(tmp_path: Path) -> None:
    adapter = VWorldGeometryAdapter(config(), MockTransport(exception=TimeoutError("timeout")))
    result = adapter.fetch(FetchRequest(pnu=PNU, raw_dir=tmp_path))

    assert result.error is not None
    assert result.error.code is AdapterErrorCode.TRANSPORT
    assert result.error.retryable is True
    assert result.provenance.raw_path is None
    assert list(tmp_path.iterdir()) == []


def test_registry_allows_only_unique_auto_apply_adapters() -> None:
    adapter = VWorldGeometryAdapter(
        config(),
        MockTransport(response=TransportResponse(status_code=200, payload=feature_collection())),
    )
    registry = AdapterRegistry()
    registry.register(adapter)

    assert registry.get("vworld_wfs") is adapter
    assert registry.source_ids() == ("vworld_wfs",)
    with pytest.raises(AdapterRegistryError, match="Duplicate"):
        registry.register(adapter)
    with pytest.raises(AdapterRegistryError, match="Reference-only"):
        registry.register(ReferenceOnlyAdapter())
    with pytest.raises(AdapterRegistryError, match="Unknown"):
        registry.get("missing")


def test_config_rejects_endpoint_query_and_missing_placeholder() -> None:
    values = config().model_dump()
    values["endpoint"] = "https://example.test/wfs?key=secret"
    with pytest.raises(ValueError, match="query parameters"):
        VWorldGeometryConfig(**values)

    values = config().model_dump()
    values["filter_template"] = "pnu='fixed'"
    with pytest.raises(ValueError, match="placeholder"):
        VWorldGeometryConfig(**values)
