"""Live enrichment runner — XLSX → VWorld → graded results.

Combines xlsx_converter and pipeline into a single local-only execution.
Real addresses, PNU, API responses stay local. ALL outputs are written
to output-dir/local_only/ which is gitignored. No committable output.

Usage:
    $env:VWORLD_API_KEY="..."
    python -m transaction_enrichment.run_live \
        --xlsx "<시군구_법정동_지번>.xlsx" \
        --output-dir output/live_enrichment \
        --standards standards.json \
        [--sheet "토지"] \
        [--delay 0.3]
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

from .models import CaseGrade, ReviewPriority
from .pipeline import run_enrichment, summarize_results, write_outputs
from .pnu import VWorldAddressPnuResolver
from .providers import VWorldLandCharacteristicsProvider
from .xlsx_converter import (
    PRICE_UNIT_MULTIPLIERS,
    TARGET_COMBOS,
    build_bundle,
    dedupe_events,
    filter_pre_announcement,
    filter_pure_land,
    filter_target_combos,
    read_rows,
    resolve_price_unit,
)
from .xlsx_converter import LOOKBACK_START
from .precheck import ANNOUNCEMENT_DATE

try:
    from openpyxl import load_workbook
except ImportError:
    sys.exit("openpyxl required: pip install openpyxl")


RETRYABLE_STATUSES = {"VWORLD_API_ERROR", "PNU_SEARCH_FAILED"}


def retry_transport_failures(
    results: list, cases_by_id: dict, provider: Any, standards: list, resolver: Any
) -> tuple[list, int, int]:
    """Retry once, only for VWorld/PNU-search transport-class failures.

    VWORLD_MULTIPLE_EXACT_MATCHES and other ambiguous-match codes are never
    retried here — those are fail-closed by design and must stay for human
    review, not be resolved by a second automated attempt.

    Returns (merged_results, retried_count, recovered_count).
    """
    retry_ids = [r.transaction.case_id for r in results if r.provider_status in RETRYABLE_STATUSES]
    if not retry_ids:
        return results, 0, 0

    original_by_id = {r.transaction.case_id: r for r in results}
    retry_cases = [cases_by_id[case_id] for case_id in retry_ids]
    retry_results, _ = run_enrichment(retry_cases, provider, standards, pnu_resolver=resolver)

    merged_by_id = dict(original_by_id)
    recovered = 0
    for retried in retry_results:
        case_id = retried.transaction.case_id
        original = original_by_id[case_id]
        # Event membership is only correct when computed against the full
        # case set. A retry over just the failed subset would recompute it
        # against that subset alone, so keep the original run's event
        # fields and take only this attempt's lookup/grade outcome.
        retried.transaction_event_id = original.transaction_event_id
        retried.event_member_count = original.event_member_count
        retried.is_event_representative = original.is_event_representative
        merged_by_id[case_id] = retried
        if retried.provider_status == "SUCCESS":
            recovered += 1

    merged = [merged_by_id[r.transaction.case_id] for r in results]
    merged.sort(
        key=lambda item: (
            item.review_priority != ReviewPriority.A_PLUS_REVIEW,
            item.transaction.transaction_date,
            item.transaction.case_id,
        )
    )
    return merged, len(retry_ids), recovered


def count_a_plus_review(results) -> int:
    """Total A_PLUS_REVIEW count, matching summary["a_plus_review_candidates"].

    No is_event_representative filter: POSSIBLE_SAME_TRANSACTION_EVENT is a
    review hint only and never removes a row from the A+ total.
    """
    return sum(item.review_priority == ReviewPriority.A_PLUS_REVIEW for item in results)


def _load_bundle_cases(bundle: dict[str, Any]):
    from datetime import date as _date
    from .models import TransactionCase, StandardLandCandidate

    cases = [
        TransactionCase(
            case_id=item["case_id"],
            address=item["address"],
            transaction_date=_date.fromisoformat(item["transaction_date"]),
            land_category=item["land_category"],
            zoning=item["zoning"],
            area_m2=float(item["area_m2"]),
            unit_price_m2=float(item["unit_price_m2"]),
            pnu=item.get("pnu"),
            standard_candidate_ids=tuple(item.get("standard_candidate_ids", [])),
        )
        for item in bundle["transactions"]
    ]
    standards = [StandardLandCandidate(**item) for item in bundle["standard_candidates"]]
    return cases, standards


class ThrottledVWorldProvider(VWorldLandCharacteristicsProvider):
    def __init__(self, *, delay: float = 0.3, **kwargs: Any):
        super().__init__(**kwargs)
        self._delay = delay
        self._call_count = 0

    def get_by_pnu(self, pnu: str, *, standard_year: int | None = None):
        if self._call_count > 0:
            time.sleep(self._delay)
        self._call_count += 1
        return super().get_by_pnu(pnu, standard_year=standard_year)


class ThrottledPnuResolver(VWorldAddressPnuResolver):
    def __init__(self, *, delay: float = 0.3, **kwargs: Any):
        super().__init__(**kwargs)
        self._delay = delay
        self._call_count = 0

    def resolve(self, address: str):
        if self._call_count > 0:
            time.sleep(self._delay)
        self._call_count += 1
        return super().resolve(address)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Live XLSX → VWorld enrichment (local only)")
    parser.add_argument("--xlsx", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--sheet", default=None)
    parser.add_argument("--header-row", type=int, default=None)
    parser.add_argument("--standards", type=Path, default=None)
    parser.add_argument("--delay", type=float, default=0.3, help="Delay between API calls (sec)")
    parser.add_argument(
        "--price-unit",
        choices=sorted(PRICE_UNIT_MULTIPLIERS),
        default=None,
        help="거래금액 단위. 헤더에 단위 표기가 없으면 필수",
    )
    args = parser.parse_args(argv)

    if not args.standards:
        sys.exit("--standards 파일을 명시해야 합니다. 합성 DEFAULT_STANDARDS는 라이브 경로에서 사용할 수 없습니다.")
    if not args.standards.exists():
        sys.exit(f"--standards 파일이 존재하지 않습니다: {args.standards}")

    provider = ThrottledVWorldProvider(delay=args.delay)
    if not provider.configured:
        sys.exit("VWORLD_API_KEY 환경변수를 설정하세요.")
    resolver = ThrottledPnuResolver(delay=args.delay)

    print("=== XLSX Conversion ===")
    from .xlsx_converter import _detect_header_row, _map_columns

    wb = load_workbook(args.xlsx, read_only=True, data_only=True)
    sheet = wb[args.sheet] if args.sheet else wb.active
    print(f"Sheet: {sheet.title}")

    if args.header_row:
        header_row = args.header_row
        headers = [str(cell.value or "") for cell in sheet[header_row]]
    else:
        header_row, headers = _detect_header_row(sheet)
    col_map = _map_columns(headers)
    print(f"Column mapping: { {k: headers[v] for k, v in col_map.items()} }")

    price_unit = resolve_price_unit(headers, col_map, args.price_unit)
    print(f"Price unit: {price_unit}")

    all_rows = read_rows(sheet, header_row, col_map, price_unit=price_unit)
    print(f"[0] Total: {len(all_rows)}")

    land = filter_pure_land(all_rows)
    print(f"[1] Pure land: {len(land)}")

    pre_ann = filter_pre_announcement(land, LOOKBACK_START, ANNOUNCEMENT_DATE)
    print(f"[2] Pre-announcement 3yr: {len(pre_ann)}")

    deduped = dedupe_events(pre_ann)
    dup_count = sum(1 for r in deduped if r.get("_possible_same_transaction_event"))
    print(f"[3] Event flag: {len(deduped)} ({dup_count} flagged POSSIBLE_SAME_TRANSACTION_EVENT)")

    filtered = filter_target_combos(deduped, TARGET_COMBOS)
    print(f"[4] Target combos: {len(filtered)}")
    wb.close()

    raw = json.loads(args.standards.read_text(encoding="utf-8"))
    standards_data = raw if isinstance(raw, list) else raw.get("standard_candidates", raw)

    bundle = build_bundle(filtered, standards_data, standards_source="VERIFIED_INPUT")
    cases, standards = _load_bundle_cases(bundle)

    print(f"\n=== VWorld Live Enrichment ({len(cases)} cases) ===")
    print(f"Provider: {provider}")
    print(f"Delay: {args.delay}s between calls")

    results, summary = run_enrichment(cases, provider, standards, pnu_resolver=resolver)

    retry_ids = [r.transaction.case_id for r in results if r.provider_status in RETRYABLE_STATUSES]
    if retry_ids:
        print(
            f"\n=== Retry pass ({len(retry_ids)} transport-class failures: "
            "VWORLD_API_ERROR / PNU_SEARCH_FAILED — VWORLD_MULTIPLE_EXACT_MATCHES is never retried) ==="
        )
        cases_by_id = {c.case_id: c for c in cases}
        results, retried, recovered = retry_transport_failures(
            results, cases_by_id, provider, standards, resolver
        )
        print(f"Retried: {retried}, recovered to SUCCESS: {recovered}, still failing: {retried - recovered}")
        summary = summarize_results(results, provider)

    print("\n=== Results ===")
    print(json.dumps(
        {k: v for k, v in summary.items() if k != "review_reason_counts"},
        ensure_ascii=False, indent=2,
    ))

    print(f"\nReview reason counts:")
    for reason, count in sorted(summary.get("review_reason_counts", {}).items()):
        print(f"  {reason}: {count}")

    a_plus_total = count_a_plus_review(results)
    a_cand = [r for r in results if r.grade == CaseGrade.A_CANDIDATE]
    print(f"\nA_PLUS_REVIEW total: {a_plus_total}")
    print(f"A_CANDIDATE total: {len(a_cand)}")

    local_dir = args.output_dir / "local_only"
    local_dir.mkdir(parents=True, exist_ok=True)

    json_path, csv_path = write_outputs(local_dir, results, summary)
    print(f"\nEnrichment JSON: {json_path}")
    print(f"Review CSV:      {csv_path}")

    local_json = local_dir / "live_enrichment_full.json"
    local_json.write_text(
        json.dumps(
            {
                "summary": {k: (v if not callable(v) else str(v)) for k, v in summary.items()},
                "a_plus_count": a_plus_total,
                "a_candidate_count": len(a_cand),
                "total_cases": len(results),
            },
            ensure_ascii=False, indent=2, default=str,
        ) + "\n",
        encoding="utf-8",
    )
    print(f"Local summary: {local_json}")
    print(f"\n⚠ {local_dir}/ contains real data. All outputs are local-only. Never commit.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
