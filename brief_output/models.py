from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ReviewStatus(str, Enum):
    PASS = "PASS"
    WARN = "WARN"
    FAIL = "FAIL"
    REVIEW_REQUIRED = "REVIEW_REQUIRED"


class SourceRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_id: str
    page: int | None = Field(default=None, ge=1)
    locator: str | None = None
    excerpt: str | None = None


class RunMeta(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["bso_brief_output_v0.1"] = "bso_brief_output_v0.1"
    run_id: str
    generated_at: datetime
    status: Literal["complete", "partial", "failed"]
    local_processing: bool = True


class ProjectMeta(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_name: str
    client_name_masked: str | None = None
    report_date: date | None = None
    ownership_share: str | None = None
    output_mode: Literal["internal", "client"] = "internal"


class DocumentMeta(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_id: str
    file_name_masked: str
    appraisal_company: str | None = None
    page_count: int | None = Field(default=None, ge=1)
    extraction_method: str | None = None


class SubjectParcel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    parcel_id: str
    lot_number: str
    area_sqm: float | None = Field(default=None, gt=0)
    land_category: str | None = None
    current_use: str | None = None
    ownership_share: str | None = None
    source_refs: list[SourceRef] = Field(default_factory=list)


class ReferenceParcel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reference_id: str
    lot_number: str
    official_price_per_sqm: float | None = Field(default=None, ge=0)
    source_refs: list[SourceRef] = Field(default_factory=list)


class IndividualFactorBreakdown(BaseModel):
    model_config = ConfigDict(extra="forbid")

    street_condition: float | None = Field(default=None, gt=0)
    access_condition: float | None = Field(default=None, gt=0)
    environment_condition: float | None = Field(default=None, gt=0)
    parcel_condition: float | None = Field(default=None, gt=0)
    administrative_condition: float | None = Field(default=None, gt=0)
    other_condition: float | None = Field(default=None, gt=0)
    overall_individual_factor: float | None = Field(default=None, gt=0)
    source_refs: list[SourceRef] = Field(default_factory=list)
    review_status: ReviewStatus = ReviewStatus.REVIEW_REQUIRED

    @model_validator(mode="after")
    def require_any_factor_value(self) -> "IndividualFactorBreakdown":
        values = [
            self.street_condition,
            self.access_condition,
            self.environment_condition,
            self.parcel_condition,
            self.administrative_condition,
            self.other_condition,
            self.overall_individual_factor,
        ]
        if not any(value is not None for value in values):
            self.review_status = ReviewStatus.FAIL
        return self


class ValuatorResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    valuator_id: str
    appraisal_company: str
    subject_parcel_id: str
    reference_parcel_id: str | None = None
    official_price_per_sqm: float | None = Field(default=None, ge=0)
    time_adjustment: float | None = Field(default=None, gt=0)
    regional_factor: float | None = Field(default=None, gt=0)
    individual_factors: IndividualFactorBreakdown
    other_factor: float | None = Field(default=None, gt=0)
    calculated_unit_price: float | None = Field(default=None, ge=0)
    decided_unit_price: float | None = Field(default=None, ge=0)
    appraised_amount: float | None = Field(default=None, ge=0)
    source_refs: list[SourceRef] = Field(default_factory=list)


class IssueCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    issue_id: str
    priority: int = Field(ge=1, le=3)
    title: str
    summary: str
    evidence: list[str] = Field(default_factory=list)
    additional_review: list[str] = Field(default_factory=list)
    review_required: bool = True


class GraphicAsset(BaseModel):
    model_config = ConfigDict(extra="forbid")

    asset_id: str
    asset_type: str
    file_name: str | None = None
    status: Literal["ready", "pending", "failed"] = "pending"
    metadata: dict[str, Any] = Field(default_factory=dict)


class TablePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    table_id: str
    columns: list[str]
    rows: list[list[str | int | float | None]]


class PagePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    page_id: Literal[
        "page1_summary",
        "page2_analysis",
        "page3_analysis",
        "page4_analysis",
        "page5_conclusion",
    ]
    title: str
    paragraphs: list[str] = Field(default_factory=list, max_length=8)
    tables: list[TablePayload] = Field(default_factory=list)
    graphic_asset_ids: list[str] = Field(default_factory=list)
    source_keys: list[str] = Field(default_factory=list)


class SlotBinding(BaseModel):
    model_config = ConfigDict(extra="forbid")

    slot_name: str
    payload_type: Literal["text", "table", "image", "issues"]
    payload_key: str
    required: bool = True


class QAResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rule_id: str
    status: ReviewStatus
    message: str
    source_keys: list[str] = Field(default_factory=list)


class ReviewItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    review_id: str
    priority: Literal["P0", "P1", "P2"]
    title: str
    reason: str
    verification_method: str
    completed: bool = False


class BriefOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_meta: RunMeta
    project_meta: ProjectMeta
    document_meta: list[DocumentMeta]
    source_bundle: dict[str, Any]
    subject_bundle: dict[str, list[SubjectParcel | ReferenceParcel]]
    valuation_bundle: list[ValuatorResult]
    analysis_bundle: dict[str, Any]
    graphics_bundle: list[GraphicAsset]
    page_payloads: list[PagePayload]
    docx_assembly: list[SlotBinding]
    qa_bundle: list[QAResult]
    review_queue: list[ReviewItem]

    @model_validator(mode="after")
    def enforce_mvp_contract(self) -> "BriefOutput":
        if len(self.page_payloads) != 5:
            raise ValueError("page_payloads must contain exactly five page payloads")
        issue_candidates = self.analysis_bundle.get("issue_candidates", [])
        if len(issue_candidates) > 3:
            raise ValueError("issue_candidates must not exceed three")
        missing_factor_rows = [
            row.valuator_id
            for row in self.valuation_bundle
            if row.individual_factors.review_status == ReviewStatus.FAIL
        ]
        if missing_factor_rows and self.run_meta.status == "complete":
            raise ValueError(
                "run_meta.status cannot be complete when individual-factor values are missing: "
                + ", ".join(missing_factor_rows)
            )
        return self
