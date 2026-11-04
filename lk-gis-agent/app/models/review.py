"""Review queue and resolution contracts."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import Field, model_validator

from app.models.common import PNU, AppraisalField, ScalarValue, StrictModel


class ReviewReason(StrEnum):
    VALUE_MISMATCH = "VALUE_MISMATCH"
    PUB_NOT_FOUND = "PUB_NOT_FOUND"
    GEOM_INVALID = "GEOM_INVALID"
    STD_NOT_FOUND = "STD_NOT_FOUND"
    NOT_FOUND = "NOT_FOUND"
    FETCH_FAILED = "FETCH_FAILED"


class ReviewStatus(StrEnum):
    OPEN = "OPEN"
    RESOLVED = "RESOLVED"


class ReviewDecision(StrEnum):
    ACCEPT_PUB = "ACCEPT_PUB"
    KEEP_APR = "KEEP_APR"
    MANUAL = "MANUAL"


class ReviewResolutionRequest(StrictModel):
    decision: ReviewDecision
    value: ScalarValue = None
    resolved_by: str = Field(min_length=1, max_length=80)

    @model_validator(mode="after")
    def validate_manual_value(self) -> ReviewResolutionRequest:
        if self.decision is ReviewDecision.MANUAL and self.value is None:
            raise ValueError("MANUAL review decisions require value")
        if self.decision is not ReviewDecision.MANUAL and self.value is not None:
            raise ValueError("value is allowed only for MANUAL review decisions")
        return self


class ReviewItem(StrictModel):
    id: str = Field(min_length=1, max_length=100)
    pnu: PNU
    field: AppraisalField
    pub_value: ScalarValue = None
    apr_value: ScalarValue = None
    pub_source: str | None = Field(default=None, max_length=300)
    apr_source: str | None = Field(default=None, max_length=300)
    reason: ReviewReason
    status: ReviewStatus = ReviewStatus.OPEN
    decision: ReviewDecision | None = None
    decided_value: ScalarValue = None
    resolved_by: str | None = Field(default=None, max_length=80)
    resolved_at: datetime | None = None

    @model_validator(mode="after")
    def validate_resolution_state(self) -> ReviewItem:
        resolution_fields = (self.decision, self.decided_value, self.resolved_by, self.resolved_at)
        has_resolution_data = any(value is not None for value in resolution_fields)
        if self.status is ReviewStatus.OPEN and has_resolution_data:
            raise ValueError("OPEN review items cannot contain resolution data")
        if self.status is ReviewStatus.RESOLVED:
            if self.decision is None or self.resolved_by is None or self.resolved_at is None:
                raise ValueError(
                    "RESOLVED review items require decision, resolved_by and resolved_at"
                )
            if self.decision is ReviewDecision.MANUAL and self.decided_value is None:
                raise ValueError("MANUAL resolved items require decided_value")
            if self.decision is not ReviewDecision.MANUAL and self.decided_value is not None:
                raise ValueError("decided_value is allowed only for MANUAL decisions")
        return self
