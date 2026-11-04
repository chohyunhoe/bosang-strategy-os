from __future__ import annotations

import io
import json
import os
import urllib.error
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from public_data.building import (
    BuildingLedgerClient,
    BuildingLedgerOp,
    BuildingRecord,
    CrosscheckState,
    crosscheck_building,
    normalize_building_item,
    pnu_to_ledger_params,
)
from public_data.candidates import (
    build_field_candidates,
    normalize_address,
    point_in_polygon,
    write_candidate_outputs,
)
from public_data.core import (
    ENV_PUBLIC_DATA_API_KEY,
    FetchResult,
    ProviderError,
    PublicDataProvider,
    SourceMeta,
    classify_http_error,
    load_env_file,
    normalize_service_key,
    parse_standard_body,
    redact_secrets,
)
from public_data.factoryon import (
    FactoryOnClient,
    normalize_parcel_item,
    parse_lot_number,
)
from public_data.g2b import (
    G2BClient,
    G2BStage,
    classify_keywords,
    normalize_g2b_item,
    to_monitoring_rows,
)
from public_data.legal_dong import (
    LegalDongCodeClient,
    build_pnu,
    parse_stan_regin_payload,
)
from public_data.rtms import RtmsTradeClient, RtmsTradeType, parse_rtms_xml
from public_data.stores import StoreInfoClient, normalize_store_item


FAKE_KEY = "TEST-ONLY-FAKE-KEY-abc123=="
SYNTHETIC_PNU = "9999912345112340001"
SYNTHETIC_REGION = "9999912345"


def env_with_key(**extra):
    values = {ENV_PUBLIC_DATA_API_KEY: FAKE_KEY}
    values.update(extra)
    return patch.dict(os.environ, values, clear=False)


def env_without_key():
    cleaned = {k: v for k, v in os.environ.items()
               if k not in (ENV_PUBLIC_DATA_API_KEY, "PUBLIC_DATA_SERVICE_KEY")}
    return patch.dict(os.environ, cleaned, clear=True)


def json_transport(payload):
    def transport(url, timeout):
        return json.dumps(payload, ensure_ascii=False)
    return transport


def text_transport(text):
    def transport(url, timeout):
        return text
    return transport


def failing_transport(url, timeout):
    raise ConnectionError(f"boom url={url}")


class CoreProviderTests(unittest.TestCase):
    def test_env_missing_key_marks_unconfigured_and_fails_safe(self):
        with env_without_key():
            provider = PublicDataProvider()
            self.assertFalse(provider.configured)
            with self.assertRaises(ProviderError) as ctx:
                provider.require_key()
            self.assertEqual(ctx.exception.code, "PUBLIC_DATA_KEY_MISSING")
            client = LegalDongCodeClient(provider)
            result = client.search("강남구 대치동")
            self.assertFalse(result.ok)
            self.assertEqual(result.error_code, "PUBLIC_DATA_KEY_MISSING")
            self.assertEqual(result.status, "PARTIAL")

    def test_legacy_env_name_still_configures_provider(self):
        with env_without_key():
            with patch.dict(os.environ, {"PUBLIC_DATA_SERVICE_KEY": FAKE_KEY}):
                self.assertTrue(PublicDataProvider().configured)

    def test_repr_and_errors_never_contain_the_key(self):
        with env_with_key():
            provider = PublicDataProvider(transport=failing_transport)
            self.assertNotIn(FAKE_KEY, repr(provider))
            with self.assertRaises(ProviderError) as ctx:
                provider.get_text("https://example.invalid/api", {"a": "1"})
            self.assertEqual(ctx.exception.code, "PUBLIC_DATA_TRANSPORT_ERROR")
            self.assertNotIn(FAKE_KEY, str(ctx.exception))

    def test_redact_secrets_masks_key_and_service_key_params(self):
        raw = f"call failed serviceKey={FAKE_KEY}&x=1 and key=abc"
        masked = redact_secrets(raw, (FAKE_KEY,))
        self.assertNotIn(FAKE_KEY, masked)
        self.assertIn("serviceKey=[REDACTED]", masked)
        self.assertIn("key=[REDACTED]", masked)

    def test_data_go_kr_error_xml_is_classified(self):
        xml = (
            "<OpenAPI_ServiceResponse><cmmMsgHeader>"
            "<returnAuthMsg>SERVICE_ACCESS_DENIED_ERROR</returnAuthMsg>"
            "<returnReasonCode>20</returnReasonCode>"
            "</cmmMsgHeader></OpenAPI_ServiceResponse>"
        )
        with env_with_key():
            provider = PublicDataProvider(transport=text_transport(xml))
            with self.assertRaises(ProviderError) as ctx:
                provider.get_json("https://example.invalid/api", {})
            self.assertEqual(ctx.exception.code, "SERVICE_ACCESS_DENIED")

    def test_nodata_result_code_is_empty_not_error(self):
        # 상가정보 03 / 행안부 INFO-200 = 조회결과 없음 → 오류가 아니라 빈 결과
        for code in ("03", "INFO-200"):
            records, total = parse_standard_body(
                {"response": {"header": {"resultCode": code, "resultMsg": "NODATA"}, "body": {}}},
                dataset="X",
            )
            self.assertEqual((records, total), ([], 0))

    def test_parse_standard_body_rejects_error_and_missing_body(self):
        with self.assertRaises(ProviderError):
            parse_standard_body({"response": {"header": {"resultCode": "99", "resultMsg": "ERR"}}}, dataset="X")
        with self.assertRaises(ProviderError):
            parse_standard_body({"unexpected": True}, dataset="X")

    def test_load_env_file_reads_names_without_overriding(self):
        with tempfile.TemporaryDirectory() as tmp:
            env_path = Path(tmp) / ".env"
            env_path.write_text(
                "# comment\nPUBLIC_DATA_API_KEY=from-file\nOTHER_VALUE=1\n",
                encoding="utf-8",
            )
            with env_with_key():
                loaded = load_env_file(env_path)
                self.assertIn("OTHER_VALUE", loaded)
                self.assertNotIn(ENV_PUBLIC_DATA_API_KEY, loaded)  # 기존 환경변수 우선
                self.assertEqual(os.environ[ENV_PUBLIC_DATA_API_KEY], FAKE_KEY)

    def test_missing_env_file_is_not_an_error(self):
        self.assertEqual(load_env_file(Path("/nonexistent/.env")), [])


