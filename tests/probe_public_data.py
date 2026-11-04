"""공공데이터포털 endpoint·파라미터 진단 프로브 (테스트 아님, 수동 실행 전용).

    python -m tests.probe_public_data

목적: 미검증 endpoint 와 파라미터 조합을 한 번에 실호출해 실제 사유코드를
출력한다. 자동 테스트가 아니므로 파일명이 test_ 로 시작하지 않는다(디스커버리 제외).

원칙:
- 인증키는 어떤 줄에도 출력하지 않는다.
- 응답 원문을 파일로 저장하지 않는다(개인정보 유입 방지).
- 결과는 사람이 판별할 근거일 뿐, 이 출력만으로 endpoint 를 확정하지 않는다.
"""

from __future__ import annotations

import os
import re
import sys

from public_data.core import (
    ENV_PUBLIC_DATA_API_KEY,
    ProviderError,
    PublicDataProvider,
    load_env_file,
)
from public_data.factoryon import FACTORY_PARCEL_ENDPOINT
from public_data.g2b import G2B_ENDPOINT_CANDIDATES
from public_data.stores import STORE_BASE

BUILDING_BASE = "https://apis.data.go.kr/1613000/BldRgstHubService"
RTMS_LAND = "https://apis.data.go.kr/1613000/RTMSDataSvcLandTrade/getRTMSDataSvcLandTrade"

# 표본 입력값(사건과 무관). 정확성 미검증 — 연결성·파라미터 판별 용도로만 쓴다.
SAMPLE_SIGUNGU_CD = "11680"        # 서울 강남구
SAMPLE_ADONG_CD = "1168064000"     # 서울 강남구 삼성1동(행정동) 표본
SAMPLE_LDONG_CD = "1168010500"     # 서울 강남구 삼성동(법정동) 표본
SAMPLE_PNU = "1168010500108120002"  # 지번단위 조회 표본
# FactoryOn 필지정보는 cmpnyNm 이 필수다. 사건과 무관한 공개 법인명을 표본으로 쓴다.
SAMPLE_COMPANY_NM = "삼성전자"


def summarize(text: str, limit: int = 160) -> str:
    """응답에서 판별에 필요한 코드/메시지만 뽑는다(원문 저장·전량 출력 안 함)."""
    result_code = re.search(r"[\"<]result(?:Code|Cd)[\">:]+\s*\"?([A-Za-z0-9_.-]+)", text)
    result_msg = re.search(r"[\"<]result(?:Msg|Message)[\">:]+\s*\"?([^\"<,}]+)", text)
    total = re.search(r"[\"<]totalCount[\">:]+\s*\"?(\d+)", text)
    reason = re.search(r"<returnReasonCode>([^<]+)</returnReasonCode>", text)
    parts = []
    if result_code:
        parts.append(f"resultCode={result_code.group(1)}")
    if reason:
        parts.append(f"returnReasonCode={reason.group(1)}")
    if result_msg:
        parts.append(f"msg={result_msg.group(1).strip()[:60]}")
    if total:
        parts.append(f"totalCount={total.group(1)}")
    if not parts:
        parts.append(f"body[:{limit}]={' '.join(text.split())[:limit]}")
    return " | ".join(parts)


def probe(provider: PublicDataProvider, label: str, endpoint: str, params: dict) -> None:
    try:
        text = provider.get_text(endpoint, params)
    except ProviderError as exc:
        print(f"  {label:<44} ERROR {exc.code} :: {exc}")
        return
    except Exception as exc:  # noqa: BLE001
        print(f"  {label:<44} ERROR UNEXPECTED :: {provider.redact(exc)}")
        return
    print(f"  {label:<44} {summarize(text)}")


