# -*- coding: utf-8 -*-
"""로컬 출력 브리지용 수치 비교표 진입점.

    python -m brief_output.numeric_table_entry <case.json> <out_dir> [xlsx|csv|xlsx,csv]

분석보고서와 같은 어댑터·QA 계층을 그대로 지나온 결과를 표로 옮긴다.
stdout 은 JSON 한 줄만 쓴다. 종료코드 0=성공, 2=fail-closed 중단.
"""
from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path

from .build_case_brief import apply_adapter_qa
from .generator import build_output
from .killerkit_adapter import AdapterError, AdapterSafetyError, adapt_case
from .numeric_table import (
    SHEET_REVIEW,
    build_sheets,
    valuation_sheet,
    write_csv,
    write_xlsx,
)


def run(case_path: Path, out_dir: Path, formats: set[str]) -> dict:
    case = json.loads(case_path.read_text(encoding="utf-8"))
    output = apply_adapter_qa(build_output(adapt_case(case)))
    sheets = build_sheets(output, case)
    report = output.analysis_bundle.get("adapter_report", {})
    stem = f"{output.run_meta.run_id}.numeric"

    written: dict[str, str] = {}
    if "xlsx" in formats:
        written["xlsx_path"] = str(write_xlsx(sheets, out_dir / f"{stem}.xlsx"))
    if "csv" in formats:
        written["csv_path"] = str(write_csv(valuation_sheet(sheets), out_dir / f"{stem}.csv"))

    review_rows = next(sheet for sheet in sheets if sheet["name"] == SHEET_REVIEW)["rows"]
    return {
        "ok": True,
        "output_status": output.run_meta.status,
        "file_stem": stem,
        "project_name": output.project_meta.project_name,
        **written,
        "sheets": [
            {"name": sheet["name"], "columns": len(sheet["columns"]), "rows": len(sheet["rows"])}
            for sheet in sheets
        ],
        "counts": {
            "subject_parcels": len(output.subject_bundle.get("subject_parcels", [])),
            "valuation_rows": len(output.valuation_bundle),
            "appraisal_companies": len({row.appraisal_company for row in output.valuation_bundle}),
            "review_items": len(review_rows),
        },
        "review_warnings": report.get("review_warnings", []),
        "unlinked_subject_parcels": report.get("unlinked_subject_parcels", []),
    }


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) not in (2, 3):
        print(json.dumps({"ok": False, "error_code": "BAD_ARGUMENTS"}, ensure_ascii=False))
        return 2
    requested = {item.strip().lower() for item in (args[2] if len(args) == 3 else "xlsx,csv").split(",") if item.strip()}
    formats = requested & {"xlsx", "csv"}
    if not formats:
        print(json.dumps({"ok": False, "error_code": "NO_SUPPORTED_FORMAT"}, ensure_ascii=False))
        return 2
    try:
        print(json.dumps(run(Path(args[0]), Path(args[1]), formats), ensure_ascii=False))
        return 0
    except AdapterSafetyError as error:
        print(json.dumps({"ok": False, "error_code": "AUTO_CONFIRMED_BOUNDARY", "message": str(error)}, ensure_ascii=False))
        return 2
    except AdapterError as error:
        print(json.dumps({"ok": False, "error_code": "FAIL_CLOSED", "message": str(error)}, ensure_ascii=False))
        return 2
    except Exception as error:  # noqa: BLE001 - 브리지가 원인을 UI 로 되돌려 줘야 한다
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"ok": False, "error_code": "GENERATION_FAILED", "message": str(error)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
