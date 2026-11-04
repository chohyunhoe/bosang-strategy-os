"""공공데이터포털 실호출 integration test (진단 리포트 겸용).

PUBLIC_DATA_API_KEY 가 런타임 환경(.env 포함)에 있을 때만 실행되고,
없으면 전체가 명확하게 SKIP 된다.

    python -m unittest tests.test_public_data_integration -v

이 테스트는 '정상 응답'을 강제하지 않는다. 활용신청 승인 대기·트래픽 제한 등은
분류된 오류코드로 fail-safe 동작을 확인하고 넘어간다. 대신 데이터셋별
[PUBLIC-DATA] 진단 줄을 출력해 무엇이 되고 무엇이 막혔는지 사람이 판별할 수
있게 한다(인증키는 어떤 줄에도 출력되지 않는다).

주의:
- 응답 원문을 fixture 로 커밋하지 않는다(개인정보·인증정보 유입 방지).
- 지역 코드는 특정 사건과 무관한 광역 단위 표본만 사용한다.
"""

from __future__ import annotations

import os
import unittest

from public_data.core import ENV_PUBLIC_DATA_API_KEY, PublicDataProvider, load_env_file
from public_data.factoryon import FactoryOnClient
from public_data.building import BuildingLedgerClient, BuildingLedgerOp
from public_data.g2b import G2BClient, G2BStage
from public_data.legal_dong import LegalDongCodeClient
from public_data.rtms import RtmsTradeClient, RtmsTradeType
from public_data.stores import StoreInfoClient

load_env_file()  # .env 가 있으면 로드(값은 출력하지 않음)
HAS_KEY = bool(os.getenv(ENV_PUBLIC_DATA_API_KEY) or os.getenv("PUBLIC_DATA_SERVICE_KEY"))

# 실패로 간주하지 않는 '분류된' 오류코드 — 활용신청 승인 전/트래픽 제한/경로 미확정 등.
TOLERATED_ERROR_CODES = {
    "SERVICE_ACCESS_DENIED",
    "RATE_LIMIT_EXCEEDED",
    "SERVICE_KEY_UNREGISTERED",
    "SERVICE_KEY_EXPIRED",
    "NO_OPENAPI_SERVICE",
    "UNREGISTERED_DOMAIN_OR_IP",
    "APPLICATION_ERROR",
    "HTTP_ERROR",
    "PUBLIC_DATA_SERVICE_ERROR",
    "PUBLIC_DATA_HTTP_ERROR",
    "PUBLIC_DATA_BAD_REQUEST",
    "PUBLIC_DATA_TRANSPORT_ERROR",
    "PUBLIC_DATA_RESPONSE_ERROR",
    "MOIS_STAN_REGIN_CD_API_ERROR",
    "MOIS_STAN_REGIN_CD_SCHEMA_CHANGED",
    "RTMS_API_ERROR",
    "RTMS_RESPONSE_ERROR",
}
TOLERATED_ERROR_CODES |= {f"G2B_{stage.value}_API_ERROR" for stage in G2BStage}
TOLERATED_ERROR_CODES |= {f"G2B_{stage.value}_SCHEMA_CHANGED" for stage in G2BStage}
TOLERATED_ERROR_CODES |= {"MOLIT_BLD_RGST_HUB_API_ERROR", "MOLIT_BLD_RGST_HUB_SCHEMA_CHANGED"}
TOLERATED_ERROR_CODES |= {"KICOX_FACTORY_PARCEL_API_ERROR", "KICOX_FACTORY_PARCEL_SCHEMA_CHANGED",
                          "FACTORYON_REGION_QUERY_UNSUPPORTED"}
TOLERATED_ERROR_CODES |= {"SEMAS_STORE_INFO_API_ERROR", "SEMAS_STORE_INFO_SCHEMA_CHANGED",
                          "SEMAS_STORE_INFO_RESPONSE_ERROR", "STORE_LEGAL_DONG_UNSUPPORTED"}

# 사건과 무관한 광역 표본. LAWD_CD 는 시군구 5자리.
SAMPLE_LAWD_CD = "36110"          # 세종특별자치시
SAMPLE_DEAL_YMD = "202506"
SAMPLE_ADDR = "세종특별자치시"

# 연결성·인증 확인용 표본 법정동코드. 정확성 미검증 값이며, 결과가 0건이어도
# 실패로 보지 않는다(이 테스트의 목적은 '호출이 되는가'를 구분하는 것).
SAMPLE_LEGAL_DONG_CD_UNVERIFIED = "3611010200"

# FactoryOn 필지정보는 cmpnyNm 이 필수다. 사건과 무관한 공개 법인명을 표본으로 쓴다.
SAMPLE_COMPANY_NM = "삼성전자"


def _key():
    return os.getenv(ENV_PUBLIC_DATA_API_KEY) or os.getenv("PUBLIC_DATA_SERVICE_KEY") or ""


