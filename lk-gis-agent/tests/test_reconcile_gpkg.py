"""Reconcile and GeoPackage builder regression tests."""

from __future__ import annotations

import sqlite3
import struct
from datetime import datetime, timezone
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.adapters.base import FetchKind, ProvenanceRecord
from app.gpkg import ParcelFeature, ReferenceNote, SourceRecord, build_geopackage
from app.models import (
    AppraisalSnapshot,
    CanonicalParcel,
    ParcelRole,
    PublicLandSnapshot,
    ReconcileStatus,
    ReviewReason,
)
from app.normalize import reconcile_parcel

PNU = "4139013200101200007"


def parcel(
    *,
    public: PublicLandSnapshot | None = None,
    appraisal: AppraisalSnapshot | None = None,
    role: ParcelRole = ParcelRole.SUBJECT,
) -> CanonicalParcel:
    return CanonicalParcel(
        pnu=PNU,
        role=role,
        addr_jibun="경기도 시흥시 과림동 120-7",
        public_values=public or PublicLandSnapshot(area=891, jimok="답", road="세로(가)"),
        appraisal_values=appraisal
        or AppraisalSnapshot(
            area=891,
            jimok="답",
            road="세로(가)",
            source_doc="중앙감정평가서 p.42",
        ),
        geometry_available=True,
        geom_source_id="vworld_wfs",
        attr_source_ids=("datago_landchar",),
    )


def polygon() -> dict:
    return {
        "type": "Polygon",
        "coordinates": [[[200000, 450000], [200010, 450000], [200010, 450010], [200000, 450000]]],
    }


def test_reconcile_equal_values_are_ok_without_review() -> None:
    original = parcel()
    result = reconcile_parcel(original)

    assert result.parcel.recon_status is ReconcileStatus.OK
    assert result.parcel.mismatch_fields == ()
    assert result.review_items == ()
    assert original.recon_status is ReconcileStatus.PENDING


def test_reconcile_creates_mismatch_and_missing_review_items() -> None:
    original = parcel(
        public=PublicLandSnapshot(area=891.2, jimok="전", road=None),
        appraisal=AppraisalSnapshot(
            area=891,
            jimok="답",
            road="세로(가)",
            source_doc="정해감정평가서 p.48",
        ),
    )
    result = reconcile_parcel(
        original,
        public_source_by_field={"area": "landchar", "jimok": "landchar"},
    )

    assert result.parcel.recon_status is ReconcileStatus.MISMATCH
    assert result.parcel.mismatch_fields == ("area", "jimok", "road")
    assert [item.reason for item in result.review_items] == [
        ReviewReason.VALUE_MISMATCH,
        ReviewReason.VALUE_MISMATCH,
        ReviewReason.PUB_NOT_FOUND,
    ]
    assert result.review_items[0].pub_source == "landchar"
    assert result.review_items[0].apr_source == "정해감정평가서 p.48"


def test_reconcile_ignores_whitespace_and_case_and_supports_area_tolerance() -> None:
    value = parcel(
        public=PublicLandSnapshot(area=891.004, jimok=" 답 "),
        appraisal=AppraisalSnapshot(area=891, jimok="답", source_doc="평가서"),
    )
    result = reconcile_parcel(value, area_tolerance=0.01)
    assert result.parcel.recon_status is ReconcileStatus.OK


def test_appraisal_snapshot_remains_immutable() -> None:
    value = parcel()
    with pytest.raises(ValidationError):
        value.appraisal_values.jimok = "전"


