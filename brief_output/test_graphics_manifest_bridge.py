from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from .generator import build_output
from .graphics_manifest_bridge import GraphicsManifestBridgeError, bridge_graphics_manifest
from .models import BriefOutput

ROOT = Path(__file__).resolve().parent
FIXTURE = ROOT / "golden_case_shinmh_input.json"


class GraphicsManifestBridgeTests(unittest.TestCase):
    def _output(self) -> BriefOutput:
        raw = json.loads(FIXTURE.read_text(encoding="utf-8"))
        return build_output(BriefOutput.model_validate(raw))

    def _write_manifest(self, folder: Path, payload: dict) -> Path:
        path = folder / "graphics_bundle.json"
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return path

    def test_blocked_manifest_refuses_bridge(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write_manifest(
                Path(tmp),
                {"brief_blocked": True, "block_reason": "geometry gate blocked", "graphics": []},
            )
            with self.assertRaises(GraphicsManifestBridgeError):
                bridge_graphics_manifest(self._output(), path)

    def test_single_pr106_png_only_promotes_overview(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            png = folder / "review-map.png"
            png.write_bytes(b"png")
            path = self._write_manifest(
                folder,
                {
                    "brief_blocked": False,
                    "graphics": [
                        {
                            "slot": "PNG",
                            "path": str(png),
                            "review_status_code": "NEEDS_REVIEW",
                            "auto_confirmed": False,
                        }
                    ],
                },
            )
            result = bridge_graphics_manifest(self._output(), path)
            self.assertEqual(result.ready_asset_ids, ("overview-map",))
            self.assertEqual(
                result.pending_asset_ids,
                ("subject-detail-map", "reference-detail-map", "other-factor-flow"),
            )
            self.assertFalse(result.final_ready)

    def test_review_map_slot_promotes_overview(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            png = folder / "review-map.png"
            png.write_bytes(b"png")
            path = self._write_manifest(
                folder,
                {
                    "brief_blocked": False,
                    "graphics": [
                        {
                            "slot": "REVIEW_MAP",
                            "path": str(png),
                            "media_type": "image/png",
                            "review_status_code": "NEEDS_REVIEW",
                            "auto_confirmed": False,
                        }
                    ],
                },
            )
            result = bridge_graphics_manifest(self._output(), path)
            self.assertEqual(result.ready_asset_ids, ("overview-map",))
            asset = next(a for a in result.output.graphics_bundle if a.asset_id == "overview-map")
            self.assertEqual(asset.status, "ready")
            self.assertEqual(asset.metadata["source_slot"], "REVIEW_MAP")

    def test_missing_file_never_becomes_ready(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            path = self._write_manifest(
                folder,
                {
                    "brief_blocked": False,
                    "graphics": [
                        {"slot": "PNG", "path": str(folder / "missing.png"), "auto_confirmed": False}
                    ],
                },
            )
            result = bridge_graphics_manifest(self._output(), path)
            self.assertEqual(result.ready_asset_ids, ())
            self.assertEqual(len(result.pending_asset_ids), 4)

    def test_auto_confirmed_graphic_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            png = folder / "overview.png"
            png.write_bytes(b"png")
            path = self._write_manifest(
                folder,
                {
                    "brief_blocked": False,
                    "graphics": [
                        {"slot": "OVERVIEW_MAP", "path": str(png), "auto_confirmed": True}
                    ],
                },
            )
            with self.assertRaises(GraphicsManifestBridgeError):
                bridge_graphics_manifest(self._output(), path)

    def test_four_semantic_assets_can_be_final_ready(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            items = []
            slots = (
                "OVERVIEW_MAP",
                "SUBJECT_DETAIL_MAP",
                "REFERENCE_DETAIL_MAP",
                "OTHER_FACTOR_FLOW",
            )
            for idx, slot in enumerate(slots, start=1):
                image = folder / f"asset-{idx}.png"
                image.write_bytes(b"png")
                items.append({"slot": slot, "path": str(image), "auto_confirmed": False})
            path = self._write_manifest(folder, {"brief_blocked": False, "graphics": items})
            result = bridge_graphics_manifest(self._output(), path, strict_final=True)
            self.assertTrue(result.final_ready)
            self.assertEqual(len(result.ready_asset_ids), 4)
            self.assertEqual(result.pending_asset_ids, ())

    def test_strict_final_blocks_incomplete_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            png = folder / "review-map.png"
            png.write_bytes(b"png")
            path = self._write_manifest(
                folder,
                {"brief_blocked": False, "graphics": [{"slot": "PNG", "path": str(png)}]},
            )
            with self.assertRaises(GraphicsManifestBridgeError):
                bridge_graphics_manifest(self._output(), path, strict_final=True)


if __name__ == "__main__":
    unittest.main()
