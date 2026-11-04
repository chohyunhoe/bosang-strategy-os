# -*- coding: utf-8 -*-
from __future__ import annotations

import gc
import shutil
import tempfile
import time
from pathlib import Path
from typing import Any

from .cadastral_source import prepare_layer_specs
from .flow_graphic import generate_other_factor_flow
from .layout_exporter import write_report
from .manifest_loader import resolve_path

ROLE_STYLE = {
    "subject": (250, 190, 0, 110),
    "standard": (226, 55, 70, 105),
    "case": (30, 125, 235, 105),
}
ROLE_LABEL = {"subject": "대상", "standard": "표준지", "case": "사례"}

DEFAULT_MAP_PROFILES = {
    "overview": {
        "page_width_mm": 210.0,
        "page_height_mm": 148.0,
        "map_rect": (4.0, 16.0, 202.0, 127.0),
        "extent_scale": 1.30,
    },
    "subject_vs_standard": {
        "page_width_mm": 210.0,
        "page_height_mm": 120.0,
        "map_rect": (4.0, 16.0, 202.0, 99.0),
        "extent_scale": 1.18,
    },
    "standard_vs_case": {
        "page_width_mm": 210.0,
        "page_height_mm": 120.0,
        "map_rect": (4.0, 16.0, 202.0, 99.0),
        "extent_scale": 1.15,
    },
}


def _map_profile(manifest: dict, output_name: str) -> dict[str, Any]:
    profile = dict(DEFAULT_MAP_PROFILES.get(output_name, DEFAULT_MAP_PROFILES["overview"]))
    configured = (manifest.get("map_profiles") or {}).get(output_name) or {}
    profile.update(configured)
    for key in ("page_width_mm", "page_height_mm", "extent_scale"):
        value = float(profile[key])
        if value <= 0:
            raise ValueError(f"map profile {output_name}.{key} must be positive")
        profile[key] = value
    rect = tuple(float(value) for value in profile["map_rect"])
    if len(rect) != 4 or any(value < 0 for value in rect) or rect[2] <= 0 or rect[3] <= 0:
        raise ValueError(f"map profile {output_name}.map_rect is invalid")
    profile["map_rect"] = rect
    return profile


def _preflight(manifest: dict, vworld_key: str | None) -> list[dict[str, str]]:
    issues: list[dict[str, str]] = []
    if not vworld_key:
        issues.append({"code": "VWORLD_KEY_MISSING", "message": "VWORLD_API_KEY가 없습니다."})
    for role in manifest.get("missing_roles", []):
        issues.append({"code": "ROLE_MISSING", "message": f"필수 geometry 역할 누락: {role}"})
    for layer in manifest.get("layers", []):
        role = layer.get("role", "unknown")
        source = resolve_path(manifest, layer.get("source"))
        archive = resolve_path(manifest, layer.get("archive"))
        if source is not None and not source.exists():
            issues.append({"code": "GEOMETRY_MISSING", "message": f"{role} geometry 파일 없음: {source}"})
        if archive is not None and not archive.exists():
            issues.append({"code": "CADASTRAL_ARCHIVE_MISSING", "message": f"{role} 연속지적도 ZIP 없음: {archive}"})
        if role == "case" and not layer.get("lot"):
            issues.append({"code": "CASE_LOT_MISSING", "message": "사례 지번 미확인 — 사례 그래픽 생성 차단"})
        if role == "case" and layer.get("review_required"):
            issues.append({
                "code": "CASE_REVIEW_REQUIRED",
                "message": layer.get("review_reason") or "사례 PNU 원문 대조 필요",
            })
    return issues


def _qgis_imports() -> dict[str, Any]:
    from qgis.core import (
        QgsApplication, QgsFillSymbol, QgsLayoutExporter, QgsLayoutItemLabel,
        QgsLayoutItemLegend, QgsLayoutItemMap, QgsLayoutItemScaleBar,
        QgsLayoutPoint, QgsLayoutSize, QgsPalLayerSettings, QgsPrintLayout, QgsProject,
        QgsRasterLayer, QgsRectangle, QgsTextFormat, QgsUnitTypes,
        QgsVectorFileWriter, QgsVectorLayer, QgsVectorLayerSimpleLabeling,
    )
    from qgis.PyQt.QtCore import QCoreApplication, QRectF
    from qgis.PyQt.QtGui import QColor, QFont
    return locals()


