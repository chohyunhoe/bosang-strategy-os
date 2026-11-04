"""현장후보 수집 CLI (로컬 전용 출력).

사용 예:
    python -m public_data.run_field_candidates \
        --sigungu-cd 11680 \
        --sigungu "강남구" \
        --boundary boundary.json \
        --output-dir output/public_data

상가정보 API 는 법정동코드 조회를 지원하지 않으므로(실호출 확인) 시군구 단위로
수집한 뒤 사업지구 경계 폴리곤·좌표로 필터링한다.

- 인증키는 .env 의 PUBLIC_DATA_API_KEY 또는 셸 환경변수에서만 읽는다.
- 출력은 항상 <output-dir>/local_only/ 아래에 쓴다(gitignore: **/local_only/).
- 어떤 API 가 실패해도 나머지 소스는 계속 수집한다(fail-safe, PARTIAL 보고).
- boundary.json: {"ring": [[lon, lat], ...]} (EPSG:4326, 선택).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .candidates import build_field_candidates, write_candidate_outputs
from .core import PublicDataProvider, load_env_file
from .factoryon import FactoryOnClient
from .stores import StoreInfoClient


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="공공데이터 기반 현장후보표 생성(검토 보조)")
    parser.add_argument("--sigungu-cd", action="append", default=[], help="시군구코드 5자리(복수 지정 가능)")
    parser.add_argument("--adong-cd", action="append", default=[], help="행정동코드(복수 지정 가능, 선택)")
    parser.add_argument("--company", action="append", default=[],
                        help="FactoryOn 필지정보 조회용 회사명(복수 지정 가능). "
                             "FactoryOn 은 지역 전체조회를 제공하지 않는다.")
    parser.add_argument("--boundary", type=Path, default=None, help='{"ring": [[lon,lat],...]} JSON')
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--project-id", default=None)
    parser.add_argument("--max-pages", type=int, default=5)
    args = parser.parse_args(argv)

    load_env_file()
    provider = PublicDataProvider()
    if not provider.configured:
        print("ERROR: PUBLIC_DATA_API_KEY 가 설정되지 않았습니다. .env 또는 환경변수를 확인하세요.", file=sys.stderr)
        return 1

    boundary_ring = None
    if args.boundary:
        data = json.loads(args.boundary.read_text(encoding="utf-8"))
        boundary_ring = [tuple(point) for point in data.get("ring", [])] or None

    stores_client = StoreInfoClient(provider)
    factory_client = FactoryOnClient(provider)

    failures: list[str] = []
    stores = []
    stores_meta = None
    store_queries = [("signgu", code) for code in args.sigungu_cd] + [("adong", code) for code in args.adong_cd]
    for kind, code in store_queries:
        for page in range(1, args.max_pages + 1):
            if kind == "signgu":
                result = stores_client.stores_in_sigungu(code, page=page, project_id=args.project_id)
            else:
                result = stores_client.stores_in_admin_dong(code, page=page, project_id=args.project_id)
            if not result.ok:
                failures.append(f"STORE {kind}={code} p{page}: {result.error_code}")
                break
            stores.extend(result.records)
            stores_meta = result.meta
            if result.status != "PARTIAL":
                break
        else:
            # max_pages 로 끊긴 경우 — 조용한 절단 금지, 명시적으로 남긴다.
            failures.append(f"STORE {kind}={code}: MAX_PAGES_REACHED(p{args.max_pages}) 잔여분 미수집")

    # FactoryOn 은 회사명 필수의 단건 조회다(공식 명세). 사업지구 전체를 훑는
    # 용도가 아니라, 이미 확보한 회사명을 필지정보로 보강하는 용도로만 쓴다.
    factories, factories_meta = [], None
    parcels, parcels_meta = [], None
    for company in args.company:
        lot = factory_client.parcels_by_company(company, project_id=args.project_id)
        if lot.ok:
            parcels.extend(lot.records)
            parcels_meta = lot.meta
        else:
            failures.append(f"FACTORY_PARCEL {company}: {lot.error_code}")

    candidates = build_field_candidates(
        stores=stores,
        factories=factories,
        factory_parcels=parcels,
        boundary_ring=boundary_ring,
        stores_meta=stores_meta,
        factories_meta=factories_meta,
        parcels_meta=parcels_meta,
        project_id=args.project_id,
    )
    output_dir = args.output_dir / "local_only"
    json_path, csv_path = write_candidate_outputs(output_dir, candidates)

    summary = {
        "status": "PARTIAL" if failures else "DONE_REVIEW_REQUIRED",
        "candidates": len(candidates),
        "failures": failures,
        "outputs": [str(json_path), str(csv_path)],
        "note": "실패한 소스는 기존 수동 워크플로우로 보강하세요. 후보는 전 건 사람 검수 대상입니다.",
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
