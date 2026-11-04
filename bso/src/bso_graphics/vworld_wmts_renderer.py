# -*- coding: utf-8 -*-
from __future__ import annotations

import os
from pathlib import Path

from . import qgis_renderer as legacy
from .vworld_local_basemap import build_local_vworld_basemap


class _DeferredBasemap:
    """벡터 extent가 준비되기 전 원격 배경 생성을 지연시키는 표식 객체."""


def _defer_vworld_layer(project, manifest: dict, key: str, q: dict):
    # 원격 WMTS를 QGIS 레이아웃에서 비동기로 직접 그리지 않는다.
    # 실제 배경은 _export_layout 진입 시 벡터 extent에 맞춰 로컬 GeoTIFF로 만든다.
    return _DeferredBasemap()


def render_manifest(manifest: dict, output_dir, vworld_key: str | None):
    """VWorld 타일을 로컬 GeoTIFF로 선취득한 뒤 기존 QGIS 레이아웃으로 출력한다."""
    original_add = legacy._add_vworld_layer
    original_export = legacy._export_layout
    output_path = Path(output_dir)
    diagnostic = output_path / "vworld_basemap_error.txt"
    if diagnostic.exists():
        diagnostic.unlink()

    def export_with_local_basemap(
        project,
        vector_layers,
        raster_layer,
        output_base,
        title,
        formats,
        q,
        profile=None,
    ):
        local_layer = None
        try:
            if not vector_layers:
                raise RuntimeError("no vector layers for local basemap render")

            # 레이아웃 extent는 벡터 좌표계 기준으로 계산된다. 헤드리스 프로젝트의
            # 기본 CRS를 그대로 두면 EPSG:3857 GeoTIFF가 벡터와 중첩되지 않으므로
            # 프로젝트 CRS를 주 벡터 레이어 CRS로 명시한다.
            project.setCrs(vector_layers[0].crs())

            local_layer = build_local_vworld_basemap(
                vector_layers=vector_layers,
                api_key=vworld_key or "",
                cache_root=Path(output_base).parent / "_basemap-cache",
                q=q,
                referer=(
                    manifest.get("vworld_referer")
                    or os.environ.get("VWORLD_DOMAIN")
                    or "http://localhost"
                ),
                target_aspect=(
                    float(profile["map_rect"][2]) / float(profile["map_rect"][3])
                    if profile and profile.get("map_rect")
                    else None
                ),
            )

            from qgis.core import QgsCoordinateReferenceSystem

            local_layer.setCrs(QgsCoordinateReferenceSystem("EPSG:3857"))
            project.addMapLayer(local_layer)

            # QGIS map layer list는 앞쪽 레이어가 위에 그려진다. 기존 export 함수는
            # vector_layers 뒤에 raster를 붙이므로 벡터는 위, 위성영상은 배경이 된다.
            return original_export(
                project,
                vector_layers,
                local_layer,
                output_base,
                title,
                formats,
                q,
                profile,
            )
        except Exception as exc:
            diagnostic.write_text(str(exc), encoding="utf-8")
            # 지도 geometry 출력은 유지하되 결과 JSON에서 배경 실패를 명시한다.
            return original_export(
                project,
                vector_layers,
                None,
                output_base,
                title,
                formats,
                q,
                profile,
            )
        finally:
            if local_layer is not None:
                try:
                    project.removeMapLayer(local_layer.id())
                except Exception:
                    pass

    legacy._add_vworld_layer = _defer_vworld_layer
    legacy._export_layout = export_with_local_basemap
    try:
        result = legacy.render_manifest(manifest, output_path, vworld_key)
        if diagnostic.exists():
            message = diagnostic.read_text(encoding="utf-8", errors="replace")
            result.setdefault("issues", []).append({
                "code": "VWORLD_LOCAL_BASEMAP_FAILED",
                "message": message,
            })
            if result.get("status") == "COMPLETED":
                result["status"] = "PARTIAL_REVIEW_REQUIRED"
            result["background_source"] = "NONE_LOCAL_TILE_FAILED"
        else:
            result["background_source"] = "VWORLD_LOCAL_TILE_MOSAIC"
            result["background_crs"] = "EPSG:3857"
            result["map_crs"] = "PRIMARY_VECTOR_CRS"
        return result
    finally:
        legacy._add_vworld_layer = original_add
        legacy._export_layout = original_export
