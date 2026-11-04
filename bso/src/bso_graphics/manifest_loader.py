# -*- coding: utf-8 -*-
from __future__ import annotations

import json
from pathlib import Path

REQUIRED_ROLES = {"subject", "standard"}
SUPPORTED_GEOMETRY_EXTENSIONS = {".geojson", ".json", ".gpkg", ".shp"}
SUPPORTED_ARCHIVE_EXTENSIONS = {".zip"}


def load_manifest(path: Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("manifest must be a JSON object")
    payload["_manifest_dir"] = str(path.parent)
    payload.setdefault("schema_version", "bso_graphics_v0.2")
    payload.setdefault("layers", [])
    payload.setdefault("outputs", ["overview", "subject_vs_standard", "standard_vs_case"])
    payload.setdefault("output_formats", ["png", "pdf"])
    validate_manifest(payload)
    return payload


def resolve_path(manifest: dict, value: str | None) -> Path | None:
    if not value:
        return None
    path = Path(value)
    if not path.is_absolute():
        path = Path(manifest["_manifest_dir"]) / path
    return path.resolve()


def resolve_source(manifest: dict, source: str | None) -> Path | None:
    return resolve_path(manifest, source)


def _valid_pnu(value: object) -> bool:
    text = str(value)
    return len(text) == 19 and text.isdigit()


def validate_manifest(manifest: dict) -> None:
    if not manifest.get("case_id"):
        raise ValueError("case_id is required")
    roles = set()
    all_layer_pnus: set[str] = set()
    for layer in manifest.get("layers", []):
        role = layer.get("role")
        if role:
            roles.add(role)

        source = layer.get("source")
        archive = layer.get("archive")
        pnus = layer.get("pnus") or ([layer["pnu"]] if layer.get("pnu") else [])
        all_layer_pnus.update(str(value) for value in pnus)
        if source and archive:
            raise ValueError(f"layer must use source or archive, not both: {role}")
        if not source and not archive:
            raise ValueError(f"layer source/archive is required: {role}")
        if source and Path(source).suffix.lower() not in SUPPORTED_GEOMETRY_EXTENSIONS:
            raise ValueError(f"unsupported geometry format: {source}")
        if archive:
            if Path(archive).suffix.lower() not in SUPPORTED_ARCHIVE_EXTENSIONS:
                raise ValueError(f"unsupported cadastral archive: {archive}")
            if not pnus:
                raise ValueError(f"PNU is required for archive layer: {role}")
            if any(not _valid_pnu(value) for value in pnus):
                raise ValueError(f"invalid PNU for {role}: {pnus}")

    verification = manifest.get("parcel_verification")
    if isinstance(verification, dict) and verification.get("enabled"):
        required = verification.get("required_pnus")
        if not isinstance(required, list) or not required:
            raise ValueError("parcel_verification.required_pnus is required")
        seen: set[str] = set()
        for item in required:
            if not isinstance(item, dict):
                raise ValueError("parcel_verification.required_pnus items must be objects")
            pnu = str(item.get("pnu") or "")
            if not _valid_pnu(pnu):
                raise ValueError(f"invalid parcel verification PNU: {pnu}")
            if pnu in seen:
                raise ValueError(f"duplicate parcel verification PNU: {pnu}")
            seen.add(pnu)
            if pnu not in all_layer_pnus:
                raise ValueError(f"parcel verification PNU is not present in layers: {pnu}")
            expected_jibun = item.get("expected_jibun")
            if expected_jibun is not None and not str(expected_jibun).strip():
                raise ValueError(f"empty expected_jibun for parcel verification PNU: {pnu}")

    manifest["missing_roles"] = sorted(REQUIRED_ROLES - roles)