class LegalDongTests(unittest.TestCase):
    PAYLOAD = {
        "StanReginCd": [
            {"head": [{"totalCount": 2}, {"RESULT": {"resultCode": "INFO-0", "resultMsg": "NORMAL SERVICE"}}]},
            {
                "row": [
                    {"region_cd": SYNTHETIC_REGION, "locatadd_nm": "테스트도 테스트시 테스트동",
                     "sido_cd": "99", "sgg_cd": "999", "umd_cd": "123", "ri_cd": "45"},
                    {"region_cd": "9999912346", "locatadd_nm": "테스트도 테스트시 테스트2동"},
                ]
            },
        ]
    }

    def test_parse_and_normalize_rows(self):
        rows, total = parse_stan_regin_payload(self.PAYLOAD)
        self.assertEqual(total, 2)
        self.assertEqual(len(rows), 2)
        with env_with_key():
            client = LegalDongCodeClient(PublicDataProvider(transport=json_transport(self.PAYLOAD)))
            result = client.search("테스트동")
            self.assertTrue(result.ok)
            self.assertEqual(result.records[0].region_cd, SYNTHETIC_REGION)
            self.assertEqual(result.records[0].sigungu_cd5, "99999")
            self.assertEqual(result.records[0].bjdong_cd5, "12345")
            self.assertTrue(result.meta.review_required)
            self.assertEqual(result.meta.source_dataset, "MOIS_STAN_REGIN_CD")

    def test_empty_result_info_200_returns_ok_with_no_rows(self):
        payload = {"RESULT": {"resultCode": "INFO-200", "resultMsg": "해당하는 데이터가 없습니다."}}
        rows, total = parse_stan_regin_payload(payload)
        self.assertEqual((rows, total), ([], 0))
        with env_with_key():
            client = LegalDongCodeClient(PublicDataProvider(transport=json_transport(payload)))
            result = client.search("없는동네")
            self.assertTrue(result.ok)
            self.assertEqual(result.records, [])
            self.assertEqual(result.status, "REVIEW_REQUIRED")

    def test_schema_change_fails_closed(self):
        with env_with_key():
            client = LegalDongCodeClient(PublicDataProvider(transport=json_transport({"weird": 1})))
            result = client.search("테스트동")
            self.assertFalse(result.ok)
            self.assertIn("SCHEMA_CHANGED", result.error_code)

    def test_resolve_exact_requires_single_match(self):
        with env_with_key():
            client = LegalDongCodeClient(PublicDataProvider(transport=json_transport(self.PAYLOAD)))
            exact = client.resolve_exact("테스트도 테스트시 테스트동")
            self.assertTrue(exact.ok)
            self.assertEqual(len(exact.records), 1)
            missing = client.resolve_exact("테스트도 다른동")
            self.assertFalse(missing.ok)
            self.assertEqual(missing.error_code, "LEGAL_DONG_NOT_FOUND")

    def test_build_pnu(self):
        self.assertEqual(build_pnu(SYNTHETIC_REGION, mountain=False, bun=1234, ji=1), SYNTHETIC_PNU)
        self.assertEqual(build_pnu(SYNTHETIC_REGION, mountain=True, bun=3, ji=0), "9999912345200030000")
        with self.assertRaises(ProviderError):
            build_pnu("123", mountain=False, bun=1)
        with self.assertRaises(ProviderError):
            build_pnu(SYNTHETIC_REGION, mountain=False, bun=0)


