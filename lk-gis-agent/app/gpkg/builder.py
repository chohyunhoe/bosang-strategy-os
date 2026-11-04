"""Pure-Python GeoPackage builder for reviewed parcel data.

The builder writes a standards-oriented SQLite/GeoPackage container without depending on
GDAL. Polygon and MultiPolygon GeoJSON are serialized to GeoPackage geometry BLOBs.
"""

from __future__ import annotations

import json
import math
import sqlite3
import struct
from collections.abc import Mapping, Sequence
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pydantic import Field

from app.adapters.base import ProvenanceRecord
from app.models.common import StrictModel
from app.models.parcel import CanonicalParcel
from app.models.review import ReviewItem

_APPLICATION_ID = 0x47504B47
_USER_VERSION = 10300
_ROLE_TABLE = {
    "SUBJECT": "subject_parcels",
    "STANDARD": "standard_parcels",
    "CASE": "case_parcels",
}


class ParcelFeature(StrictModel):
    parcel: CanonicalParcel
    geometry: dict[str, Any]
    record_meta: dict[str, Any] = Field(default_factory=dict)


class SourceRecord(StrictModel):
    source_id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=200)
    kind: str = Field(min_length=1, max_length=40)
    auto_apply: bool
    attribution_text: str | None = Field(default=None, max_length=500)


class ReferenceNote(StrictModel):
    pnu: str = Field(pattern=r"^\d{19}$")
    platform: str = Field(min_length=1, max_length=80)
    url: str | None = Field(default=None, max_length=500)
    memo: str = Field(min_length=1, max_length=2000)
    captured_by: str = Field(min_length=1, max_length=80)
    captured_at: datetime


class GeoPackageBuildResult(StrictModel):
    path: Path
    feature_count: int = Field(ge=0)
    review_count: int = Field(ge=0)
    provenance_count: int = Field(ge=0)
    spatial_layers: tuple[str, ...]
    attribute_tables: tuple[str, ...]


def build_geopackage(
    output_path: Path,
    *,
    case_id: str,
    job_id: str,
    features: Sequence[ParcelFeature],
    target_srs_id: int,
    target_crs_name: str,
    target_crs_wkt: str = "undefined",
    review_items: Sequence[ReviewItem] = (),
    provenance: Sequence[ProvenanceRecord] = (),
    sources: Sequence[SourceRecord] = (),
    reference_notes: Sequence[ReferenceNote] = (),
    biz_zone: dict[str, Any] | None = None,
    job_options: Mapping[str, Any] | None = None,
    overwrite: bool = False,
) -> GeoPackageBuildResult:
    """Create one atomic GeoPackage file from already reviewed local data."""

    path = Path(output_path)
    if path.suffix.lower() != ".gpkg":
        raise ValueError("GeoPackage output path must end with .gpkg")
    if target_srs_id <= 0:
        raise ValueError("target_srs_id must be a positive authority code")
    if path.exists() and not overwrite:
        raise FileExistsError(path)

    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.unlink(missing_ok=True)

    connection = sqlite3.connect(temp_path)
    try:
        _initialize_container(
            connection,
            target_srs_id=target_srs_id,
            target_crs_name=target_crs_name,
            target_crs_wkt=target_crs_wkt,
        )
        _create_spatial_layers(connection, target_srs_id)
        _create_attribute_tables(connection)
        for feature in features:
            _insert_parcel_feature(connection, feature, target_srs_id)
        if biz_zone is not None:
            _insert_biz_zone(connection, biz_zone, target_srs_id)
        _insert_provenance(connection, provenance)
        _insert_sources(connection, sources)
        _insert_review_items(connection, review_items)
        _insert_reference_notes(connection, reference_notes)
        _insert_job_meta(
            connection,
            case_id=case_id,
            job_id=job_id,
            options=job_options or {},
        )
        connection.commit()
    except Exception:
        connection.rollback()
        connection.close()
        temp_path.unlink(missing_ok=True)
        raise
    else:
        connection.close()

    if path.exists():
        path.unlink()
    temp_path.replace(path)
    return GeoPackageBuildResult(
        path=path,
        feature_count=len(features),
        review_count=len(review_items),
        provenance_count=len(provenance),
        spatial_layers=("subject_parcels", "standard_parcels", "case_parcels", "biz_zone"),
        attribute_tables=("provenance", "sources", "review_queue", "ref_notes", "job_meta"),
    )


