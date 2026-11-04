from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.models import AppraisalSnapshot, CanonicalParcel, PublicLandSnapshot

PNU = "4139013200101200007"


def test_canonical_parcel_separates_public_and_appraisal_values() -> None:
    parcel = CanonicalParcel(
        pnu=PNU,
        role="SUBJECT",
        addr_jibun="경기도 시흥시 과림동 120-7",
        public_values=PublicLandSnapshot(jimok="답"),
        appraisal_values=AppraisalSnapshot(jimok="전", source_doc="평가서 p.8"),
    )
    assert parcel.public_values.jimok == "답"
    assert parcel.appraisal_values.jimok == "전"


def test_appraisal_snapshot_cannot_be_mutated() -> None:
    snapshot = AppraisalSnapshot(jimok="답")
    with pytest.raises(ValidationError, match="frozen"):
        snapshot.jimok = "전"


def test_appraisal_snapshot_cannot_be_replaced_on_parcel() -> None:
    parcel = CanonicalParcel(
        pnu=PNU,
        role="SUBJECT",
        addr_jibun="경기도 시흥시 과림동 120-7",
        appraisal_values=AppraisalSnapshot(jimok="답"),
    )
    with pytest.raises(ValidationError, match="frozen"):
        parcel.appraisal_values = AppraisalSnapshot(jimok="전")


def test_public_snapshot_can_be_replaced_by_later_adapter_stage() -> None:
    parcel = CanonicalParcel(
        pnu=PNU,
        role="SUBJECT",
        addr_jibun="경기도 시흥시 과림동 120-7",
    )
    parcel.public_values = PublicLandSnapshot(jimok="답", road="세로(가)")
    assert parcel.public_values.road == "세로(가)"