class BuildingTests(unittest.TestCase):
    def test_pnu_to_ledger_params(self):
        params = pnu_to_ledger_params(SYNTHETIC_PNU)
        self.assertEqual(params, {"sigunguCd": "99999", "bjdongCd": "12345", "platGbCd": "0", "bun": "1234", "ji": "0001"})
        mountain = pnu_to_ledger_params("9999912345200030000")
        self.assertEqual(mountain["platGbCd"], "1")
        with self.assertRaises(ProviderError):
            pnu_to_ledger_params("123")
        with self.assertRaises(ProviderError):
            pnu_to_ledger_params("9999912345900030000")

    def _payload(self, items):
        return {"response": {"header": {"resultCode": "00", "resultMsg": "NORMAL SERVICE."},
                             "body": {"items": {"item": items}, "totalCount": len(items)}}}

    def test_fetch_title_normalizes_fields(self):
        item = {
            "mgmBldrgstPk": "99999-100001", "platPlc": "테스트시 테스트동 1234-1",
            "bldNm": "테스트공장", "mainPurpsCdNm": "공장", "totArea": "1234.56",
            "grndFlrCnt": "3", "ugrndFlrCnt": "1", "useAprDay": "20010101",
        }
        with env_with_key():
            client = BuildingLedgerClient(PublicDataProvider(transport=json_transport(self._payload([item]))))
            result = client.fetch(BuildingLedgerOp.TITLE, SYNTHETIC_PNU)
            self.assertTrue(result.ok)
            record = result.records[0]
            self.assertEqual(record.main_purps_nm, "공장")
            self.assertEqual(record.tot_area, 1234.56)
            self.assertEqual(record.grnd_flr_cnt, 3)
            self.assertEqual(result.meta.pnu, SYNTHETIC_PNU)
            self.assertTrue(result.meta.review_required)
            self.assertIsNotNone(record.raw_record_hash)

    def test_fetch_empty_items_is_ok_but_review_required(self):
        with env_with_key():
            client = BuildingLedgerClient(PublicDataProvider(transport=json_transport(self._payload([]))))
            result = client.fetch(BuildingLedgerOp.BASIS, SYNTHETIC_PNU)
            self.assertTrue(result.ok)
            self.assertEqual(result.records, [])
            self.assertEqual(result.status, "REVIEW_REQUIRED")

    def test_fetch_invalid_pnu_fails_safe(self):
        with env_with_key():
            client = BuildingLedgerClient(PublicDataProvider(transport=json_transport(self._payload([])) ))
            result = client.fetch(BuildingLedgerOp.TITLE, "not-a-pnu")
            self.assertFalse(result.ok)
            self.assertEqual(result.error_code, "PNU_INVALID")

    def test_crosscheck_flags_do_not_conclude(self):
        ledger = normalize_building_item(
            BuildingLedgerOp.TITLE,
            {"mainPurpsCdNm": "공장", "totArea": "1000.0", "grndFlrCnt": "2", "ugrndFlrCnt": ""},
        )
        flags = crosscheck_building(
            {"building_use": "창고시설", "total_floor_area_m2": 1000.0, "ground_floors": 2},
            ledger,
        )
        by_field = {flag.field: flag for flag in flags}
        self.assertEqual(by_field["building_use"].state, CrosscheckState.MISMATCH)
        self.assertEqual(by_field["total_floor_area_m2"].state, CrosscheckState.MATCH)
        self.assertEqual(by_field["ground_floors"].state, CrosscheckState.MATCH)
        self.assertEqual(by_field["underground_floors"].state, CrosscheckState.NOT_COMPARABLE)
        self.assertTrue(all(flag.review_required for flag in flags))