def _extent_for_layers(layers: list[Any], q: dict[str, Any]):
    extent = None
    for layer in layers:
        if not layer.isValid() or layer.featureCount() == 0:
            continue
        if extent is None:
            extent = q["QgsRectangle"](layer.extent())
        else:
            extent.combineExtentWith(layer.extent())
    return extent


def _add_vworld_layer(project: Any, manifest: dict, key: str, q: dict[str, Any]):
    template = manifest.get("vworld_xyz_template") or (
        "type=xyz&url=https://api.vworld.kr/req/wmts/1.0.0/{key}/Satellite/"
        "{{z}}/{{y}}/{{x}}.jpeg&zmin=6&zmax=19"
    )
    referer = manifest.get("vworld_referer") or "http://localhost"
    uri = template.format(key=key)
    if "http-header:referer=" not in uri:
        uri += "&http-header:referer=" + referer
    raster = q["QgsRasterLayer"](uri, "VWorld Satellite", "wms")
    if raster.isValid():
        project.addMapLayer(raster)
        return raster
    return None


def _configured_field(layer: Any, configured: object, aliases: tuple[str, ...]) -> str | None:
    fields = {str(name).upper(): str(name) for name in layer.fields().names()}
    if configured:
        return fields.get(str(configured).upper())
    for alias in aliases:
        if alias.upper() in fields:
            return fields[alias.upper()]
    return None


def _apply_labels(layer: Any, spec: dict, q: dict[str, Any]) -> None:
    jibun_field = _configured_field(layer, spec.get("jibun_field"), ("JIBUN", "A4"))
    if jibun_field is None:
        return
    prefix = spec.get("label_prefix") or ROLE_LABEL.get(spec.get("role"), "필지")
    safe_prefix = str(prefix).replace("'", "''")
    settings = q["QgsPalLayerSettings"]()
    settings.fieldName = (
        f"concat('{safe_prefix} ', regexp_replace(trim(\"{jibun_field}\"), '[가-힣\\s]+$', ''))"
    )
    settings.isExpression = True
    text_format = q["QgsTextFormat"]()
    text_format.setFont(q["QFont"]("Malgun Gothic", 10))
    text_format.setSize(10)
    text_format.setColor(q["QColor"](20, 20, 20))
    try:
        from qgis.core import QgsTextBufferSettings
        buffer = QgsTextBufferSettings()
        buffer.setEnabled(True)
        buffer.setSize(1.2)
        buffer.setColor(q["QColor"](255, 255, 255))
        text_format.setBuffer(buffer)
    except (ImportError, AttributeError):
        pass
    settings.setFormat(text_format)
    layer.setLabeling(q["QgsVectorLayerSimpleLabeling"](settings))
    layer.setLabelsEnabled(True)


def _load_vector(project: Any, spec: dict, q: dict[str, Any]):
    source = Path(spec["_prepared_source"])
    layer_name = spec.get("label") or spec.get("role") or source.stem
    layer = q["QgsVectorLayer"](str(source), layer_name, "ogr")
    if not layer.isValid():
        raise RuntimeError(f"invalid vector layer: {source}")

    pnus = spec.get("_subset_pnus") or []
    if pnus:
        pnu_field = _configured_field(layer, spec.get("pnu_field"), ("PNU", "A1"))
        if pnu_field is None:
            raise RuntimeError(f"PNU field missing: {source}")
        quoted = ",".join("'" + str(value).replace("'", "''") + "'" for value in pnus)
        if not layer.setSubsetString(f'\"{pnu_field}\" IN ({quoted})'):
            raise RuntimeError(f"PNU subset failed: {pnus}")
        if layer.featureCount() == 0:
            raise RuntimeError(f"PNU not found: {pnus}")

    color = ROLE_STYLE.get(spec.get("role"), (120, 120, 120, 80))
    symbol = q["QgsFillSymbol"].createSimple({
        "color": f"{color[0]},{color[1]},{color[2]},{color[3]}",
        "outline_color": f"{color[0]},{color[1]},{color[2]},255",
        "outline_width": "1.8",
    })
    layer.renderer().setSymbol(symbol)
    _apply_labels(layer, spec, q)
    project.addMapLayer(layer)
    return layer


def _write_selected_geometry(project: Any, layer: Any, role: str, output_dir: Path, q: dict[str, Any]) -> Path:
    directory = output_dir / "selected-geometry"
    directory.mkdir(parents=True, exist_ok=True)
    output = directory / f"{role}.geojson"
    if output.exists():
        output.unlink()
    options = q["QgsVectorFileWriter"].SaveVectorOptions()
    options.driverName = "GeoJSON"
    options.fileEncoding = "UTF-8"
    result = q["QgsVectorFileWriter"].writeAsVectorFormatV3(
        layer, str(output), project.transformContext(), options
    )
    if result[0] != q["QgsVectorFileWriter"].NoError:
        raise RuntimeError(f"selected geometry export failed: {role}, {result}")
    return output


