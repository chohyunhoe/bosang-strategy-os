# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC_DIR = HERE / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from bso_graphics.manifest_loader import load_manifest
from bso_graphics.parcel_verification import (
    remove_blocked_outputs,
    verification_gate_passed,
    verification_required,
    verification_result_path,
)
from bso_graphics.qgis_windows_bootstrap import configure_windows_dll_search
from bso_graphics.sample_brief_renderer import generate_sample_brief as generate_qt_sample_brief


def main() -> int:
    parser = argparse.ArgumentParser(description="보상전략 OS 칸샘플형 최종 2페이지 산출물")
    parser.add_argument("manifest")
    parser.add_argument("--output-dir", default="graphics-output")
    args = parser.parse_args()

    manifest_path = Path(args.manifest).resolve()
    manifest = load_manifest(manifest_path)
    output_dir = Path(args.output_dir).resolve() / str(manifest["case_id"])
    output_dir.mkdir(parents=True, exist_ok=True)

    if verification_required(manifest) and not verification_gate_passed(manifest, output_dir):
        remove_blocked_outputs(output_dir)
        result = {
            "status": "REVIEW_REQUIRED",
            "final_sample_outputs": [],
            "issue": "PARCEL_VERIFICATION_REQUIRED",
            "parcel_verification_result": str(verification_result_path(output_dir)),
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 12

    configure_windows_dll_search()
    try:
        from qgis.core import QgsApplication
    except (ImportError, OSError):
        from bso_graphics.fitz_sample_brief_renderer import generate_sample_brief as generate_fitz_sample_brief

        paths = generate_fitz_sample_brief(manifest, output_dir)
        renderer = "PYMUPDF_FALLBACK"
    else:
        app = QgsApplication([], False)
        app.initQgis()
        try:
            paths = generate_qt_sample_brief(manifest, output_dir)
            renderer = "QGIS_QT"
        finally:
            app.exitQgis()

    result_path = output_dir / "graphics_manifest_result.json"
    if result_path.exists():
        result = json.loads(result_path.read_text(encoding="utf-8"))
    else:
        result = {"status": "PARTIAL_REVIEW_REQUIRED", "outputs": [], "issues": []}
    outputs = result.setdefault("outputs", [])
    for path in paths:
        value = str(path)
        if value not in outputs:
            outputs.append(value)
    result["final_sample_brief"] = str(output_dir / "final_sample_brief.pdf")
    result["final_sample_pages"] = [str(output_dir / "final_sample_page1.png"), str(output_dir / "final_sample_page2.png")]
    result["sample_brief_renderer"] = renderer
    if verification_required(manifest):
        result["parcel_verification_result"] = str(verification_result_path(output_dir))
    result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": "COMPLETED", "final_sample_outputs": [str(p) for p in paths]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