class StoreTests(unittest.TestCase):
    ITEM = {
        "bizesId": "S001", "bizesNm": "테스트주유소", "indsLclsCd": "D",
        "indsLclsNm": "소매", "indsMclsNm": "연료판매", "indsSclsNm": "주유소",
        "ksicCd": "G47712", "ksicNm": "차량용 주유소 운영업",
        "rdnmAdr": "테스트로 1", "lnoAdr": "테스트동 1234-1 (공장부지)",
        "lon": "126.7", "lat": "37.3", "ldongCd": SYNTHETIC_REGION + "00",
        "lnoCd": SYNTHETIC_PNU,
    }

    @staticmethod
    def _xml(items, total=None):
        """이 API 는 XML 전용이다(실호출 확인). 테스트도 XML 로 맞춘다."""
        rows = "".join(
            "<item>" + "".join(f"<{k}>{v}</{k}>" for k, v in item.items()) + "</item>"
            for item in items
        )
        count = total if total is not None else len(items)
        return (
            "<response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE</resultMsg></header>"
            f"<body><items>{rows}</items><totalCount>{count}</totalCount></body></response>"
        )

    def _payload(self, items, total=None):
        return self._xml(items, total)

    def test_normalize_and_pnu_candidate(self):
        record = normalize_store_item(self.ITEM)
        self.assertEqual(record.name, "테스트주유소")
        self.assertEqual(record.pnu_candidate, SYNTHETIC_PNU)
        self.assertEqual(record.lon, 126.7)
        self.assertEqual(record.ksic_cd, "G47712")

    def test_fetch_in_sigungu_and_pagination_flag(self):
        with env_with_key():
            provider = PublicDataProvider(transport=text_transport(self._payload([self.ITEM], total=9999)))
            client = StoreInfoClient(provider, page_size=500)
            result = client.stores_in_sigungu("99999")
            self.assertTrue(result.ok)
            self.assertEqual(result.records[0].name, "테스트주유소")
            self.assertEqual(result.status, "PARTIAL")  # 다음 페이지 존재
            self.assertEqual(result.meta.source_dataset, "SEMAS_STORE_INFO")

    def test_legal_dong_lookup_fails_closed_with_guidance(self):
        """법정동코드는 이 API 가 지원하지 않는다 — 조용히 잘못된 조회를 보내지 않는다."""
        with env_with_key():
            client = StoreInfoClient(PublicDataProvider(transport=text_transport(self._payload([]))))
            result = client.stores_in_legal_dong(SYNTHETIC_REGION)
            self.assertFalse(result.ok)
            self.assertEqual(result.error_code, "STORE_LEGAL_DONG_UNSUPPORTED")
            self.assertIn("stores_in_sigungu", result.error_message)

    def test_request_never_sends_type_json(self):
        """type=json 을 붙이면 이 API 응답이 깨진다(실호출 확인). 회귀 방지."""
        seen = {}

        def capture(url, timeout):
            seen["url"] = url
            return self._payload([])

        with env_with_key():
            StoreInfoClient(PublicDataProvider(transport=capture)).stores_in_sigungu("99999")
        self.assertNotIn("type=json", seen["url"])
        self.assertIn("divId=signguCd", seen["url"])

    def test_nodata_result_code_is_empty_result(self):
        nodata = "<response><header><resultCode>03</resultCode><resultMsg>NODATA_ERROR</resultMsg></header></response>"
        with env_with_key():
            client = StoreInfoClient(PublicDataProvider(transport=text_transport(nodata)))
            result = client.stores_in_admin_dong("1168064000")
            self.assertTrue(result.ok)
            self.assertEqual(result.records, [])
            self.assertEqual(result.status, "REVIEW_REQUIRED")

    def test_invalid_parameter_result_code_fails_safe(self):
        bad = "<response><header><resultCode>10</resultCode><resultMsg>INVALID_REQUEST_PARAMETER_ERROR</resultMsg></header></response>"
        with env_with_key():
            client = StoreInfoClient(PublicDataProvider(transport=text_transport(bad)))
            result = client.stores_in_admin_dong("badcode")
            self.assertFalse(result.ok)
            self.assertEqual(result.error_code, "SEMAS_STORE_INFO_API_ERROR")
            self.assertEqual(result.status, "PARTIAL")

    def test_invalid_pnu_query_fails_safe(self):
        with env_with_key():
            client = StoreInfoClient(PublicDataProvider(transport=text_transport(self._payload([]))))
            result = client.stores_in_pnu("nope")
            self.assertFalse(result.ok)
            self.assertEqual(result.error_code, "PNU_INVALID")

    def test_transport_failure_returns_partial_not_exception(self):
        with env_with_key():
            client = StoreInfoClient(PublicDataProvider(transport=failing_transport))
            result = client.stores_in_sigungu("99999")
            self.assertFalse(result.ok)
            self.assertEqual(result.status, "PARTIAL")
            self.assertNotIn(FAKE_KEY, result.error_message or "")


