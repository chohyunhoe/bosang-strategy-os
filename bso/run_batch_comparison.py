# -*- coding: utf-8 -*-
"""복수 평가법인 canonical JSON을 비교표 JSON으로 묶는 시용 CLI."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from bso_parser.batch_comparison import build_batch_comparison


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("inputs", nargs="+", help="company=canonical.json 또는 golden fixture JSON")
    parser.add_argument("--output", default="batch_comparison.json")
    args = parser.parse_args()

    items = []
    for spec in args.inputs:
        if "=" in spec:
            company, path_text = spec.split("=", 1)
            canonical = json.loads(Path(path_text).read_text(encoding="utf-8"))
            items.append({"company": company, "canonical": canonical})
            continue

        payload = json.loads(Path(spec).read_text(encoding="utf-8"))
        if "appraisals" not in payload:
            raise SystemExit(f"지원하지 않는 입력 형식: {spec}")
        items.extend(payload["appraisals"])

    result = build_batch_comparison(items)
    output = Path(args.output)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(output.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
