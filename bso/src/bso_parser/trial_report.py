# -*- coding: utf-8 -*-
"""시용 배치 결과를 사람이 바로 검토할 수 있는 Markdown으로 변환한다."""
from __future__ import annotations


def _fmt(value):
    if value is None:
        return "-"
    if isinstance(value, float):
        return f"{value:.5f}".rstrip("0").rstrip(".")
    if isinstance(value, int):
        return f"{value:,}"
    return str(value)


def build_markdown(manifest: dict, comparison: dict) -> str:
    lines = [
        "# 보상전략 OS 시용 배치 결과",
        "",
        f"- 입력 평가서: {len(manifest.get('items', []))}건",
        f"- 시용 가능 판정: {manifest.get('trial_usable_count', 0)}건",
        f"- 전체 시용 가능: {'예' if manifest.get('all_trial_usable') else '아니오'}",
    ]
    if "golden_all_valid" in manifest:
        lines.append(f"- 기대값 전체 일치: {'예' if manifest.get('golden_all_valid') else '아니오'}")
    lines.extend(["", "## 법인별 핵심 비교", ""])

    headers = ["법인", "표준지", "공시지가", "대상 개별요인", "그 밖의 요인", "적용단가", "평가액", "시용판정"]
    lines.append("| " + " | ".join(headers) + " |")
    lines.append("|" + "|".join(["---"] * len(headers)) + "|")
    readiness = {item.get("company"): item.get("trial_readiness", {}) for item in manifest.get("items", [])}
    for row in comparison.get("rows", []):
        company = row.get("company")
        rd = readiness.get(company, {})
        values = [
            company,
            row.get("standard_lot"),
            _fmt(row.get("official_price")),
            _fmt(row.get("subject_factor_total")),
            _fmt(row.get("other_factor")),
            _fmt(row.get("unit_price")),
            _fmt(row.get("amount")),
            "가능" if rd.get("trial_usable") else "검토필요",
        ]
        lines.append("| " + " | ".join(_fmt(value) for value in values) + " |")

    reverse = comparison.get("reverse_factor_audit") or {}
    if reverse:
        lines.extend(["", "## 역산 감사 — 원문값과 분리된 추정", ""])
        reverse_headers = ["법인", "후보 표준지", "역산 종합개별요인", "출처상태", "선정상태"]
        lines.append("| " + " | ".join(reverse_headers) + " |")
        lines.append("|" + "|".join(["---"] * len(reverse_headers)) + "|")
        for appraisal in reverse.get("appraisals", []):
            for candidate in appraisal.get("candidates", []):
                inferred = candidate.get("implied_subject_individual_factor") or {}
                values = [
                    appraisal.get("company") or candidate.get("company"),
                    candidate.get("standard_lot"),
                    _fmt(inferred.get("value")),
                    inferred.get("status"),
                    candidate.get("selection_status"),
                ]
                lines.append("| " + " | ".join(_fmt(value) for value in values) + " |")
        best = reverse.get("cross_appraiser_comparison", {}).get("best_supported_candidate")
        if best:
            lines.extend([
                "",
                f"- 법인 간 수렴도 최상 후보: `{best.get('standard_lot')}` "
                f"(절대 편차 {_fmt(best.get('absolute_spread'))}, 원문 선정 여부는 수동검토)",
            ])
        lines.extend([
            "",
            "> 역산값은 산식 누락 검토를 위한 추정치입니다. 6개 개별요인 세부값으로 분해하지 않습니다.",
        ])

    lines.extend(["", "## 검토 필요 항목", ""])
    review_count = 0
    for item in manifest.get("items", []):
        company = item.get("company")
        rd = item.get("trial_readiness", {})
        for check in rd.get("checks", []):
            if not check.get("passed"):
                lines.append(f"- **{company}**: {check.get('name')} — {check.get('note', '확인 필요')}")
                review_count += 1
        verification = item.get("golden_verification") or {}
        for mismatch in verification.get("mismatches", []):
            lines.append(
                f"- **{company}** 기대값 불일치: `{mismatch.get('field')}` "
                f"(실제 {_fmt(mismatch.get('actual'))} / 기대 {_fmt(mismatch.get('expected'))})"
            )
            review_count += 1
    if review_count == 0:
        lines.append("- 없음")

    lines.extend([
        "",
        "> 본 결과는 감정평가 또는 법률판단을 대체하지 않는 검토 보조자료입니다.",
        "",
    ])
    return "\n".join(lines)