def main() -> int:
    load_env_file()
    if not (os.getenv(ENV_PUBLIC_DATA_API_KEY) or os.getenv("PUBLIC_DATA_SERVICE_KEY")):
        print(f"ERROR: {ENV_PUBLIC_DATA_API_KEY} 미설정 — .env 를 확인하세요.", file=sys.stderr)
        return 1
    provider = PublicDataProvider(timeout=20.0)
    print(f"key_form={provider.key_form} (키 값은 출력하지 않음)\n")

    print("[1] 상가(상권)정보 — 조회 경로별 확인 (XML 전용, type 파라미터 없음)")
    probe(provider, "storeListInDong divId=signguCd", f"{STORE_BASE}/storeListInDong",
          {"divId": "signguCd", "key": SAMPLE_SIGUNGU_CD, "numOfRows": 5, "pageNo": 1})
    probe(provider, "storeListInPnu", f"{STORE_BASE}/storeListInPnu",
          {"key": SAMPLE_PNU, "numOfRows": 5, "pageNo": 1})
    probe(provider, "storeListInRadius", f"{STORE_BASE}/storeListInRadius",
          {"radius": 500, "cx": 127.0276, "cy": 37.4979, "numOfRows": 5, "pageNo": 1})
    probe(provider, "storeListInPolygon", f"{STORE_BASE}/storeListInPolygon",
          {"key": "POLYGON((127.02 37.49,127.03 37.49,127.03 37.50,127.02 37.50,127.02 37.49))",
           "numOfRows": 5, "pageNo": 1})

    print("\n[2] 나라장터 발주계획 — 서비스 경로 prefix 변형 (400 본문으로 원인 확인)")
    order_params = {"inqryDiv": "1", "inqryBgnDate": "20260801", "inqryEndDate": "20260802",
                    "numOfRows": 5, "pageNo": 1, "type": "json"}
    for prefix in ("ao", "ad", "at", ""):
        seg = f"{prefix}/" if prefix else ""
        probe(provider, f"/{seg}OrderPlanSttusService/getOrderPlanSttusList",
              f"https://apis.data.go.kr/1230000/{seg}OrderPlanSttusService/getOrderPlanSttusList",
              order_params)

    print("\n[3] 나라장터 계약 — 서비스 경로 prefix 변형")
    cntrct_params = dict(order_params)
    for prefix in ("at", "ao", "ad", ""):
        seg = f"{prefix}/" if prefix else ""
        probe(provider, f"/{seg}CntrctInfoService/getCntrctInfoListServcPPSSrch",
              f"https://apis.data.go.kr/1230000/{seg}CntrctInfoService/getCntrctInfoListServcPPSSrch",
              cntrct_params)

    print("\n[3b] 나라장터 — 작동 중인 입찰공고에 계약/발주 오퍼레이션 존재 여부")
    probe(provider, "BidPublicInfoService/getBidPblancListInfoCnstwkPPSSrch",
          "https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoCnstwkPPSSrch",
          {"inqryDiv": "1", "inqryBgnDt": "202608010000", "inqryEndDt": "202608022359",
           "numOfRows": 5, "pageNo": 1, "type": "json"})

    print("\n[4] FactoryOn — 공식 명세 기반 단일 프로브 (추측 매트릭스 금지)")
    parcel_endpoint = os.getenv("PUBLIC_DATA_FACTORYON_PARCEL_ENDPOINT") or FACTORY_PARCEL_ENDPOINT
    probe(provider, f"필지정보 cmpnyNm={SAMPLE_COMPANY_NM}", parcel_endpoint,
          {"cmpnyNm": SAMPLE_COMPANY_NM, "numOfRows": 5, "pageNo": 1})
    print("  * 생산정보는 공식 활용명세(요청주소+필수 파라미터) 확보 전까지 프로브하지 않습니다.")

    print("\n[5] 실거래가 3종 — 활용신청 승인 여부 재확인")
    for label, endpoint in (
        ("토지", "https://apis.data.go.kr/1613000/RTMSDataSvcLandTrade/getRTMSDataSvcLandTrade"),
        ("공장·창고 등", "https://apis.data.go.kr/1613000/RTMSDataSvcInduTrade/getRTMSDataSvcInduTrade"),
        ("상업업무용", "https://apis.data.go.kr/1613000/RTMSDataSvcNrgTrade/getRTMSDataSvcNrgTrade"),
    ):
        probe(provider, f"실거래가 {label}", endpoint,
              {"LAWD_CD": SAMPLE_SIGUNGU_CD, "DEAL_YMD": "202506", "numOfRows": 5, "pageNo": 1})

    print("\n판별 기준: resultCode=00/000 정상 / 03 결과없음 / 10 파라미터오류 / "
          "HTTP 400 필수파라미터·경로 오류 / returnReasonCode=30 서비스키 미등록")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
