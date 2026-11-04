from __future__ import annotations

import argparse
import json
from pathlib import Path

from .layout_table_extractor import build_layout_diagnostics


def main() -> None:
    parser = argparse.ArgumentParser(description="보상전략 OS PDF 레이아웃 진단")
    parser.add_argument("--central", required=True)
    parser.add_argument("--junghae", required=True)
    parser.add_argument("--output", default="prototype-output")
    args = parser.parse_args()

    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)

    raw_lines: list[dict[str, object]] = []
    blocks: list[dict[str, object]] = []
    for path, company in (
        (args.central, "중앙감정평가법인"),
        (args.junghae, "정해감정평가법인"),
    ):
        result = build_layout_diagnostics(path)
        for item in result["raw_layout_lines"]:
            item["appraisal_company"] = company
            raw_lines.append(item)
        for item in result["table_blocks_before_filter"]:
            item["appraisal_company"] = company
            blocks.append(item)

    (out_dir / "raw_layout_lines.json").write_text(
        json.dumps(raw_lines, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (out_dir / "table_blocks_before_filter.json").write_text(
        json.dumps(blocks, ensure_ascii=False, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
