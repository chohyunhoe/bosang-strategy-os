# -*- coding: utf-8 -*-
from __future__ import annotations

import hashlib
import json
import math
import shutil
import tempfile
from datetime import date, datetime, time
from pathlib import Path
from typing import Any

from .cadastral_source import prepare_layer_specs
from .manifest_loader import resolve_path

RESULT_FILENAME = "parcel_verification_result.json"
POLICY_VERSION = "bso_parcel_verification_v0.2"


def verification_config(manifest: dict) -> dict:
    value = manifest.get("parcel_verification")
    return value if isinstance(value, dict) else {}


def _uses_archive_geometry(manifest: dict) -> bool:
    return any(layer.get("archive") for layer in manifest.get("layers", []))


def verification_required(manifest: dict) -> bool:
    """연속지적도 ZIP을 사용하는 사건은 예외 없이 검증 게이트를 거친다."""
    return _uses_archive_geometry(manifest) or bool(verification_config(manifest).get("enabled"))


def verification_result_path(output_dir: Path) -> Path:
    return Path(output_dir) / RESULT_FILENAME


def _json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, bytes):
        return value.hex()
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    return str(value)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _file_identity(path: Path | None) -> dict | None:
    if path is None:
        return None
    payload: dict[str, Any] = {"path": str(path)}
    if path.exists():
        stat = path.stat()
        payload.update({
            "exists": True,
            "size": stat.st_size,
            "mtime_ns": stat.st_mtime_ns,
            "sha256": _sha256(path),
        })
    else:
        payload["exists"] = False
    return payload