class FactoryOnTests(unittest.TestCase):
    def test_parse_lot_number(self):
        self.assertEqual(parse_lot_number("산 3-1"), (True, 3, 1))
        self.assertEqual(parse_lot_number("1234-1"), (False, 1234, 1))
        self.assertEqual(parse_lot_number("77"), (False, 77, 0))
        self.assertEqual(parse_lot_number("이상한값"), (None, None, None))
        self.assertEqual(parse_lot_number(None), (None, None, None))

    def test_parcel_normalization_builds_pnu_candidate(self):
        record = normalize_parcel_item({"cmpnyNm": "테스트산업", "ldongCd": SYNTHETIC_REGION, "lnbr": "1234-1"})
        self.assertEqual(record.pnu_candidate, SYNTHETIC_PNU)
        broken = normalize_parcel_item({"cmpnyNm": "테스트산업", "lnbr": "1234-1"})
        self.assertIsNone(broken.pnu_candidate)

    def test_parcels_by_company_sends_required_cmpny_nm(self):
        """공식 명세: 필지정보는 cmpnyNm 이 필수 파라미터다."""
        payload = {"response": {"header": {"resultCode": "00"}, "body": {"items": {"item": [
            {"cmpnyNm": "테스트산업", "ldongCd": SYNTHETIC_REGION, "lnbr": "1234-1"}]}, "totalCount": 1}}}
        seen = {}

        def capture(url, timeout):
            seen["url"] = url
            return json.dumps(payload, ensure_ascii=False)

        with env_with_key():
            result = FactoryOnClient(PublicDataProvider(transport=capture)).parcels_by_company(
                "테스트산업", factory_manage_no="F-001"
            )
        self.assertTrue(result.ok)
        self.assertEqual(result.records[0].pnu_candidate, SYNTHETIC_PNU)
        self.assertIn("cmpnyNm=", seen["url"])
        self.assertIn("fctryManageNo=F-001", seen["url"])
        self.assertIsNone(result.meta.confidence)  # 필지정보는 실호출 확인됨

    def test_company_name_is_required(self):
        with env_with_key():
            client = FactoryOnClient(PublicDataProvider(transport=failing_transport))
            for result in (client.parcels_by_company("  "), client.factories_by_company("")):
                self.assertFalse(result.ok)
                self.assertEqual(result.error_code, "FACTORYON_COMPANY_NAME_REQUIRED")

    def test_region_wide_query_is_unsupported_and_fails_closed(self):
        """FactoryOn 은 지역 전체조회를 제공하지 않는다 — 잘못된 조회를 보내지 않는다."""
        called = []

        def transport(url, timeout):
            called.append(url)
            return "{}"

        with env_with_key():
            client = FactoryOnClient(PublicDataProvider(transport=transport))
            for result in (client.parcels_by_region("테스트시"), client.factories_by_region("테스트시")):
                self.assertFalse(result.ok)
                self.assertEqual(result.error_code, "FACTORYON_REGION_QUERY_UNSUPPORTED")
                self.assertIn("상가정보", result.error_message)
        self.assertEqual(called, [], "미지원 조회는 실제 API 를 호출하면 안 된다")

    def test_fetch_failure_is_fail_safe(self):
        with env_with_key():
            client = FactoryOnClient(PublicDataProvider(transport=failing_transport))
            result = client.parcels_by_company("테스트산업")
            self.assertFalse(result.ok)
            self.assertEqual(result.status, "PARTIAL")