def _initialize_container(
    connection: sqlite3.Connection,
    *,
    target_srs_id: int,
    target_crs_name: str,
    target_crs_wkt: str,
) -> None:
    connection.execute(f"PRAGMA application_id={_APPLICATION_ID}")
    connection.execute(f"PRAGMA user_version={_USER_VERSION}")
    connection.executescript(
        """
        CREATE TABLE gpkg_spatial_ref_sys (
            srs_name TEXT NOT NULL,
            srs_id INTEGER NOT NULL PRIMARY KEY,
            organization TEXT NOT NULL,
            organization_coordsys_id INTEGER NOT NULL,
            definition TEXT NOT NULL,
            description TEXT
        );
        CREATE TABLE gpkg_contents (
            table_name TEXT NOT NULL PRIMARY KEY,
            data_type TEXT NOT NULL,
            identifier TEXT UNIQUE,
            description TEXT DEFAULT '',
            last_change DATETIME NOT NULL,
            min_x DOUBLE,
            min_y DOUBLE,
            max_x DOUBLE,
            max_y DOUBLE,
            srs_id INTEGER,
            CONSTRAINT fk_gc_r_srs_id FOREIGN KEY (srs_id)
                REFERENCES gpkg_spatial_ref_sys(srs_id)
        );
        CREATE TABLE gpkg_geometry_columns (
            table_name TEXT NOT NULL,
            column_name TEXT NOT NULL,
            geometry_type_name TEXT NOT NULL,
            srs_id INTEGER NOT NULL,
            z TINYINT NOT NULL,
            m TINYINT NOT NULL,
            PRIMARY KEY (table_name, column_name),
            FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id),
            FOREIGN KEY (table_name) REFERENCES gpkg_contents(table_name)
        );
        """
    )
    connection.executemany(
        """INSERT INTO gpkg_spatial_ref_sys
        (srs_name, srs_id, organization, organization_coordsys_id, definition, description)
        VALUES (?, ?, ?, ?, ?, ?)""",
        [
            ("Undefined Cartesian", -1, "NONE", -1, "undefined", "undefined Cartesian"),
            ("Undefined Geographic", 0, "NONE", 0, "undefined", "undefined geographic"),
            (
                target_crs_name,
                target_srs_id,
                "EPSG",
                target_srs_id,
                target_crs_wkt,
                "Configured target CRS",
            ),
        ],
    )


def _create_spatial_layers(connection: sqlite3.Connection, srs_id: int) -> None:
    parcel_columns = """
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        geom BLOB NOT NULL,
        pnu TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL,
        addr_jibun TEXT NOT NULL,
        area_pub REAL,
        jimok_pub TEXT,
        use_zone_pub TEXT,
        use_etc_pub TEXT,
        land_use_pub TEXT,
        road_pub TEXT,
        shape_pub TEXT,
        topo_pub TEXT,
        price_indv_pub REAL,
        price_base_year_pub INTEGER,
        price_std_pub REAL,
        price_std_year_pub INTEGER,
        area_apr REAL,
        jimok_apr TEXT,
        use_zone_apr TEXT,
        land_use_apr TEXT,
        road_apr TEXT,
        shape_apr TEXT,
        topo_apr TEXT,
        note_apr TEXT,
        apr_source_doc TEXT,
        recon_status TEXT NOT NULL,
        mismatch_fields TEXT NOT NULL,
        geom_source_id TEXT,
        attr_source_ids TEXT NOT NULL,
        record_meta TEXT NOT NULL
    """
    for table_name in _ROLE_TABLE.values():
        connection.execute(f'CREATE TABLE "{table_name}" ({parcel_columns})')
        _register_feature_table(connection, table_name, srs_id)

    connection.execute(
        """CREATE TABLE biz_zone (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            geom BLOB NOT NULL,
            name TEXT NOT NULL DEFAULT '사업구역',
            source_note TEXT
        )"""
    )
    _register_feature_table(connection, "biz_zone", srs_id)


def _register_feature_table(
    connection: sqlite3.Connection,
    table_name: str,
    srs_id: int,
) -> None:
    connection.execute(
        """INSERT INTO gpkg_contents
        (table_name, data_type, identifier, description, last_change, srs_id)
        VALUES (?, 'features', ?, '', ?, ?)""",
        (table_name, table_name, _now_text(), srs_id),
    )
    connection.execute(
        """INSERT INTO gpkg_geometry_columns
        (table_name, column_name, geometry_type_name, srs_id, z, m)
        VALUES (?, 'geom', 'MULTIPOLYGON', ?, 0, 0)""",
        (table_name, srs_id),
    )


