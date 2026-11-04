from __future__ import annotations

import json
from pathlib import Path

from .generator import build_output
from .models import BriefOutput


ROOT = Path(__file__).resolve().parent
INPUT = ROOT / "golden_case_shinmh_input.json"
OUTPUT = ROOT / "bso_brief_output_v0.1.json"
SCHEMA = ROOT / "bso_brief_output_v0.1.schema.json"


def main() -> None:
    raw = json.loads(INPUT.read_text(encoding="utf-8"))
    base = BriefOutput.model_validate(raw)
    output = build_output(base)
    OUTPUT.write_text(output.model_dump_json(indent=2), encoding="utf-8")
    SCHEMA.write_text(
        json.dumps(BriefOutput.model_json_schema(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(OUTPUT)
    print(SCHEMA)
    print(output.run_meta.status)


if __name__ == "__main__":
    main()