class RtmsTests(unittest.TestCase):
    XML = (
        "<response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>"
        "<body><items>"
        "<item><sggCd>99999</sggCd><umdNm>테스트동</umdNm><dealYear>2026</dealYear>"
        "<dealMonth>7</dealMonth><dealDay>15</dealDay><dealAmount>  150,000 </dealAmount>"
        "<dealArea>500.0</dealArea><jimok>장</jimok><landUse>계획관리</landUse></item>"
        "</items><totalCount>1</totalCount></body></response>"
    )

    def test_parse_and_unit_price_is_assistive_only(self):
        records, total = parse_rtms_xml(RtmsTradeType.LAND, self.XML)
        self.assertEqual(total, 1)
        record = records[0]
        self.assertEqual(record.contract_date, "2026-07-15")
        self.assertEqual(record.deal_amount_won, 1_500_000_000)
        self.assertAlmostEqual(record.unit_price_won_m2, 3_000_000.0)
        self.assertIn("확정값 아님", record.unit_price_basis)
        self.assertTrue(record.review_required)

    def test_error_result_code_raises_provider_error(self):
        xml = "<response><header><resultCode>22</resultCode><resultMsg>LIMITED</resultMsg></header></response>"
        with self.assertRaises(ProviderError):
            parse_rtms_xml(RtmsTradeType.LAND, xml)

    def test_client_validates_inputs_and_fails_safe(self):
        with env_with_key():
            client = RtmsTradeClient(PublicDataProvider(transport=text_transport(self.XML)))
            bad_region = client.trade_candidates(RtmsTradeType.LAND, lawd_cd="1", deal_ymd="202607")
            self.assertFalse(bad_region.ok)
            bad_month = client.trade_candidates(RtmsTradeType.LAND, lawd_cd="99999", deal_ymd="2026-07")
            self.assertFalse(bad_month.ok)
            ok = client.trade_candidates(RtmsTradeType.LAND, lawd_cd="99999", deal_ymd="202607")
            self.assertTrue(ok.ok)
            self.assertTrue(ok.meta.review_required)
            self.assertEqual(ok.meta.effective_date, "202607")

    def test_no_auto_selection_marker_everywhere(self):
        records, _ = parse_rtms_xml(RtmsTradeType.LAND, self.XML)
        self.assertTrue(all(record.review_required for record in records))


class G2BTests(unittest.TestCase):
    ITEM = {
        "bidNtceNo": "20260800001", "bidNtceOrd": "00",
        "bidNtceNm": "OO지구 공공주택사업 지장물 기본조사 용역",
        "dminsttNm": "테스트공사", "bidNtceDt": "2026-08-10 10:00",
        "bidNtceDtlUrl": "https://example.invalid/notice/1",
    }

    def _payload(self, items):
        return {"response": {"header": {"resultCode": "00"}, "body": {"items": items, "totalCount": len(items)}}}

    def test_classify_keywords(self):
        self.assertEqual(classify_keywords("OO 손실보상 및 감정평가 용역"), ["보상", "손실보상", "감정평가"])
        self.assertEqual(classify_keywords("무관한 공고"), [])

    def test_normalize_keeps_link_keys_and_review_state(self):
        signal = normalize_g2b_item(G2BStage.BID_NOTICE, self.ITEM)
        self.assertEqual(signal.signal_type, "EARLY_SIGNAL")
        self.assertEqual(signal.link_keys["bidNtceNo"], "20260800001")
        self.assertIn("지장물", signal.matched_keywords)
        self.assertTrue(signal.review_required)
        self.assertEqual(signal.human_review_state, "PENDING_HUMAN_REVIEW")

    def test_signals_keyword_filter_and_fail_safe(self):
        with env_with_key():
            client = G2BClient(PublicDataProvider(transport=json_transport(self._payload([self.ITEM, {"bidNtceNm": "무관 공고", "bidNtceNo": "X"}]))))
            result = client.signals(G2BStage.BID_NOTICE, inqry_bgn_dt="202608010000", inqry_end_dt="202608312359")
            self.assertTrue(result.ok)
            self.assertEqual(len(result.records), 1)
            self.assertIsNone(result.meta.confidence)  # BID_NOTICE 는 실호출 확인됨

            failing = G2BClient(PublicDataProvider(transport=failing_transport))
            failure = failing.signals(G2BStage.CONTRACT, inqry_bgn_dt="202608010000", inqry_end_dt="202608312359")
            self.assertFalse(failure.ok)
            self.assertEqual(failure.status, "PARTIAL")

    def test_verified_stage_drops_unverified_confidence(self):
        with env_with_key():
            client = G2BClient(PublicDataProvider(transport=json_transport(self._payload([self.ITEM]))))
            verified = client.signals(G2BStage.BID_NOTICE, inqry_bgn_dt="202608010000", inqry_end_dt="202608312359")
            self.assertIsNone(verified.meta.confidence)  # 실호출 확인된 단계
            unverified = client.signals(G2BStage.ORDER_PLAN, inqry_bgn_dt="202608010000", inqry_end_dt="202608312359", keyword_filter=False)
            self.assertEqual(unverified.meta.confidence, "ENDPOINT_UNVERIFIED")

    def test_contract_endpoint_uses_confirmed_ao_prefix(self):
        """at/ad/무접두는 서비스 부재(12), ao 만 실재 경로(30). 회귀 방지."""
        from public_data.g2b import G2B_ENDPOINT_CANDIDATES, PENDING_SUBSCRIPTION_STAGES

        self.assertIn("/1230000/ao/CntrctInfoService/", G2B_ENDPOINT_CANDIDATES["CONTRACT"])
        self.assertIn("CONTRACT", PENDING_SUBSCRIPTION_STAGES)

    def test_monitoring_rows_never_auto_confirm(self):
        signal = normalize_g2b_item(G2BStage.ORDER_PLAN, {"orderPlanPrdctNm": "도로 보상업무 위탁", "orderPlanUntyNo": "OP1"})
        rows = to_monitoring_rows([signal])
        self.assertEqual(rows[0]["상태"], "확인 필요")
        self.assertEqual(rows[0]["검수"], "사람 검수 대기")
        self.assertIn("orderPlanUntyNo=OP1", rows[0]["연결키"])