def _create_attribute_tables(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE provenance (
            prov_id INTEGER PRIMARY KEY AUTOINCREMENT,
            pnu TEXT NOT NULL,
            source_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            endpoint TEXT NOT NULL,
            params_hash TEXT NOT NULL,
            fetched_at TEXT NOT NULL,
            http_status INTEGER,
            raw_path TEXT,
            cache_hit INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE sources (
            source_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            kind TEXT NOT NULL,
            auto_apply INTEGER NOT NULL,
            attribution_text TEXT
        );
        CREATE TABLE review_queue (
            item_id TEXT PRIMARY KEY,
            pnu TEXT NOT NULL,
            field TEXT NOT NULL,
            pub_value TEXT,
            apr_value TEXT,
            pub_source TEXT,
            apr_source TEXT,
            reason TEXT NOT NULL,
            status TEXT NOT NULL,
            decision TEXT,
            decided_value TEXT,
            resolved_by TEXT,
            resolved_at TEXT
        );
        CREATE TABLE ref_notes (
            note_id INTEGER PRIMARY KEY AUTOINCREMENT,
            pnu TEXT NOT NULL,
            platform TEXT NOT NULL,
            url TEXT,
            memo TEXT NOT NULL,
            captured_by TEXT NOT NULL,
            captured_at TEXT NOT NULL,
            license_status TEXT NOT NULL DEFAULT 'REFERENCE_ONLY',
            exported INTEGER NOT NULL DEFAULT 0 CHECK (exported = 0)
        );
        CREATE TABLE job_meta (
            job_id TEXT PRIMARY KEY,
            case_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            options_json TEXT NOT NULL
        );
        """
    )
    for table_name in ("provenance", "sources", "review_queue", "ref_notes", "job_meta"):
        connection.execute(
            """INSERT INTO gpkg_contents
            (table_name, data_type, identifier, description, last_change, srs_id)
            VALUES (?, 'attributes', ?, '', ?, NULL)""",
            (table_name, table_name, _now_text()),
        )


def _insert_parcel_feature(
    connection: sqlite3.Connection,
    feature: ParcelFeature,
    srs_id: int,
) -> None:
    parcel = feature.parcel
    table_name = _ROLE_TABLE[parcel.role.value]
    pub = parcel.public_values
    apr = parcel.appraisal_values
    values = (
        _geometry_blob(feature.geometry, srs_id),
        parcel.pnu,
        parcel.role.value,
        parcel.addr_jibun,
        pub.area,
        pub.jimok,
        pub.use_zone,
        pub.use_etc,
        pub.land_use,
        pub.road,
        pub.shape,
        pub.topo,
        pub.price_indv,
        pub.price_base_year,
        pub.price_std,
        pub.price_std_year,
        apr.area,
        apr.jimok,
        apr.use_zone,
        apr.land_use,
        apr.road,
        apr.shape,
        apr.topo,
        apr.note,
        apr.source_doc,
        parcel.recon_status.value,
        _json(parcel.mismatch_fields),
        parcel.geom_source_id,
        _json(parcel.attr_source_ids),
        _json(feature.record_meta),
    )
    connection.execute(
        f"""INSERT INTO "{table_name}" (
            geom, pnu, role, addr_jibun,
            area_pub, jimok_pub, use_zone_pub, use_etc_pub, land_use_pub,
            road_pub, shape_pub, topo_pub, price_indv_pub, price_base_year_pub,
            price_std_pub, price_std_year_pub,
            area_apr, jimok_apr, use_zone_apr, land_use_apr, road_apr,
            shape_apr, topo_apr, note_apr, apr_source_doc,
            recon_status, mismatch_fields, geom_source_id, attr_source_ids, record_meta
        ) VALUES ({','.join('?' for _ in values)})""",
        values,
    )


def _insert_biz_zone(
    connection: sqlite3.Connection,
    biz_zone: dict[str, Any],
    srs_id: int,
) -> None:
    properties = biz_zone.get("properties") if isinstance(biz_zone, dict) else None
    properties = properties if isinstance(properties, dict) else {}
    geometry = biz_zone.get("geometry") if biz_zone.get("type") == "Feature" else biz_zone
    connection.execute(
        "INSERT INTO biz_zone (geom, name, source_note) VALUES (?, ?, ?)",
        (
            _geometry_blob(geometry, srs_id),
            str(properties.get("name") or "사업구역"),
            properties.get("source_note"),
        ),
    )


def _insert_provenance(
    connection: sqlite3.Connection,
    records: Sequence[ProvenanceRecord],
) -> None:
    connection.executemany(
        """INSERT INTO provenance
        (pnu, source_id, kind, endpoint, params_hash, fetched_at,
         http_status, raw_path, cache_hit)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        [
            (
                item.pnu,
                item.source_id,
                item.kind.value,
                item.endpoint,
                item.params_hash,
                item.fetched_at.isoformat(),
                item.http_status,
                item.raw_path,
                int(item.cache_hit),
            )
            for item in records
        ],
    )


def _insert_sources(connection: sqlite3.Connection, records: Sequence[SourceRecord]) -> None:
    connection.executemany(
        """INSERT INTO sources
        (source_id, name, kind, auto_apply, attribution_text)
        VALUES (?, ?, ?, ?, ?)""",
        [
            (item.source_id, item.name, item.kind, int(item.auto_apply), item.attribution_text)
            for item in records
        ],
    )


def _insert_review_items(connection: sqlite3.Connection, items: Sequence[ReviewItem]) -> None:
    connection.executemany(
        """INSERT INTO review_queue
        (item_id, pnu, field, pub_value, apr_value, pub_source, apr_source,
         reason, status, decision, decided_value, resolved_by, resolved_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        [
            (
                item.id,
                item.pnu,
                item.field.value,
                _scalar_text(item.pub_value),
                _scalar_text(item.apr_value),
                item.pub_source,
                item.apr_source,
                item.reason.value,
                item.status.value,
                item.decision.value if item.decision else None,
                _scalar_text(item.decided_value),
                item.resolved_by,
                item.resolved_at.isoformat() if item.resolved_at else None,
            )
            for item in items
        ],
    )


def _insert_reference_notes(
    connection: sqlite3.Connection,
    notes: Sequence[ReferenceNote],
) -> None:
    connection.executemany(
        """INSERT INTO ref_notes
        (pnu, platform, url, memo, captured_by, captured_at)
        VALUES (?, ?, ?, ?, ?, ?)""",
        [
            (
                item.pnu,
                item.platform,
                item.url,
                item.memo,
                item.captured_by,
                item.captured_at.isoformat(),
            )
            for item in notes
        ],
    )


def _insert_job_meta(
    connection: sqlite3.Connection,
    *,
    case_id: str,
    job_id: str,
    options: Mapping[str, Any],
) -> None:
    connection.execute(
        "INSERT INTO job_meta (job_id, case_id, created_at, options_json) VALUES (?, ?, ?, ?)",
        (job_id, case_id, _now_text(), _json(dict(options))),
    )


def _geometry_blob(geometry: dict[str, Any], srs_id: int) -> bytes:
    polygons = _multipolygon_coordinates(geometry)
    wkb = bytearray()
    wkb.extend(struct.pack("<BI", 1, 6))
    wkb.extend(struct.pack("<I", len(polygons)))
    for polygon in polygons:
        wkb.extend(struct.pack("<BI", 1, 3))
        wkb.extend(struct.pack("<I", len(polygon)))
        for ring in polygon:
            points = _ring_points(ring)
            wkb.extend(struct.pack("<I", len(points)))
            for x, y in points:
                wkb.extend(struct.pack("<dd", x, y))
    return b"GP" + bytes((0, 1)) + struct.pack("<i", srs_id) + bytes(wkb)


def _multipolygon_coordinates(geometry: dict[str, Any]) -> list[list[list[list[float]]]]:
    if not isinstance(geometry, dict):
        raise ValueError("geometry must be a GeoJSON object")
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if geometry_type == "Polygon":
        polygons = [coordinates]
    elif geometry_type == "MultiPolygon":
        polygons = coordinates
    else:
        raise ValueError("GeoPackage parcel geometry must be Polygon or MultiPolygon")
    if not isinstance(polygons, list) or not polygons:
        raise ValueError("geometry coordinates must be non-empty")
    return polygons


def _ring_points(ring: Any) -> list[tuple[float, float]]:
    if not isinstance(ring, list) or len(ring) < 4:
        raise ValueError("polygon rings require at least four coordinate pairs")
    points: list[tuple[float, float]] = []
    for point in ring:
        if not isinstance(point, (list, tuple)) or len(point) < 2:
            raise ValueError("invalid coordinate pair")
        x, y = float(point[0]), float(point[1])
        if not math.isfinite(x) or not math.isfinite(y):
            raise ValueError("coordinates must be finite")
        points.append((x, y))
    if points[0] != points[-1]:
        raise ValueError("polygon rings must be closed")
    return points


def _scalar_text(value: Any) -> str | None:
    if value is None:
        return None
    return _json(value)


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _now_text() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
