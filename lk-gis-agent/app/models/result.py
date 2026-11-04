"""Job result and artifact contracts."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import Field, field_validator, model_validator

from app.models.common import PNU, SHA256, StrictModel, is_safe_filename
from app.models.review import ReviewItem


class JobStatus(StrEnum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    PAUSED_QUOTA = "PAUSED_QUOTA"
    FAILED = "FAILED"
    CANCELED = "CANCELED"
    DONE = "DONE"
    DONE_WITH_REVIEW = "DONE_WITH_REVIEW"


class ParcelResultStatus(StrEnum):
    OK = "OK"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    FAILED = "FAILED"


class Artifact(StrictModel):
    type: Literal["gpkg", "qgz", "pdf", "png", "json", "log"]
    name: str = Field(min_length=1, max_length=240)
    sha256: SHA256

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        if not is_safe_filename(value):
            raise ValueError("Artifact name must be a plain filename")
        return value


class ResultSummary(StrictModel):
    parcels_total: int = Field(ge=0)
    ok: int = Field(ge=0)
    needs_review: int = Field(ge=0)
    failed: int = Field(ge=0)

    @model_validator(mode="after")
    def validate_total(self) -> ResultSummary:
        if self.parcels_total != self.ok + self.needs_review + self.failed:
            raise ValueError("parcels_total must equal ok + needs_review + failed")
        return self


class ParcelResult(StrictModel):
    pnu: PNU
    role: Literal["SUBJECT", "STANDARD", "CASE"]
    status: ParcelResultStatus
    reasons: tuple[str, ...] = ()


class JobResult(StrictModel):
    schema_version: Literal["0.1"] = "0.1"
    job_id: str = Field(min_length=1, max_length=100)
    case_id: str = Field(min_length=3, max_length=80)
    status: JobStatus
    started_at: datetime
    finished_at: datetime | None = None
    summary: ResultSummary
    artifacts: tuple[Artifact, ...] = ()
    parcels: tuple[ParcelResult, ...] = ()
    review_items: tuple[ReviewItem, ...] = ()
    provenance_file: str | None = None
    log_file: str | None = None
    notes: tuple[str, ...] = ()

    @model_validator(mode="after")
    def validate_timeline_and_terminal_state(self) -> JobResult:
        terminal = {
            JobStatus.FAILED,
            JobStatus.CANCELED,
            JobStatus.DONE,
            JobStatus.DONE_WITH_REVIEW,
        }
        if self.started_at.tzinfo is None:
            raise ValueError("started_at must be timezone-aware")
        if self.finished_at is not None and self.finished_at.tzinfo is None:
            raise ValueError("finished_at must be timezone-aware")
        if self.status in terminal and self.finished_at is None:
            raise ValueError("Terminal job results require finished_at")
        if self.status not in terminal and self.finished_at is not None:
            raise ValueError("Non-terminal job results cannot have finished_at")
        if self.finished_at is not None and self.finished_at < self.started_at:
            raise ValueError("finished_at cannot precede started_at")
        return self
