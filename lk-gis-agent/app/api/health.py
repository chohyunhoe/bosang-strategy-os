"""Health and environment probe endpoints."""

from __future__ import annotations

from fastapi import APIRouter

from app.models.health import HealthResponse
from app.qgisrecipe.environment import probe_qgis_environment

router = APIRouter(prefix="/v1", tags=["health"])


def detect_qgis() -> tuple[bool, str | None]:
    """Return the shared QGIS environment probe in the legacy health contract."""

    report = probe_qgis_environment()
    return report.detected, report.qgis_version


@router.get("/health", response_model=HealthResponse)
def get_health() -> HealthResponse:
    qgis_detected, qgis_version = detect_qgis()
    return HealthResponse(
        status="ok",
        agent_version="0.1.0.dev0",
        qgis_detected=qgis_detected,
        qgis_version=qgis_version,
    )