class CandidateTests(unittest.TestCase):
    def test_point_in_polygon(self):
        ring = [(0.0, 0.0), (0.0, 1.0), (1.0, 1.0), (1.0, 0.0)]
        self.assertTrue(point_in_polygon(0.5, 0.5, ring))
        self.assertFalse(point_in_polygon(1.5, 0.5, ring))
        self.assertFalse(point_in_polygon(0.5, 0.5, ring[:2]))

    def test_normalize_address(self):
        self.assertEqual(normalize_address("테스트동  1234-1 (공장부지)"), "테스트동 1234-1")
        self.assertEqual(normalize_address(None), "")

    def test_build_candidates_marks_boundary_and_review(self):
        store_in = normalize_store_item(StoreTests.ITEM)
        store_out = normalize_store_item({**StoreTests.ITEM, "bizesId": "S002", "lon": "10.0", "lat": "10.0"})
        parcel = normalize_parcel_item({"cmpnyNm": "테스트산업", "ldongCd": SYNTHETIC_REGION, "lnbr": "1234-1"})
        ring = [(126.6, 37.2), (126.6, 37.4), (126.8, 37.4), (126.8, 37.2)]
        meta = SourceMeta(source_dataset="SEMAS_STORE_INFO", source_provider="테스트")
        candidates = build_field_candidates(
            stores=[store_in, store_out],
            factory_parcels=[parcel],
            boundary_ring=ring,
            stores_meta=meta,
            project_id="PJT-TEST",
        )
        self.assertEqual(len(candidates), 3)
        self.assertTrue(candidates[0].in_boundary)
        self.assertFalse(candidates[1].in_boundary)
        self.assertIsNone(candidates[2].in_boundary)
        self.assertTrue(all(candidate.review_required for candidate in candidates))
        self.assertTrue(all(candidate.status == "REVIEW_REQUIRED" for candidate in candidates))
        self.assertEqual(candidates[0].source["project_id"], "PJT-TEST")

    def test_write_outputs_creates_json_and_qgis_csv(self):
        store = normalize_store_item(StoreTests.ITEM)
        candidates = build_field_candidates(stores=[store])
        with tempfile.TemporaryDirectory() as tmp:
            json_path, csv_path = write_candidate_outputs(Path(tmp) / "local_only", candidates)
            payload = json.loads(json_path.read_text(encoding="utf-8"))
            self.assertEqual(payload["total"], 1)
            self.assertIn("review_required", json.dumps(payload, ensure_ascii=False))
            header = csv_path.read_text(encoding="utf-8-sig").splitlines()[0]
            self.assertIn("lon", header)
            self.assertIn("lat", header)
            self.assertIn("pnu_candidate", header)


