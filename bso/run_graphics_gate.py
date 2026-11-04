# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

# QGIS 전용 Python은 배치파일에서 전달한 PYTHONPATH를 초기화하는 경우가 있다.
# 따라서 실행 파일 위치를 기준으로 bso/src를 직접 sys.path에 넣는다.
HERE = Path(__file__).resolve().parent
SRC_DIR = HERE / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from bso_graphics.brief_slot_mapper import write_slot_map
from bso_graphics.manifest_loader import load_manifest
from bso_graphics.parcel_verification import (
    load_verification_result,
    remove_blocked_outputs,
    verification_gate_passed,
    verification_required,
    verification_result_path,
)
from bso_graphics.qgis_windows_bootstrap import configure_windows_dll_search
from bso_graphics.vworld_wmts_renderer import render_manifest


def _write_result(output_dir: Path, result: dict) -> Path:
    result_path = output_dir / "graphics_manifest_result.json"
    result["result_file"] = str(result_path)
    result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result_path


def main() -> int:
    parser = argparse.ArgumentParser(description="보상전략 OS QGIS 그래픽 게이트")
    parser.add_argument("manifest")
    parser.add_argument("--output-dir", default="graphics-output")
    args = parser.parse_args()

    manifest_path = Path(args.manifest).resolve()
    output_root = Path(args.output_dir).resolve()
    manifest = load_manifest(manifest_path)
    output_dir = output_root / str(manifest["case_id"])
    output_dir.mkdir(parents=True, exist_ok=True)

    # 광명시흥처럼 parcel_verification이 활성화된 사건은 PASS 결과 없이는
    # QGIS 지도·항공사진·최종 샘플 생성 단계로 진입하지 않는다.
    if verification_required(manifest) and not verification_gate_passed(manifest, output_dir):
        remove_blocked_outputs(output_dir)
        verification = load_verification_result(output_dir)
        verification_status = verification.get("status") if verification else "MISSING"
        issue = {
            "code": "PARCEL_VERIFICATION_REQUIRED",
            "message": f"PNU→SHP 필지 검증이 PASS가 아닙니다: {verification_status}",
        }
        result = {
            "status": "REVIEW_REQUIRED",
            "outputs": [],
            "selected_geometry": [],
            "issues": [issue],
            "parcel_verification_result": str(verification_result_path(output_dir)),
        }
        slot_path = write_slot_map(output_dir, result["issues"])
        result["brief_slot_map"] = str(slot_path)
        _write_result(output_dir, result)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 12

    # Python 3.8+ Windows의 DLL 검색정책에 QGIS/Qt 폴더를 명시한다.
    configure_windows_dll_search()
    # 지도·흐름도·PDF 보고서는 모두 QgsApplication 생존 구간 안에서 생성된다.
    result = render_manifest(manifest, output_dir, vworld_key=os.environ.get("VWORLD_API_KEY"))
    if verification_required(manifest):
        result["parcel_verification_result"] = str(verification_result_path(output_dir))

    slot_path = write_slot_map(output_dir, result.get("issues", []))
    result["brief_slot_map"] = str(slot_path)

    _write_result(output_dir, result)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("status") in {"COMPLETED", "PARTIAL_REVIEW_REQUIRED"} else 10


if __name__ == "__main__":
    raise SystemExit(main())
