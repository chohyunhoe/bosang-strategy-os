"""Common contracts for public-data source adapters."""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from enum import StrEnum
from pathlib import Path
from typing import Any, Protocol

from pydantic import Field

from app.models.common import PNU, StrictModel


class FetchKind(StrEnum):
    GEOMETRY = "GEOMETRY"
    ATTRIBUTE = "ATTRIBUTE"


class AdapterErrorCode(StrEnum):
    AUTH = "ADAPTER_AUTH"
    HTTP = "ADAPTER_HTTP"
    TRANSPORT = "ADAPTER_TRANSPORT"
    NOT_FOUND = "NOT_FOUND"
    AMBIGUOUS = "AMBIGUOUS_RESULT"
    MALFORMED_RESPONSE = "MALFORMED_RESPONSE"
    PNU_MISMATCH = "PNU_MISMATCH"


class AdapterError(StrictModel):
    code: AdapterErrorCode
    message: str = Field(min_length=1, max_length=500)
    retryable: bool = False
    detail: dict[str, Any] = Field(default_factory=dict)


class ProvenanceRecord(StrictModel):
    source_id: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9._-]+$")
    kind: FetchKind
    pnu: PNU
    endpoint: str = Field(min_length=1, max_length=500)
    params_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    fetched_at: datetime
    http_status: int | None = Field(default=None, ge=100, le=599)
    raw_path: str | None = Field(default=None, max_length=240)
    cache_hit: bool = False


class FetchRequest(StrictModel):
    pnu: PNU
    raw_dir: Path
    extra_params: dict[str, str | int | float | bool] = Field(default_factory=dict)


class FetchResult(StrictModel):
    ok: bool
    payload: dict[str, Any] | None = None
    provenance: ProvenanceRecord
    error: AdapterError | None = None

    def model_post_init(self, __context: Any) -> None:
        if self.ok and self.error is not None:
            raise ValueError("Successful fetch results cannot include an error")
        if not self.ok and self.error is None:
            raise ValueError("Failed fetch results require an error")


class TransportResponse(StrictModel):
    status_code: int = Field(ge=100, le=599)
    payload: dict[str, Any]


class JsonTransport(Protocol):
    def get_json(self, endpoint: str, params: dict[str, Any]) -> TransportResponse: ...


class SourceAdapter(Protocol):
    source_id: str
    auto_apply: bool

    def fetch(self, request: FetchRequest) -> FetchResult: ...


_SENSITIVE_PARAM = re.compile(r"(?:key|token|secret|auth|credential)", re.IGNORECASE)


def canonical_params_hash(params: dict[str, Any]) -> str:
    """Hash request metadata after removing credential-like values."""

    sanitized = {
        key: "<redacted>" if _SENSITIVE_PARAM.search(key) else value
        for key, value in sorted(params.items())
    }
    encoded = json.dumps(sanitized, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def write_raw_payload(
    raw_dir: Path,
    *,
    source_id: str,
    pnu: str,
    params_hash: str,
    payload: dict[str, Any],
) -> str:
    """Persist a response body without putting request credentials in its filename."""

    raw_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{source_id}_{pnu}_{params_hash[:12]}.json"
    path = raw_dir / filename
    path.write_text(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2),
        encoding="utf-8",
    )
    return filename
