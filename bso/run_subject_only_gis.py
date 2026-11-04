# -*- coding: utf-8 -*-
"""보상전략 OS — subject-only 일회성 GIS runner (상담배포 지도).

RUN_GRAPHICS_GATE / qgis_renderer는 subject+standard 역할을 강제한다(ROLE_MISSING).
상담배포 지도는 비교표준지가 없는 자료이므로 가짜 표준지를 넣지 않고 이 별도 runner로
대상토지만 처리한다. 기존 안정 모듈은 수정하지 않고 import만 한다.

재사용 모듈(무수정):
- manifest_loader.load_manifest / resolve_path
- parcel_verification.verify_manifest_parcels (PNU exact 1건, JIBUN, CRS, 좌표범위, 상호거리)
- cadastral_source.prepare_layer_specs (연속지적 ZIP 안전 추출)
- qgis_windows_bootstrap.configure_windows_dll_search
- vworld_local_basemap.build_local_vworld_basemap (VWorld 위성 타일 → 로컬 GeoTIFF)

subject-only 전용 추가 fail-closed 게이트:
- subject 역할만 허용, 기대 필지수와 required_pnus 수 일치
- PNU 본번·부번 → 기대 지번 자기일치
- 원본 JIBUN(A4) 엄격 일치(지목 접미만 제거 후 완전일치)
- 재추출 feature가 검증 feature와 동일(면적·bbox)
10/10 PASS가 아니면 지도 렌더를 하지 않는다. API key는 환경변수로만 받고 어떤 출력에도 쓰지 않는다.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
SRC_DIR = HERE / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from bso_graphics.manifest_loader import load_manifest, resolve_path  # noqa: E402
from bso_graphics.parcel_verification import (  # noqa: E402
    RESULT_FILENAME,
    remove_blocked_outputs,
    verification_result_path,
)

RUNNER_VERSION = "bso_subject_only_gis_v0.1"
RUN_RESULT_FILENAME = "subject_only_gis_result.json"

EXIT_OK = 0
EXIT_PREFLIGHT = 11
EXIT_VERIFICATION = 12
EXIT_BASEMAP = 13
EXIT_RENDER = 14

GROUP_NOTE_DEFAULT = "상담 검토를 위한 작업가설 군집입니다. 일단지 여부를 확정한 것이 아닙니다."


# ---------------------------------------------------------------------------
# 순수 함수 (QGIS 불필요 — 단위테스트 대상)
# ---------------------------------------------------------------------------

def pnu_to_jibun(pnu: str) -> str:
    """19자리 PNU의 산 구분·본번·부번으로 지번 문자열을 만든다."""
    text = str(pnu)
    if len(text) != 19 or not text.isdigit():
        raise ValueError(f"invalid PNU: {pnu}")
    mountain = text[10]
    if mountain not in ("1", "2"):
        raise ValueError(f"invalid PNU land-type digit: {pnu}")
    main = int(text[11:15])
    sub = int(text[15:19])
    prefix = "산" if mountain == "2" else ""
    return f"{prefix}{main}-{sub}" if sub else f"{prefix}{main}"


_JIBUN_CORE = re.compile(r"^(산?\d+(?:-\d+)?)(\D*)$")


def normalize_jibun(value: object) -> str:
    """공백과 말미 지목 표기(예: '2-5대', '2-5 대')만 제거한다.

    말미 접미부에 숫자가 섞이면(예: '2-5-3대') 지번 일부로 보고 제거하지 않는다.
    지목 글자가 인코딩 문제로 깨져도(비숫자) 지번 본체 비교는 유지된다.
    """
    text = re.sub(r"\s+", "", str(value or ""))
    match = _JIBUN_CORE.match(text)
    return match.group(1) if match else text


def strict_jibun_equal(expected: object, actual: object) -> bool:
    left = normalize_jibun(expected)
    return bool(left) and left == normalize_jibun(actual)


def subject_only_preflight(manifest: dict) -> list[dict]:
    """subject-only 사건 manifest의 구조·자기일치를 검증한다(실패 시 렌더 불가)."""
    issues: list[dict] = []

    def add(code: str, message: str, **extra: Any) -> None:
        issues.append({"code": code, "message": message, **extra})

    if manifest.get("subject_only") is not True:
        add("SUBJECT_ONLY_FLAG_REQUIRED", "manifest.subject_only=true 사건만 처리합니다.")
    layers = manifest.get("layers") or []
    if not layers:
        add("SUBJECT_LAYER_REQUIRED", "대상토지 레이어가 없습니다.")
    for layer in layers:
        if layer.get("role") != "subject":
            add("NON_SUBJECT_ROLE_FORBIDDEN", "subject-only runner에는 비교표준지·사례 레이어를 넣지 않습니다.",
                role=layer.get("role"))
        archive = resolve_path(manifest, layer.get("archive"))
        source = resolve_path(manifest, layer.get("source"))
        if archive is None and source is None:
            add("GEOMETRY_INPUT_MISSING", "archive 또는 source가 필요합니다.")
        if archive is not None and not archive.exists():
            add("CADASTRAL_ARCHIVE_MISSING", f"연속지적 ZIP 없음: {archive.name}")

    config = manifest.get("parcel_verification") or {}
    if not config.get("enabled"):
        add("PARCEL_VERIFICATION_REQUIRED", "parcel_verification.enabled=true가 필요합니다.")
    required = list(config.get("required_pnus") or [])
    expected_count = manifest.get("expected_parcel_count")
    if not isinstance(expected_count, int) or expected_count <= 0:
        add("EXPECTED_PARCEL_COUNT_REQUIRED", "expected_parcel_count(양의 정수)가 필요합니다.")
    elif len(required) != expected_count:
        add("REQUIRED_PNU_COUNT_MISMATCH", "required_pnus 수가 기대 필지수와 다릅니다.",
            expected=expected_count, actual=len(required))

    jibuns: list[str] = []
    for entry in required:
        pnu = str(entry.get("pnu") or "")
        expected_jibun = str(entry.get("expected_jibun") or "")
        if entry.get("role") not in (None, "subject"):
            add("NON_SUBJECT_ROLE_FORBIDDEN", "required_pnus에는 subject만 허용합니다.", pnu=pnu)
        try:
            derived = pnu_to_jibun(pnu)
        except ValueError as exc:
            add("PNU_INVALID", str(exc), pnu=pnu)
            continue
        if derived != normalize_jibun(expected_jibun):
            add("PNU_JIBUN_SELF_MISMATCH", "PNU 본번·부번과 기대 지번이 다릅니다.",
                pnu=pnu, pnu_derived_jibun=derived, expected_jibun=expected_jibun)
        jibuns.append(normalize_jibun(expected_jibun))
    if len(set(jibuns)) != len(jibuns):
        add("DUPLICATE_EXPECTED_JIBUN", "기대 지번이 중복됩니다.")

    seen: dict[str, str] = {}
    for group in (manifest.get("working_hypothesis_groups") or {}).get("groups") or []:
        group_id = str(group.get("id") or "")
        for jibun in group.get("jibuns") or []:
            key = normalize_jibun(jibun)
            if key not in jibuns:
                add("GROUP_MEMBER_NOT_IN_SUBJECT", "작업가설 군집 구성 지번이 대상 목록에 없습니다.",
                    group=group_id, jibun=jibun)
            if key in seen:
                add("GROUP_MEMBER_DUPLICATED", "한 지번이 여러 작업가설 군집에 들어 있습니다.",
                    jibun=jibun, groups=[seen[key], group_id])
            seen[key] = group_id
    return issues


def assess_area(areas_m2: list[float], reference: dict | None) -> dict:
    total = round(sum(float(value) for value in areas_m2), 2)
    result: dict[str, Any] = {
        "basis": "연속지적도 도형 평면면적(EPSG:5186, m²) — 토지대장 면적이 아님",
        "geometry_total_m2": total,
    }
    expected = (reference or {}).get("expected_total_m2")
    if expected is None:
        result["level"] = "NO_REFERENCE"
        return result
    expected = float(expected)
    diff = round(total - expected, 2)
    ratio = diff / expected if expected else float("inf")
    warn = float((reference or {}).get("warn_ratio", 0.01))
    anomaly = float((reference or {}).get("anomaly_ratio", 0.03))
    if abs(ratio) <= warn:
        level = "WITHIN_TOLERANCE"
    elif abs(ratio) <= anomaly:
        level = "REVIEW_DIFFERENCE"
    else:
        level = "ANOMALY_WARNING"
    result.update({
        "reference_total_m2": round(expected, 2),
        "reference_note": (reference or {}).get("source_note"),
        "difference_m2": diff,
        "difference_ratio": round(ratio, 6),
        "warn_ratio": warn,
        "anomaly_ratio": anomaly,
        "level": level,
    })
    return result


def redact(value: Any, secrets: list[str]) -> Any:
    secrets = [item for item in secrets if item and len(item) >= 6]
    if not secrets:
        return value
    if isinstance(value, str):
        for secret in secrets:
            value = value.replace(secret, "[REDACTED]")
        return value
    if isinstance(value, list):
        return [redact(item, secrets) for item in value]
    if isinstance(value, dict):
        return {key: redact(item, secrets) for key, item in value.items()}
    return value


def fit_extent(bounds: tuple[float, float, float, float], aspect: float,
               pad_ratio: float, min_pad: float, min_width: float = 0.0) -> tuple[float, float, float, float]:
    xmin, ymin, xmax, ymax = bounds
    width = max(xmax - xmin, 1.0)
    height = max(ymax - ymin, 1.0)
    pad_x = max(width * pad_ratio, min_pad)
    pad_y = max(height * pad_ratio, min_pad)
    xmin, xmax, ymin, ymax = xmin - pad_x, xmax + pad_x, ymin - pad_y, ymax + pad_y
    cx, cy = (xmin + xmax) / 2.0, (ymin + ymax) / 2.0
    width, height = xmax - xmin, ymax - ymin
    if width < min_width:
        width = min_width
    if width / height < aspect:
        width = height * aspect
    else:
        height = width / aspect
    return (cx - width / 2.0, cy - height / 2.0, cx + width / 2.0, cy + height / 2.0)


def rects_overlap(a: tuple[float, float, float, float], b: tuple[float, float, float, float], gap: float = 0.0) -> bool:
    """(x, y, w, h) 사각형 겹침 여부."""
    return not (a[0] + a[2] + gap <= b[0] or b[0] + b[2] + gap <= a[0]
                or a[1] + a[3] + gap <= b[1] or b[1] + b[3] + gap <= a[1])


def rect_contains(outer: tuple[float, float, float, float], inner: tuple[float, float, float, float]) -> bool:
    return (inner[0] >= outer[0] and inner[1] >= outer[1]
            and inner[0] + inner[2] <= outer[0] + outer[2]
            and inner[1] + inner[3] <= outer[1] + outer[3])


def nearest_point_on_rect(rect: tuple[float, float, float, float], px: float, py: float) -> tuple[float, float]:
    x, y, w, h = rect
    cx = min(max(px, x), x + w)
    cy = min(max(py, y), y + h)
    if x < px < x + w and y < py < y + h:  # 내부점: 가장 가까운 변으로
        distances = [(px - x, (x, py)), (x + w - px, (x + w, py)), (py - y, (px, y)), (y + h - py, (px, y + h))]
        return min(distances)[1]
    return cx, cy


def segment_hits_rect(p0: tuple[float, float], p1: tuple[float, float], rect: tuple[float, float, float, float]) -> bool:
    """선분이 사각형 내부를 지나는지(Liang–Barsky)."""
    x0, y0 = p0
    dx, dy = p1[0] - x0, p1[1] - y0
    t0, t1 = 0.0, 1.0
    rx, ry, rw, rh = rect
    for p, q in ((-dx, x0 - rx), (dx, rx + rw - x0), (-dy, y0 - ry), (dy, ry + rh - y0)):
        if abs(p) < 1e-12:
            if q < 0:
                return False
            continue
        t = q / p
        if p < 0:
            t0 = max(t0, t)
        else:
            t1 = min(t1, t)
        if t0 > t1:
            return False
    return t1 - t0 > 1e-6


def leader_candidates(anchor: tuple[float, float], outward_angle: float, radii: list[float]) -> list[tuple[float, float]]:
    offsets = [0.0]
    for step in range(1, 9):
        offsets.extend([step * 22.5, -step * 22.5])
    points: list[tuple[float, float]] = []
    for radius in radii:
        for offset in offsets:
            angle = math.radians(outward_angle + offset)
            points.append((anchor[0] + radius * math.cos(angle), anchor[1] + radius * math.sin(angle)))
    return points


def nice_scale_length(map_width_m: float, fraction: float = 0.22) -> float:
    target = max(map_width_m * fraction, 1.0)
    candidates = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000]
    best = candidates[0]
    for value in candidates:
        if value <= target:
            best = value
    return float(best)


def format_area(value: float) -> str:
    return f"{value:,.2f}㎡"


# ---------------------------------------------------------------------------
# 결과 파일
# ---------------------------------------------------------------------------

def _write_json(path: Path, payload: dict, secrets: list[str]) -> None:
    path.write_text(json.dumps(redact(payload, secrets), ensure_ascii=False, indent=2), encoding="utf-8")


def _clear_case_dir(case_dir: Path) -> None:
    """이전 실행 산출물을 지운다(타일 캐시는 보존)."""
    if not case_dir.exists():
        return
    for path in case_dir.iterdir():
        if path.name == "_basemap-cache":
            continue
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
        else:
            try:
                path.unlink()
            except OSError:
                pass


# ---------------------------------------------------------------------------
# QGIS / GDAL 단계
# ---------------------------------------------------------------------------

def _field(layer: Any, configured: object, aliases: tuple[str, ...]) -> str | None:
    names = {str(name).upper(): str(name) for name in layer.fields().names()}
    if configured:
        return names.get(str(configured).upper())
    for alias in aliases:
        if alias.upper() in names:
            return names[alias.upper()]
    return None


def _text(value: Any) -> str:
    if value is None:
        return ""
    try:
        if hasattr(value, "isNull") and value.isNull():
            return ""
    except Exception:
        pass
    return str(value)


def apply_subject_only_gate(result: dict, manifest: dict) -> list[dict]:
    """verify_manifest_parcels 결과에 subject-only 엄격 검증을 덧붙인다."""
    issues: list[dict] = []
    expected_count = int(manifest.get("expected_parcel_count") or 0)
    if int(result.get("verified_count") or 0) != expected_count:
        issues.append({
            "code": "SUBJECT_VERIFIED_COUNT_MISMATCH",
            "expected": expected_count,
            "verified": result.get("verified_count"),
            "message": "검증된 필지 수가 기대 필지 수와 다릅니다.",
        })
    for record in result.get("records") or []:
        resolved = record.get("resolved_attributes") or {}
        actual_jibun = resolved.get("jibun")
        expected_jibun = record.get("expected_jibun")
        derived = pnu_to_jibun(record["pnu"])
        strict = strict_jibun_equal(expected_jibun, actual_jibun)
        pnu_ok = str(resolved.get("pnu") or "") == str(record["pnu"])
        record["subject_only_check"] = {
            "expected_jibun": expected_jibun,
            "source_jibun_raw": actual_jibun,
            "source_jibun_normalized": normalize_jibun(actual_jibun),
            "pnu_derived_jibun": derived,
            "source_pnu_equals_requested": pnu_ok,
            "strict_jibun_match": strict,
            "pass": bool(strict and pnu_ok and derived == normalize_jibun(expected_jibun)),
        }
        if not record["subject_only_check"]["pass"]:
            issues.append({
                "code": "SUBJECT_JIBUN_STRICT_MISMATCH",
                "pnu": record["pnu"],
                "expected_jibun": expected_jibun,
                "source_jibun": actual_jibun,
                "message": "원본 JIBUN이 대상 지번과 엄격 일치하지 않습니다.",
            })
    return issues


def extract_subject_parcels(manifest: dict, verification: dict, work_dir: Path) -> tuple[list[dict], Path, list[dict]]:
    """검증 PASS 후 동일 원본에서 10필지를 재추출하고 검증 feature와 동일성을 대조한다."""
    from osgeo import ogr
    from qgis.core import QgsFeatureRequest, QgsVectorLayer

    from bso_graphics.cadastral_source import prepare_layer_specs

    issues: list[dict] = []
    specs = prepare_layer_specs(manifest, work_dir)
    spec = specs[0]
    source = Path(spec["_prepared_source"])
    layer = QgsVectorLayer(str(source), "cadastral_source", "ogr")
    if not layer.isValid():
        raise RuntimeError(f"cadastral SHP invalid: {source.name}")
    pnu_field = _field(layer, spec.get("pnu_field"), ("PNU", "A1"))
    jibun_field = _field(layer, spec.get("jibun_field"), ("JIBUN", "A4"))
    if pnu_field is None or jibun_field is None:
        raise RuntimeError("PNU/JIBUN field missing in cadastral SHP")

    records = {str(item["pnu"]): item for item in verification.get("records") or []}
    pnus = [str(item["pnu"]) for item in (manifest["parcel_verification"]["required_pnus"])]
    quoted = ",".join("'" + value + "'" for value in pnus)
    request = QgsFeatureRequest().setFilterExpression(f'"{pnu_field}" IN ({quoted})')
    found: dict[str, list[Any]] = {value: [] for value in pnus}
    for feature in layer.getFeatures(request):
        key = _text(feature.attribute(pnu_field))
        if key in found:
            found[key].append(feature)

    display = {str(item["pnu"]): item for item in manifest.get("parcel_display") or []}
    groups = {}
    for group in (manifest.get("working_hypothesis_groups") or {}).get("groups") or []:
        for jibun in group.get("jibuns") or []:
            groups[normalize_jibun(jibun)] = str(group.get("id"))

    parcels: list[dict] = []
    for index, entry in enumerate(manifest["parcel_verification"]["required_pnus"], start=1):
        pnu = str(entry["pnu"])
        matches = found.get(pnu) or []
        if len(matches) != 1:
            issues.append({"code": "EXTRACTION_MATCH_COUNT_INVALID", "pnu": pnu, "match_count": len(matches),
                           "message": "재추출 PNU 건수가 1건이 아닙니다."})
            continue
        feature = matches[0]
        geometry = feature.geometry()
        area = float(geometry.area())
        record = records.get(pnu) or {}
        summary = record.get("geometry_summary") or {}
        bbox = geometry.boundingBox()
        ref_bbox = summary.get("bbox_original_crs") or {}
        same = (
            abs(area - float(summary.get("area_source_units", -1))) <= max(1e-6, area * 1e-9)
            and all(abs(float(ref_bbox.get(key, 1e18)) - value) <= 1e-6 for key, value in (
                ("xmin", bbox.xMinimum()), ("ymin", bbox.yMinimum()),
                ("xmax", bbox.xMaximum()), ("ymax", bbox.yMaximum()),
            ))
        )
        if not same:
            issues.append({"code": "EXTRACTION_FEATURE_DIFFERS_FROM_VERIFIED", "pnu": pnu,
                           "message": "재추출 feature가 검증 feature와 다릅니다."})
            continue
        ogr_geometry = ogr.CreateGeometryFromWkt(geometry.asWkt())
        if ogr_geometry is None:
            issues.append({"code": "GEOMETRY_CONVERSION_FAILED", "pnu": pnu, "message": "WKT 변환 실패"})
            continue
        expected_jibun = normalize_jibun(entry.get("expected_jibun"))
        part_count = ogr_geometry.GetGeometryCount() if ogr_geometry.GetGeometryType() in (
            ogr.wkbMultiPolygon, ogr.wkbMultiPolygon25D) else 1
        parcels.append({
            "no": int((display.get(pnu) or {}).get("no") or index),
            "pnu": pnu,
            "jibun": expected_jibun,
            "jibun_source": _text(feature.attribute(jibun_field)),
            "group": groups.get(expected_jibun, ""),
            "area_m2": round(area, 2),
            "area_m2_raw": area,
            "geometry": ogr_geometry,
            "geometry_valid": bool(ogr_geometry.IsValid()),
            "part_count": int(part_count),
        })
    return parcels, source, issues


def geometry_warnings(parcels: list[dict]) -> list[dict]:
    warnings: list[dict] = []
    for parcel in parcels:
        if not parcel["geometry_valid"]:
            warnings.append({"code": "GEOMETRY_INVALID", "jibun": parcel["jibun"],
                             "message": "도형 유효성 검사 실패 — 면적값 검토 필요"})
        if parcel["part_count"] > 1:
            warnings.append({"code": "GEOMETRY_MULTIPART", "jibun": parcel["jibun"],
                             "parts": parcel["part_count"], "message": "다중 polygon 필지 — 원본 확인 필요"})
        if parcel["area_m2_raw"] < 1.0:
            warnings.append({"code": "GEOMETRY_AREA_TOO_SMALL", "jibun": parcel["jibun"],
                             "message": "도형면적 1㎡ 미만 — 원본 확인 필요"})
    return warnings


def build_group_geometries(manifest: dict, parcels: list[dict], buffer_m: float) -> list[dict]:
    from osgeo import ogr

    by_jibun = {parcel["jibun"]: parcel for parcel in parcels}
    note = (manifest.get("working_hypothesis_groups") or {}).get("note") or GROUP_NOTE_DEFAULT
    output: list[dict] = []
    for group in (manifest.get("working_hypothesis_groups") or {}).get("groups") or []:
        members = [by_jibun[normalize_jibun(j)] for j in group.get("jibuns") or [] if normalize_jibun(j) in by_jibun]
        if not members:
            continue
        union = None
        for member in members:
            buffered = member["geometry"].Buffer(buffer_m, 8)
            union = buffered if union is None else union.Union(buffered)
        # 사실관계 기록용: 0.5m 이내로 서로 이어지는 덩어리 수(인접 판단은 전문가 확인 대상)
        touching = None
        for member in members:
            item = member["geometry"].Buffer(0.25, 4)
            touching = item if touching is None else touching.Union(item)
        pieces = touching.GetGeometryCount() if touching.GetGeometryType() in (
            ogr.wkbMultiPolygon, ogr.wkbMultiPolygon25D) else 1
        output.append({
            "id": str(group.get("id")),
            "members": [member["jibun"] for member in members],
            "outline": union,
            "connected_pieces_within_0_5m": int(pieces),
            "note": note,
        })
    return output


def write_geometry_outputs(case_dir: Path, case_id: str, parcels: list[dict], groups: list[dict],
                           source_label: str) -> dict:
    from osgeo import ogr, osr

    src = osr.SpatialReference()
    src.ImportFromEPSG(5186)
    wgs = osr.SpatialReference()
    wgs.ImportFromEPSG(4326)
    for ref in (src, wgs):
        try:
            ref.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        except AttributeError:
            pass
    to_wgs = osr.CoordinateTransformation(src, wgs)

    gpkg_path = case_dir / f"{case_id}_subject_parcels.gpkg"
    geojson_path = case_dir / f"{case_id}_subject_parcels.geojson"
    for path in (gpkg_path, geojson_path):
        if path.exists():
            path.unlink()

    fields = [
        ("no", ogr.OFTInteger), ("pnu", ogr.OFTString), ("jibun", ogr.OFTString),
        ("jibun_src", ogr.OFTString), ("hyp_group", ogr.OFTString), ("area_m2", ogr.OFTReal),
        ("area_basis", ogr.OFTString), ("source", ogr.OFTString), ("verify", ogr.OFTString),
    ]

    def fill(layer: Any, geometry: Any, parcel: dict) -> None:
        feature = ogr.Feature(layer.GetLayerDefn())
        feature.SetField("no", int(parcel["no"]))
        feature.SetField("pnu", parcel["pnu"])
        feature.SetField("jibun", parcel["jibun"])
        feature.SetField("jibun_src", parcel["jibun_source"])
        feature.SetField("hyp_group", parcel["group"])
        feature.SetField("area_m2", float(parcel["area_m2"]))
        feature.SetField("area_basis", "연속지적 도형 평면면적 EPSG:5186 (대장면적 아님)")
        feature.SetField("source", source_label)
        feature.SetField("verify", "PASS")
        feature.SetGeometry(geometry)
        layer.CreateFeature(feature)

    gpkg = ogr.GetDriverByName("GPKG").CreateDataSource(str(gpkg_path))
    layer = gpkg.CreateLayer("subject_parcels", src, ogr.wkbMultiPolygon)
    for name, kind in fields:
        layer.CreateField(ogr.FieldDefn(name, kind))
    for parcel in sorted(parcels, key=lambda item: item["no"]):
        fill(layer, ogr.ForceToMultiPolygon(parcel["geometry"].Clone()), parcel)
    group_layer = gpkg.CreateLayer("working_hypothesis_groups", src, ogr.wkbMultiPolygon)
    for name in ("group_id", "members", "note"):
        group_layer.CreateField(ogr.FieldDefn(name, ogr.OFTString))
    for group in groups:
        feature = ogr.Feature(group_layer.GetLayerDefn())
        feature.SetField("group_id", group["id"])
        feature.SetField("members", ", ".join(group["members"]))
        feature.SetField("note", group["note"])
        feature.SetGeometry(ogr.ForceToMultiPolygon(group["outline"].Clone()))
        group_layer.CreateFeature(feature)
    gpkg = None

    driver = ogr.GetDriverByName("GeoJSON")
    dataset = driver.CreateDataSource(str(geojson_path))
    layer = dataset.CreateLayer("subject_parcels", wgs, ogr.wkbMultiPolygon, options=["RFC7946=YES"])
    for name, kind in fields:
        layer.CreateField(ogr.FieldDefn(name, kind))
    for parcel in sorted(parcels, key=lambda item: item["no"]):
        geometry = ogr.ForceToMultiPolygon(parcel["geometry"].Clone())
        geometry.Transform(to_wgs)
        fill(layer, geometry, parcel)
    dataset = None
    return {
        "gpkg": str(gpkg_path),
        "gpkg_crs": "EPSG:5186",
        "gpkg_layers": ["subject_parcels", "working_hypothesis_groups"],
        "geojson": str(geojson_path),
        "geojson_crs": "EPSG:4326 (RFC 7946)",
    }


def load_context_geometries(source: Path, extent: tuple[float, float, float, float], exclude: set[str],
                            pnu_field_name: str | None, limit: int = 8000) -> tuple[list[Any], bool]:
    from osgeo import ogr
    from qgis.core import QgsFeatureRequest, QgsRectangle, QgsVectorLayer

    layer = QgsVectorLayer(str(source), "context", "ogr")
    if not layer.isValid():
        return [], False
    pnu_field = _field(layer, pnu_field_name, ("PNU", "A1"))
    request = QgsFeatureRequest().setFilterRect(QgsRectangle(*extent))
    geometries: list[Any] = []
    for feature in layer.getFeatures(request):
        if pnu_field and _text(feature.attribute(pnu_field)) in exclude:
            continue
        geometry = ogr.CreateGeometryFromWkt(feature.geometry().asWkt())
        if geometry is not None:
            geometries.append(geometry)
        if len(geometries) > limit:
            return [], False
    return geometries, True


def write_frame_layer(path: Path, extent: tuple[float, float, float, float]) -> Any:
    from osgeo import ogr, osr
    from qgis.core import QgsVectorLayer

    if path.exists():
        path.unlink()
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(5186)
    dataset = ogr.GetDriverByName("GPKG").CreateDataSource(str(path))
    layer = dataset.CreateLayer("frame", srs, ogr.wkbPolygon)
    xmin, ymin, xmax, ymax = extent
    ring = ogr.Geometry(ogr.wkbLinearRing)
    for x, y in ((xmin, ymin), (xmax, ymin), (xmax, ymax), (xmin, ymax), (xmin, ymin)):
        ring.AddPoint_2D(x, y)
    polygon = ogr.Geometry(ogr.wkbPolygon)
    polygon.AddGeometry(ring)
    feature = ogr.Feature(layer.GetLayerDefn())
    feature.SetGeometry(polygon)
    layer.CreateFeature(feature)
    dataset = None
    frame = QgsVectorLayer(f"{path}|layername=frame", "frame", "ogr")
    if not frame.isValid() or frame.featureCount() != 1:
        raise RuntimeError("basemap frame layer invalid")
    return frame


def fetch_basemap(name: str, extent: tuple[float, float, float, float], aspect: float, case_dir: Path,
                  work_dir: Path, manifest: dict, api_key: str) -> dict:
    """기존 build_local_vworld_basemap을 그대로 호출해 지도 범위의 VWorld GeoTIFF를 만든다."""
    from bso_graphics.vworld_local_basemap import build_local_vworld_basemap

    frame = write_frame_layer(work_dir / f"frame_{name}.gpkg", extent)
    referer = manifest.get("vworld_referer") or os.environ.get("VWORLD_DOMAIN") or "http://localhost"
    layer = build_local_vworld_basemap(
        vector_layers=[frame],
        api_key=api_key,
        cache_root=case_dir / "_basemap-cache",
        q={},
        referer=referer,
        target_aspect=aspect,
    )
    path = Path(layer.source().split("|")[0])
    match = re.match(r"z(\d+)_", path.parent.name)
    return {"path": path, "zoom": int(match.group(1)) if match else None, "source": "VWORLD_LOCAL_TILE_MOSAIC"}


def warp_background(tif_path: Path, extent: tuple[float, float, float, float], width: int, height: int,
                    tag: str) -> Any:
    from osgeo import gdal
    from qgis.PyQt.QtGui import QImage

    warped = f"/vsimem/bso_subject_only_{tag}.tif"
    png = f"/vsimem/bso_subject_only_{tag}.png"
    options = gdal.WarpOptions(
        format="GTiff", srcSRS="EPSG:3857", dstSRS="EPSG:5186",
        outputBounds=extent, width=width, height=height, resampleAlg="cubic",
    )
    dataset = gdal.Warp(warped, str(tif_path), options=options)
    if dataset is None:
        raise RuntimeError("background warp failed")
    out = gdal.Translate(png, dataset, format="PNG", bandList=[1, 2, 3])
    dataset = None
    if out is None:
        raise RuntimeError("background PNG conversion failed")
    out = None
    handle = gdal.VSIFOpenL(png, "rb")
    gdal.VSIFSeekL(handle, 0, 2)
    size = gdal.VSIFTellL(handle)
    gdal.VSIFSeekL(handle, 0, 0)
    payload = gdal.VSIFReadL(1, size, handle)
    gdal.VSIFCloseL(handle)
    gdal.Unlink(warped)
    gdal.Unlink(png)
    image = QImage()
    if not image.loadFromData(payload, "PNG"):
        raise RuntimeError("background image decode failed")
    return image


def to_epsg5186(lon: float, lat: float) -> tuple[float, float]:
    from osgeo import osr

    wgs = osr.SpatialReference()
    wgs.ImportFromEPSG(4326)
    tm = osr.SpatialReference()
    tm.ImportFromEPSG(5186)
    for ref in (wgs, tm):
        try:
            ref.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        except AttributeError:
            pass
    x, y, _ = osr.CoordinateTransformation(wgs, tm).TransformPoint(lon, lat)
    return x, y


# ---------------------------------------------------------------------------
# 렌더링 (Qt — PNG/PDF 공용 그리기)
# ---------------------------------------------------------------------------

def _qint(flag: Any) -> int:
    """PyQt5(sip int enum)와 PyQt6(enum.Flag) 모두에서 정수 플래그로 변환."""
    return int(getattr(flag, "value", flag))


class Page:
    def __init__(self, width_mm: float, height_mm: float, dpi: int):
        self.width_mm = width_mm
        self.height_mm = height_mm
        self.dpi = dpi
        self.width = int(round(self.mm(width_mm)))
        self.height = int(round(self.mm(height_mm)))

    def mm(self, value: float) -> float:
        return value / 25.4 * self.dpi

    def pt(self, value: float) -> int:
        return max(1, int(round(value / 72.0 * self.dpi)))


class MapView:
    def __init__(self, extent: tuple[float, float, float, float], rect: tuple[float, float, float, float]):
        self.extent = extent
        self.rect = rect
        self.scale = rect[2] / (extent[2] - extent[0])

    def px(self, x: float, y: float) -> tuple[float, float]:
        return (self.rect[0] + (x - self.extent[0]) * self.scale,
                self.rect[1] + (self.extent[3] - y) * self.scale)

    def map(self, px: float, py: float) -> tuple[float, float]:
        return (self.extent[0] + (px - self.rect[0]) / self.scale,
                self.extent[3] - (py - self.rect[1]) / self.scale)


def _font_family() -> str:
    from qgis.PyQt.QtGui import QFontDatabase

    try:
        families = set(QFontDatabase.families())
    except TypeError:
        families = set(QFontDatabase().families())
    for name in ("Malgun Gothic", "맑은 고딕", "Noto Sans CJK KR", "NanumGothic", "Apple SD Gothic Neo"):
        if name in families:
            return name
    return "Malgun Gothic"


def _ogr_polygons(geometry: Any) -> list[Any]:
    from osgeo import ogr

    kind = ogr.GT_Flatten(geometry.GetGeometryType())
    if kind == ogr.wkbPolygon:
        return [geometry]
    if kind in (ogr.wkbMultiPolygon, ogr.wkbGeometryCollection):
        output = []
        for index in range(geometry.GetGeometryCount()):
            output.extend(_ogr_polygons(geometry.GetGeometryRef(index)))
        return output
    return []


def _ogr_lines(geometry: Any) -> list[list[tuple[float, float]]]:
    """polygon 외곽·내곽 ring 좌표열."""
    rings: list[list[tuple[float, float]]] = []
    for polygon in _ogr_polygons(geometry):
        for index in range(polygon.GetGeometryCount()):
            ring = polygon.GetGeometryRef(index)
            rings.append([(ring.GetX(i), ring.GetY(i)) for i in range(ring.GetPointCount())])
    return rings


class Renderer:
    def __init__(self, page: Page, manifest: dict, qa_background_label: str | None = None):
        from qgis.PyQt import QtCore, QtGui

        self.QtCore = QtCore
        self.QtGui = QtGui
        self.page = page
        self.manifest = manifest
        self.family = _font_family()
        self.qa_background_label = qa_background_label
        self.degraded_labels: list[str] = []

    # --- 기본 도구 ---------------------------------------------------------
    def font(self, size_pt: float, bold: bool = False) -> Any:
        font = self.QtGui.QFont(self.family)
        font.setPixelSize(self.page.pt(size_pt))
        font.setBold(bold)
        return font

    def metrics(self, font: Any) -> Any:
        return self.QtGui.QFontMetricsF(font)

    def pen(self, color: Any, width_mm: float, style: str = "solid") -> Any:
        QtCore, QtGui = self.QtCore, self.QtGui
        pen = QtGui.QPen(QtGui.QColor(*color) if isinstance(color, tuple) else color)
        pen.setWidthF(self.page.mm(width_mm))
        pen.setCapStyle(QtCore.Qt.PenCapStyle.RoundCap)
        pen.setJoinStyle(QtCore.Qt.PenJoinStyle.RoundJoin)
        if style == "dash":
            pen.setStyle(QtCore.Qt.PenStyle.DashLine)
        return pen

    def text(self, painter: Any, rect: tuple[float, float, float, float], text: str, font: Any,
             color: tuple = (20, 20, 20), align: str = "left") -> None:
        QtCore = self.QtCore
        qt = QtCore.Qt
        flags = {
            "left": _qint(qt.AlignmentFlag.AlignLeft) | _qint(qt.AlignmentFlag.AlignVCenter),
            "right": _qint(qt.AlignmentFlag.AlignRight) | _qint(qt.AlignmentFlag.AlignVCenter),
            "center": _qint(qt.AlignmentFlag.AlignCenter),
        }[align]
        painter.setFont(font)
        painter.setPen(self.QtGui.QColor(*color))
        painter.drawText(QtCore.QRectF(*rect), flags, text)

    def wrapped(self, painter: Any, rect: tuple[float, float, float, float], text: str, font: Any,
                color: tuple = (60, 60, 60)) -> float:
        QtCore = self.QtCore
        painter.setFont(font)
        painter.setPen(self.QtGui.QColor(*color))
        qt = QtCore.Qt
        flags = (_qint(qt.AlignmentFlag.AlignLeft) | _qint(qt.AlignmentFlag.AlignTop)
                 | _qint(qt.TextFlag.TextWordWrap))
        bound = painter.boundingRect(QtCore.QRectF(*rect), flags, text)
        painter.drawText(QtCore.QRectF(*rect), flags, text)
        return bound.height()

    def halo_text(self, painter: Any, x: float, baseline: float, text: str, font: Any,
                  fill: tuple = (15, 15, 15), halo: tuple = (255, 255, 255), halo_mm: float = 0.55,
                  angle_deg: float = 0.0) -> None:
        QtCore, QtGui = self.QtCore, self.QtGui
        path = QtGui.QPainterPath()
        path.addText(QtCore.QPointF(0, 0), font, text)
        painter.save()
        painter.translate(x, baseline)
        if angle_deg:
            painter.rotate(angle_deg)
        painter.strokePath(path, self.pen(halo, halo_mm))
        painter.fillPath(path, QtGui.QBrush(QtGui.QColor(*fill)))
        painter.restore()

    def path_for(self, view: MapView, geometry: Any) -> Any:
        QtCore, QtGui = self.QtCore, self.QtGui
        path = QtGui.QPainterPath()
        path.setFillRule(QtCore.Qt.FillRule.OddEvenFill)
        for ring in _ogr_lines(geometry):
            points = [QtCore.QPointF(*view.px(x, y)) for x, y in ring]
            if len(points) >= 3:
                path.addPolygon(QtGui.QPolygonF(points))
                path.closeSubpath()
        return path

    # --- 페이지 골격 -------------------------------------------------------
    def layout(self) -> dict:
        mm = self.page.mm
        return {
            "header": (0, 0, self.page.width, mm(19)),
            "map": (mm(8), mm(23), mm(203), mm(170)),
            "panel": (mm(215), mm(23), mm(74), mm(170)),
            "footer": (mm(8), mm(196), mm(281), mm(11)),
        }

    def draw_header(self, painter: Any, map_title: str, page_no: int, page_total: int) -> None:
        mm = self.page.mm
        QtCore, QtGui = self.QtCore, self.QtGui
        x, y, w, h = self.layout()["header"]
        painter.fillRect(QtCore.QRectF(x, y, w, h), QtGui.QColor(24, 39, 58))
        self.text(painter, (mm(8), mm(2.5), mm(200), mm(8.5)), str(self.manifest.get("title") or ""),
                  self.font(15, True), (255, 255, 255))
        self.text(painter, (mm(8), mm(11), mm(200), mm(6)), map_title, self.font(9), (210, 220, 232))
        badge = (mm(239), mm(3.2), mm(50), mm(6.8))
        painter.setPen(QtCore.Qt.PenStyle.NoPen)
        painter.setBrush(QtGui.QColor(232, 160, 32))
        painter.drawRoundedRect(QtCore.QRectF(*badge), mm(1.2), mm(1.2))
        self.text(painter, badge, "DRAFT · REVIEW", self.font(9, True), (24, 30, 40), "center")
        status = str(self.manifest.get("status_line") or "")
        self.text(painter, (mm(180), mm(11), mm(109), mm(6)), f"{status}   ({page_no}/{page_total})",
                  self.font(8), (210, 220, 232), "right")

    def draw_footer(self, painter: Any, source_line: str) -> None:
        mm = self.page.mm
        x, y, w, h = self.layout()["footer"]
        self.text(painter, (x, y, w, mm(4.5)), source_line, self.font(6.3), (70, 70, 70))
        self.text(painter, (x, y + mm(4.6), w, mm(4.5)),
                  str(self.manifest.get("output_disclaimer") or ""), self.font(6.3), (110, 70, 20))

    def draw_panel(self, painter: Any, parcels: list[dict], area: dict, legend: list[tuple[str, str]],
                   notes: list[str]) -> None:
        mm = self.page.mm
        QtCore, QtGui = self.QtCore, self.QtGui
        x, y, w, h = self.layout()["panel"]
        painter.setPen(self.pen((200, 205, 212), 0.25))
        painter.setBrush(QtGui.QColor(250, 250, 248))
        painter.drawRect(QtCore.QRectF(x, y, w, h))
        cx = x + mm(3)
        cw = w - mm(6)
        cy = y + mm(3)
        self.text(painter, (cx, cy, cw, mm(6)), f"대상 필지 ({len(parcels)}필지)", self.font(9.5, True), (24, 39, 58))
        cy += mm(7)
        cols = [("No", mm(7), "center"), ("지번", mm(17), "left"), ("도형면적", mm(25), "right"), ("가설군*", mm(cw / self.page.mm(1) - 49), "center")]
        row_h = mm(5.0)
        painter.fillRect(QtCore.QRectF(cx, cy, cw, row_h), QtGui.QColor(228, 232, 238))
        offset = cx
        for label, width, align in cols:
            self.text(painter, (offset + mm(0.8), cy, width - mm(1.6), row_h), label, self.font(7, True), (40, 50, 60), align)
            offset += width
        cy += row_h
        for parcel in sorted(parcels, key=lambda item: item["no"]):
            values = [str(parcel["no"]), parcel["jibun"], format_area(parcel["area_m2"]), parcel["group"] or "-"]
            offset = cx
            for (label, width, align), value in zip(cols, values):
                self.text(painter, (offset + mm(0.8), cy, width - mm(1.6), row_h), value, self.font(7.2), (25, 25, 25), align)
                offset += width
            painter.setPen(self.pen((222, 225, 230), 0.15))
            painter.drawLine(QtCore.QPointF(cx, cy + row_h), QtCore.QPointF(cx + cw, cy + row_h))
            cy += row_h
        painter.fillRect(QtCore.QRectF(cx, cy, cw, row_h), QtGui.QColor(255, 243, 205))
        self.text(painter, (cx + mm(0.8), cy, mm(23), row_h), "합계(도형)", self.font(7.2, True), (25, 25, 25))
        self.text(painter, (cx + mm(24), cy, mm(25) - mm(1.6), row_h), format_area(area["geometry_total_m2"]),
                  self.font(7.2, True), (25, 25, 25), "right")
        cy += row_h + mm(2)
        if area.get("reference_total_m2") is not None:
            level_text = {
                "WITHIN_TOLERANCE": ("오차 범위 내(±{:.0%})".format(area["warn_ratio"]), (30, 110, 60)),
                "REVIEW_DIFFERENCE": ("차이 검토 필요", (170, 110, 0)),
                "ANOMALY_WARNING": ("이상치 경고 — 원본 확인 필요", (180, 30, 30)),
            }.get(area["level"], ("", (60, 60, 60)))
            self.text(painter, (cx, cy, cw, mm(4.2)),
                      f"기존 자료 합계 {format_area(area['reference_total_m2'])}", self.font(7), (40, 40, 40))
            cy += mm(4.2)
            sign = "+" if area["difference_m2"] >= 0 else ""
            self.text(painter, (cx, cy, cw, mm(4.2)),
                      f"차이 {sign}{area['difference_m2']:,.2f}㎡ ({sign}{area['difference_ratio'] * 100:.2f}%) · {level_text[0]}",
                      self.font(7, True), level_text[1])
            cy += mm(5.5)
        self.text(painter, (cx, cy, cw, mm(5)), "범례", self.font(8.5, True), (24, 39, 58))
        cy += mm(5.5)
        for kind, label in legend:
            self.legend_symbol(painter, kind, (cx, cy + mm(0.4), mm(8), mm(3.6)))
            height = self.wrapped(painter, (cx + mm(10), cy, cw - mm(10), mm(9)), label, self.font(6.8), (40, 40, 40))
            cy += max(mm(4.8), height + mm(1.2))
        cy += mm(1.5)
        for note in notes:
            height = self.wrapped(painter, (cx, cy, cw, mm(14)), note, self.font(6.2), (90, 90, 90))
            cy += height + mm(1.2)

    def legend_symbol(self, painter: Any, kind: str, rect: tuple[float, float, float, float]) -> None:
        QtCore, QtGui = self.QtCore, self.QtGui
        x, y, w, h = rect
        if kind == "subject":
            painter.setPen(self.pen((120, 78, 0), 0.6))
            painter.setBrush(QtGui.QColor(255, 196, 0, 110))
            painter.drawRect(QtCore.QRectF(x, y, w, h))
        elif kind == "group":
            painter.setBrush(QtCore.Qt.BrushStyle.NoBrush)
            painter.setPen(self.pen((10, 10, 10), 0.9))
            painter.drawRect(QtCore.QRectF(x, y, w, h))
            painter.setPen(self.pen((255, 255, 255), 0.45, "dash"))
            painter.drawRect(QtCore.QRectF(x, y, w, h))
        elif kind == "context":
            painter.setPen(self.pen((255, 255, 255), 0.18))
            painter.fillRect(QtCore.QRectF(x, y, w, h), QtGui.QColor(90, 100, 90))
            painter.setBrush(QtCore.Qt.BrushStyle.NoBrush)
            painter.drawRect(QtCore.QRectF(x + w * 0.15, y + h * 0.15, w * 0.7, h * 0.7))
        elif kind == "station":
            self.station_marker(painter, x + w / 2, y + h / 2)
        elif kind == "detail_frame":
            painter.setBrush(QtCore.Qt.BrushStyle.NoBrush)
            painter.setPen(self.pen((10, 10, 10), 0.8))
            painter.drawRect(QtCore.QRectF(x, y, w, h))
            painter.setPen(self.pen((0, 210, 255), 0.4, "dash"))
            painter.drawRect(QtCore.QRectF(x, y, w, h))

    def station_marker(self, painter: Any, px: float, py: float) -> None:
        QtCore, QtGui = self.QtCore, self.QtGui
        radius = self.page.mm(1.7)
        painter.setPen(self.pen((20, 45, 95), 0.6))
        painter.setBrush(QtGui.QColor(255, 255, 255))
        painter.drawEllipse(QtCore.QPointF(px, py), radius, radius)
        painter.setPen(QtCore.Qt.PenStyle.NoPen)
        painter.setBrush(QtGui.QColor(20, 45, 95))
        painter.drawEllipse(QtCore.QPointF(px, py), radius * 0.45, radius * 0.45)

    # --- 지도 요소 ---------------------------------------------------------
    def draw_background(self, painter: Any, view: MapView, image: Any | None) -> None:
        QtCore, QtGui = self.QtCore, self.QtGui
        rect = QtCore.QRectF(*view.rect)
        if image is not None:
            painter.drawImage(rect, image)
            painter.fillRect(rect, QtGui.QColor(0, 0, 0, 28))
        else:
            painter.fillRect(rect, QtGui.QColor(70, 78, 72))
        if self.qa_background_label:
            self.halo_text(painter, view.rect[0] + self.page.mm(4), view.rect[1] + self.page.mm(10),
                           self.qa_background_label, self.font(16, True), (200, 0, 0), (255, 255, 255), 0.8)

    def draw_polygons(self, painter: Any, view: MapView, parcels: list[dict]) -> None:
        QtGui = self.QtGui
        for parcel in parcels:
            path = self.path_for(view, parcel["geometry"])
            painter.setPen(self.pen((255, 248, 220), 0.9))
            painter.setBrush(QtGui.QColor(255, 196, 0, 105))
            painter.drawPath(path)
            painter.setPen(self.pen((125, 80, 0), 0.5))
            painter.setBrush(self.QtCore.Qt.BrushStyle.NoBrush)
            painter.drawPath(path)

    def draw_context(self, painter: Any, view: MapView, geometries: list[Any]) -> None:
        painter.setBrush(self.QtCore.Qt.BrushStyle.NoBrush)
        painter.setPen(self.pen((255, 255, 255, 150), 0.16))
        for geometry in geometries:
            painter.drawPath(self.path_for(view, geometry))

    def draw_groups(self, painter: Any, view: MapView, groups: list[dict], placed: list[tuple]) -> list[tuple]:
        QtCore, QtGui = self.QtCore, self.QtGui
        mm = self.page.mm
        tags: list[tuple] = []
        for group in groups:
            path = self.path_for(view, group["outline"])
            painter.setBrush(QtCore.Qt.BrushStyle.NoBrush)
            painter.setPen(self.pen((10, 10, 10, 220), 0.95))
            painter.drawPath(path)
            painter.setPen(self.pen((255, 255, 255), 0.5, "dash"))
            painter.drawPath(path)
        bounds = {group["id"]: self.path_for(view, group["outline"]).boundingRect() for group in groups}
        for group in groups:
            bound = bounds[group["id"]]
            others = [(r.x(), r.y(), r.width(), r.height()) for gid, r in bounds.items() if gid != group["id"]]
            size = (mm(6.2), mm(5.0))
            gap = mm(1.2)
            corners = [
                (bound.left() - size[0] - gap, bound.top() - size[1] - gap),
                (bound.right() + gap, bound.top() - size[1] - gap),
                (bound.left() - size[0] - gap, bound.bottom() + gap),
                (bound.right() + gap, bound.bottom() + gap),
                (bound.left() - size[0] - gap, bound.center().y() - size[1] / 2),
                (bound.right() + gap, bound.center().y() - size[1] / 2),
            ]
            choice = None
            inner = (view.rect[0] + mm(1), view.rect[1] + mm(1), view.rect[2] - mm(2), view.rect[3] - mm(2))
            # 1순위: 다른 군집 외곽·라벨과 떨어진 자리, 2순위: 라벨만 피한 자리
            for blockers in (placed + tags + others, placed + tags):
                for cx, cy in corners:
                    rect = (cx, cy, size[0], size[1])
                    if rect_contains(inner, rect) and not any(rects_overlap(rect, other, mm(1.0)) for other in blockers):
                        choice = rect
                        break
                if choice is not None:
                    break
            if choice is None:
                choice = (min(max(corners[0][0], inner[0]), inner[0] + inner[2] - size[0]),
                          min(max(corners[0][1], inner[1]), inner[1] + inner[3] - size[1]), size[0], size[1])
            painter.setPen(self.pen((255, 255, 255), 0.35))
            painter.setBrush(QtGui.QColor(24, 39, 58, 235))
            painter.drawRoundedRect(QtCore.QRectF(*choice), mm(1), mm(1))
            self.text(painter, choice, group["id"], self.font(9, True), (255, 255, 255), "center")
            tags.append(choice)
        return tags

    def _label_box(self, parcel: dict) -> tuple[float, float, list[str]]:
        mm = self.page.mm
        jibun_font = self.font(8.2, True)
        area_font = self.font(7.0)
        lines = [parcel["jibun"], format_area(parcel["area_m2"])]
        text_w = max(self.metrics(jibun_font).horizontalAdvance(lines[0]),
                     self.metrics(area_font).horizontalAdvance(lines[1]))
        badge = mm(4.4)
        width = mm(1.2) + badge + mm(1.2) + text_w + mm(1.4)
        height = mm(1.0) + self.metrics(jibun_font).height() + self.metrics(area_font).height() + mm(0.8)
        return width, max(height, badge + mm(1.6)), lines

    def place_parcel_labels(self, view: MapView, parcels: list[dict], reserved: list[tuple]) -> list[dict]:
        from osgeo import ogr

        mm = self.page.mm
        union = None
        for parcel in parcels:
            union = parcel["geometry"].Clone() if union is None else union.Union(parcel["geometry"])
        union_buffer = union.Buffer(0.3)
        anchors = {}
        for parcel in parcels:
            point = parcel["geometry"].PointOnSurface()
            anchors[parcel["pnu"]] = view.px(point.GetX(), point.GetY())
        center = (sum(a[0] for a in anchors.values()) / len(anchors), sum(a[1] for a in anchors.values()) / len(anchors))
        inner = (view.rect[0] + mm(2), view.rect[1] + mm(2), view.rect[2] - mm(4), view.rect[3] - mm(4))
        placed: list[tuple] = list(reserved)
        results: dict[str, dict] = {}

        def map_box(rect: tuple) -> Any:
            x, y, w, h = rect
            corners = [view.map(x, y), view.map(x + w, y), view.map(x + w, y + h), view.map(x, y + h), view.map(x, y)]
            ring = ogr.Geometry(ogr.wkbLinearRing)
            for cx, cy in corners:
                ring.AddPoint_2D(cx, cy)
            polygon = ogr.Geometry(ogr.wkbPolygon)
            polygon.AddGeometry(ring)
            return polygon

        # 1차: 필지 내부에 들어가는 라벨
        for parcel in sorted(parcels, key=lambda item: -item["area_m2_raw"]):
            width, height, lines = self._label_box(parcel)
            ax, ay = anchors[parcel["pnu"]]
            rect = (ax - width / 2, ay - height / 2, width, height)
            if (rect_contains(inner, rect) and parcel["geometry"].Contains(map_box(rect))
                    and not any(rects_overlap(rect, other, mm(0.5)) for other in placed)):
                placed.append(rect)
                results[parcel["pnu"]] = {"parcel": parcel, "rect": rect, "anchor": (ax, ay), "leader": False, "lines": lines}

        # 2차: 들어가지 않는 필지는 바깥 빈 곳에 leader로 연결
        remaining = [parcel for parcel in parcels if parcel["pnu"] not in results]
        remaining.sort(key=lambda item: math.atan2(anchors[item["pnu"]][1] - center[1], anchors[item["pnu"]][0] - center[0]))
        radii = [mm(value) for value in (9, 13, 17, 22, 28, 35, 44, 55)]
        for relaxed in (False, True):
            for parcel in list(remaining):
                width, height, lines = self._label_box(parcel)
                ax, ay = anchors[parcel["pnu"]]
                outward = math.degrees(math.atan2(ay - center[1], ax - center[0])) if (ax, ay) != center else -90.0
                chosen = None
                for px, py in leader_candidates((ax, ay), outward, radii):
                    rect = (px - width / 2, py - height / 2, width, height)
                    if not rect_contains(inner, rect):
                        continue
                    if any(rects_overlap(rect, other, mm(0.8)) for other in placed):
                        continue
                    if not relaxed and map_box(rect).Intersects(union_buffer):
                        continue
                    end = nearest_point_on_rect(rect, ax, ay)
                    if any(segment_hits_rect((ax, ay), end, other) for other in placed):
                        continue
                    chosen = rect
                    break
                if chosen is None:
                    continue
                placed.append(chosen)
                results[parcel["pnu"]] = {"parcel": parcel, "rect": chosen, "anchor": (ax, ay), "leader": True, "lines": lines}
                remaining.remove(parcel)
        for parcel in remaining:  # 최후: 겹침 허용 배치(결과 JSON에 기록)
            width, height, lines = self._label_box(parcel)
            ax, ay = anchors[parcel["pnu"]]
            rect = (min(max(ax + mm(6), inner[0]), inner[0] + inner[2] - width),
                    min(max(ay - height / 2, inner[1]), inner[1] + inner[3] - height), width, height)
            placed.append(rect)
            self.degraded_labels.append(parcel["jibun"])
            results[parcel["pnu"]] = {"parcel": parcel, "rect": rect, "anchor": (ax, ay), "leader": True, "lines": lines}
        return [results[parcel["pnu"]] for parcel in parcels]

    def draw_parcel_labels(self, painter: Any, placements: list[dict]) -> None:
        QtCore, QtGui = self.QtCore, self.QtGui
        mm = self.page.mm
        for item in placements:
            if not item["leader"]:
                continue
            ax, ay = item["anchor"]
            end = nearest_point_on_rect(item["rect"], ax, ay)
            painter.setPen(self.pen((255, 255, 255), 0.75))
            painter.drawLine(QtCore.QPointF(ax, ay), QtCore.QPointF(*end))
            painter.setPen(self.pen((20, 20, 20), 0.32))
            painter.drawLine(QtCore.QPointF(ax, ay), QtCore.QPointF(*end))
            painter.setPen(self.pen((255, 255, 255), 0.3))
            painter.setBrush(QtGui.QColor(20, 20, 20))
            painter.drawEllipse(QtCore.QPointF(ax, ay), mm(0.75), mm(0.75))
        jibun_font = self.font(8.2, True)
        area_font = self.font(7.0)
        for item in placements:
            x, y, w, h = item["rect"]
            painter.setPen(self.pen((60, 45, 10), 0.25))
            painter.setBrush(QtGui.QColor(255, 255, 255, 236))
            painter.drawRoundedRect(QtCore.QRectF(x, y, w, h), mm(0.9), mm(0.9))
            badge = mm(4.4)
            bx, by = x + mm(1.2), y + (h - badge) / 2
            painter.setPen(self.pen((120, 78, 0), 0.25))
            painter.setBrush(QtGui.QColor(255, 196, 0))
            painter.drawEllipse(QtCore.QRectF(bx, by, badge, badge))
            self.text(painter, (bx, by, badge, badge), str(item["parcel"]["no"]), self.font(7.2, True), (30, 20, 0), "center")
            tx = bx + badge + mm(1.2)
            jm = self.metrics(jibun_font)
            am = self.metrics(area_font)
            top = y + (h - jm.height() - am.height()) / 2
            self.text(painter, (tx, top, w, jm.height()), item["lines"][0], jibun_font, (15, 15, 15))
            self.text(painter, (tx, top + jm.height(), w, am.height()), item["lines"][1], area_font, (60, 50, 30))

    def draw_reference(self, painter: Any, view: MapView, reference: dict, avoid: list[tuple]) -> list[tuple]:
        """OSM 참고 위치(역·도로명)를 표기한다. 범위 밖 항목은 그리지 않는다."""
        mm = self.page.mm
        placed: list[tuple] = []
        inner = (view.rect[0] + mm(2), view.rect[1] + mm(2), view.rect[2] - mm(4), view.rect[3] - mm(4))
        name_font = self.font(9, True)
        for point in reference.get("points") or []:
            x, y = to_epsg5186(float(point["lon"]), float(point["lat"]))
            px, py = view.px(x, y)
            if not (inner[0] <= px <= inner[0] + inner[2] and inner[1] <= py <= inner[1] + inner[3]):
                continue
            self.station_marker(painter, px, py)
            metrics = self.metrics(name_font)
            text_w = metrics.horizontalAdvance(point["name"])
            text_h = metrics.height()
            offsets = [(mm(2.6), -text_h / 2), (-mm(2.6) - text_w, -text_h / 2),
                       (-text_w / 2, -mm(2.6) - text_h), (-text_w / 2, mm(2.6))]
            chosen = None
            for dx, dy in offsets:
                rect = (px + dx, py + dy, text_w, text_h)
                if rect_contains(inner, rect) and not any(rects_overlap(rect, other, mm(0.5)) for other in avoid + placed):
                    chosen = rect
                    break
            chosen = chosen or (px + offsets[0][0], py + offsets[0][1], text_w, text_h)
            placed.append(chosen)
            self.halo_text(painter, chosen[0], chosen[1] + metrics.ascent(), point["name"], name_font,
                           (20, 45, 95), (255, 255, 255), 0.7)
        road_font = self.font(8.5, True)
        for line in reference.get("lines") or []:
            best = None
            cx = view.rect[0] + view.rect[2] / 2
            cy = view.rect[1] + view.rect[3] / 2
            for segment in line.get("segments") or []:
                coords = [view.px(*to_epsg5186(lon, lat)) for lon, lat in segment["coordinates_lonlat"]]
                for (x0, y0), (x1, y1) in zip(coords, coords[1:]):
                    length = math.hypot(x1 - x0, y1 - y0)
                    if length < mm(4):
                        continue
                    mx, my = (x0 + x1) / 2, (y0 + y1) / 2
                    if not (inner[0] + mm(10) <= mx <= inner[0] + inner[2] - mm(10)
                            and inner[1] + mm(10) <= my <= inner[1] + inner[3] - mm(10)):
                        continue
                    angle = math.degrees(math.atan2(y1 - y0, x1 - x0))
                    if angle > 90:
                        angle -= 180
                    if angle < -90:
                        angle += 180
                    metrics = self.metrics(road_font)
                    text_w = metrics.horizontalAdvance(line["name"])
                    radius = text_w / 2 + mm(1)
                    box = (mx - radius, my - radius, radius * 2, radius * 2)
                    if any(rects_overlap(box, other, 0) for other in avoid + placed):
                        continue
                    score = math.hypot(mx - cx, my - cy)
                    if best is None or score < best[0]:
                        best = (score, mx, my, angle, text_w, box)
            if best is None:
                continue
            _, mx, my, angle, text_w, box = best
            metrics = self.metrics(road_font)
            painter.save()
            painter.translate(mx, my)
            painter.rotate(angle)
            self.halo_text(painter, -text_w / 2, metrics.ascent() / 2 - mm(0.3), line["name"], road_font,
                           (255, 255, 255), (30, 30, 30), 0.65)
            painter.restore()
            placed.append(box)
        return placed

    def draw_scale_and_north(self, painter: Any, view: MapView) -> list[tuple]:
        QtCore, QtGui = self.QtCore, self.QtGui
        mm = self.page.mm
        map_width_m = view.extent[2] - view.extent[0]
        length_m = nice_scale_length(map_width_m)
        bar_px = length_m * view.scale
        box = (view.rect[0] + mm(3), view.rect[1] + view.rect[3] - mm(11), bar_px + mm(12), mm(8))
        painter.setPen(QtCore.Qt.PenStyle.NoPen)
        painter.setBrush(QtGui.QColor(255, 255, 255, 225))
        painter.drawRoundedRect(QtCore.QRectF(*box), mm(1), mm(1))
        bx = box[0] + mm(4)
        by = box[1] + mm(4.6)
        half = bar_px / 2
        painter.setPen(self.pen((20, 20, 20), 0.25))
        painter.setBrush(QtGui.QColor(20, 20, 20))
        painter.drawRect(QtCore.QRectF(bx, by, half, mm(1.3)))
        painter.setBrush(QtGui.QColor(255, 255, 255))
        painter.drawRect(QtCore.QRectF(bx + half, by, half, mm(1.3)))
        label_font = self.font(6.5, True)
        self.text(painter, (bx - mm(3), box[1] + mm(0.6), mm(6), mm(3.6)), "0", label_font, (20, 20, 20), "center")
        self.text(painter, (bx + bar_px - mm(8), box[1] + mm(0.6), mm(16), mm(3.6)), f"{length_m:g} m",
                  label_font, (20, 20, 20), "center")
        north = (view.rect[0] + view.rect[2] - mm(13), view.rect[1] + mm(3), mm(10), mm(13))
        painter.setPen(QtCore.Qt.PenStyle.NoPen)
        painter.setBrush(QtGui.QColor(255, 255, 255, 225))
        painter.drawRoundedRect(QtCore.QRectF(*north), mm(1), mm(1))
        cx = north[0] + north[2] / 2
        top = north[1] + mm(4.8)
        triangle = QtGui.QPolygonF([QtCore.QPointF(cx, top), QtCore.QPointF(cx - mm(2.4), top + mm(6.8)),
                                    QtCore.QPointF(cx, top + mm(5.2)), QtCore.QPointF(cx + mm(2.4), top + mm(6.8))])
        painter.setBrush(QtGui.QColor(20, 20, 20))
        painter.drawPolygon(triangle)
        self.text(painter, (north[0], north[1] + mm(0.4), north[2], mm(4.2)), "N", self.font(8, True), (20, 20, 20), "center")
        return [box, north]


def render_pages(renderer: Renderer, pages: list[dict], png_paths: list[Path], pdf_path: Path) -> None:
    from qgis.PyQt.QtCore import QMarginsF, QRectF, QSizeF
    from qgis.PyQt.QtGui import QColor, QImage, QPageLayout, QPageSize, QPainter, QPdfWriter

    page = renderer.page

    def draw(painter: Any, spec: dict) -> None:
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        painter.setRenderHint(QPainter.RenderHint.TextAntialiasing, True)
        painter.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform, True)
        painter.fillRect(QRectF(0, 0, page.width, page.height), QColor(255, 255, 255))
        spec["draw"](painter)

    for spec, path in zip(pages, png_paths):
        image = QImage(page.width, page.height, QImage.Format.Format_ARGB32)
        if image.isNull():
            raise RuntimeError("page image allocation failed")
        dots = int(round(page.dpi / 0.0254))
        image.setDotsPerMeterX(dots)
        image.setDotsPerMeterY(dots)
        painter = QPainter()
        try:
            if not painter.begin(image):
                raise RuntimeError("PNG painter begin failed")
            draw(painter, spec)
        finally:
            if painter.isActive():
                painter.end()
        if not image.save(str(path), "PNG"):
            raise RuntimeError(f"PNG save failed: {path.name}")

    writer = QPdfWriter(str(pdf_path))
    writer.setResolution(page.dpi)
    writer.setPageSize(QPageSize(QSizeF(page.width_mm, page.height_mm), QPageSize.Unit.Millimeter, "BSO"))
    writer.setPageMargins(QMarginsF(0, 0, 0, 0), QPageLayout.Unit.Millimeter)
    writer.setTitle(str(renderer.manifest.get("title") or "BSO subject-only GIS"))
    writer.setCreator(RUNNER_VERSION)
    painter = QPainter()
    try:
        if not painter.begin(writer):
            raise RuntimeError("PDF painter begin failed")
        scale = min(writer.width() / page.width, writer.height() / page.height)
        for index, spec in enumerate(pages):
            if index:
                writer.newPage()
            painter.save()
            painter.scale(scale, scale)
            draw(painter, spec)
            painter.restore()
    finally:
        if painter.isActive():
            painter.end()
    if not pdf_path.exists() or pdf_path.stat().st_size == 0:
        raise RuntimeError("PDF save failed")


def build_pages(renderer: Renderer, manifest: dict, parcels: list[dict], groups: list[dict], area: dict,
                views: dict, backgrounds: dict, context: list[Any], basemap_info: dict) -> list[dict]:
    titles = manifest.get("map_titles") or {}
    reference = manifest.get("reference_features") or {}
    zooms = ", ".join(f"z{info['zoom']}" for info in basemap_info.values()
                      if isinstance(info, dict) and info.get("zoom"))
    background_text = basemap_info.get("_label") or f"VWorld 위성영상(촬영시점 미표기, {zooms})"
    archive_names = [Path(layer.get("archive") or layer.get("source") or "").name for layer in manifest["layers"]]
    source_line = (f"지적: 국가공간정보 연속지적도 {', '.join(archive_names)} (EPSG:5186, PNU=A1·지번=A4) · "
                   f"배경: {background_text} · {manifest.get('footer_org') or ''}")
    group_ids = [g["id"] for g in groups]
    group_range = f"{group_ids[0]}~{group_ids[-1]}" if len(group_ids) > 1 else (group_ids[0] if group_ids else "")
    notes_common = [
        f"* 가설군 {group_range}는 상담 검토를 위한 작업가설 군집이며 일단지 여부를 확정한 것이 아닙니다.",
        "면적은 연속지적도 도형으로 계산한 값이며 토지대장 면적과 다를 수 있습니다.",
    ]
    detail_frame = views["detail"].extent

    def overview(painter: Any) -> None:
        view = views["overview"]
        renderer.draw_header(painter, titles.get("subject_only_overview", "광역 위치도"), 1, 2)
        painter.save()
        painter.setClipRect(renderer.QtCore.QRectF(*view.rect))
        renderer.draw_background(painter, view, backgrounds.get("overview"))
        renderer.draw_polygons(painter, view, parcels)
        x0, y0 = view.px(detail_frame[0], detail_frame[3])
        x1, y1 = view.px(detail_frame[2], detail_frame[1])
        frame_rect = (x0, y0, x1 - x0, y1 - y0)
        painter.setBrush(renderer.QtCore.Qt.BrushStyle.NoBrush)
        painter.setPen(renderer.pen((10, 10, 10), 0.8))
        painter.drawRect(renderer.QtCore.QRectF(*frame_rect))
        painter.setPen(renderer.pen((0, 210, 255), 0.45, "dash"))
        painter.drawRect(renderer.QtCore.QRectF(*frame_rect))
        reserved = renderer.draw_scale_and_north(painter, view)
        reference_boxes = renderer.draw_reference(painter, view, reference, reserved + [frame_rect])
        # 대상 10필지 총괄 callout
        union = None
        for parcel in parcels:
            union = parcel["geometry"].Clone() if union is None else union.Union(parcel["geometry"])
        envelope = union.GetEnvelope()
        anchor = view.px((envelope[0] + envelope[1]) / 2, (envelope[2] + envelope[3]) / 2)
        mm = renderer.page.mm
        font = renderer.font(9, True)
        sub_font = renderer.font(7.2)
        callout = str(manifest.get("overview_callout") or "대상 필지 {count}필지").format(count=len(parcels))
        lines = [callout, f"도형면적 합계 {format_area(area['geometry_total_m2'])} · 상세도 참조"]
        width = max(renderer.metrics(font).horizontalAdvance(lines[0]), renderer.metrics(sub_font).horizontalAdvance(lines[1])) + mm(4)
        height = renderer.metrics(font).height() + renderer.metrics(sub_font).height() + mm(2.4)
        inner = (view.rect[0] + mm(2), view.rect[1] + mm(2), view.rect[2] - mm(4), view.rect[3] - mm(4))
        avoid = reserved + reference_boxes + [frame_rect]
        chosen = None
        for px, py in leader_candidates(anchor, -60.0, [mm(v) for v in (22, 30, 40, 52, 65)]):
            rect = (px - width / 2, py - height / 2, width, height)
            if rect_contains(inner, rect) and not any(rects_overlap(rect, other, mm(1)) for other in avoid):
                chosen = rect
                break
        chosen = chosen or (inner[0] + mm(2), inner[1] + mm(2), width, height)
        end = nearest_point_on_rect(chosen, *anchor)
        painter.setPen(renderer.pen((255, 255, 255), 0.9))
        painter.drawLine(renderer.QtCore.QPointF(*anchor), renderer.QtCore.QPointF(*end))
        painter.setPen(renderer.pen((20, 20, 20), 0.4))
        painter.drawLine(renderer.QtCore.QPointF(*anchor), renderer.QtCore.QPointF(*end))
        painter.setPen(renderer.pen((60, 45, 10), 0.3))
        painter.setBrush(renderer.QtGui.QColor(255, 255, 255, 240))
        painter.drawRoundedRect(renderer.QtCore.QRectF(*chosen), mm(1), mm(1))
        renderer.text(painter, (chosen[0] + mm(2), chosen[1] + mm(1.1), width, renderer.metrics(font).height()), lines[0], font)
        renderer.text(painter, (chosen[0] + mm(2), chosen[1] + mm(1.1) + renderer.metrics(font).height(), width,
                                renderer.metrics(sub_font).height()), lines[1], sub_font, (70, 55, 20))
        painter.restore()
        painter.setPen(renderer.pen((40, 40, 40), 0.3))
        painter.setBrush(renderer.QtCore.Qt.BrushStyle.NoBrush)
        painter.drawRect(renderer.QtCore.QRectF(*view.rect))
        renderer.draw_panel(painter, parcels, area, [
            ("subject", "대상 필지 — 연속지적 polygon"),
            ("detail_frame", "상세도(2/2) 범위"),
            ("station", "역 위치 — OpenStreetMap 참고값"),
        ], notes_common + [f"역·도로 표기: {reference.get('source') or 'OpenStreetMap 참고'}"])
        renderer.draw_footer(painter, source_line)

    def detail(painter: Any) -> None:
        view = views["detail"]
        renderer.draw_header(painter, titles.get("subject_only_detail", "상세도"), 2, 2)
        painter.save()
        painter.setClipRect(renderer.QtCore.QRectF(*view.rect))
        renderer.draw_background(painter, view, backgrounds.get("detail"))
        renderer.draw_context(painter, view, context)
        renderer.draw_polygons(painter, view, parcels)
        reserved = renderer.draw_scale_and_north(painter, view)
        placements = renderer.place_parcel_labels(view, parcels, reserved)
        label_boxes = [item["rect"] for item in placements]
        group_tags = renderer.draw_groups(painter, view, groups, reserved + label_boxes)
        reference_boxes = renderer.draw_reference(painter, view, reference, reserved + label_boxes + group_tags)
        renderer.draw_parcel_labels(painter, placements)
        painter.restore()
        painter.setPen(renderer.pen((40, 40, 40), 0.3))
        painter.setBrush(renderer.QtCore.Qt.BrushStyle.NoBrush)
        painter.drawRect(renderer.QtCore.QRectF(*view.rect))
        legend = [
            ("subject", "대상 필지 — 연속지적 polygon (번호·지번·도형면적)"),
            ("group", f"가설군 {group_range} — 작업가설 군집 점선(일단지 확정 아님)"),
        ]
        if context:
            legend.append(("context", "주변 연속지적 경계(참고)"))
        renderer.draw_panel(painter, parcels, area, legend, notes_common + [
            "라벨이 필지 안에 들어가지 않는 경우 지시선(leader)으로 연결했습니다.",
        ])
        renderer.draw_footer(painter, source_line)
        renderer.placements = placements
        renderer.reference_boxes = reference_boxes

    return [{"name": "overview", "draw": overview}, {"name": "detail", "draw": detail}]


# ---------------------------------------------------------------------------
# 실행
# ---------------------------------------------------------------------------

def run(manifest_path: Path, output_root: Path, basemap_override: Path | None = None) -> int:
    manifest = load_manifest(manifest_path)
    case_id = str(manifest["case_id"])
    case_dir = output_root / case_id
    case_dir.mkdir(parents=True, exist_ok=True)
    _clear_case_dir(case_dir)
    api_key = os.environ.get("VWORLD_API_KEY") or ""
    secrets = [api_key]
    run_result: dict[str, Any] = {
        "runner_version": RUNNER_VERSION,
        "case_id": case_id,
        "title": manifest.get("title"),
        "status_line": manifest.get("status_line"),
        "started_at": datetime.now().isoformat(timespec="seconds"),
        "status": "STARTED",
        "issues": [],
        "warnings": [],
        "outputs": {"parcel_verification_result": str(verification_result_path(case_dir))},
    }
    run_path = case_dir / RUN_RESULT_FILENAME

    def finish(status: str, code: int) -> int:
        run_result["status"] = status
        run_result["finished_at"] = datetime.now().isoformat(timespec="seconds")
        _write_json(run_path, run_result, secrets)
        print(json.dumps(redact({
            "status": status,
            "case_id": case_id,
            "verification": run_result.get("verification"),
            "area": run_result.get("area"),
            "outputs": run_result.get("outputs"),
            "issues": run_result.get("issues"),
            "warnings": run_result.get("warnings"),
        }, secrets), ensure_ascii=False, indent=2))
        return code

    preflight = subject_only_preflight(manifest)
    if preflight:
        _write_json(verification_result_path(case_dir), {
            "schema_version": "bso_parcel_verification_v0.2",
            "case_id": case_id,
            "status": "FAIL",
            "verified_count": 0,
            "required_count": len((manifest.get("parcel_verification") or {}).get("required_pnus") or []),
            "issues": preflight,
            "subject_only_gate": {"runner_version": RUNNER_VERSION, "status": "FAIL", "stage": "PREFLIGHT"},
        }, secrets)
        run_result["issues"].extend(preflight)
        return finish("BLOCKED_PREFLIGHT", EXIT_PREFLIGHT)

    from bso_graphics.qgis_windows_bootstrap import configure_windows_dll_search

    configure_windows_dll_search()
    from qgis.core import QgsApplication

    app = QgsApplication([], False)
    app.initQgis()
    work_dir = case_dir / "_work"
    try:
        from bso_graphics.parcel_verification import verify_manifest_parcels

        verification = verify_manifest_parcels(manifest, case_dir)
        base_status = verification.get("status")
        strict_issues = apply_subject_only_gate(verification, manifest)
        gate_pass = base_status == "PASS" and not strict_issues
        verification["issues"] = list(verification.get("issues") or []) + strict_issues
        verification["subject_only_gate"] = {
            "runner_version": RUNNER_VERSION,
            "base_verification_status": base_status,
            "expected_parcel_count": manifest.get("expected_parcel_count"),
            "verified_count": verification.get("verified_count"),
            "strict_jibun_policy": "공백·말미 지목표기 제거 후 완전일치 + PNU 본번·부번 자기일치",
            "status": "PASS" if gate_pass else "FAIL",
        }
        verification["status"] = "PASS" if gate_pass else "FAIL"
        _write_json(verification_result_path(case_dir), verification, secrets)
        run_result["verification"] = {
            "status": verification["status"],
            "verified": f"{verification.get('verified_count')}/{verification.get('required_count')}",
            "manifest_fingerprint": verification.get("manifest_fingerprint"),
        }
        if not gate_pass:
            remove_blocked_outputs(case_dir)
            run_result["issues"].extend(verification["issues"])
            return finish("BLOCKED_VERIFICATION", EXIT_VERIFICATION)

        work_dir.mkdir(parents=True, exist_ok=True)
        parcels, source_shp, extraction_issues = extract_subject_parcels(manifest, verification, work_dir)
        if extraction_issues or len(parcels) != int(manifest["expected_parcel_count"]):
            run_result["issues"].extend(extraction_issues or [{"code": "EXTRACTION_COUNT_MISMATCH",
                                                                 "message": "재추출 필지 수 불일치"}])
            remove_blocked_outputs(case_dir)
            return finish("BLOCKED_VERIFICATION", EXIT_VERIFICATION)

        archive_label = Path(manifest["layers"][0].get("archive") or manifest["layers"][0].get("source")).name
        area = assess_area([parcel["area_m2_raw"] for parcel in parcels], manifest.get("area_reference"))
        area["per_parcel_m2"] = [{"no": p["no"], "jibun": p["jibun"], "area_m2": p["area_m2"]}
                                 for p in sorted(parcels, key=lambda item: item["no"])]
        run_result["area"] = area
        run_result["warnings"].extend(geometry_warnings(parcels))
        if area.get("level") in {"REVIEW_DIFFERENCE", "ANOMALY_WARNING"}:
            run_result["warnings"].append({
                "code": "AREA_TOTAL_" + area["level"],
                "message": (f"도형면적 합계 {area['geometry_total_m2']:,.2f}㎡ vs 기존 자료 "
                            f"{area['reference_total_m2']:,.2f}㎡ (차이 {area['difference_m2']:+,.2f}㎡, "
                            f"{area['difference_ratio'] * 100:+.2f}%)"),
            })
        run_result["geometry"] = {
            "source": f"연속지적도 {archive_label} → {source_shp.name}",
            "crs": "EPSG:5186",
            "pnu_field": manifest["layers"][0].get("pnu_field"),
            "jibun_field": manifest["layers"][0].get("jibun_field"),
        }

        groups = build_group_geometries(manifest, parcels, buffer_m=2.5)
        run_result["working_hypothesis_groups"] = [
            {"id": g["id"], "members": g["members"], "connected_pieces_within_0_5m": g["connected_pieces_within_0_5m"],
             "note": g["note"]} for g in groups
        ]
        run_result["outputs"].update(write_geometry_outputs(case_dir, case_id, parcels, groups, archive_label))

        render_cfg = manifest.get("render") or {}
        page = Page(float(render_cfg.get("page_width_mm", 297)), float(render_cfg.get("page_height_mm", 210)),
                    int(render_cfg.get("dpi", 300)))
        renderer = Renderer(page, manifest, qa_background_label="QA 테스트 배경 — 배포 금지" if basemap_override else None)
        map_rect = renderer.layout()["map"]
        aspect = map_rect[2] / map_rect[3]

        union = None
        for parcel in parcels:
            union = parcel["geometry"].Clone() if union is None else union.Union(parcel["geometry"])
        env = union.GetEnvelope()  # (minx, maxx, miny, maxy)
        bounds = (env[0], env[2], env[1], env[3])
        detail_extent = fit_extent(bounds, aspect, pad_ratio=0.22, min_pad=30.0)
        points = [bounds]
        for point in (manifest.get("reference_features") or {}).get("points") or []:
            x, y = to_epsg5186(float(point["lon"]), float(point["lat"]))
            points.append((x, y, x, y))
        overview_bounds = (min(p[0] for p in points), min(p[1] for p in points),
                           max(p[2] for p in points), max(p[3] for p in points))
        overview_extent = fit_extent(overview_bounds, aspect, pad_ratio=0.30, min_pad=120.0, min_width=900.0)

        exclude = {parcel["pnu"] for parcel in parcels}
        context, context_ok = load_context_geometries(source_shp, detail_extent, exclude,
                                                      manifest["layers"][0].get("pnu_field"))
        if not context_ok:
            run_result["warnings"].append({"code": "CONTEXT_CADASTRAL_SKIPPED",
                                           "message": "주변 지적 경계를 표시하지 못했습니다(대상 필지 표시는 정상)."})

        basemap_info: dict[str, Any] = {}
        backgrounds: dict[str, Any] = {}
        views = {"overview": MapView(overview_extent, map_rect), "detail": MapView(detail_extent, map_rect)}
        try:
            for name in ("overview", "detail"):
                if basemap_override is not None:
                    basemap_info[name] = {"path": basemap_override, "zoom": None, "source": "QA_LOCAL_OVERRIDE"}
                else:
                    if not api_key:
                        raise RuntimeError("VWORLD_API_KEY missing")
                    basemap_info[name] = fetch_basemap(name, views[name].extent, aspect, case_dir, work_dir,
                                                       manifest, api_key)
                backgrounds[name] = warp_background(Path(basemap_info[name]["path"]), views[name].extent,
                                                    int(map_rect[2]), int(map_rect[3]), name)
        except Exception as exc:  # 예외 객체(트레이스백)가 QGIS 레이어를 잡고 있지 않도록 메시지만 보존
            background_error = redact(f"{type(exc).__name__}: {exc}", secrets)
        else:
            background_error = None
        if background_error:
            backgrounds.clear()
            run_result["issues"].append({"code": "VWORLD_BACKGROUND_FAILED", "message": background_error})
            run_result["outputs"]["maps"] = []
            return finish("BLOCKED_BASEMAP", EXIT_BASEMAP)
        if basemap_override is not None:
            basemap_info["_label"] = "QA 테스트 배경(배포 금지)"
        run_result["background"] = {
            name: {"source": info["source"], "zoom": info.get("zoom"), "crs_native": "EPSG:3857",
                   "rendered_crs": "EPSG:5186"}
            for name, info in basemap_info.items() if not name.startswith("_")
        }

        pages = build_pages(renderer, manifest, parcels, groups, area, views, backgrounds, context, basemap_info)
        png_paths = [case_dir / f"{case_id}_01_overview.png", case_dir / f"{case_id}_02_detail.png"]
        pdf_path = case_dir / f"{case_id}_overview_detail.pdf"
        try:
            render_pages(renderer, pages, png_paths, pdf_path)
        except Exception as exc:
            render_error = redact(f"{type(exc).__name__}: {exc}", secrets)
        else:
            render_error = None
        if render_error:
            for path in png_paths + [pdf_path]:
                if path.exists():
                    path.unlink()
            run_result["issues"].append({"code": "RENDER_FAILED", "message": render_error})
            return finish("ERROR_RENDER", EXIT_RENDER)
        run_result["outputs"]["maps"] = [str(path) for path in png_paths] + [str(pdf_path)]
        run_result["render"] = {
            "page_mm": [page.width_mm, page.height_mm], "dpi": page.dpi, "png_px": [page.width, page.height],
            "font_family": renderer.family,
            "detail_extent_epsg5186": [round(v, 2) for v in detail_extent],
            "overview_extent_epsg5186": [round(v, 2) for v in overview_extent],
            "leader_labels": [item["parcel"]["jibun"] for item in getattr(renderer, "placements", []) if item["leader"]],
            "degraded_label_placement": renderer.degraded_labels,
        }
        if renderer.degraded_labels:
            run_result["warnings"].append({"code": "LABEL_PLACEMENT_DEGRADED", "jibuns": renderer.degraded_labels,
                                           "message": "일부 라벨이 겹침 허용 위치에 배치되었습니다 — 육안 확인 필요"})
        status = "COMPLETED_REVIEW_REQUIRED" if (run_result["warnings"] or basemap_override) else "COMPLETED"
        return finish(status, EXIT_OK)
    finally:
        import gc

        gc.collect()
        app.processEvents()
        app.exitQgis()
        gc.collect()
        shutil.rmtree(work_dir, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="보상전략 OS subject-only 상담배포 지도 runner")
    parser.add_argument("manifest")
    parser.add_argument("--output-dir", default="graphics-output")
    parser.add_argument("--qa-basemap-geotiff", default=None,
                        help="QA 전용: VWorld 대신 로컬 EPSG:3857 GeoTIFF 사용(지도에 '배포 금지' 표기)")
    args = parser.parse_args()
    override = Path(args.qa_basemap_geotiff).resolve() if args.qa_basemap_geotiff else None
    return run(Path(args.manifest).resolve(), Path(args.output_dir).resolve(), override)


if __name__ == "__main__":
    raise SystemExit(main())
