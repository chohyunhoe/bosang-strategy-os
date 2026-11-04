"""Input contract for a Local GIS Agent job."""

from __future__ import annotations

from typing import Literal

from pydantic import Field, field_validator, model_validator

from app.models.common import (
    PNU,
    AppraisalField,
    EPSGCode,
    LedgerType,
    ParcelRole,
    ScalarValue,
    StrictModel,
    is_safe_relative_path,
)


class CaseMetadata(StrictModel):
    case_id: str = Field(min_length=3, max_length=80, pattern=r"^[A-Za-z0-9._-]+$")
    case_name: str = Field(min_length=1, max_length=200)
    district_label: str | None = Field(default=None, max_length=200)
    manager: str | None = Field(default=None, max_length=80)


class CaseReferenceValues(StrictModel):
    case_kind: str | None = Field(default=None, max_length=80)
    case_date: str | None = Field(default=None, max_length=40)
    note: str | None = Field(default=None, max_length=1000)
    source_doc: str | None = Field(default=None, max_length=300)


class ParcelRequest(StrictModel):
    role: ParcelRole
    addr_jibun: str | None = Field(default=None, max_length=240)
    ledger: LedgerType = LedgerType.LAND
    pnu: PNU | None = None
    std_serial: str | None = Field(default=None, max_length=40)
    case_label: str | None = Field(default=None, max_length=100)
    user_values: CaseReferenceValues | None = None

    @model_validator(mode="after")
    def validate_role_contract(self) -> ParcelRequest:
        if not self.pnu and not self.addr_jibun:
            raise ValueError("Each parcel requires pnu or addr_jibun")
        if self.role is ParcelRole.CASE and not self.case_label:
            raise ValueError("CASE parcels require case_label")
        if self.role is not ParcelRole.CASE and self.user_values is not None:
            raise ValueError("user_values are allowed only for CASE parcels")
        if self.role is not ParcelRole.STANDARD and self.std_serial is not None:
            raise ValueError("std_serial is allowed only for STANDARD parcels")
        return self


class AppraisalValueInput(StrictModel):
    """Immutable appraisal excerpt supplied by a human reviewer."""

    model_config = StrictModel.model_config | {"frozen": True}

    target: str = Field(min_length=1, max_length=240)
    field: AppraisalField
    value: ScalarValue
    source_doc: str = Field(min_length=1, max_length=300)


class OverlaySpec(StrictModel):
    type: Literal["user_file"] = "user_file"
    path: str = Field(min_length=1, max_length=500)
    name: str = Field(min_length=1, max_length=200)
    crs: EPSGCode | None = None

    @field_validator("path")
    @classmethod
    def validate_path(cls, value: str) -> str:
        if not is_safe_relative_path(value):
            raise ValueError("Overlay path must be a safe relative path")
        return value.replace("\\", "/")


class OverlayCollection(StrictModel):
    biz_zone: OverlaySpec | None = None


class JobOptions(StrictModel):
    target_crs: EPSGCode | None = None
    scale_candidates: tuple[int, ...] = (1000, 2500, 5000)
    outputs: tuple[Literal["gpkg", "qgz", "pdf", "png"], ...] = (
        "gpkg",
        "qgz",
        "pdf",
        "png",
    )
    per_parcel_sheets: bool = False
    extent_buffer_ratio: float = Field(default=0.15, ge=0, le=1)
    use_cache: bool = True

    @field_validator("scale_candidates")
    @classmethod
    def validate_scales(cls, values: tuple[int, ...]) -> tuple[int, ...]:
        if not values or any(value <= 0 for value in values):
            raise ValueError("scale_candidates must contain positive integers")
        if tuple(sorted(set(values))) != values:
            raise ValueError("scale_candidates must be unique and strictly increasing")
        return values

    @field_validator("outputs")
    @classmethod
    def validate_outputs(cls, values: tuple[str, ...]) -> tuple[str, ...]:
        if not values:
            raise ValueError("At least one output is required")
        if len(set(values)) != len(values):
            raise ValueError("outputs must not contain duplicates")
        return values


class CaseJob(StrictModel):
    schema_version: Literal["0.1"] = "0.1"
    case: CaseMetadata
    parcels: tuple[ParcelRequest, ...] = Field(min_length=1)
    appraisal_values: tuple[AppraisalValueInput, ...] = ()
    overlays: OverlayCollection = Field(default_factory=OverlayCollection)
    options: JobOptions = Field(default_factory=JobOptions)

    @model_validator(mode="after")
    def validate_job_contract(self) -> CaseJob:
        if not any(parcel.role is ParcelRole.SUBJECT for parcel in self.parcels):
            raise ValueError("At least one SUBJECT parcel is required")

        identifiers = {
            identifier
            for parcel in self.parcels
            for identifier in (parcel.pnu, parcel.addr_jibun)
            if identifier
        }
        unknown = [item.target for item in self.appraisal_values if item.target not in identifiers]
        if unknown:
            raise ValueError(f"appraisal_values target unknown parcels: {unknown}")
        return self