class KeyFormAndHttpErrorTests(unittest.TestCase):
    """403 진단 가능성 회귀: HTTP 오류 본문을 읽어야 사유를 구분할 수 있다."""

    def test_normalize_service_key_forms(self):
        self.assertEqual(normalize_service_key(None), (None, "MISSING"))
        self.assertEqual(normalize_service_key("abc+/DEF=="), ("abc+/DEF==", "DECODED"))
        # Encoding 키(퍼센트 인코딩)를 붙여넣은 경우 1회 unquote 되어야 한다.
        self.assertEqual(normalize_service_key("abc%2B%2FDEF%3D%3D"), ("abc+/DEF==", "PERCENT_ENCODED_NORMALIZED"))

    def test_provider_reports_key_form_without_exposing_key(self):
        with env_with_key():
            self.assertEqual(PublicDataProvider().key_form, "DECODED")
        with env_without_key():
            self.assertEqual(PublicDataProvider().key_form, "MISSING")
        provider = PublicDataProvider(service_key="abc%2Bxyz")
        self.assertEqual(provider.key_form, "PERCENT_ENCODED_NORMALIZED")
        self.assertNotIn("abc", repr(provider))

    def test_encoded_key_is_not_double_encoded_in_url(self):
        provider = PublicDataProvider(service_key="abc%2Bxyz")
        url = provider.build_url("https://example.invalid/api", {})
        self.assertIn("serviceKey=abc%2Bxyz", url)
        self.assertNotIn("%252B", url)

    def _http_error(self, status, body):
        return urllib.error.HTTPError(
            "https://example.invalid/api", status, "err", {},
            io.BytesIO(body.encode("utf-8")),
        )

    def test_classify_http_error_reads_service_reason_code(self):
        xml = (
            "<OpenAPI_ServiceResponse><cmmMsgHeader>"
            "<returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg>"
            "<returnReasonCode>30</returnReasonCode>"
            "</cmmMsgHeader></OpenAPI_ServiceResponse>"
        )
        code, message = classify_http_error(self._http_error(403, xml))
        self.assertEqual(code, "SERVICE_KEY_UNREGISTERED")
        self.assertIn("403", message)

    def test_classify_http_error_without_body_falls_back_by_status(self):
        self.assertEqual(classify_http_error(self._http_error(403, ""))[0], "SERVICE_ACCESS_DENIED")
        self.assertEqual(classify_http_error(self._http_error(404, ""))[0], "NO_OPENAPI_SERVICE")
        self.assertEqual(classify_http_error(self._http_error(429, ""))[0], "RATE_LIMIT_EXCEEDED")
        self.assertEqual(classify_http_error(self._http_error(400, ""))[0], "PUBLIC_DATA_BAD_REQUEST")
        self.assertEqual(classify_http_error(self._http_error(500, ""))[0], "PUBLIC_DATA_HTTP_ERROR")

    def test_bad_request_body_is_surfaced_for_diagnosis(self):
        """400 본문에 원인이 담긴다 — 버리면 경로/파라미터 문제를 구분할 수 없다."""
        code, message = classify_http_error(
            self._http_error(400, '{"errorMessage":"inqryDiv is required"}')
        )
        self.assertEqual(code, "PUBLIC_DATA_BAD_REQUEST")
        self.assertIn("inqryDiv is required", message)

    def test_error_body_snippet_is_length_capped(self):
        _, message = classify_http_error(self._http_error(400, "x" * 5000))
        self.assertLess(len(message), 500)

    def test_client_surfaces_classified_http_error_not_opaque_transport_error(self):
        xml = (
            "<OpenAPI_ServiceResponse><cmmMsgHeader>"
            "<returnAuthMsg>SERVICE_ACCESS_DENIED_ERROR</returnAuthMsg>"
            "<returnReasonCode>20</returnReasonCode>"
            "</cmmMsgHeader></OpenAPI_ServiceResponse>"
        )

        def transport(url, timeout):
            raise urllib.error.HTTPError(url, 403, "Forbidden", {}, io.BytesIO(xml.encode("utf-8")))

        with env_with_key():
            client = LegalDongCodeClient(PublicDataProvider(transport=transport))
            result = client.search("테스트동")
            self.assertFalse(result.ok)
            self.assertEqual(result.error_code, "SERVICE_ACCESS_DENIED")
            self.assertEqual(result.status, "PARTIAL")
            self.assertNotIn(FAKE_KEY, result.error_message or "")


class SecretHygieneTests(unittest.TestCase):
    def test_env_example_documents_public_data_key_without_value(self):
        env_example = Path(__file__).parents[1] / ".env.example"
        content = env_example.read_text(encoding="utf-8")
        self.assertIn("PUBLIC_DATA_API_KEY=", content)
        line = next(l for l in content.splitlines() if l.startswith("PUBLIC_DATA_API_KEY="))
        value = line.split("=", 1)[1]
        self.assertTrue(
            value in ("", "your_public_data_api_key_here"),
            ".env.example 에 실제 키를 넣지 마세요",
        )

    def test_gitignore_still_covers_env_and_local_only(self):
        gitignore = (Path(__file__).parents[1] / ".gitignore").read_text(encoding="utf-8")
        self.assertIn("\n.env\n", gitignore)
        self.assertIn("**/local_only/", gitignore)


if __name__ == "__main__":
    unittest.main()
