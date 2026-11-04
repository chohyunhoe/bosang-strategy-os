# -*- coding: utf-8 -*-
from __future__ import annotations

import hashlib
import math
import time
import urllib.request
from pathlib import Path
from typing import Any

ORIGIN_SHIFT = 20037508.342789244
TILE_SIZE = 256


def _mercator_tile_bounds(x: int, y: int, z: int) -> tuple[float, float, float, float]:
    resolution = (2 * ORIGIN_SHIFT) / (TILE_SIZE * (2 ** z))
    min_x = -ORIGIN_SHIFT + x * TILE_SIZE * resolution
    max_x = min_x + TILE_SIZE * resolution
    max_y = ORIGIN_SHIFT - y * TILE_SIZE * resolution
    min_y = max_y - TILE_SIZE * resolution
    return min_x, min_y, max_x, max_y


def _tile_range(extent, z: int) -> tuple[int, int, int, int]:
    n = 2 ** z
    def tx(x: float) -> int:
        return max(0, min(n - 1, int((x + ORIGIN_SHIFT) / (2 * ORIGIN_SHIFT) * n)))
    def ty(y: float) -> int:
        return max(0, min(n - 1, int((ORIGIN_SHIFT - y) / (2 * ORIGIN_SHIFT) * n)))
    return tx(extent.xMinimum()), tx(extent.xMaximum()), ty(extent.yMaximum()), ty(extent.yMinimum())


def _choose_zoom(extent, target_pixels: int = 1800) -> int:
    width = max(float(extent.width()), 1.0)
    raw = math.log2((2 * ORIGIN_SHIFT * target_pixels) / (TILE_SIZE * width))
    return max(6, min(19, int(round(raw))))


def _download(url: str, destination: Path, referer: str, retries: int = 3) -> None:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 BSO-Graphics-Gate/0.1",
            "Referer": referer,
            "Accept": "image/jpeg,image/*;q=0.8,*/*;q=0.5",
        },
    )
    error: Exception | None = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                payload = response.read()
                content_type = str(response.headers.get("Content-Type") or "").lower()
            if len(payload) < 500 or ("image" not in content_type and not payload.startswith(b"\xff\xd8")):
                raise RuntimeError(f"invalid tile response: {content_type}, {len(payload)} bytes")
            destination.write_bytes(payload)
            return
        except Exception as exc:
            error = exc
            time.sleep(0.5 + attempt * 0.7)
    # URL path contains the VWorld API key. Never persist it in reports or logs.
    raise RuntimeError(f"VWorld tile download failed: {type(error).__name__}: {error}")


def _write_world_file(path: Path, x: int, y: int, z: int) -> None:
    min_x, _min_y, _max_x, max_y = _mercator_tile_bounds(x, y, z)
    resolution = (2 * ORIGIN_SHIFT) / (TILE_SIZE * (2 ** z))
    values = [resolution, 0.0, 0.0, -resolution, min_x + resolution / 2, max_y - resolution / 2]
    path.with_suffix(".jgw").write_text("\n".join(f"{value:.15f}" for value in values), encoding="ascii")


def _to_3857_extent(
    vector_layers: list[Any],
    q: dict[str, Any],
    target_aspect: float | None = None,
):
    from qgis.core import QgsCoordinateReferenceSystem, QgsCoordinateTransform, QgsRectangle

    combined = None
    target = QgsCoordinateReferenceSystem("EPSG:3857")
    for layer in vector_layers:
        if not layer.isValid() or layer.featureCount() == 0:
            continue
        transform = QgsCoordinateTransform(layer.crs(), target, layer.transformContext())
        extent = transform.transformBoundingBox(layer.extent())
        if combined is None:
            combined = QgsRectangle(extent)
        else:
            combined.combineExtentWith(extent)
    if combined is None:
        raise RuntimeError("no vector extent for basemap")
    combined.scale(1.75)
    if target_aspect and target_aspect > 0:
        width = max(float(combined.width()), 1.0)
        height = max(float(combined.height()), 1.0)
        current_aspect = width / height
        center = combined.center()
        if current_aspect < target_aspect:
            half_width = height * target_aspect / 2.0
            combined.setXMinimum(center.x() - half_width)
            combined.setXMaximum(center.x() + half_width)
        elif current_aspect > target_aspect:
            half_height = width / target_aspect / 2.0
            combined.setYMinimum(center.y() - half_height)
            combined.setYMaximum(center.y() + half_height)
    return combined


def build_local_vworld_basemap(
    vector_layers: list[Any],
    api_key: str,
    cache_root: Path,
    q: dict[str, Any],
    referer: str = "http://localhost",
    target_aspect: float | None = None,
) -> Any:
    """필요한 VWorld 위성 타일만 내려받아 로컬 GeoTIFF로 모자이크한다."""
    if not api_key:
        raise RuntimeError("VWORLD_API_KEY missing")

    from osgeo import gdal, osr
    from qgis.core import QgsRasterLayer

    extent = _to_3857_extent(vector_layers, q, target_aspect=target_aspect)
    zoom = _choose_zoom(extent)
    x0, x1, y0, y1 = _tile_range(extent, zoom)
    tile_count = (x1 - x0 + 1) * (y1 - y0 + 1)
    if tile_count > 64:
        zoom = max(6, zoom - 1)
        x0, x1, y0, y1 = _tile_range(extent, zoom)
        tile_count = (x1 - x0 + 1) * (y1 - y0 + 1)
    if tile_count > 100:
        raise RuntimeError(f"too many VWorld tiles: {tile_count}")

    signature = hashlib.sha1(
        f"{zoom}:{x0}:{x1}:{y0}:{y1}".encode("ascii")
    ).hexdigest()[:12]
    directory = cache_root / f"z{zoom}_{signature}"
    directory.mkdir(parents=True, exist_ok=True)
    output = directory / "vworld_satellite.tif"
    if output.exists() and output.stat().st_size > 1000:
        layer = QgsRasterLayer(str(output), "VWorld Satellite Local")
        if layer.isValid():
            return layer

    tiles: list[str] = []
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(3857)
    wkt = srs.ExportToWkt()
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            tile = directory / f"{zoom}_{x}_{y}.jpg"
            if not tile.exists() or tile.stat().st_size < 500:
                url = (
                    "https://api.vworld.kr/req/wmts/1.0.0/"
                    f"{api_key}/Satellite/{zoom}/{y}/{x}.jpeg"
                )
                _download(url, tile, referer)
            _write_world_file(tile, x, y, zoom)
            tile.with_suffix(".prj").write_text(wkt, encoding="utf-8")
            tiles.append(str(tile))

    vrt = directory / "mosaic.vrt"
    gdal.SetConfigOption("GDAL_PAM_ENABLED", "YES")
    dataset = gdal.BuildVRT(str(vrt), tiles)
    if dataset is None:
        raise RuntimeError("VWorld VRT build failed")
    dataset = None
    translated = gdal.Translate(
        str(output),
        str(vrt),
        format="GTiff",
        creationOptions=["TILED=YES", "COMPRESS=JPEG", "PHOTOMETRIC=YCBCR"],
    )
    if translated is None:
        raise RuntimeError("VWorld GeoTIFF creation failed")
    translated = None

    layer = QgsRasterLayer(str(output), "VWorld Satellite Local")
    if not layer.isValid():
        raise RuntimeError("local VWorld GeoTIFF is invalid")
    return layer