def _wait_for_tiles(q: dict[str, Any], seconds: float = 5.0) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        q["QCoreApplication"].processEvents()
        time.sleep(0.1)


def _export_layout(
    project: Any,
    vector_layers: list[Any],
    raster_layer: Any,
    output_base: Path,
    title: str,
    formats: list[str],
    q: dict[str, Any],
    profile: dict[str, Any] | None = None,
) -> list[Path]:
    profile = profile or dict(DEFAULT_MAP_PROFILES["overview"])
    layout = q["QgsPrintLayout"](project)
    layout.initializeDefaults()
    layout.setName(title)
    page = layout.pageCollection().page(0)
    page.setPageSize(q["QgsLayoutSize"](
        profile["page_width_mm"],
        profile["page_height_mm"],
        q["QgsUnitTypes"].LayoutMillimeters,
    ))

    map_item = q["QgsLayoutItemMap"](layout)
    layout.addLayoutItem(map_item)
    map_item.attemptSetSceneRect(q["QRectF"](*profile["map_rect"]))
    extent = _extent_for_layers(vector_layers, q)
    if extent is None:
        raise RuntimeError("no valid geometry extent")
    extent.scale(profile["extent_scale"])
    map_item.zoomToExtent(extent)
    map_layers = list(vector_layers)
    if raster_layer is not None:
        map_layers.append(raster_layer)
    map_item.setLayers(map_layers)
    map_item.refresh()

    label = q["QgsLayoutItemLabel"](layout)
    label.setText(title)
    label.setFont(q["QFont"]("Malgun Gothic", 16))
    label.adjustSizeToText()
    layout.addLayoutItem(label)
    label.attemptMove(q["QgsLayoutPoint"](4, 2, q["QgsUnitTypes"].LayoutMillimeters))

    north = q["QgsLayoutItemLabel"](layout)
    north.setText("N ↑")
    north.setFont(q["QFont"]("Arial", 14))
    north.adjustSizeToText()
    layout.addLayoutItem(north)
    north.attemptMove(q["QgsLayoutPoint"](
        profile["page_width_mm"] - 25,
        2,
        q["QgsUnitTypes"].LayoutMillimeters,
    ))

    legend = q["QgsLayoutItemLegend"](layout)
    legend.setLinkedMap(map_item)
    legend.setAutoUpdateModel(False)
    legend.model().rootGroup().clear()
    for vector_layer in vector_layers:
        legend.model().rootGroup().addLayer(vector_layer)
    layout.addLayoutItem(legend)
    legend.attemptSetSceneRect(q["QRectF"](
        profile["page_width_mm"] - 68,
        profile["page_height_mm"] - 39,
        64,
        34,
    ))

    scale = q["QgsLayoutItemScaleBar"](layout)
    scale.setStyle("Single Box")
    scale.setLinkedMap(map_item)
    scale.setUnits(q["QgsUnitTypes"].DistanceMeters)
    scale.applyDefaultSize()
    layout.addLayoutItem(scale)
    scale.attemptSetSceneRect(q["QRectF"](
        8,
        profile["page_height_mm"] - 14,
        62,
        9,
    ))

    _wait_for_tiles(q, 5.0 if raster_layer is not None else 0.2)

    exporter = q["QgsLayoutExporter"](layout)
    outputs: list[Path] = []
    if "png" in formats:
        png = output_base.with_suffix(".png")
        if png.exists():
            png.unlink()
        settings = q["QgsLayoutExporter"].ImageExportSettings()
        settings.dpi = 220
        result = exporter.exportToImage(str(png), settings)
        if result != q["QgsLayoutExporter"].Success:
            raise RuntimeError(f"QGIS image export failed: {result}")
        outputs.append(png)
    if "pdf" in formats:
        pdf = output_base.with_suffix(".pdf")
        if pdf.exists():
            pdf.unlink()
        result = exporter.exportToPdf(str(pdf), q["QgsLayoutExporter"].PdfExportSettings())
        if result != q["QgsLayoutExporter"].Success:
            raise RuntimeError(f"QGIS PDF export failed: {result}")
        outputs.append(pdf)
    layout = None
    gc.collect()
    return outputs


