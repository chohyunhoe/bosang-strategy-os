"""나라장터 EARLY_SIGNAL 수집 CLI (신규사업 모니터링 보조, 로컬 전용 출력).

사용 예:
    python -m public_data.run_early_signal \
        --begin 202608010000 --end 202608312359 \
        --output-dir output/public_data

- 4단계(발주계획/사전규격/입찰공고/계약)를 각각 수집하며, 한 단계가 실패해도
  나머지는 계속 진행한다(fail-safe).
- 결과는 사람 검수 전 EARLY_SIGNAL 이며, 이것만으로 사업 확정·수임가능 판정을
  하지 않는다. 모니터링 시트 편입 행의 상태는 '확인 필요'로 고정된다.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from dataclasses import asdict
from pathlib import Path

from .core import PublicDataProvider, load_env_file, utc_now_iso
from .g2b import G2BClient, G2BStage, to_monitoring_rows


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="나라장터 EARLY_SIGNAL 수집(사람 검수 전제)")
    parser.add_argument("--begin", required=True, help="조회 시작 YYYYMMDDHHMM")
    parser.add_argument("--end", required=True, help="조회 종료 YYYYMMDDHHMM")
    parser.add_argument("--stages", default="ORDER_PLAN,PRE_SPEC,BID_NOTICE,CONTRACT")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--project-id", default=None)
    args = parser.parse_args(argv)

    load_env_file()
    provider = PublicDataProvider()
    if not provider.configured:
        print("ERROR: PUBLIC_DATA_API_KEY 가 설정되지 않았습니다.", file=sys.stderr)
        return 1

    client = G2BClient(provider)
    all_signals = []
    failures: list[str] = []
    for stage_name in [s.strip() for s in args.stages.split(",") if s.strip()]:
        try:
            stage = G2BStage(stage_name)
        except ValueError:
            failures.append(f"{stage_name}: UNKNOWN_STAGE")
            continue
        result = client.signals(stage, inqry_bgn_dt=args.begin, inqry_end_dt=args.end, project_id=args.project_id)
        if result.ok:
            all_signals.extend(result.records)
        else:
            failures.append(f"{stage.value}: {result.error_code}")

    output_dir = args.output_dir / "local_only"
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / "early_signals.json"
    csv_path = output_dir / "early_signals_monitoring.csv"

    json_path.write_text(
        json.dumps(
            {
                "schema_version": "public-data/early-signal/0.1",
                "generated_at": utc_now_iso(),
                "safety_boundary": "EARLY_SIGNAL 은 사람 검수 전 후보이며 사업 확정·수임가능 판정이 아닙니다.",
                "total": len(all_signals),
                "signals": [asdict(signal) for signal in all_signals],
            },
            ensure_ascii=False,
            indent=2,
            default=str,
        )
        + "\n",
        encoding="utf-8",
    )

    rows = to_monitoring_rows(all_signals)
    columns = ["구분", "단계", "공고명", "발주기관", "지역", "일자", "일치키워드", "연결키", "상세URL", "상태", "검수"]
    with csv_path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=columns, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)

    print(
        json.dumps(
            {
                "status": "PARTIAL" if failures else "DONE_REVIEW_REQUIRED",
                "signals": len(all_signals),
                "failures": failures,
                "outputs": [str(json_path), str(csv_path)],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
