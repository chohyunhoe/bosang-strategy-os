# -*- coding: utf-8 -*-
"""CLI: killerkit 사건 JSON 1건 → 보상전략 분석보고서(JSON + DOCX).

    python -m brief_output.build_case_brief <case.json> [--out-dir DIR] [--json-only]

브라우저 `JSON/API/OCR` 화면에서 내보낸 사건 데이터를 그대로 넣는다.
새 분석을 만들지 않고 이미 구현된 산출 계층(`generator.build_output` → `docx_binder.bind_docx`)만 호출한다.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .docx_binder import bind_docx
from .docx_template import TEMPLATE_PATH, build_template
from .generator import build_output
from .killerkit_adapter import AdapterError, adapt_case
from .models import BriefOutput, QAResult, ReviewItem, ReviewStatus


def apply_adapter_qa(output: BriefOutput) -> BriefOutput:
    """어댑터 단계의 결손을 QA·검토큐에 올리고, 결손이 있으면 complete 로 끝나지 않게 한다.

    `generator.build_output` 은 개별요인 누락만 본다. 근거(source_ref) 전무, 차단된 평가행,
    평가행이 붙지 않은 편입토지는 그 검사에 걸리지 않으므로 여기서 fail-closed 로 잡는다.
    """
    report = output.analysis_bundle.get("adapter_report", {})
    blocked = report.get("blocked_rows", [])
    unlinked = report.get("unlinked_subject_parcels", [])
    provenance = report.get("provenance", {})
    mapped = int(provenance.get("source_refs_mapped") or 0)
    missing = int(provenance.get("records_without_source_ref") or 0)

    if mapped == 0:
        provenance_status = ReviewStatus.FAIL
        provenance_message = "구조화 근거(source_ref)가 하나도 없어 원문 대조 경로가 없는 보고서입니다."
    elif missing:
        provenance_status = ReviewStatus.REVIEW_REQUIRED
        provenance_message = f"근거 {mapped}건 승계, 근거 없는 레코드 {missing}건."
    else:
        provenance_status = ReviewStatus.PASS
        provenance_message = f"모든 레코드가 근거를 보유합니다({mapped}건 승계)."

    output.qa_bundle.append(
        QAResult(rule_id="QA-ADAPTER-PROVENANCE", status=provenance_status, message=provenance_message)
    )
    output.qa_bundle.append(
        QAResult(
            rule_id="QA-ADAPTER-BLOCKED-ROWS",
            status=ReviewStatus.FAIL if blocked else ReviewStatus.PASS,
            message=(
                f"어댑터가 차단한 평가행 {len(blocked)}건: "
                + ", ".join(sorted({row["reason"] for row in blocked}))
                if blocked
                else "차단된 평가행 없음."
            ),
            source_keys=[row["row_id"] for row in blocked],
        )
    )
    output.qa_bundle.append(
        QAResult(
            rule_id="QA-ADAPTER-SUBJECT-COVERAGE",
            status=ReviewStatus.FAIL if unlinked else ReviewStatus.PASS,
            message=(
                f"평가행이 연결되지 않은 편입토지 {len(unlinked)}필지가 비교대상에서 빠졌습니다."
                if unlinked
                else "모든 편입토지에 평가행이 연결되었습니다."
            ),
            source_keys=list(unlinked),
        )
    )

    # SubjectParcel·ReferenceParcel 에는 검토상태 필드가 없다. 상태가 사라지지 않도록 QA 로 올린다.
    preserved = report.get("review_status_preserved", {})
    unresolved = {code: count for code, count in preserved.items() if code.upper() != "CONFIRMED"}
    output.qa_bundle.append(
        QAResult(
            rule_id="QA-ADAPTER-REVIEW-STATE",
            status=ReviewStatus.REVIEW_REQUIRED if unresolved else ReviewStatus.PASS,
            message=(
                "검수가 끝나지 않은 원천 레코드가 있습니다: "
                + ", ".join(f"{code} {count}건" for code, count in sorted(unresolved.items()))
                if unresolved
                else "모든 원천 레코드가 CONFIRMED 상태입니다."
            ),
            source_keys=sorted(unresolved),
        )
    )

    if unlinked:
        output.review_queue.append(
            ReviewItem(
                review_id="review-unlinked-subject-parcels",
                priority="P0",
                title="평가행이 없는 편입토지 확인",
                reason="해당 필지가 보고서 비교표에서 빠져 있어 비교가 완결되지 않았습니다.",
                verification_method="산출근거 표 원문에서 해당 필지 행의 존재 여부를 확인합니다.",
            )
        )
    if mapped == 0:
        output.review_queue.append(
            ReviewItem(
                review_id="review-missing-provenance",
                priority="P0",
                title="구조화 근거 부재",
                reason="원문 페이지·행 근거가 없어 기재값을 대조할 수 없습니다.",
                verification_method="source_ref 를 포함하는 parser 출력으로 다시 생성합니다.",
            )
        )

    if any(item.status == ReviewStatus.FAIL for item in output.qa_bundle):
        output.run_meta.status = "partial"

    # Gate 와 같은 사유 코드로 남긴다. UI·문서 어느 쪽에서도 사라지면 안 된다.
    warnings: list[dict] = []
    if unlinked:
        warnings.append(
            {
                "code": "APPRAISAL_ROW_COVERAGE_GAP",
                "subject_lands": len(output.subject_bundle.get("subject_parcels", [])),
                "appraisal_rows": len(output.valuation_bundle),
                "unlinked_land_count": len(unlinked),
                "land_ids": list(unlinked),
                "detail": "편입토지 수보다 평가행이 적어 해당 필지가 비교표에서 빠졌습니다. 평가행을 자동 생성·복제하지 않았으므로 원문 산출근거 대조가 필요합니다.",
            }
        )
    if mapped == 0:
        warnings.append(
            {
                "code": "MISSING_PROVENANCE",
                "detail": "구조화 근거(원문 페이지·행)가 없어 기재값을 원문과 대조할 경로가 없습니다.",
            }
        )
    report["review_warnings"] = warnings
    _write_warnings_into_pages(output, warnings)
    return BriefOutput.model_validate(output.model_dump())


def _write_warnings_into_pages(output: BriefOutput, warnings: list[dict]) -> None:
    """경고를 문서 본문에도 남긴다. JSON 에만 있으면 DOCX 를 받은 사람은 볼 수 없다."""
    pages = {page.page_id: page for page in output.page_payloads}
    banner = (
        f"[문서 상태: {output.run_meta.status.upper()} · 원문 확인 필요]"
        if output.run_meta.status != "complete"
        else "[문서 상태: 구조화 완료 · 전문가 검토 필요]"
    )
    if warnings:
        banner += " 검토항목: " + ", ".join(item["code"] for item in warnings)

    summary = pages.get("page1_summary")
    if summary is not None:
        summary.paragraphs = ([banner] + list(summary.paragraphs))[:8]

    conclusion = pages.get("page5_conclusion")
    if conclusion is not None and warnings:
        lines = [
            f"[검토항목 · {item['code']}] {item['detail']}"
            + (
                f" (편입토지 {item['subject_lands']}필지 / 평가행 {item['appraisal_rows']}행 · 미연결 {item['unlinked_land_count']}필지: {', '.join(item['land_ids'])})"
                if item["code"] == "APPRAISAL_ROW_COVERAGE_GAP"
                else ""
            )
            for item in warnings
        ]
        conclusion.paragraphs = (list(conclusion.paragraphs) + lines)[:8]


def build_case_brief(case_path: Path, out_dir: Path, *, json_only: bool = False) -> dict[str, Path]:
    case = json.loads(case_path.read_text(encoding="utf-8"))
    base = adapt_case(case)
    output = apply_adapter_qa(build_output(base))

    out_dir.mkdir(parents=True, exist_ok=True)
    stem = output.run_meta.run_id
    written: dict[str, Path] = {}

    json_path = out_dir / f"{stem}.brief.json"
    json_path.write_text(output.model_dump_json(indent=2), encoding="utf-8")
    written["json"] = json_path

    if not json_only:
        if not TEMPLATE_PATH.exists():
            build_template()
        docx_path = out_dir / f"{stem}.brief.docx"
        bind_docx(output, TEMPLATE_PATH, docx_path)
        written["docx"] = docx_path

    report = output.analysis_bundle.get("adapter_report", {})
    print(f"status            : {output.run_meta.status}")
    print(f"valuation rows    : {len(output.valuation_bundle)}")
    print(f"subject parcels   : {len(output.subject_bundle.get('subject_parcels', []))}")
    print(f"blocked rows      : {len(report.get('blocked_rows', []))}")
    print(f"unlinked parcels  : {report.get('unlinked_subject_parcels', [])}")
    print(f"source_refs mapped: {report.get('provenance', {}).get('source_refs_mapped')}")
    for key, path in written.items():
        print(f"{key:<18}: {path}")
    return written


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="killerkit 사건 JSON → 보상전략 분석보고서")
    parser.add_argument("case_json", type=Path, help="사건 JSON 경로")
    parser.add_argument("--out-dir", type=Path, default=Path("output/brief"), help="출력 폴더")
    parser.add_argument("--json-only", action="store_true", help="DOCX 없이 BriefOutput JSON만 생성")
    args = parser.parse_args(argv)

    try:
        build_case_brief(args.case_json, args.out_dir, json_only=args.json_only)
    except AdapterError as error:
        print(f"[FAIL-CLOSED] {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