def _cleanup_temp(path: Path) -> None:
    for attempt in range(8):
        try:
            shutil.rmtree(path)
            return
        except FileNotFoundError:
            return
        except PermissionError:
            gc.collect()
            time.sleep(0.35 + attempt * 0.15)
    shutil.rmtree(path, ignore_errors=True)


def _status_for(outputs: list[str], issues: list[dict[str, str]]) -> str:
    if not outputs:
        return "REVIEW_REQUIRED"
    if issues:
        return "PARTIAL_REVIEW_REQUIRED"
    return "COMPLETED"


def render_manifest(manifest: dict, output_dir: Path, vworld_key: str | None) -> dict:
    issues = _preflight(manifest, vworld_key)
    hard_codes = {"VWORLD_KEY_MISSING", "ROLE_MISSING", "GEOMETRY_MISSING", "CADASTRAL_ARCHIVE_MISSING"}
    if any(item["code"] in hard_codes for item in issues):
        return {"status": "REVIEW_REQUIRED", "outputs": [], "issues": issues}

    q = _qgis_imports()
    app = q["QgsApplication"]([], False)
    app.initQgis()
    outputs: list[str] = []
    selected_geometry: list[str] = []
    report_path: str | None = None
    temp_root = Path(tempfile.mkdtemp(prefix="bso_graphics_"))
    project = q["QgsProject"].instance()
    raster = None
    loaded: dict[str, Any] = {}
    try:
        specs = prepare_layer_specs(manifest, temp_root)
        project.clear()
        raster = _add_vworld_layer(project, manifest, vworld_key or "", q)
        if raster is None:
            issues.append({"code": "VWORLD_LAYER_INVALID", "message": "VWorld 위성배경 레이어를 열지 못했습니다."})

        for spec in specs:
            role = spec.get("role", "unknown")
            try:
                layer = _load_vector(project, spec, q)
                loaded[role] = layer
                selected_geometry.append(str(_write_selected_geometry(project, layer, role, output_dir, q)))
            except Exception as exc:
                issues.append({"code": "LAYER_LOAD_FAILED", "message": f"{role}: {exc}"})

        plans = [
            ("overview", ["subject", "standard", "case"]),
            ("subject_vs_standard", ["subject", "standard"]),
            ("standard_vs_case", ["standard", "case"]),
        ]
        formats = [str(value).lower() for value in manifest.get("output_formats", ["png", "pdf"])]
        case_review = any(item["code"] in {"CASE_LOT_MISSING", "CASE_REVIEW_REQUIRED"} for item in issues)
        for name, roles in plans:
            if name not in manifest.get("outputs", []):
                continue
            if any(role not in loaded for role in roles):
                issues.append({"code": "OUTPUT_BLOCKED", "message": f"{name}: geometry 역할 누락"})
                continue
            if name == "standard_vs_case" and case_review and manifest.get(
                "skip_standard_vs_case_if_review_unresolved", True
            ):
                issues.append({"code": "OUTPUT_BLOCKED", "message": "standard_vs_case: 사례 검토 미해결"})
                continue
            base = output_dir / name
            map_title = (manifest.get("map_titles") or {}).get(name)
            paths = _export_layout(
                project,
                [loaded[role] for role in roles],
                raster,
                base,
                map_title or (manifest.get("title", name) + " - " + name),
                formats,
                q,
                _map_profile(manifest, name),
            )
            outputs.extend(str(path) for path in paths)

        # Qt/QImage/QPdfWriter는 QgsApplication이 살아 있을 때만 사용한다.
        try:
            flow_paths = generate_other_factor_flow(manifest.get("other_factor_flow") or {}, output_dir)
            outputs.extend(str(path) for path in flow_paths)
        except Exception as exc:
            issues.append({"code": "FLOW_GRAPHIC_FAILED", "message": str(exc)})

        provisional = {
            "status": _status_for(outputs, issues),
            "outputs": outputs,
            "selected_geometry": selected_geometry,
            "issues": issues,
        }
        try:
            report_path = str(write_report(manifest, provisional, output_dir))
        except Exception as exc:
            issues.append({"code": "REPORT_PDF_FAILED", "message": str(exc)})
    finally:
        project.clear()
        loaded.clear()
        raster = None
        gc.collect()
        q["QCoreApplication"].processEvents()
        app.exitQgis()
        app = None
        gc.collect()
        _cleanup_temp(temp_root)

    result = {
        "status": _status_for(outputs, issues),
        "outputs": outputs,
        "selected_geometry": selected_geometry,
        "issues": issues,
    }
    if report_path:
        result["report"] = report_path
    return result
