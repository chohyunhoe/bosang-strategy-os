# -*- coding: utf-8 -*-
"""복수 평가서 PDF를 canonical JSON과 법인별 비교표로 묶는 시용 실행기."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from bso_parser.pipeline import run, to_json_dict
from bso_parser.batch_comparison import build_batch_comparison
from bso_parser.trial_readiness import evaluate
from bso_parser.golden_verifier import verify_against_expected
from bso_parser.trial_report import build_markdown


def _safe_name(value: str) -> str:
    return "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in value).strip("_") or "appraisal"


def _load_expected(path_text: str | None) -> dict:
    if not path_text:
        return {}
    payload = json.loads(Path(path_text).read_text(encoding="utf-8"))
    expected = {}
    for item in payload.get("appraisals", []):
        company = item.get("company") or item.get("appraisal_company")
        values = item.get("expected") or item.get("metrics") or item
        if company:
            expected[company] = values
    return expected


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("inputs", nargs="+", help="company=PDF 경로")
    parser.add_argument("--output-dir", default="trial-output")
    parser.add_argument("--expected", help="선택: 법인별 기대값 fixture JSON")
    parser.add_argument("--password", default=os.environ.get("BSO_PDF_PASSWORD"),
                        help="암호화 PDF 비밀번호 (환경변수 BSO_PDF_PASSWORD)")
    parser.add_argument("--target-dong", help="대상토지 동")
    parser.add_argument("--target-lot", help="대상토지 지번")
    parser.add_argument("--target-serial", help="대상토지 일련번호")
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    expected_by_company = _load_expected(args.expected)

    items = []
    manifest = {"schema_version": "bso_trial_batch_v0.3", "items": []}
    for spec in args.inputs:
        if "=" not in spec:
            raise SystemExit(f"company=PDF 형식 필요: {spec}")
        company, pdf_text = spec.split("=", 1)
        pdf_path = Path(pdf_text)
        if not pdf_path.is_file():
            raise SystemExit(f"PDF 없음: {pdf_path}")

        canonical = to_json_dict(run(
            str(pdf_path),
            password=args.password,
            target_dong=args.target_dong,
            target_lot=args.target_lot,
            target_serial=args.target_serial,
        ))
        readiness = evaluate(canonical)
        canonical["trial_readiness"] = readiness

        golden_check = None
        expected = expected_by_company.get(company)
        if expected:
            allowed = {
                key: value for key, value in expected.items()
                if key in {
                    "subject_lot", "standard_lot", "official_price",
                    "subject_factor_total", "other_factor", "unit_price", "amount",
                }
            }
            golden_check = verify_against_expected(canonical, allowed)
            canonical["golden_verification"] = golden_check

        out_name = f"{_safe_name(company)}.canonical.json"
        out_path = output_dir / out_name
        out_path.write_text(json.dumps(canonical, ensure_ascii=False, indent=2), encoding="utf-8")

        items.append({"company": company, "canonical": canonical})
        manifest_item = {
            "company": company,
            "source_file": pdf_path.name,
            "canonical_file": out_name,
            "trial_readiness": readiness,
        }
        if golden_check is not None:
            manifest_item["golden_verification"] = golden_check
        manifest["items"].append(manifest_item)

    comparison = build_batch_comparison(items)
    comparison_path = output_dir / "batch_comparison.json"
    comparison_path.write_text(json.dumps(comparison, ensure_ascii=False, indent=2), encoding="utf-8")
    manifest["comparison_file"] = comparison_path.name
    manifest["trial_usable_count"] = sum(
        1 for item in manifest["items"] if item["trial_readiness"]["trial_usable"]
    )
    manifest["all_trial_usable"] = manifest["trial_usable_count"] == len(manifest["items"])
    verified = [item.get("golden_verification") for item in manifest["items"] if item.get("golden_verification")]
    if verified:
        manifest["golden_all_valid"] = all(item["valid"] for item in verified)

    report_path = output_dir / "trial_report.md"
    report_path.write_text(build_markdown(manifest, comparison), encoding="utf-8")
    manifest["report_file"] = report_path.name

    manifest_path = output_dir / "trial_manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(manifest_path.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
