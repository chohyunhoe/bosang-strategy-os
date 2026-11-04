"""Shared strict model primitives for the LK GIS Agent."""

from __future__ import annotations

import re
from enum import StrEnum
from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints

PNU = Annotated[str, StringConstraints(pattern=r"^\d{19}$")]
SHA256 = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]
EPSGCode = Annotated[str, StringConstraints(pattern=r"^EPSG:\d{4,6}$")]


class StrictModel(BaseModel):
    """Base model that rejects undeclared data and validates assignment."""

    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
        validate_assignment=True,
        use_enum_values=False,
    )


class ParcelRole(StrEnum):
    SUBJECT = "SUBJECT"
    STANDARD = "STANDARD"
    CASE = "CASE"


class LedgerType(StrEnum):
    LAND = "토지"
    FOREST = "임야"


class AppraisalField(StrEnum):
    JIMOK = "jimok"
    LAND_USE = "land_use"
    ROAD = "road"
    SHAPE = "shape"
    TOPO = "topo"
    USE_ZONE = "use_zone"
    AREA = "area"
    NOTE = "note"


ScalarValue = str | int | float | bool | None


def is_safe_filename(value: str) -> bool:
    """Return True only for a plain filename, never a path."""

    return bool(value) and "/" not in value and "\\" not in value and value not in {".", ".."}


def is_safe_relative_path(value: str) -> bool:
    """Reject absolute, drive-qualified and parent-traversal paths."""

    normalized = value.replace("\\", "/")
    if normalized.startswith("/") or re.match(r"^[A-Za-z]:", normalized):
        return False
    return all(part not in {"", ".", ".."} for part in normalized.split("/"))
