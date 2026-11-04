"""Public-data attribute adapter mock tests."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from app.adapters.base import AdapterErrorCode, FetchRequest, TransportResponse
from app.adapters.datago_attributes import (
    AttributeFieldMap,
    DataGoAttributeAdapter,
    DataGoAttributeConfig,
    PublicAttributeProfile,
)

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


def characteristic_config() -> DataGoAttributeConfig:
    return DataGoAttributeConfig(
        source_id="datago_land_characteristics",
        profile=PublicAttributeProfile.LAND_CHARACTERISTICS,
        endpoint="https://mock.example.test/land-characteristics",
        static_params={"format": "json"},
        pnu_param="pnuQuery",
        records_path=("response", "body", "items", "item"),
        pnu_property="pnuCode",
        fields=AttributeFieldMap(
            area="parcelArea",
            jimok="landCategory",
            use_zone="zoning",
            land_use="actualUse",
            road="roadFrontage",
            shape="parcelShape",
            topo="terrainHeight",
        ),
    )


def individual_price_config() -> DataGoAttributeConfig:
    return DataGoAttributeConfig(
        source_id="datago_individual_land_price",
        profile=PublicAttributeProfile.INDIVIDUAL_LAND_PRICE,
        endpoint="https://mock.example.test/individual-price",
        static_params={"format": "json"},
        pnu_param="pnuQuery",
        records_path=("response", "body", "items", "item"),
        pnu_property="pnuCode",
        fields=AttributeFieldMap(
            price_indv="officialPrice",
            price_base_year="baseYear",
        ),
        year_param="yearQuery",
    )


def standard_price_config() -> DataGoAttributeConfig:
    return DataGoAttributeConfig(
        source_id="datago_standard_land_price",
        profile=PublicAttributeProfile.STANDARD_LAND_PRICE,
        endpoint="https://mock.example.test/standard-price",
        static_params={"format": "json"},
        pnu_param="pnuQuery",
        records_path=("response", "body", "items", "item"),
        pnu_property="pnuCode",
        fields=AttributeFieldMap(
            price_std="standardPrice",
            price_std_year="baseYear",
            std_serial="standardSerial",
        ),
        year_param="yearQuery",
    )


def payload(records: list[dict[str, Any]] | dict[str, Any] | None) -> dict[str, Any]:
    return {"response": {"body": {"items": {"item": records}}}}


def fetch(
    tmp_path: Path,
    config: DataGoAttributeConfig,
    body: dict[str, Any],
    *,
    extra_params: dict[str, Any] | None = None,
):
    adapter = DataGoAttributeAdapter(
        config,
        MockTransport(response=TransportResponse(status_code=200, payload=body)),
    )
    return adapter.fetch(
        FetchRequest(pnu=PNU, raw_dir=tmp_path, extra_params=extra_params or {})
    )


def test_land_characteristics_maps_canonical_values_and_writes_raw(tmp_path: Path) -> None:
    record = {
        "pnuCode": PNU,
        "parcelArea": "4,006",
        "landCategory": "답",
        "zoning": "자연녹지지역",
        "actualUse": "답",
        "roadFrontage": "세로(가)",
        "parcelShape": "부정형",
        "terrainHeight": "평지",
    }
    result = fetch(tmp_path, characteristic_config(), payload(record))

    assert result.ok is True
    assert result.payload == {
        "profile": "LAND_CHARACTERISTICS",
        "public_values": {
            "area": 4006.0,
            "jimok": "답",
            "use_zone": "자연녹지지역",
            "land_use": "답",
            "road": "세로(가)",
            "shape": "부정형",
            "topo": "평지",
        },
    }
    assert result.provenance.kind.value == "ATTRIBUTE"
    raw_path = tmp_path / str(result.provenance.raw_path)
    assert json.loads(raw_path.read_text(encoding="utf-8"))["response"]["body"]["items"][
        "item"
    ]["pnuCode"] == PNU


def test_request_mapping_and_internal_base_year_are_config_driven(tmp_path: Path) -> None:
    transport = MockTransport(
        response=TransportResponse(
            status_code=200,
            payload=payload(
                {"pnuCode": PNU, "officialPrice": "927000", "baseYear": "2026"}
            ),
        )
    )
    adapter = DataGoAttributeAdapter(individual_price_config(), transport)
    adapter.fetch(
        FetchRequest(
            pnu=PNU,
            raw_dir=tmp_path,
            extra_params={"base_year": 2026, "pageNo": 1},
        )
    )

    _, params = transport.calls[0]
    assert params["pnuQuery"] == PNU
    assert params["yearQuery"] == 2026
    assert params["pageNo"] == 1
    assert "base_year" not in params


def test_individual_price_selects_latest_year_by_default(tmp_path: Path) -> None:
    records = [
        {"pnuCode": PNU, "officialPrice": "800000", "baseYear": "2025"},
        {"pnuCode": PNU, "officialPrice": "927,000", "baseYear": "2026"},
    ]
    result = fetch(tmp_path, individual_price_config(), payload(records))

    assert result.payload == {
        "profile": "INDIVIDUAL_LAND_PRICE",
        "public_values": {"price_indv": 927000.0, "price_base_year": 2026},
    }


def test_price_selects_requested_year(tmp_path: Path) -> None:
    records = [
        {"pnuCode": PNU, "officialPrice": "800000", "baseYear": "2025"},
        {"pnuCode": PNU, "officialPrice": "927000", "baseYear": "2026"},
    ]
    result = fetch(
        tmp_path,
        individual_price_config(),
        payload(records),
        extra_params={"base_year": 2025},
    )
    assert result.payload["public_values"]["price_base_year"] == 2025
    assert result.payload["public_values"]["price_indv"] == 800000.0


def test_standard_price_preserves_standard_serial_as_metadata(tmp_path: Path) -> None:
    result = fetch(
        tmp_path,
        standard_price_config(),
        payload(
            {
                "pnuCode": PNU,
                "standardPrice": "293000",
                "baseYear": "2021",
                "standardSerial": "118",
            }
        ),
    )
    assert result.payload == {
        "profile": "STANDARD_LAND_PRICE",
        "public_values": {"price_std": 293000.0, "price_std_year": 2021},
        "record_meta": {"std_serial": "118"},
    }


@pytest.mark.parametrize("records", [None, []])
def test_empty_items_become_not_found(tmp_path: Path, records: Any) -> None:
    result = fetch(tmp_path, characteristic_config(), payload(records))
    assert result.error.code is AdapterErrorCode.NOT_FOUND


def test_wrong_pnu_becomes_pnu_mismatch(tmp_path: Path) -> None:
    result = fetch(
        tmp_path,
        characteristic_config(),
        payload({"pnuCode": OTHER_PNU, "landCategory": "답"}),
    )
    assert result.error.code is AdapterErrorCode.PNU_MISMATCH
    assert result.error.detail["actual"] == [OTHER_PNU]


def test_missing_pnu_property_is_malformed(tmp_path: Path) -> None:
    result = fetch(
        tmp_path,
        characteristic_config(),
        payload({"landCategory": "답"}),
    )
    assert result.error.code is AdapterErrorCode.MALFORMED_RESPONSE


def test_missing_records_path_is_malformed(tmp_path: Path) -> None:
    result = fetch(tmp_path, characteristic_config(), {"response": {"body": {}}})
    assert result.error.code is AdapterErrorCode.MALFORMED_RESPONSE


def test_multiple_characteristic_records_are_ambiguous(tmp_path: Path) -> None:
    result = fetch(
        tmp_path,
        characteristic_config(),
        payload(
            [
                {"pnuCode": PNU, "landCategory": "답"},
                {"pnuCode": PNU, "landCategory": "전"},
            ]
        ),
    )
    assert result.error.code is AdapterErrorCode.AMBIGUOUS


def test_duplicate_price_year_is_ambiguous(tmp_path: Path) -> None:
    result = fetch(
        tmp_path,
        individual_price_config(),
        payload(
            [
                {"pnuCode": PNU, "officialPrice": "1", "baseYear": "2026"},
                {"pnuCode": PNU, "officialPrice": "2", "baseYear": "2026"},
            ]
        ),
    )
    assert result.error.code is AdapterErrorCode.AMBIGUOUS


def test_requested_year_not_found_is_explicit(tmp_path: Path) -> None:
    result = fetch(
        tmp_path,
        individual_price_config(),
        payload(
            [
                {"pnuCode": PNU, "officialPrice": "1", "baseYear": "2025"},
                {"pnuCode": PNU, "officialPrice": "2", "baseYear": "2026"},
            ]
        ),
        extra_params={"base_year": 2024},
    )
    assert result.error.code is AdapterErrorCode.NOT_FOUND
    assert result.error.detail["available_years"] == [2025, 2026]


@pytest.mark.parametrize(
    ("record", "profile"),
    [
        ({"pnuCode": PNU, "officialPrice": "not-a-number", "baseYear": "2026"}, "indv"),
        ({"pnuCode": PNU, "officialPrice": "1", "baseYear": "20x6"}, "indv"),
        ({"pnuCode": PNU, "standardPrice": "", "baseYear": "2021"}, "std"),
    ],
)
def test_required_price_values_must_be_valid(
    tmp_path: Path,
    record: dict[str, Any],
    profile: str,
) -> None:
    config = individual_price_config() if profile == "indv" else standard_price_config()
    result = fetch(tmp_path, config, payload(record))
    assert result.error.code is AdapterErrorCode.MALFORMED_RESPONSE


@pytest.mark.parametrize("status_code", [401, 403])
def test_auth_failure_is_not_retryable(tmp_path: Path, status_code: int) -> None:
    adapter = DataGoAttributeAdapter(
        characteristic_config(),
        MockTransport(
            response=TransportResponse(status_code=status_code, payload={"error": "auth"})
        ),
    )
    result = adapter.fetch(FetchRequest(pnu=PNU, raw_dir=tmp_path))
    assert result.error.code is AdapterErrorCode.AUTH
    assert result.error.retryable is False


def test_server_error_is_retryable(tmp_path: Path) -> None:
    adapter = DataGoAttributeAdapter(
        characteristic_config(),
        MockTransport(
            response=TransportResponse(status_code=503, payload={"error": "down"})
        ),
    )
    result = adapter.fetch(FetchRequest(pnu=PNU, raw_dir=tmp_path))
    assert result.error.code is AdapterErrorCode.HTTP
    assert result.error.retryable is True


def test_transport_error_is_retryable_and_writes_no_raw(tmp_path: Path) -> None:
    adapter = DataGoAttributeAdapter(
        characteristic_config(),
        MockTransport(exception=TimeoutError("timeout")),
    )
    result = adapter.fetch(FetchRequest(pnu=PNU, raw_dir=tmp_path))
    assert result.error.code is AdapterErrorCode.TRANSPORT
    assert result.error.retryable is True
    assert result.provenance.raw_path is None
    assert list(tmp_path.iterdir()) == []


def test_config_rejects_unapproved_profile_mapping_and_endpoint_query() -> None:
    values = characteristic_config().model_dump()
    values["fields"]["price_indv"] = "unexpected"
    with pytest.raises(ValueError, match="not allowed"):
        DataGoAttributeConfig(**values)

    values = characteristic_config().model_dump()
    values["fields"]["road"] = values["fields"]["jimok"]
    with pytest.raises(ValueError, match="only one canonical field"):
        DataGoAttributeConfig(**values)

    values = characteristic_config().model_dump()
    values["endpoint"] = "https://example.test/api?serviceKey=secret"
    with pytest.raises(ValueError, match="query parameters"):
        DataGoAttributeConfig(**values)
