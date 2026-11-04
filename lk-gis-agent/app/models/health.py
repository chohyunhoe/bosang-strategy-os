"""Health endpoint response models."""

from pydantic import BaseModel, ConfigDict


class HealthResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str
    agent_version: str
    qgis_detected: bool
    qgis_version: str | None = None
