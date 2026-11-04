"""Config-driven public-data attribute adapters.

PR-05 deliberately validates response mapping with mock transports only. Production
endpoints, query parameter names, response paths, field names, quotas and credentials
must be supplied from reviewed configuration after checking official documentation.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import Field, field_validator, model_validator

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
from app.models.parcel import PublicLandSnapshot


class PublicAttributeProfile(StrEnum):
    LAND_CHARACTERISTICS = "LAND_CHARACTERISTICS"
    INDIVIDUAL_LAND_PRICE = "INDIVIDUAL_LAND_PRICE"
    STANDARD_LAND_PRICE = "STANDARD_LAND_PRICE"


class AttributeFieldMap(StrictModel):
    area: str | None = Field(default=None, max_length=80)
    jimok: str | None = Field(default=None, max_length=80)
    use_zone: str | None = Field(default=None, max_length=80)
    use_etc: str | None = Field(default=None, max_length=80)
    land_use: str | None = Field(default=None, max_length=80)
    road: str | None = Field(default=None, max_length=80)
    shape: str | None = Field(default=None, max_length=80)
    topo: str | None = Field(default=None, max_length=80)
    price_indv: str | None = Field(default=None, max_length=80)
    price_base_year: str | None = Field(default=None, max_length=80)
    price_std: str | None = Field(default=None, max_length=80)
    price_std_year: str | None = Field(default=None, max_length=80)
    std_serial: str | None = Field(default=None, max_length=80)

    def configured(self) -> dict[str, str]:
        return {
            key: value
            for key, value in self.model_dump().items()
            if isinstance(value, str) and value
        }


_CHARACTERISTIC_FIELDS = {
    "area",
    "jimok",
    "use_zone",
    "use_etc",
    "land_use",
    "road",
    "shape",
    "topo",
}
_INDIVIDUAL_PRICE_FIELDS = {"price_indv", "price_base_year"}
_STANDARD_PRICE_FIELDS = {"price_std", "price_std_year", "std_serial"}
_NUMERIC_FIELDS = {"area", "price_indv", "price_std"}
_INTEGER_FIELDS = {"price_base_year", "price_std_year"}


class DataGoAttributeConfig(StrictModel):
    source_id: str = Field(pattern=r"^[A-Za-z0-9._-]+$")
    profile: PublicAttributeProfile
    endpoint: str = Field(min_length=8, max_length=500)
    static_params: dict[str, str | int | float | bool]
    pnu_param: str = Field(min_length=1, max_length=80)
    records_path: tuple[str, ...] = Field(min_length=1)
    pnu_property: str = Field(min_length=1, max_length=80)
    fields: AttributeFieldMap
    year_param: str | None = Field(default=None, max_length=80)

    @field_validator("endpoint")
    @classmethod
    def validate_endpoint(cls, value: str) -> str:
        if not value.startswith(("https://", "http://127.0.0.1", "http://localhost")):
            raise ValueError("Adapter endpoint must use HTTPS or a local mock endpoint")
        if "?" in value:
            raise ValueError("Credentials and query parameters must not be embedded in endpoint")
        return value.rstrip("/")

    @field_validator("records_path")
    @classmethod
    def validate_records_path(cls, values: tuple[str, ...]) -> tuple[str, ...]:
        if any(not value or "." in value for value in values):
            raise ValueError("records_path must contain plain non-empty object keys")
        return values

    @model_validator(mode="after")
    def validate_profile_fields(self) -> DataGoAttributeConfig:
        configured_map = self.fields.configured()
        configured = set(configured_map)
        source_fields = list(configured_map.values())
        if len(set(source_fields)) != len(source_fields):
            raise ValueError("Each response field may map to only one canonical field")
        if self.profile is PublicAttributeProfile.LAND_CHARACTERISTICS:
            if not configured.intersection(_CHARACTERISTIC_FIELDS):
                raise ValueError(
                    "LAND_CHARACTERISTICS requires at least one characteristic mapping"
                )
            invalid = configured - _CHARACTERISTIC_FIELDS
        elif self.profile is PublicAttributeProfile.INDIVIDUAL_LAND_PRICE:
            missing = _INDIVIDUAL_PRICE_FIELDS - configured
            if missing:
                raise ValueError(f"INDIVIDUAL_LAND_PRICE missing mappings: {sorted(missing)}")
            invalid = configured - _INDIVIDUAL_PRICE_FIELDS
        else:
            missing = {"price_std", "price_std_year"} - configured
            if missing:
                raise ValueError(f"STANDARD_LAND_PRICE missing mappings: {sorted(missing)}")
            invalid = configured - _STANDARD_PRICE_FIELDS
        if invalid:
            raise ValueError(f"Mappings are not allowed for {self.profile}: {sorted(invalid)}")
        return self


class DataGoAttributeAdapter:
    """Fetch and normalize one configured public-data attribute response."""

    auto_apply = True

    def __init__(self, config: DataGoAttributeConfig, transport: JsonTransport) -> None:
        self.config = config
        self.transport = transport
        self.source_id = config.source_id

    def fetch(self, request: FetchRequest) -> FetchResult:
        params = dict(self.config.static_params)
        params[self.config.pnu_param] = request.pnu
        extra_params = dict(request.extra_params)
        requested_year = extra_params.pop("base_year", None)
        if requested_year is not None and self.config.year_param:
            params[self.config.year_param] = requested_year
        params.update(extra_params)
        params_hash = canonical_params_hash(params)
        fetched_at = utc_now()

        try:
            response = self.transport.get_json(self.config.endpoint, params)
        except Exception as exc:
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
                    message="Public-data attribute transport failed",
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
                "Public-data attribute authentication failed",
            )
        if not 200 <= response.status_code < 300:
            return self._failure(
                provenance,
                AdapterErrorCode.HTTP,
                f"Public-data attribute source returned HTTP {response.status_code}",
                retryable=response.status_code >= 500,
            )

        parsed = self._parse_payload(
            expected_pnu=request.pnu,
            payload=response.payload,
            requested_year=requested_year,
        )
        if isinstance(parsed, AdapterError):
            return FetchResult(ok=False, provenance=provenance, error=parsed)
        return FetchResult(ok=True, payload=parsed, provenance=provenance)

    def _parse_payload(
        self,
        *,
        expected_pnu: str,
        payload: dict[str, Any],
        requested_year: str | int | float | bool | None,
    ) -> dict[str, Any] | AdapterError:
        records = self._records(payload)
        if isinstance(records, AdapterError):
            return records
        if not records:
            return AdapterError(
                code=AdapterErrorCode.NOT_FOUND,
                message="No public-data attribute record was returned",
            )

        missing_pnu = [record for record in records if self.config.pnu_property not in record]
        if missing_pnu:
            return self._malformed("Attribute record lacks the configured PNU property")

        matches = [
            record
            for record in records
            if str(record.get(self.config.pnu_property)).strip() == expected_pnu
        ]
        if not matches:
            return AdapterError(
                code=AdapterErrorCode.PNU_MISMATCH,
                message="Returned attribute records belong to a different PNU",
                detail={
                    "expected": expected_pnu,
                    "actual": sorted(
                        {str(record.get(self.config.pnu_property)).strip() for record in records}
                    ),
                },
            )

        selected = self._select_record(matches, requested_year=requested_year)
        if isinstance(selected, AdapterError):
            return selected
        return self._map_record(selected)

    def _records(self, payload: dict[str, Any]) -> list[dict[str, Any]] | AdapterError:
        cursor: Any = payload
        for key in self.config.records_path:
            if not isinstance(cursor, dict) or key not in cursor:
                path_label = "/".join(self.config.records_path)
                return self._malformed(
                    f"Response does not contain configured records path: {path_label}"
                )
            cursor = cursor[key]
        if cursor is None:
            return []
        if isinstance(cursor, dict):
            return [cursor]
        if isinstance(cursor, list) and all(isinstance(item, dict) for item in cursor):
            return cursor
        return self._malformed("Configured records path must resolve to an object or object list")

    def _select_record(
        self,
        records: list[dict[str, Any]],
        *,
        requested_year: str | int | float | bool | None,
    ) -> dict[str, Any] | AdapterError:
        if len(records) == 1:
            record = records[0]
            if (
                requested_year is not None
                and self.config.profile is not PublicAttributeProfile.LAND_CHARACTERISTICS
            ):
                year_field = self._year_source_field()
                parsed_year = self._to_int(record.get(year_field), year_field)
                if isinstance(parsed_year, AdapterError):
                    return parsed_year
                requested = self._to_int(requested_year, "base_year")
                if isinstance(requested, AdapterError):
                    return requested
                if parsed_year != requested:
                    return AdapterError(
                        code=AdapterErrorCode.NOT_FOUND,
                        message="Requested base year was not returned",
                        detail={"requested_year": requested, "returned_year": parsed_year},
                    )
            return record

        if self.config.profile is PublicAttributeProfile.LAND_CHARACTERISTICS:
            return AdapterError(
                code=AdapterErrorCode.AMBIGUOUS,
                message="More than one land-characteristics record was returned",
                detail={"record_count": len(records)},
            )

        year_field = self._year_source_field()
        by_year: dict[int, list[dict[str, Any]]] = {}
        for record in records:
            parsed_year = self._to_int(record.get(year_field), year_field)
            if isinstance(parsed_year, AdapterError):
                return parsed_year
            by_year.setdefault(parsed_year, []).append(record)

        if requested_year is None:
            selected_year = max(by_year)
        else:
            parsed_requested = self._to_int(requested_year, "base_year")
            if isinstance(parsed_requested, AdapterError):
                return parsed_requested
            selected_year = parsed_requested

        selected = by_year.get(selected_year, [])
        if not selected:
            return AdapterError(
                code=AdapterErrorCode.NOT_FOUND,
                message="Requested base year was not returned",
                detail={"requested_year": selected_year, "available_years": sorted(by_year)},
            )
        if len(selected) != 1:
            return AdapterError(
                code=AdapterErrorCode.AMBIGUOUS,
                message="More than one attribute record exists for the selected year",
                detail={"selected_year": selected_year, "record_count": len(selected)},
            )
        return selected[0]

    def _map_record(self, record: dict[str, Any]) -> dict[str, Any] | AdapterError:
        mapped: dict[str, Any] = {}
        metadata: dict[str, Any] = {}
        for canonical, source_field in self.config.fields.configured().items():
            raw = record.get(source_field)
            if canonical == "std_serial":
                if raw is not None and raw != "":
                    metadata["std_serial"] = str(raw).strip()
                continue
            value = self._convert_value(canonical, raw, source_field)
            if isinstance(value, AdapterError):
                return value
            if value is not None:
                mapped[canonical] = value

        required = self._required_fields()
        missing = sorted(required - set(mapped))
        if missing:
            return self._malformed(f"Required mapped values are missing: {missing}")

        try:
            PublicLandSnapshot(**mapped)
        except ValueError as exc:
            return self._malformed(
                "Mapped public values violate the canonical parcel contract",
                detail={"validation": str(exc)},
            )

        result: dict[str, Any] = {
            "profile": self.config.profile.value,
            "public_values": mapped,
        }
        if metadata:
            result["record_meta"] = metadata
        return result

    def _convert_value(
        self,
        canonical: str,
        raw: Any,
        source_field: str,
    ) -> str | float | int | None | AdapterError:
        if raw is None:
            return None
        if isinstance(raw, str):
            raw = raw.strip()
            if not raw:
                return None
        if canonical in _NUMERIC_FIELDS:
            try:
                return float(str(raw).replace(",", ""))
            except (TypeError, ValueError):
                return self._malformed(
                    f"Field {source_field} cannot be converted to a number",
                    detail={"field": source_field},
                )
        if canonical in _INTEGER_FIELDS:
            return self._to_int(raw, source_field)
        return str(raw).strip()

    def _to_int(self, raw: Any, source_field: str) -> int | AdapterError:
        try:
            value = float(str(raw).replace(",", ""))
            if not value.is_integer():
                raise ValueError
            return int(value)
        except (TypeError, ValueError):
            return self._malformed(
                f"Field {source_field} cannot be converted to an integer",
                detail={"field": source_field},
            )

    def _year_source_field(self) -> str:
        if self.config.profile is PublicAttributeProfile.INDIVIDUAL_LAND_PRICE:
            assert self.config.fields.price_base_year is not None
            return self.config.fields.price_base_year
        assert self.config.fields.price_std_year is not None
        return self.config.fields.price_std_year

    def _required_fields(self) -> set[str]:
        if self.config.profile is PublicAttributeProfile.INDIVIDUAL_LAND_PRICE:
            return _INDIVIDUAL_PRICE_FIELDS
        if self.config.profile is PublicAttributeProfile.STANDARD_LAND_PRICE:
            return {"price_std", "price_std_year"}
        return set()

    def _malformed(
        self,
        message: str,
        *,
        detail: dict[str, Any] | None = None,
    ) -> AdapterError:
        return AdapterError(
            code=AdapterErrorCode.MALFORMED_RESPONSE,
            message=message,
            detail=detail or {},
        )

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
            kind=FetchKind.ATTRIBUTE,
            pnu=request.pnu,
            endpoint=self.config.endpoint,
            params_hash=params_hash,
            fetched_at=fetched_at,
            http_status=http_status,
            raw_path=raw_path,
        )
