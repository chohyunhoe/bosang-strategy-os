#!/usr/bin/env python3
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

from bso_graphics.canonical_brief_builder import build_manifest
from bso_graphics.manifest_loader import validate_manifest


def _absolutize_geometry_paths(manifest: dict, base_dir: Path) -> None:
    for layer in manifest.get("layers") or []:
        for key in ("source", "archive"):
            value = layer.get(key)
            if value and not Path(value).is_absolute():
                layer[key] = str((base_dir / value).resolve())


def main() -> int:
    parser = argparse.ArgumentParser(description="canonical JSON → 검증 지도 2페이지 브리프 manifest")
    parser.add_argument("base_manifest", help="PNU/geometry 검증 설정이 포함된 graphics manifest")
    parser.add_argument("inputs", nargs="+", help="company=canonical.json")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    base_path = Path(args.base_manifest).resolve()
    base = json.loads(base_path.read_text(encoding="utf-8"))
    appraisals = []
    for spec in args.inputs:
        if "=" not in spec:
            raise SystemExit(f"company=canonical.json 형식 필요: {spec}")
        company, canonical_text = spec.split("=", 1)
        canonical = json.loads(Path(canonical_text).read_text(encoding="utf-8"))
        appraisals.append((company, canonical))
    manifest = build_manifest(base, appraisals)
    _absolutize_geometry_paths(manifest, base_path.parent)
    validate_manifest(manifest)
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