def key_not_in(text: str | None) -> bool:
    key = _key()
    return not key or key not in (text or "")


def report(dataset: str, result) -> None:
    """인증키를 제외한 진단 한 줄. -v 실행 시 사람이 바로 판별할 수 있게 한다."""
    if result.ok:
        print(f"[PUBLIC-DATA] {dataset:<22} OK      records={len(result.records)} status={result.status}")
    else:
        print(f"[PUBLIC-DATA] {dataset:<22} BLOCKED {result.error_code} :: {result.error_message}")


@unittest.skipUnless(HAS_KEY, "PUBLIC_DATA_API_KEY 미설정: integration test SKIP")
class PublicDataIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.provider = PublicDataProvider(timeout=15.0)
        print(f"\n[PUBLIC-DATA] key_form={cls.provider.key_form} (키 값은 출력하지 않음)")

    def _assert_result(self, dataset: str, result):
        report(dataset, result)
        # 어떤 경우에도 키가 오류 메시지에 남으면 안 된다.
        self.assertTrue(key_not_in(result.error_message), f"{dataset}: 오류 메시지에 인증키가 노출됨")
        if result.ok:
            self.assertIsNotNone(result.meta)
            self.assertTrue(result.meta.review_required)
            self.assertTrue(result.meta.retrieved_at)
            return
        self.assertIn(
            result.error_code,
            TOLERATED_ERROR_CODES,
            f"{dataset}: 분류되지 않은 오류코드 — fail-safe 분류를 보완해야 함",
        )

    def test_legal_dong_code_lookup(self):
        result = LegalDongCodeClient(self.provider).search(SAMPLE_ADDR)
        self._assert_result("법정동코드", result)
        if result.ok and result.records:
            self.assertEqual(len(result.records[0].region_cd), 10)

    def test_building_ledger_basis(self):
        """법정동코드 API 가 막혀도 건축HUB 자체 연결성은 확인한다."""
        dong = LegalDongCodeClient(self.provider).search("세종특별자치시 어진동")
        if dong.ok and dong.records:
            region = dong.records[0].region_cd
            source = "법정동코드 API"
        else:
            region = SAMPLE_LEGAL_DONG_CD_UNVERIFIED
            source = "표본값(미검증)"
        pnu = f"{region}1" + "0001" + "0000"
        print(f"[PUBLIC-DATA] 건축HUB 입력 법정동코드 출처: {source}")
        result = BuildingLedgerClient(self.provider).fetch(BuildingLedgerOp.BASIS, pnu)
        self._assert_result("건축HUB(기본개요)", result)

    def test_store_info_in_sigungu(self):
        """상가정보는 법정동코드를 지원하지 않는다 — 시군구 단위로 조회한다."""
        result = StoreInfoClient(self.provider, page_size=10).stores_in_sigungu(SAMPLE_LAWD_CD)
        self._assert_result("상가(상권)정보", result)

    def test_store_info_rejects_legal_dong_without_calling_api(self):
        result = StoreInfoClient(self.provider).stores_in_legal_dong(SAMPLE_LEGAL_DONG_CD_UNVERIFIED)
        self.assertFalse(result.ok)
        self.assertEqual(result.error_code, "STORE_LEGAL_DONG_UNSUPPORTED")

    def test_rtms_land_trade_candidates(self):
        result = RtmsTradeClient(self.provider, page_size=10).trade_candidates(
            RtmsTradeType.LAND, lawd_cd=SAMPLE_LAWD_CD, deal_ymd=SAMPLE_DEAL_YMD
        )
        self._assert_result("실거래가(토지)", result)
        for record in result.records:
            self.assertTrue(record.review_required)

    def test_factoryon_parcel_by_company(self):
        """FactoryOn 필지정보는 회사명 필수 단건 조회다(지역 전체조회 아님)."""
        result = FactoryOnClient(self.provider, page_size=5).parcels_by_company(SAMPLE_COMPANY_NM)
        self._assert_result("FactoryOn 필지정보", result)

    def test_factoryon_region_query_never_calls_api(self):
        result = FactoryOnClient(self.provider).parcels_by_region("테스트시")
        self.assertFalse(result.ok)
        self.assertEqual(result.error_code, "FACTORYON_REGION_QUERY_UNSUPPORTED")

    def test_g2b_bid_notice_signals(self):
        result = G2BClient(self.provider, page_size=10).signals(
            G2BStage.BID_NOTICE,
            inqry_bgn_dt="202608010000",
            inqry_end_dt="202608022359",
            keyword_filter=False,  # 연결성 확인이 목적이므로 필터 없이 원건수를 본다
        )
        self._assert_result("나라장터(입찰공고)", result)


if __name__ == "__main__":
    unittest.main(verbosity=2)
