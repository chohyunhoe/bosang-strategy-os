# -*- coding: utf-8 -*-
from __future__ import annotations

import hashlib
import zipfile
from pathlib import Path

from .manifest_loader import resolve_path


def _safe_extract(zip_path: Path, target_dir: Path) -> None:
    target_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as archive:
        root = target_dir.resolve()
        for member in archive.infolist():
            destination = (target_dir / member.filename).resolve()
            if root not in destination.parents and destination != root:
                raise ValueError(f"unsafe zip member: {member.filename}")
        archive.extractall(target_dir)


def _cache_dir(work_dir: Path, archive_path: Path) -> Path:
    digest = hashlib.sha1(str(archive_path.resolve()).encode("utf-8")).hexdigest()[:12]
    return work_dir / f"cadastral_{digest}"


def extract_archive_shapefile(archive_path: Path, work_dir: Path) -> Path:
    """연속지적도 ZIP을 안전하게 풀고 내부 SHP 경로를 반환한다."""
    target = _cache_dir(work_dir, archive_path)
    if not target.exists():
        _safe_extract(archive_path, target)
    shapefiles = sorted(target.rglob("*.shp"))
    if not shapefiles:
        raise ValueError(f"SHP not found in archive: {archive_path}")
    if len(shapefiles) > 1:
        preferred = [path for path in shapefiles if "LSMD_CONT_LDREG" in path.name.upper()]
        if len(preferred) == 1:
            return preferred[0]
        raise ValueError(f"multiple SHP files in archive: {archive_path}")
    return shapefiles[0]


def prepare_layer_specs(manifest: dict, work_dir: Path) -> list[dict]:
    """geometry source 또는 연속지적도 ZIP+PNU 입력을 QGIS 로딩 사양으로 변환한다."""
    prepared: list[dict] = []
    archive_cache: dict[Path, Path] = {}
    for raw in manifest.get("layers", []):
        spec = dict(raw)
        source = resolve_path(manifest, spec.get("source"))
        archive = resolve_path(manifest, spec.get("archive"))
        pnus = spec.get("pnus") or ([spec["pnu"]] if spec.get("pnu") else [])

        if source is not None:
            spec["_prepared_source"] = str(source)
        elif archive is not None:
            if archive not in archive_cache:
                archive_cache[archive] = extract_archive_shapefile(archive, work_dir)
            spec["_prepared_source"] = str(archive_cache[archive])
            spec["_subset_pnus"] = [str(value) for value in pnus]
        prepared.append(spec)
    return prepared
