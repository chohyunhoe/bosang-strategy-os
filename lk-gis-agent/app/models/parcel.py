"""Canonical parcel models with appraisal/public value separation."""

from __future__ import annotations

from enum import StrEnum

from pydantic import ConfigDict, Field

from app.models.common import PNU, ParcelRole, StrictModel


class ReconcileStatus(StrEnum):
    PENDING = "PENDING"
    OK = "OK"
    MISMATCH = "MISMATCH"
    PUB_NOT_FOUND = "PUB_NOT_FOUND"
    FAILED = "FAILED"


class PublicLandSnapshot(StrictModel):
    area: float | None = Field(default=None, ge=0)
    jimok: str | None = None
    use_zone: str | None = None
    use_etc: str | None = None
    land_use: str | None = None
    road: str | None = None
    shape: str | None = None
    topo: str | None = None
    price_indv: float | None = Field(default=None, ge=0)
    price_base_year: int | None = Field(default=None, ge=1900, le=2200)
    price_std: float | None = Field(default=None, ge=0)
    price_std_year: int | None = Field(default=None, ge=1900, le=2200)


class AppraisalSnapshot(StrictModel):
    """Human-extracted appraisal values; immutable after validation."""

    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
        frozen=True,
        use_enum_values=False,
    )

    area: float | None = Field(default=None, ge=0)
    jimok: str | None = None
    land_use: str | None = None
    road: str | None = None
    shape: str | None = None
    topo: str | None = None
    use_zone: str | None = None
    note: str | None = None
    source_doc: str | None = None


class CanonicalParcel(StrictModel):
    pnu: PNU
    role: ParcelRole
    addr_jibun: str = Field(min_length=1, max_length=240)
    public_values: PublicLandSnapshot = Field(default_factory=PublicLandSnapshot)
    appraisal_values: AppraisalSnapshot = Field(
        default_factory=AppraisalSnapshot,
        frozen=True,
    )
    recon_status: ReconcileStatus = ReconcileStatus.PENDING
    mismatch_fields: tuple[str, ...] = ()
    geometry_available: bool = False
    geom_source_id: str | None = None
    attr_source_ids: tuple[str, ...] = ()
