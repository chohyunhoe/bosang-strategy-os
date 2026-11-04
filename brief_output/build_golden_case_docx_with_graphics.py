from __future__ import annotations

import argparse
import json
from pathlib import Path

from .docx_binder import bind_docx
from .docx_template import TEMPLATE_PATH, build_template
from .generator import build_output
from .graphics_manifest_bridge import bridge_graphics_manifest
from .models import BriefOutput

ROOT = Path(__file__).resolve().parent
INPUT = ROOT / "golden_case_shinmh_input.json"
DEFAULT_OUTPUT = ROOT / "bso_brief_output_v0.1_with_graphics.docx"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--graphics-manifest", required=True, type=Path)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--final",
        action="store_true",
        help="Require all four semantic graphics assets; otherwise leave missing slots pending.",
    )
    args = parser.parse_args()

    if not TEMPLATE_PATH.exists():
        build_template()

    raw = json.loads(INPUT.read_text(encoding="utf-8"))
    output = build_output(BriefOutput.model_validate(raw))
    bridged = bridge_graphics_manifest(output, args.graphics_manifest, strict_final=args.final)

    bind_docx(bridged.output, TEMPLATE_PATH, args.output)
    print(args.output)
    print("GRAPHICS_READY=" + ",".join(bridged.ready_asset_ids))
    print("GRAPHICS_PENDING=" + ",".join(bridged.pending_asset_ids))
    print("FINAL_READY=" + ("true" if bridged.final_ready else "false"))


if __name__ == "__main__":
    main()
