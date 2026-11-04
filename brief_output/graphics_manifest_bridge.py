from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .models import BriefOutput, GraphicAsset

_REQUIRED_ASSET_IDS = (
    "overview-map",
    "subject-detail-map",
    "reference-detail-map",
    "other-factor-flow",
)

_SEMANTIC_SLOT_MAP = {
    "OVERVIEW_MAP": "overview-map",
    "overview-map": "overview-map",
    "REVIEW_MAP": "overview-map",
    "SUBJECT_DETAIL_MAP": "subject-detail-map",
    "subject-detail-map": "subject-detail-map",
    "REFERENCE_DETAIL_MAP": "reference-detail-map",
    "reference-detail-map": "reference-detail-map",
    "OTHER_FACTOR_FLOW": "other-factor-flow",
    "other-factor-flow": "other-factor-flow",
}

_BRIEF_SLOT_MAP = {
    "PAGE1_HERO_GRAPHIC": "overview-map",
    "PAGE3_SUBJECT_GRAPHIC": "subject-detail-map",
    "PAGE3_STANDARD_GRAPHIC": "reference-detail-map",
    "PAGE4_FLOW_GRAPHIC": "other-factor-flow",
}

_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}


class GraphicsManifestBridgeError(ValueError):
    """Raised when a graphics manifest must not be promoted into the brief."""


@dataclass(frozen=True)
class BridgeResult:
    output: BriefOutput
    ready_asset_ids: tuple[str, ...]
    pending_asset_ids: tuple[str, ...]
    final_ready: bool


def _asset_type(asset_id: str) -> str:
    return asset_id.replace("-", "_")


def _empty_assets() -> dict[str, GraphicAsset]:
    return {
        asset_id: GraphicAsset(asset_id=asset_id, asset_type=_asset_type(asset_id))
        for asset_id in _REQUIRED_ASSET_IDS
    }


def _resolve_image_path(manifest_dir: Path, raw_path: Any) -> Path | None:
    if not raw_path:
        return None
    path = Path(str(raw_path))
    if not path.is_absolute():
        path = manifest_dir / path
    if path.suffix.lower() not in _IMAGE_SUFFIXES or not path.is_file():
        return None
    return path


def _promote(
    assets: dict[str, GraphicAsset],
    *,
    asset_id: str,
    path: Path,
    manifest_path: Path,
    source_slot: str,
    review_status_code: str = "NEEDS_REVIEW",
) -> None:
    assets[asset_id] = GraphicAsset(
        asset_id=asset_id,
        asset_type=_asset_type(asset_id),
        file_name=str(path),
        status="ready",
        metadata={
            "source_manifest": str(manifest_path),
            "source_slot": source_slot,
            "review_status_code": review_status_code,
            "auto_confirmed": False,
        },
    )


def _apply_qgis_bundle_manifest(
    manifest: dict[str, Any],
    *,
    manifest_path: Path,
    assets: dict[str, GraphicAsset],
) -> None:
    graphics = manifest.get("graphics", [])
    if not isinstance(graphics, list):
        raise GraphicsManifestBridgeError("graphics must be a list")

    for item in graphics:
        if not isinstance(item, dict):
            continue
        slot = str(item.get("slot", ""))
        asset_id = _SEMANTIC_SLOT_MAP.get(slot)
        # PR #106 currently exports one review-map PNG. It is safe only as the
        # overview asset; it must never be promoted into the other three slots.
        if asset_id is None and slot == "PNG":
            asset_id = "overview-map"
        if asset_id is None:
            continue
        if item.get("auto_confirmed") is True:
            raise GraphicsManifestBridgeError("graphics must never be auto-confirmed")
        path = _resolve_image_path(manifest_path.parent, item.get("path"))
        if path is None:
            continue
        _promote(
            assets,
            asset_id=asset_id,
            path=path,
            manifest_path=manifest_path,
            source_slot=slot,
            review_status_code=str(item.get("review_status_code", "NEEDS_REVIEW")),
        )


def _apply_brief_slot_manifest(
    manifest: dict[str, Any],
    *,
    manifest_path: Path,
    assets: dict[str, GraphicAsset],
) -> None:
    slots = manifest.get("slots", {})
    if not isinstance(slots, dict):
        raise GraphicsManifestBridgeError("slots must be an object")

    for slot, asset_id in _BRIEF_SLOT_MAP.items():
        item = slots.get(slot)
        if not isinstance(item, dict) or item.get("status") != "READY":
            continue
        path = _resolve_image_path(manifest_path.parent, item.get("file"))
        if path is None:
            continue
        _promote(
            assets,
            asset_id=asset_id,
            path=path,
            manifest_path=manifest_path,
            source_slot=slot,
            review_status_code="NEEDS_REVIEW",
        )


def bridge_graphics_manifest(
    output: BriefOutput,
    manifest_path: Path,
    *,
    strict_final: bool = False,
) -> BridgeResult:
    """Map graphics output into the brief's four GraphicAsset slots.

    Supported inputs:
    - PR #106 `LK_GRAPHICS_BUNDLE_MANIFEST` (`graphics` list)
    - PR #112 `bso_brief_graphics_slots_v0.1` (`slots` object)

    `brief_blocked:true` is an absolute stop. Draft mode may attach only the
    assets that actually exist while unavailable slots remain explicit pending
    placeholders. Final mode requires all four semantic image assets.
    """

    manifest_path = Path(manifest_path)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("brief_blocked") is True:
        reason = manifest.get("block_reason") or "graphics manifest is blocked"
        raise GraphicsManifestBridgeError(str(reason))

    assets = _empty_assets()
    if isinstance(manifest.get("slots"), dict):
        _apply_brief_slot_manifest(manifest, manifest_path=manifest_path, assets=assets)
    else:
        _apply_qgis_bundle_manifest(manifest, manifest_path=manifest_path, assets=assets)

    ready = tuple(asset_id for asset_id in _REQUIRED_ASSET_IDS if assets[asset_id].status == "ready")
    pending = tuple(asset_id for asset_id in _REQUIRED_ASSET_IDS if assets[asset_id].status != "ready")
    if strict_final and pending:
        raise GraphicsManifestBridgeError(
            "final brief requires all four graphics assets: " + ", ".join(pending)
        )

    output.graphics_bundle = [assets[asset_id] for asset_id in _REQUIRED_ASSET_IDS]
    return BridgeResult(
        output=BriefOutput.model_validate(output.model_dump()),
        ready_asset_ids=ready,
        pending_asset_ids=pending,
        final_ready=not pending,
    )
