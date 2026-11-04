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
from bso_graphics.qgis_windows_bootstrap import configure_windows_dll_search
from bso_graphics.parcel_verification import (
    remove_blocked_outputs,
    verification_required,
    verification_result_path,
    verify_manifest_parcels,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="보상전략 OS PNU→SHP 필지 검증 게이트")
    parser.add_argument("manifest")
    parser.add_argument("--output-dir", default="graphics-output")
    args = parser.parse_args()

    manifest = load_manifest(Path(args.manifest).resolve())
    output_dir = Path(args.output_dir).resolve() / str(manifest["case_id"])
    output_dir.mkdir(parents=True, exist_ok=True)

    if not verification_required(manifest):
        print(json.dumps({
            "status": "NOT_REQUIRED",
            "case_id": manifest["case_id"],
            "message": "parcel_verification이 활성화되지 않은 사건입니다.",
        }, ensure_ascii=False, indent=2))
        return 0

    configure_windows_dll_search()
    from qgis.core import QgsApplication

    app = QgsApplication([], False)
    app.initQgis()
    try:
        result = verify_manifest_parcels(manifest, output_dir)
    finally:
        app.exitQgis()

    result["result_file"] = str(verification_result_path(output_dir))
    if result.get("status") != "PASS":
        remove_blocked_outputs(output_dir)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("status") == "PASS" else 12


if __name__ == "__main__":
    raise SystemExit(main())
