import pytest

from app.models.common import LedgerType
from app.normalize import (
    InMemoryLegalDongCodeLoader,
    LegalDongRecord,
    PnuError,
    PnuErrorCode,
    PnuParts,
    compose_pnu,
    parse_jibun_address,
    parse_pnu,
    resolve_pnu,
    validate_pnu,
)

CODE = "4111111111"


def loader(*records: LegalDongRecord) -> InMemoryLegalDongCodeLoader:
    return InMemoryLegalDongCodeLoader(list(records))


def record(name: str = "경기도 시흥시 과림동", code: str = CODE) -> LegalDongRecord:
    return LegalDongRecord(code=code, full_name=name, source="fixture", version="2026-07")


@pytest.mark.parametrize(
    ("address", "ledger", "main", "sub", "normalized"),
    [
        (
            "경기도 시흥시 과림동 120-7",
            LedgerType.LAND,
            120,
            7,
            "경기도 시흥시 과림동 120-7",
        ),
        (
            "경기도  시흥시 과림동   120",
            LedgerType.LAND,
            120,
            0,
            "경기도 시흥시 과림동 120",
        ),
        (
            "경기도 시흥시 과림동 산 44",
            LedgerType.FOREST,
            44,
            0,
            "경기도 시흥시 과림동 산 44",
        ),
        (
            "경기도 시흥시 과림동 산44-2",
            LedgerType.FOREST,
            44,
            2,
            "경기도 시흥시 과림동 산 44-2",
        ),
    ],
)
def test_parse_jibun(address, ledger, main, sub, normalized):
    result = parse_jibun_address(address, ledger=ledger)
    assert (result.main_number, result.sub_number) == (main, sub)
    assert result.normalized_jibun == normalized


@pytest.mark.parametrize(
    ("address", "ledger", "code"),
    [
        ("경기도 시흥시 과림동", LedgerType.LAND, PnuErrorCode.INVALID_ADDRESS),
        ("경기도 시흥시 과림동 0", LedgerType.LAND, PnuErrorCode.INVALID_ADDRESS),
        ("경기도 시흥시 과림동 120-0", LedgerType.LAND, PnuErrorCode.INVALID_ADDRESS),
        ("경기도 시흥시 과림동 산 44", LedgerType.LAND, PnuErrorCode.LEDGER_MISMATCH),
        ("경기도 시흥시 과림동 44", LedgerType.FOREST, PnuErrorCode.LEDGER_MISMATCH),
    ],
)
def test_parse_jibun_errors(address, ledger, code):
    with pytest.raises(PnuError) as exc_info:
        parse_jibun_address(address, ledger=ledger)
    assert exc_info.value.code is code


def test_compose_and_parse_pnu_round_trip():
    original = PnuParts(CODE, LedgerType.LAND, 120, 7)
    pnu = compose_pnu(original)
    assert pnu == f"{CODE}101200007"
    assert parse_pnu(pnu) == original


def test_forest_pnu_uses_ledger_code_two():
    pnu = compose_pnu(PnuParts(CODE, LedgerType.FOREST, 44, 2))
    assert pnu == f"{CODE}200440002"


@pytest.mark.parametrize(
    "pnu",
    [
        f"{CODE}101200007",
        f"{CODE}200440000",
    ],
)
def test_validate_pnu_accepts_supported_ledgers(pnu):
    assert validate_pnu(pnu)


@pytest.mark.parametrize(
    "pnu",
    [
        "",
        "1" * 18,
        "1" * 20,
        f"{CODE}301200007",
        f"{CODE}100000007",
        f"{CODE}10120A007",
    ],
)
def test_validate_pnu_rejects_invalid_values(pnu):
    assert not validate_pnu(pnu)


def test_resolve_pnu_records_codebook_provenance():
    result = resolve_pnu(
        "경기도 시흥시 과림동 120-7",
        ledger=LedgerType.LAND,
        loader=loader(record()),
    )
    assert result.pnu == f"{CODE}101200007"
    assert result.codebook_source == "fixture"
    assert result.codebook_version == "2026-07"


def test_resolve_pnu_not_found_is_typed():
    with pytest.raises(PnuError) as exc_info:
        resolve_pnu(
            "경기도 시흥시 과림동 120-7",
            ledger=LedgerType.LAND,
            loader=loader(),
        )
    assert exc_info.value.code is PnuErrorCode.LEGAL_DONG_NOT_FOUND


def test_resolve_pnu_ambiguous_is_typed():
    records = (
        record(code="4111111111"),
        record(code="4222222222"),
    )
    with pytest.raises(PnuError) as exc_info:
        resolve_pnu(
            "경기도 시흥시 과림동 120-7",
            ledger=LedgerType.LAND,
            loader=loader(*records),
        )
    assert exc_info.value.code is PnuErrorCode.LEGAL_DONG_AMBIGUOUS


def test_legal_dong_record_requires_ten_digit_code():
    with pytest.raises(PnuError) as exc_info:
        LegalDongRecord(code="123", full_name="가상동", source="fixture", version="v1")
    assert exc_info.value.code is PnuErrorCode.INVALID_LEGAL_DONG_CODE