def verification_fingerprint(manifest: dict) -> str:
    """manifest, 정책 버전, geometry 입력 파일을 묶은 검증 지문."""
    layers = []
    for raw in manifest.get("layers", []):
        source = resolve_path(manifest, raw.get("source"))
        archive = resolve_path(manifest, raw.get("archive"))
        layers.append({
            "role": raw.get("role"),
            "label": raw.get("label"),
            "source": _file_identity(source),
            "archive": _file_identity(archive),
            "pnus": [str(value) for value in (raw.get("pnus") or [])],
            "pnu_field": raw.get("pnu_field"),
            "jibun_field": raw.get("jibun_field"),
        })
    payload = {
        "policy_version": POLICY_VERSION,
        "case_id": manifest.get("case_id"),
        "parcel_verification": verification_config(manifest),
        "layers": layers,
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _direction_8(dx: float, dy: float) -> tuple[float, str, str]:
    """북쪽 0도, 시계방향 방위각과 8방위 코드를 반환한다."""
    bearing = (math.degrees(math.atan2(dx, dy)) + 360.0) % 360.0
    sectors = [
        ("N", "북"), ("NE", "북동"), ("E", "동"), ("SE", "남동"),
        ("S", "남"), ("SW", "남서"), ("W", "서"), ("NW", "북서"),
    ]
    index = int((bearing + 22.5) // 45.0) % 8
    code, korean = sectors[index]
    return bearing, code, korean


def build_pairwise_relationships(records: list[dict]) -> list[dict]:
    relationships: list[dict] = []
    for left_index, left in enumerate(records):
        left_point = left["centroid"]["epsg5174"]
        for right in records[left_index + 1:]:
            right_point = right["centroid"]["epsg5174"]
            dx = float(right_point["x"]) - float(left_point["x"])
            dy = float(right_point["y"]) - float(left_point["y"])
            bearing, direction, direction_ko = _direction_8(dx, dy)
            relationships.append({
                "from": {"label": left["label"], "pnu": left["pnu"]},
                "to": {"label": right["label"], "pnu": right["pnu"]},
                "distance_m": round(math.hypot(dx, dy), 3),
                "delta_east_m": round(dx, 3),
                "delta_north_m": round(dy, 3),
                "bearing_degrees_from_north": round(bearing, 3),
                "relative_direction": direction,
                "relative_direction_ko": direction_ko,
            })
    return relationships


def _find_attribute_field(layer: Any, configured: object, aliases: tuple[str, ...]) -> str | None:
    fields = {str(name).upper(): str(name) for name in layer.fields().names()}
    if configured:
        return fields.get(str(configured).upper())
    for alias in aliases:
        if alias.upper() in fields:
            return fields[alias.upper()]
    return None


def _jibun_matches(expected: str, actual: str) -> bool:
    expected = expected.replace(" ", "").strip()
    actual = actual.replace(" ", "").strip()
    if not expected:
        return True
    if actual == expected:
        return True
    if not actual.startswith(expected):
        return False
    remainder = actual[len(expected):]
    return bool(remainder) and not remainder[0].isdigit()


def _feature_record(
    entry: dict,
    source: Path,
    layer: Any,
    feature: Any,
    *,
    pnu_field: str,
    jibun_field: str | None,
) -> dict:
    from qgis.core import QgsCoordinateReferenceSystem, QgsCoordinateTransform, QgsProject

    geometry = feature.geometry()
    if geometry is None or geometry.isEmpty():
        raise RuntimeError(f"empty geometry: {entry['pnu']}")
    centroid_geometry = geometry.centroid()
    if centroid_geometry.isEmpty():
        raise RuntimeError(f"centroid failed: {entry['pnu']}")
    point_original = centroid_geometry.asPoint()

    crs_5174 = QgsCoordinateReferenceSystem("EPSG:5174")
    crs_4326 = QgsCoordinateReferenceSystem("EPSG:4326")
    transform_5174 = QgsCoordinateTransform(layer.crs(), crs_5174, QgsProject.instance())
    transform_4326 = QgsCoordinateTransform(layer.crs(), crs_4326, QgsProject.instance())
    point_5174 = transform_5174.transform(point_original)
    point_4326 = transform_4326.transform(point_original)

    attributes = {field.name(): _json_safe(feature.attribute(field.name())) for field in layer.fields()}
    bbox = geometry.boundingBox()
    return {
        "label": str(entry.get("label") or entry["pnu"]),
        "role": str(entry.get("role") or "unknown"),
        "pnu": str(entry["pnu"]),
        "expected_jibun": entry.get("expected_jibun"),
        "source_shapefile_name": source.name,
        "source_shapefile_path": str(source),
        "feature_id": int(feature.id()),
        "full_attributes": attributes,
        "resolved_attributes": {
            "pnu_field": pnu_field,
            "pnu": _json_safe(feature.attribute(pnu_field)),
            "jibun_field": jibun_field,
            "jibun": _json_safe(feature.attribute(jibun_field)) if jibun_field else None,
        },
        "source_crs": {
            "authid": layer.crs().authid(),
            "description": layer.crs().description(),
            "wkt": layer.crs().toWkt(),
        },
        "centroid": {
            "original_crs": {"x": point_original.x(), "y": point_original.y()},
            "epsg5174": {"x": point_5174.x(), "y": point_5174.y()},
            "epsg4326": {"longitude": point_4326.x(), "latitude": point_4326.y()},
        },
        "geometry_summary": {
            "area_source_units": geometry.area(),
            "bbox_original_crs": {
                "xmin": bbox.xMinimum(), "ymin": bbox.yMinimum(),
                "xmax": bbox.xMaximum(), "ymax": bbox.yMaximum(),
            },
        },
    }


def _record_issues(record: dict, config: dict) -> list[dict]:
    issues: list[dict] = []
    pnu = record["pnu"]
    prefix = str(config.get("municipality_pnu_prefix") or "")
    if prefix and not pnu.startswith(prefix):
        issues.append({
            "code": "MUNICIPALITY_PNU_PREFIX_MISMATCH",
            "pnu": pnu,
            "expected_prefix": prefix,
            "message": "PNU 행정구역 코드가 사건 설정과 일치하지 않습니다.",
        })

    expected_crs = str(config.get("expected_source_crs") or "")
    actual_crs = str(record["source_crs"].get("authid") or "")
    if expected_crs and actual_crs.upper() != expected_crs.upper():
        issues.append({
            "code": "SOURCE_CRS_MISMATCH",
            "pnu": pnu,
            "expected_crs": expected_crs,
            "actual_crs": actual_crs,
            "message": "원본 SHP CRS가 사건 설정과 일치하지 않습니다.",
        })

    expected_jibun = str(record.get("expected_jibun") or "")
    actual_jibun = str(record["resolved_attributes"].get("jibun") or "")
    if not _jibun_matches(expected_jibun, actual_jibun):
        issues.append({
            "code": "JIBUN_MISMATCH",
            "pnu": pnu,
            "expected_jibun": expected_jibun,
            "actual_jibun": actual_jibun,
            "message": "PNU와 원본 JIBUN 속성이 일치하지 않습니다.",
        })

    bounds = config.get("coordinate_bounds_epsg4326") or {}
    if bounds:
        point = record["centroid"]["epsg4326"]
        lon = float(point["longitude"])
        lat = float(point["latitude"])
        inside = (
            float(bounds["min_longitude"]) <= lon <= float(bounds["max_longitude"])
            and float(bounds["min_latitude"]) <= lat <= float(bounds["max_latitude"])
        )
        if not inside:
            issues.append({
                "code": "COORDINATE_OUTSIDE_CONFIGURED_AREA",
                "pnu": pnu,
                "longitude": lon,
                "latitude": lat,
                "configured_bounds": bounds,
                "message": "변환된 중심점이 사건 행정구역 검증 범위를 벗어났습니다.",
            })
    return issues


def _relationship_for(relationships: list[dict], from_pnu: str, to_pnu: str) -> dict | None:
    for item in relationships:
        if item["from"]["pnu"] == from_pnu and item["to"]["pnu"] == to_pnu:
            return item
    return None


def _relationship_issues(relationships: list[dict], config: dict) -> list[dict]:
    issues: list[dict] = []
    global_max = config.get("max_pairwise_distance_m")
    if global_max is not None:
        for item in relationships:
            if float(item["distance_m"]) > float(global_max):
                issues.append({
                    "code": "PAIRWISE_DISTANCE_GLOBAL_MAX_EXCEEDED",
                    "from_pnu": item["from"]["pnu"],
                    "to_pnu": item["to"]["pnu"],
                    "distance_m": item["distance_m"],
                    "max_distance_m": global_max,
                    "message": "필지 상호거리가 사건 전체 허용범위를 초과했습니다.",
                })

    for rule in config.get("pairwise_constraints") or []:
        from_pnu = str(rule.get("from_pnu") or "")
        to_pnu = str(rule.get("to_pnu") or "")
        item = _relationship_for(relationships, from_pnu, to_pnu)
        if item is None:
            issues.append({
                "code": "PAIRWISE_RELATIONSHIP_MISSING",
                "from_pnu": from_pnu,
                "to_pnu": to_pnu,
                "message": "설정된 필지 간 관계를 계산하지 못했습니다.",
            })
            continue
        distance = float(item["distance_m"])
        minimum = rule.get("min_distance_m")
        maximum = rule.get("max_distance_m")
        allowed = [str(value) for value in (rule.get("allowed_directions") or [])]
        if minimum is not None and distance < float(minimum):
            issues.append({
                "code": "PAIRWISE_DISTANCE_BELOW_MIN",
                "from_pnu": from_pnu,
                "to_pnu": to_pnu,
                "distance_m": distance,
                "min_distance_m": minimum,
                "message": "필지 상호거리가 설정된 최소값보다 작습니다.",
            })
        if maximum is not None and distance > float(maximum):
            issues.append({
                "code": "PAIRWISE_DISTANCE_ABOVE_MAX",
                "from_pnu": from_pnu,
                "to_pnu": to_pnu,
                "distance_m": distance,
                "max_distance_m": maximum,
                "message": "필지 상호거리가 설정된 최대값보다 큽니다.",
            })
        if allowed and item["relative_direction"] not in allowed:
            issues.append({
                "code": "PAIRWISE_DIRECTION_MISMATCH",
                "from_pnu": from_pnu,
                "to_pnu": to_pnu,
                "actual_direction": item["relative_direction"],
                "allowed_directions": allowed,
                "message": "필지 상대방향이 사건 설정과 일치하지 않습니다.",
            })
    return issues


def verify_manifest_parcels(manifest: dict, output_dir: Path) -> dict:
    """QGIS provider로 PNU별 원본 feature와 사건별 위치 제약을 검증한다."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    config = verification_config(manifest)
    required = list(config.get("required_pnus") or [])
    result: dict[str, Any] = {
        "schema_version": POLICY_VERSION,
        "case_id": manifest.get("case_id"),
        "status": "FAIL",
        "manifest_fingerprint": verification_fingerprint(manifest),
        "required_count": len(required),
        "verified_count": 0,
        "records": [],
        "pairwise_relationships": [],
        "issues": [],
    }
    if not verification_required(manifest):
        result["status"] = "NOT_REQUIRED"
        return result
    if not required:
        result["issues"].append({
            "code": "VERIFICATION_CONFIG_REQUIRED",
            "message": "연속지적도 ZIP 사건은 parcel_verification.required_pnus 설정이 필요합니다.",
        })
        verification_result_path(output_dir).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        return result

    from qgis.core import QgsFeatureRequest, QgsVectorLayer

    temp_root = Path(tempfile.mkdtemp(prefix="bso_parcel_verify_"))
    layer_cache: dict[Path, Any] = {}
    try:
        specs = prepare_layer_specs(manifest, temp_root)
        pnu_sources: dict[str, list[tuple[Path, dict]]] = {}
        for spec in specs:
            source = Path(spec["_prepared_source"])
            for pnu in spec.get("_subset_pnus") or spec.get("pnus") or []:
                pnu_sources.setdefault(str(pnu), []).append((source, spec))

        records: list[dict] = []
        for entry in required:
            pnu = str(entry.get("pnu") or "")
            sources = pnu_sources.get(pnu, [])
            matches: list[tuple[Path, Any, Any, str, str | None]] = []
            searched_sources: list[str] = []
            for source, spec in sources:
                searched_sources.append(str(source))
                layer = layer_cache.get(source)
                if layer is None:
                    layer = QgsVectorLayer(str(source), source.stem, "ogr")
                    layer_cache[source] = layer
                if not layer.isValid():
                    result["issues"].append({
                        "code": "VERIFICATION_LAYER_INVALID",
                        "pnu": pnu,
                        "message": f"SHP 레이어를 열 수 없습니다: {source}",
                    })
                    continue
                pnu_field = _find_attribute_field(
                    layer,
                    spec.get("pnu_field") or config.get("pnu_field"),
                    ("PNU", "A1"),
                )
                if pnu_field is None:
                    result["issues"].append({
                        "code": "VERIFICATION_PNU_FIELD_MISSING",
                        "pnu": pnu,
                        "message": f"PNU 필드가 없습니다: {source}",
                    })
                    continue
                request = QgsFeatureRequest().setFilterExpression(f'"{pnu_field}" = \'{pnu}\'')
                jibun_field = _find_attribute_field(
                    layer,
                    spec.get("jibun_field") or config.get("jibun_field"),
                    ("JIBUN", "A4"),
                )
                for feature in layer.getFeatures(request):
                    matches.append((source, layer, feature, pnu_field, jibun_field))

            if len(matches) != 1:
                result["issues"].append({
                    "code": "PNU_MATCH_COUNT_INVALID",
                    "pnu": pnu,
                    "label": entry.get("label"),
                    "match_count": len(matches),
                    "searched_sources": searched_sources,
                    "message": f"PNU 검색 건수는 정확히 1건이어야 합니다: {len(matches)}건",
                })
                continue

            source, layer, feature, pnu_field, jibun_field = matches[0]
            record = _feature_record(
                entry,
                source,
                layer,
                feature,
                pnu_field=pnu_field,
                jibun_field=jibun_field,
            )
            result["issues"].extend(_record_issues(record, config))
            records.append(record)

        result["records"] = records
        result["verified_count"] = len(records)
        if len(records) == len(required):
            relationships = build_pairwise_relationships(records)
            result["pairwise_relationships"] = relationships
            result["issues"].extend(_relationship_issues(relationships, config))
        if len(records) == len(required) and not result["issues"]:
            result["status"] = "PASS"
    except Exception as exc:
        result["issues"].append({"code": "PARCEL_VERIFICATION_EXCEPTION", "message": str(exc)})
    finally:
        layer_cache.clear()
        shutil.rmtree(temp_root, ignore_errors=True)

    verification_result_path(output_dir).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def load_verification_result(output_dir: Path) -> dict | None:
    path = verification_result_path(output_dir)
    if not path.exists():
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def verification_gate_passed(manifest: dict, output_dir: Path) -> bool:
    if not verification_required(manifest):
        return True
    result = load_verification_result(output_dir)
    if result is None or result.get("status") != "PASS":
        return False
    if result.get("schema_version") != POLICY_VERSION:
        return False
    return result.get("manifest_fingerprint") == verification_fingerprint(manifest)


def remove_blocked_outputs(output_dir: Path) -> None:
    """검증 실패 시 검증 JSON 외 모든 이전·중간 산출물과 캐시를 제거한다."""
    output_dir = Path(output_dir)
    if not output_dir.exists():
        return
    for path in output_dir.iterdir():
        if path.name == RESULT_FILENAME:
            continue
        try:
            if path.is_dir():
                shutil.rmtree(path, ignore_errors=True)
            else:
                path.unlink()
        except OSError:
            pass
