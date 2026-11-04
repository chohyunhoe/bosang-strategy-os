from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from app.models import Artifact, JobResult, ResultSummary

PNU = "4139013200101200007"
SHA = "a" * 64


def test_summary_counts_must_balance() -> None:
    with pytest.raises(ValidationError, match="must equal"):
        ResultSummary(parcels_total=4, ok=2, needs_review=1, failed=0)


def test_artifact_name_cannot_escape_output_directory() -> None:
    with pytest.raises(ValidationError, match="plain filename"):
        Artifact(type="pdf", name="../secret.pdf", sha256=SHA)


def test_terminal_result_requires_finished_at() -> None:
    with pytest.raises(ValidationError, match="require finished_at"):
        JobResult(
            job_id="job-1",
            case_id="LK-2026-GMSH-001",
            status="DONE",
            started_at=datetime.now(timezone.utc),
            summary={"parcels_total": 0, "ok": 0, "needs_review": 0, "failed": 0},
        )


def test_finished_at_cannot_precede_started_at() -> None:
    started = datetime.now(timezone.utc)
    with pytest.raises(ValidationError, match="cannot precede"):
        JobResult(
            job_id="job-1",
            case_id="LK-2026-GMSH-001",
            status="DONE",
            started_at=started,
            finished_at=started - timedelta(seconds=1),
            summary={"parcels_total": 0, "ok": 0, "needs_review": 0, "failed": 0},
        )


def test_valid_result_round_trip() -> None:
    started = datetime.now(timezone.utc)
    result = JobResult(
        job_id="job-1",
        case_id="LK-2026-GMSH-001",
        status="DONE",
        started_at=started,
        finished_at=started + timedelta(seconds=5),
        summary={"parcels_total": 1, "ok": 1, "needs_review": 0, "failed": 0},
        artifacts=[{"type": "pdf", "name": "검토도.pdf", "sha256": SHA}],
        parcels=[{"pnu": PNU, "role": "SUBJECT", "status": "OK", "reasons": []}],
    )
    rebuilt = JobResult.model_validate_json(result.model_dump_json())
    assert rebuilt == result
