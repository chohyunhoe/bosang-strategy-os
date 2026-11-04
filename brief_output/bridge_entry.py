# -*- coding: utf-8 -*-
"""로컬 출력 브리지용 기계판독 진입점.

    python -m brief_output.bridge_entry <case.json> <out_dir>

`build_case_brief` 와 같은 산출 계층을 그대로 호출하고, 결과 요약만 stdout 에 JSON 한 줄로 낸다.
브라우저가 터미널 명령을 입력하지 않고도 분석보고서를 받을 수 있게 하는 배선이며,
새 분석·새 판단을 추가하지 않는다.

stdout 은 JSON 한 줄만 쓴다(진단 문구는 stderr). 종료코드 0=성공, 2=fail-closed 중단.
"""
from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path

from .build_case_brief import apply_adapter_qa
from .docx_binder import bind_docx
from .docx_template import TEMPLATE_PATH, build_template
from .generator import build_output
from .killerkit_adapter import AdapterError, AdapterSafetyError, adapt_case


def _summary(output, docx_path: Path) -> dict:
    report = output.analysis_bundle.get("adapter_report", {})
    provenance = report.get("provenance", {})
    return {
        "ok": True,
        "report_status": output.run_meta.status,
        "docx_path": str(docx_path),
        "file_stem": output.run_meta.run_id,
        "project_name": output.project_meta.project_name,
        "counts": {
            "subject_parcels": len(output.subject_bundle.get("subject_parcels", [])),
            "reference_parcels": len(output.subject_bundle.get("reference_parcels", [])),
            "valuation_rows": len(output.valuation_bundle),
            "documents": len(output.document_meta),
        },
        "review_warnings": report.get("review_warnings", []),
        "unlinked_subject_parcels": report.get("unlinked_subject_parcels", []),
        "blocked_rows": report.get("blocked_rows", []),
        "provenance": {
            "source_refs_mapped": provenance.get("source_refs_mapped", 0),
            "records_without_source_ref": provenance.get("records_without_source_ref", 0),
        },
        "qa": [
            {"rule_id": item.rule_id, "status": item.status.value, "message": item.message}
            for item in output.qa_bundle
        ],
        "review_queue": [
            {"review_id": item.review_id, "priority": item.priority, "title": item.title, "reason": item.reason}
            for item in output.review_queue
        ],
    }


def run(case_path: Path, out_dir: Path) -> dict:
    case = json.loads(case_path.read_text(encoding="utf-8"))
    output = apply_adapter_qa(build_output(adapt_case(case)))
    if not TEMPLATE_PATH.exists():
        build_template()
    out_dir.mkdir(parents=True, exist_ok=True)
    docx_path = bind_docx(output, TEMPLATE_PATH, out_dir / f"{output.run_meta.run_id}.docx")
    return _summary(output, docx_path)


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 2:
        print(json.dumps({"ok": False, "error_code": "BAD_ARGUMENTS"}, ensure_ascii=False))
        return 2
    try:
        print(json.dumps(run(Path(args[0]), Path(args[1])), ensure_ascii=False))
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
