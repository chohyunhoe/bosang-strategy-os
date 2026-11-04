"""PNU parsing and composition without external address service assumptions."""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from app.models.common import LedgerType

PNU_PATTERN = re.compile(r"^\d{19}$")
JIBUN_PATTERN = re.compile(
    r"^(?P<legal_name>.+?)\s+(?P<mountain>산\s*)?(?P<main>\d{1,4})"
    r"(?:-(?P<sub>\d{1,4}))?$"
)
LEDGER_CODES: dict[LedgerType, str] = {
    LedgerType.LAND: "1",
    LedgerType.FOREST: "2",
}


class PnuErrorCode(StrEnum):
    INVALID_ADDRESS = "INVALID_ADDRESS"
    INVALID_LEGAL_DONG_CODE = "INVALID_LEGAL_DONG_CODE"
    INVALID_PNU = "INVALID_PNU"
    LEDGER_MISMATCH = "LEDGER_MISMATCH"
    LEGAL_DONG_NOT_FOUND = "LEGAL_DONG_NOT_FOUND"
    LEGAL_DONG_AMBIGUOUS = "LEGAL_DONG_AMBIGUOUS"


class PnuError(ValueError):
    """Typed error exposed to future API and review-queue layers."""

    def __init__(self, code: PnuErrorCode, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, slots=True)
class JibunParts:
    legal_name: str
    ledger: LedgerType
    main_number: int
    sub_number: int

    @property
    def mountain(self) -> bool:
        return self.ledger is LedgerType.FOREST

    @property
    def normalized_jibun(self) -> str:
        prefix = "산 " if self.mountain else ""
        suffix = f"-{self.sub_number}" if self.sub_number else ""
        return f"{self.legal_name} {prefix}{self.main_number}{suffix}"


@dataclass(frozen=True, slots=True)
class PnuParts:
    legal_dong_code: str
    ledger: LedgerType
    main_number: int
    sub_number: int

    @property
    def pnu(self) -> str:
        return compose_pnu(self)


@dataclass(frozen=True, slots=True)
class LegalDongRecord:
    code: str
    full_name: str
    source: str
    version: str

    def __post_init__(self) -> None:
        if not _is_legal_dong_code(self.code):
            raise PnuError(
                PnuErrorCode.INVALID_LEGAL_DONG_CODE,
                "Legal-dong code must be exactly 10 digits",
            )
        if not normalize_space(self.full_name):
            raise ValueError("full_name is required")
        if not self.source or not self.version:
            raise ValueError("source and version are required")


class LegalDongCodeLoader(Protocol):
    """Pluggable legal-dong codebook interface; no remote API is assumed."""

    def find_exact(self, full_name: str) -> tuple[LegalDongRecord, ...]: ...


@dataclass(frozen=True, slots=True)
class PnuResolution:
    pnu: str
    normalized_address: str
    codebook_source: str
    codebook_version: str
    parts: PnuParts


class InMemoryLegalDongCodeLoader:
    """Deterministic loader for tests, local fixtures and offline PoC."""

    def __init__(self, records: tuple[LegalDongRecord, ...] | list[LegalDongRecord]) -> None:
        index: dict[str, list[LegalDongRecord]] = {}
        for record in records:
            index.setdefault(normalize_space(record.full_name), []).append(record)
        self._index = {key: tuple(value) for key, value in index.items()}

    def find_exact(self, full_name: str) -> tuple[LegalDongRecord, ...]:
        return self._index.get(normalize_space(full_name), ())


def normalize_space(value: str) -> str:
    return " ".join(value.strip().split())


def parse_jibun_address(addr_jibun: str, *, ledger: LedgerType) -> JibunParts:
    normalized = normalize_space(addr_jibun)
    match = JIBUN_PATTERN.fullmatch(normalized)
    if not match:
        raise PnuError(
            PnuErrorCode.INVALID_ADDRESS,
            "Jibun address must end with a main number and optional sub-number",
        )

    is_mountain = bool(match.group("mountain"))
    expected = LedgerType.FOREST if is_mountain else LedgerType.LAND
    if ledger is not expected:
        raise PnuError(
            PnuErrorCode.LEDGER_MISMATCH,
            "Ledger must match the presence or absence of the mountain prefix",
        )

    main_number = int(match.group("main"))
    sub_number = int(match.group("sub") or 0)
    if not 1 <= main_number <= 9999 or not 0 <= sub_number <= 9999:
        raise PnuError(PnuErrorCode.INVALID_ADDRESS, "Jibun numbers are out of range")
    if match.group("sub") is not None and sub_number == 0:
        raise PnuError(PnuErrorCode.INVALID_ADDRESS, "Explicit sub-number zero is not allowed")

    return JibunParts(
        legal_name=normalize_space(match.group("legal_name")),
        ledger=ledger,
        main_number=main_number,
        sub_number=sub_number,
    )


def compose_pnu(parts: PnuParts) -> str:
    if not _is_legal_dong_code(parts.legal_dong_code):
        raise PnuError(
            PnuErrorCode.INVALID_LEGAL_DONG_CODE,
            "Legal-dong code must be exactly 10 digits",
        )
    if not 1 <= parts.main_number <= 9999 or not 0 <= parts.sub_number <= 9999:
        raise PnuError(PnuErrorCode.INVALID_PNU, "PNU lot numbers are out of range")
    return (
        f"{parts.legal_dong_code}{LEDGER_CODES[parts.ledger]}"
        f"{parts.main_number:04d}{parts.sub_number:04d}"
    )


def parse_pnu(pnu: str) -> PnuParts:
    if not validate_pnu(pnu):
        raise PnuError(PnuErrorCode.INVALID_PNU, "PNU must be a valid 19-digit value")
    ledger_code = pnu[10]
    ledger = LedgerType.LAND if ledger_code == "1" else LedgerType.FOREST
    return PnuParts(
        legal_dong_code=pnu[:10],
        ledger=ledger,
        main_number=int(pnu[11:15]),
        sub_number=int(pnu[15:19]),
    )


def validate_pnu(pnu: str) -> bool:
    if not PNU_PATTERN.fullmatch(pnu):
        return False
    if pnu[10] not in {"1", "2"}:
        return False
    return int(pnu[11:15]) > 0


def resolve_pnu(
    addr_jibun: str,
    *,
    ledger: LedgerType,
    loader: LegalDongCodeLoader,
) -> PnuResolution:
    jibun = parse_jibun_address(addr_jibun, ledger=ledger)
    matches = loader.find_exact(jibun.legal_name)
    if not matches:
        raise PnuError(
            PnuErrorCode.LEGAL_DONG_NOT_FOUND,
            f"No legal-dong code matched: {jibun.legal_name}",
        )
    if len(matches) != 1:
        raise PnuError(
            PnuErrorCode.LEGAL_DONG_AMBIGUOUS,
            f"Multiple legal-dong codes matched: {jibun.legal_name}",
        )

    record = matches[0]
    parts = PnuParts(
        legal_dong_code=record.code,
        ledger=jibun.ledger,
        main_number=jibun.main_number,
        sub_number=jibun.sub_number,
    )
    return PnuResolution(
        pnu=compose_pnu(parts),
        normalized_address=jibun.normalized_jibun,
        codebook_source=record.source,
        codebook_version=record.version,
        parts=parts,
    )


def _is_legal_dong_code(value: str) -> bool:
    return len(value) == 10 and value.isdigit()