def test_build_geopackage_writes_spatial_and_attribute_contracts(tmp_path: Path) -> None:
    reconciled = reconcile_parcel(
        parcel(
            public=PublicLandSnapshot(area=891, jimok="전", road="세로(가)"),
            appraisal=AppraisalSnapshot(
                area=891,
                jimok="답",
                road="세로(가)",
                source_doc="평가서 p.1",
            ),
        )
    )
    provenance = ProvenanceRecord(
        source_id="datago_landchar",
        kind=FetchKind.ATTRIBUTE,
        pnu=PNU,
        endpoint="https://example.test/land",
        params_hash="a" * 64,
        fetched_at=datetime.now(timezone.utc),
        http_status=200,
        raw_path="datago.json",
    )
    output = tmp_path / "case.gpkg"

    result = build_geopackage(
        output,
        case_id="LK-2026-GMSH-001",
        job_id="job-001",
        features=(ParcelFeature(parcel=reconciled.parcel, geometry=polygon()),),
        target_srs_id=5186,
        target_crs_name="EPSG:5186",
        review_items=reconciled.review_items,
        provenance=(provenance,),
        sources=(
            SourceRecord(
                source_id="datago_landchar",
                name="토지특성정보",
                kind="API",
                auto_apply=True,
                attribution_text="공공데이터포털",
            ),
        ),
        reference_notes=(
            ReferenceNote(
                pnu=PNU,
                platform="디스코",
                url="https://example.test/ref",
                memo="거래 흔적 탐색 참고",
                captured_by="검토자",
                captured_at=datetime.now(timezone.utc),
            ),
        ),
        job_options={"target_crs": "EPSG:5186"},
    )

    assert result.path == output
    assert result.feature_count == 1
    assert output.exists()

    with sqlite3.connect(output) as connection:
        assert connection.execute("PRAGMA application_id").fetchone()[0] == 0x47504B47
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        assert {
            "subject_parcels",
            "standard_parcels",
            "case_parcels",
            "biz_zone",
            "provenance",
            "sources",
            "review_queue",
            "ref_notes",
            "job_meta",
        }.issubset(tables)

        row = connection.execute(
            "SELECT geom, jimok_pub, jimok_apr, recon_status, mismatch_fields "
            "FROM subject_parcels WHERE pnu=?",
            (PNU,),
        ).fetchone()
        assert row is not None
        blob, jimok_pub, jimok_apr, status, mismatch_fields = row
        assert blob[:2] == b"GP"
        byte_order, geometry_type = struct.unpack("<BI", blob[8:13])
        assert byte_order == 1
        assert geometry_type == 6
        assert jimok_pub == "전"
        assert jimok_apr == "답"
        assert status == "MISMATCH"
        assert mismatch_fields == '["jimok"]'
        assert connection.execute("SELECT COUNT(*) FROM review_queue").fetchone()[0] == 1
        assert connection.execute("SELECT COUNT(*) FROM provenance").fetchone()[0] == 1
        assert connection.execute("SELECT exported FROM ref_notes").fetchone()[0] == 0
        stored_case_id = connection.execute("SELECT case_id FROM job_meta").fetchone()[0]
        assert stored_case_id == "LK-2026-GMSH-001"


def test_role_routes_features_to_separate_layers(tmp_path: Path) -> None:
    standard = parcel(role=ParcelRole.STANDARD).model_copy(update={"pnu": "4139013200101300007"})
    output = tmp_path / "roles.gpkg"
    build_geopackage(
        output,
        case_id="case",
        job_id="job",
        features=(ParcelFeature(parcel=standard, geometry=polygon()),),
        target_srs_id=5186,
        target_crs_name="EPSG:5186",
    )
    with sqlite3.connect(output) as connection:
        assert connection.execute("SELECT COUNT(*) FROM subject_parcels").fetchone()[0] == 0
        assert connection.execute("SELECT COUNT(*) FROM standard_parcels").fetchone()[0] == 1


def test_invalid_geometry_is_atomic_and_leaves_no_output(tmp_path: Path) -> None:
    output = tmp_path / "invalid.gpkg"
    invalid = {"type": "Point", "coordinates": [1, 2]}
    with pytest.raises(ValueError, match="Polygon"):
        build_geopackage(
            output,
            case_id="case",
            job_id="job",
            features=(ParcelFeature(parcel=parcel(), geometry=invalid),),
            target_srs_id=5186,
            target_crs_name="EPSG:5186",
        )
    assert not output.exists()
    assert not output.with_suffix(".gpkg.tmp").exists()


def test_builder_requires_explicit_overwrite(tmp_path: Path) -> None:
    output = tmp_path / "existing.gpkg"
    output.write_bytes(b"existing")
    with pytest.raises(FileExistsError):
        build_geopackage(
            output,
            case_id="case",
            job_id="job",
            features=(),
            target_srs_id=5186,
            target_crs_name="EPSG:5186",
        )
