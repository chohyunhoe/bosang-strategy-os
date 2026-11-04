"""Application settings.

PR-01 deliberately contains no API key or QGIS configuration. Those are introduced
only after the security and environment contracts are reviewed.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

LoopbackHost = Literal["127.0.0.1", "::1"]


class Settings(BaseSettings):
    """Runtime settings for the local-only agent."""

    model_config = SettingsConfigDict(
        env_prefix="LK_GIS_",
        env_file=".env",
        extra="ignore",
    )

    host: LoopbackHost = "127.0.0.1"
    port: int = Field(default=8765, ge=1024, le=65535)
    allowed_origins: list[str] = Field(default_factory=list)

    @field_validator("allowed_origins")
    @classmethod
    def validate_origins(cls, origins: list[str]) -> list[str]:
        for origin in origins:
            if origin == "*":
                raise ValueError("Wildcard CORS origins are not allowed")
            if not origin.startswith(("http://", "https://")):
                raise ValueError(f"Invalid origin: {origin}")
        return origins


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
