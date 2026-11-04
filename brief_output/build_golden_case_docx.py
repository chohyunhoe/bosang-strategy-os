from __future__ import annotations

import json
from pathlib import Path

from .docx_binder import bind_docx
from .docx_template import TEMPLATE_PATH, build_template
from .generator import build_output
from .models import BriefOutput

ROOT = Path(__file__).resolve().parent
INPUT = ROOT / "golden_case_shinmh_input.json"
OUTPUT_DOCX = ROOT / "bso_brief_output_v0.1.docx"


def main() -> None:
    if not TEMPLATE_PATH.exists():
        build_template()

    raw = json.loads(INPUT.read_text(encoding="utf-8"))
    base = BriefOutput.model_validate(raw)
    output = build_output(base)

    bind_docx(output, TEMPLATE_PATH, OUTPUT_DOCX)
    print(OUTPUT_DOCX)
    print(output.run_meta.status)


if __name__ == "__main__":
    main()
