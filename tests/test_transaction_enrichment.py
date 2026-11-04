from __future__ import annotations

import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

from transaction_enrichment.models import (
    CaseGrade,
    EventPhase,
    LandCharacteristics,
    ReviewPriority,
    ReviewState,
    StandardLandCandidate,
    TransactionCase,
)
from transaction_enrichment.pipeline import (
    group_transaction_events,
    load_bundle,
    run_enrichment,
    write_outputs,
)
from transaction_enrichment.pnu import PnuResolution, PnuResolutionError, parse_vworld_address_candidates
from transaction_enrichment.precheck import classify_event_phase, enrich_transaction_case, raw_price_gap_ratio
from transaction_enrichment.providers import (
    OfflineFixtureProvider,
    ProviderError,
    VWorldLandCharacteristicsProvider,
    parse_vworld_land_characteristics,
    redact_secrets,
)


PNU = "9999900000000000001"
FIXTURE = (
    Path(__file__).parents[1]
    / "fixtures"
    / "golden_cases"
    / "topyeong2_transaction_enrichment"
    / "masked_case_bundle.json"
)
EXPECTED = FIXTURE.with_name("expected_summary.json")


def transaction(**overrides):
    values = {
        "case_id": "masked-topyeong-001",
        "address": "구리시 **동 ***-*",
        "transaction_date": date(2023, 4, 26),
        "land_category": "전",
        "zoning": "개발제한구역",
        "area_m2": 1002.0,
        "unit_price_m2": 993000.0,
        "pnu": PNU,
    }
    values.update(overrides)
    return TransactionCase(**values)


def characteristics(**overrides):
    values = {
        "pnu": PNU,
        "land_category": "전",
        "zoning": "개발제한구역",
        "land_use": "전",
        "road_access": "세로(가)",
        "shape": "사다리형",
        "elevation": "평지",
    }
    values.update(overrides)
    return LandCharacteristics(**values)


def standard(**overrides):
    values = {
        "standard_id": "STD-A",
        "official_price_m2": 500000.0,
        "land_category": "전",
        "zoning": "개발제한구역",
        "land_use": "전",
        "road_access": "세로(가)",
        "shape": "사다리형",
        "elevation": "평지",
    }
    values.update(overrides)
    return StandardLandCandidate(**values)


def vworld_payload(items, total_count=None):
    return {
        "landCharacteristicss": {
            "totalCount": str(len(items) if total_count is None else total_count),
            "field": items,
        }
    }


def vworld_item(**overrides):
    values = {
        "pnu": PNU,
        "stdrYear": "2023",
        "ldCodeNm": "구리시 **동",
        "mnnmSlno": "***-*",
        "lndcgrCodeNm": "전",
        "prposArea1Nm": "개발제한구역",
        "prposArea2Nm": "",
        "ladUseSittnNm": "전",
        "roadSideCodeNm": "세로(가)",
        "tpgrphFrmCodeNm": "사다리형",
        "tpgrphHgCodeNm": "평지",
        "pblntfPclnd": "500000",
        "lastUpdtDt": "2024-03-26",
    }
    values.update(overrides)
    return values


class VWorldAdapterTests(unittest.TestCase):
    def test_response_parser_maps_confirmed_fields(self):
        parsed = parse_vworld_land_characteristics(
            vworld_payload([vworld_item()]), expected_pnu=PNU, expected_year=2023
        )
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed.pnu, PNU)
        self.assertEqual(parsed.land_category, "전")
        self.assertEqual(parsed.zoning, "개발제한구역")
        self.assertEqual(parsed.land_use, "전")
        self.assertEqual(parsed.road_access, "세로(가)")
        self.assertEqual(parsed.shape, "사다리형")
        self.assertEqual(parsed.elevation, "평지")
        self.assertEqual(parsed.individual_official_price, 500000.0)
        self.assertEqual(parsed.price_year, 2023)

    def test_zero_rows_returns_none(self):
        self.assertIsNone(
            parse_vworld_land_characteristics(
                vworld_payload([], total_count=0), expected_pnu=PNU, expected_year=2023
            )
        )

    def test_multiple_exact_rows_fail_closed(self):
        with self.assertRaisesRegex(ProviderError, "Multiple exact") as raised:
            parse_vworld_land_characteristics(
                vworld_payload([vworld_item(), vworld_item(lastUpdtDt="2024-03-27")]),
                expected_pnu=PNU,
                expected_year=2023,
            )
        self.assertEqual(raised.exception.code, "VWORLD_MULTIPLE_EXACT_MATCHES")

    def test_pnu_mismatch_fails_closed(self):
        with self.assertRaises(ProviderError) as raised:
            parse_vworld_land_characteristics(
                vworld_payload([vworld_item(pnu="8888800000000000001")]),
                expected_pnu=PNU,
                expected_year=2023,
            )
        self.assertEqual(raised.exception.code, "VWORLD_EXACT_MATCH_NOT_FOUND")

    def test_secret_redaction_and_repr(self):
        secret = "secret-key-material"
        message = redact_secrets(f"https://example.test?key={secret}&pnu={PNU}", (secret,))
        self.assertNotIn(secret, message)
        provider = VWorldLandCharacteristicsProvider(api_key=secret, transport=lambda _url, _timeout: {})
        self.assertNotIn(secret, repr(provider))

    def test_timeout_fails_closed_without_secret(self):
        secret = "secret-timeout-key"

        def timeout_transport(url, _timeout):
            raise TimeoutError(f"timeout at {url}")

        provider = VWorldLandCharacteristicsProvider(api_key=secret, transport=timeout_transport)
        with self.assertRaises(ProviderError) as raised:
            provider.get_by_pnu(PNU, standard_year=2023)
        self.assertEqual(raised.exception.code, "VWORLD_TRANSPORT_ERROR")
        self.assertNotIn(secret, str(raised.exception))


class PnuResolutionTests(unittest.TestCase):
    def test_exact_parcel_address_returns_single_pnu(self):
        payload = {
            "response": {
                "status": "OK",
                "result": {
                    "items": [
                        {"id": PNU, "title": "<b>구리시 **동 ***-*</b>", "address": {"parcel": "구리시 **동 ***-*"}},
                        {"id": "9999900000000000002", "address": {"parcel": "구리시 **동 **-**"}},
                    ]
                },
            }
        }
        result = parse_vworld_address_candidates(payload, expected_address="구리시 **동 ***-*")
        self.assertEqual(result.pnu, PNU)

    def test_no_exact_address_fails_closed(self):
        payload = {
            "response": {
                "status": "OK",
                "result": {"items": [{"id": PNU, "address": {"parcel": "다른 주소"}}]},
            }
        }
        with self.assertRaises(PnuResolutionError) as raised:
            parse_vworld_address_candidates(payload, expected_address="구리시 **동 ***-*")
        self.assertEqual(raised.exception.code, "PNU_EXACT_MATCH_NOT_FOUND")

    def test_multiple_exact_pnus_fail_closed(self):
        payload = {
            "response": {
                "status": "OK",
                "result": {
                    "items": [
                        {"id": PNU, "address": {"parcel": "구리시 **동 ***-*"}},
                        {"id": "9999900000000000002", "address": {"parcel": "구리시 **동 ***-*"}},
                    ]
                },
            }
        }
        with self.assertRaises(PnuResolutionError) as raised:
            parse_vworld_address_candidates(payload, expected_address="구리시 **동 ***-*")
        self.assertEqual(raised.exception.code, "PNU_MULTIPLE_EXACT_MATCHES")

    def test_pipeline_uses_exact_pnu_resolver_for_missing_pnu(self):
        class ExactResolver:
            def resolve(self, address):
                self.address = address
                return PnuResolution(PNU, address, 1)

        case = transaction(pnu=None)
        results, _summary = run_enrichment(
            [case],
            OfflineFixtureProvider({PNU: characteristics()}),
            [standard()],
            pnu_resolver=ExactResolver(),
        )
        self.assertEqual(results[0].transaction.pnu, PNU)
        self.assertEqual(results[0].provider_status, "SUCCESS")


class EnrichmentSafetyTests(unittest.TestCase):
    def test_raw_gap_is_math_only(self):
        self.assertEqual(raw_price_gap_ratio(1000000, 500000), 2.0)
        with self.assertRaises(ValueError):
            raw_price_gap_ratio(1000000, 0)

    def test_provider_error_is_review_result(self):
        class ErrorProvider(OfflineFixtureProvider):
            def get_by_pnu(self, pnu, *, standard_year=None):
                raise ProviderError("VWORLD_TRANSPORT_ERROR", "safe")

        result = enrich_transaction_case(transaction(), ErrorProvider({}), [standard()])
        self.assertEqual(result.review_state, ReviewState.REVIEW_REQUIRED)
        self.assertIn("VWORLD_TRANSPORT_ERROR", result.review_reasons)
        self.assertIsNone(result.selected_standard_id)

    def test_provider_pnu_mismatch_fails_closed(self):
        provider = OfflineFixtureProvider({PNU: characteristics(pnu="8888800000000000001")})
        result = enrich_transaction_case(transaction(), provider, [standard()])
        self.assertIn("PNU_MISMATCH", result.review_reasons)
        self.assertIsNone(result.raw_price_gap_ratio)

    def test_ambiguous_standard_is_not_selected(self):
        provider = OfflineFixtureProvider({PNU: characteristics()})
        result = enrich_transaction_case(
            transaction(), provider, [standard(standard_id="STD-A"), standard(standard_id="STD-B")]
        )
        self.assertIsNone(result.selected_standard_id)
        self.assertEqual(result.grade, CaseGrade.REVIEW_REQUIRED)
        self.assertIn("STANDARD_CANDIDATE_AMBIGUOUS", result.review_reasons)

    def test_a_candidate_never_becomes_appraisal_conclusion(self):
        provider = OfflineFixtureProvider({PNU: characteristics()})
        result = enrich_transaction_case(transaction(), provider, [standard()])
        self.assertEqual(result.grade, CaseGrade.A_CANDIDATE)
        self.assertEqual(result.review_priority, ReviewPriority.A_PLUS_REVIEW)
        self.assertIsNone(result.appraisal_conclusion)
        self.assertIsNone(result.adjusted_gap_candidate)

    def test_unconfirmed_individual_factors_are_never_one(self):
        provider = OfflineFixtureProvider({PNU: characteristics()})
        result = enrich_transaction_case(transaction(), provider, [standard()])
        self.assertEqual(len(result.individual_factor_assessments), 6)
        self.assertTrue(all(item.state == ReviewState.NOT_IDENTIFIABLE for item in result.individual_factor_assessments))
        self.assertTrue(all(item.numeric_ratio is None for item in result.individual_factor_assessments))

    def test_characteristic_join_mismatch_requires_review(self):
        provider = OfflineFixtureProvider({PNU: characteristics(road_access="맹지")})
        result = enrich_transaction_case(transaction(), provider, [standard()])
        self.assertEqual(result.grade, CaseGrade.B_REFERENCE)
        self.assertEqual(result.review_state, ReviewState.REVIEW_REQUIRED)
        self.assertIn("FACTOR_ADJUSTMENT_REQUIRED", result.review_reasons)


class EventAndGoldenCaseTests(unittest.TestCase):
    def test_candidate_date_boundaries(self):
        self.assertEqual(classify_event_phase(date(2023, 11, 14)), EventPhase.PRE_ANNOUNCEMENT)
        self.assertEqual(
            classify_event_phase(date(2023, 11, 15)), EventPhase.POST_ANNOUNCEMENT_PRE_DESIGNATION
        )
        self.assertEqual(classify_event_phase(date(2025, 12, 31)), EventPhase.POST_DESIGNATION)

    def test_transaction_event_dedupe_regression(self):
        cases = [
            transaction(case_id="A", area_m2=100),
            transaction(case_id="B", area_m2=200),
            transaction(case_id="C", unit_price_m2=994000),
        ]
        events = group_transaction_events(cases)
        self.assertEqual(events["A"].event_id, events["B"].event_id)
        self.assertNotEqual(events["A"].event_id, events["C"].event_id)
        self.assertEqual(events["A"].representative_case_id, "A")

    def test_masked_topyeong_23_case_regression(self):
        cases, chars, standards = load_bundle(FIXTURE)
        results, summary = run_enrichment(cases, OfflineFixtureProvider(chars), standards)
        expected = json.loads(EXPECTED.read_text(encoding="utf-8"))
        self.assertEqual(len(cases), 23)
        for key, value in expected.items():
            self.assertEqual(summary[key], value, key)
        self.assertEqual(
            sum(item.review_priority == ReviewPriority.A_PLUS_REVIEW for item in results), 11
        )

    def test_required_json_and_csv_outputs(self):
        cases, chars, standards = load_bundle(FIXTURE)
        results, summary = run_enrichment(cases, OfflineFixtureProvider(chars), standards)
        with tempfile.TemporaryDirectory() as directory:
            json_path, csv_path = write_outputs(Path(directory), results, summary)
            payload = json.loads(json_path.read_text(encoding="utf-8"))
            self.assertEqual(payload["summary"]["total_cases"], 23)
            self.assertEqual(len(payload["cases"]), 23)
            self.assertTrue(csv_path.exists())
            first = payload["cases"][0]
            self.assertIn("raw_price_gap_ratio", first)
            self.assertIsNone(first["appraisal_conclusion"])
            self.assertIsNone(first["adjusted_gap_candidate"])
            self.assertNotIn("VWORLD_API_KEY", json_path.read_text(encoding="utf-8"))


class PrivacyAndAccuracyRegressionTests(unittest.TestCase):
    """P0-A/B/C/D/P1 regression tests added in PR #127 closure audit."""

    def test_gitignore_covers_live_enrichment_output(self):
        """P0-A sentinel: .gitignore must cover all live enrichment paths."""
        gitignore = Path(__file__).parents[1] / ".gitignore"
        content = gitignore.read_text(encoding="utf-8")
        self.assertIn("output/live_enrichment/", content)
        self.assertIn("**/local_only/", content)

    def test_parse_date_preserves_day_29_to_31(self):
        """P0-B: days 29-31 must not be clamped to 28."""
        try:
            from transaction_enrichment.xlsx_converter import _parse_date
        except SystemExit:
            self.skipTest("openpyxl not available")

        col_map = {"year": 0, "month": 1, "day": 2}
        self.assertEqual(_parse_date([2023, 1, 31], col_map), date(2023, 1, 31))
        self.assertEqual(_parse_date([2023, 4, 30], col_map), date(2023, 4, 30))
        self.assertEqual(_parse_date([2024, 2, 29], col_map), date(2024, 2, 29))
        self.assertIsNone(_parse_date([2023, 2, 29], col_map))
        self.assertIsNone(_parse_date([2023, 6, 31], col_map))

    def test_dedupe_events_preserves_all_rows(self):
        """P0-C: dedupe_events must flag, not drop, possible duplicates."""
        try:
            from transaction_enrichment.xlsx_converter import dedupe_events
        except SystemExit:
            self.skipTest("openpyxl not available")

        rows = [
            {"address": "구리시 아천동 1-1", "transaction_date": date(2023, 4, 26),
             "zoning": "개발제한구역", "land_category": "전", "unit_price_m2": 993000.0},
            {"address": "구리시 아천동 1-1", "transaction_date": date(2023, 4, 26),
             "zoning": "개발제한구역", "land_category": "전", "unit_price_m2": 993000.0},
            {"address": "구리시 아천동 2-2", "transaction_date": date(2023, 4, 26),
             "zoning": "개발제한구역", "land_category": "전", "unit_price_m2": 500000.0},
        ]
        result = dedupe_events(rows)
        self.assertEqual(len(result), 3)
        self.assertFalse(result[0]["_possible_same_transaction_event"])
        self.assertTrue(result[1]["_possible_same_transaction_event"])
        self.assertFalse(result[2]["_possible_same_transaction_event"])

    def test_live_path_rejects_missing_standards(self):
        """P0-D: run_live must not fall back to DEFAULT_STANDARDS."""
        try:
            from transaction_enrichment.run_live import main
        except SystemExit:
            self.skipTest("openpyxl not available")
        with self.assertRaises(SystemExit):
            main(["--xlsx", "nonexistent.xlsx", "--output-dir", "/tmp/out"])

    def test_ssl_error_fails_closed_without_secret(self):
        """P1: ssl.SSLError must be caught and redacted."""
        import ssl

        secret = "secret-ssl-key"

        def ssl_transport(url, _timeout):
            raise ssl.SSLError(1, f"[SSL] certificate verify failed url={url}")

        provider = VWorldLandCharacteristicsProvider(api_key=secret, transport=ssl_transport)
        with self.assertRaises(ProviderError) as raised:
            provider.get_by_pnu(PNU, standard_year=2023)
        self.assertEqual(raised.exception.code, "VWORLD_TRANSPORT_ERROR")
        self.assertNotIn(secret, str(raised.exception))

    def test_connection_reset_fails_closed_without_secret(self):
        """P1: ConnectionResetError must be caught and redacted."""
        secret = "secret-reset-key"

        def reset_transport(url, _timeout):
            raise ConnectionResetError(f"Connection reset url={url}")

        provider = VWorldLandCharacteristicsProvider(api_key=secret, transport=reset_transport)
        with self.assertRaises(ProviderError) as raised:
            provider.get_by_pnu(PNU, standard_year=2023)
        self.assertEqual(raised.exception.code, "VWORLD_TRANSPORT_ERROR")
        self.assertNotIn(secret, str(raised.exception))

    def test_ssl_eof_error_fails_closed_without_secret(self):
        """P1: ssl.SSLEOFError must be caught and redacted."""
        import ssl

        secret = "secret-ssleof-key"

        def ssleof_transport(url, _timeout):
            raise ssl.SSLEOFError(1, f"[SSL] EOF occurred url={url}")

        provider = VWorldLandCharacteristicsProvider(api_key=secret, transport=ssleof_transport)
        with self.assertRaises(ProviderError) as raised:
            provider.get_by_pnu(PNU, standard_year=2023)
        self.assertEqual(raised.exception.code, "VWORLD_TRANSPORT_ERROR")
        self.assertNotIn(secret, str(raised.exception))

    def test_remote_disconnected_fails_closed_without_secret(self):
        """P1: http.client.RemoteDisconnected must be caught and redacted."""
        from http.client import RemoteDisconnected

        secret = "secret-disconnect-key"

        def disconnect_transport(url, _timeout):
            raise RemoteDisconnected(f"Remote end closed connection url={url}")

        provider = VWorldLandCharacteristicsProvider(api_key=secret, transport=disconnect_transport)
        with self.assertRaises(ProviderError) as raised:
            provider.get_by_pnu(PNU, standard_year=2023)
        self.assertEqual(raised.exception.code, "VWORLD_TRANSPORT_ERROR")
        self.assertNotIn(secret, str(raised.exception))

    def test_http_502_fails_closed_without_secret(self):
        """P1: HTTP 502 Bad Gateway must be caught and redacted."""
        import urllib.error

        secret = "secret-502-key"

        def http_502_transport(url, _timeout):
            raise urllib.error.HTTPError(url, 502, "Bad Gateway", {}, None)

        provider = VWorldLandCharacteristicsProvider(api_key=secret, transport=http_502_transport)
        with self.assertRaises(ProviderError) as raised:
            provider.get_by_pnu(PNU, standard_year=2023)
        self.assertEqual(raised.exception.code, "VWORLD_TRANSPORT_ERROR")
        self.assertNotIn(secret, str(raised.exception))

    def test_pnu_resolver_ssl_error_fails_closed(self):
        """P1: PNU resolver must catch ssl errors and redact secrets."""
        import ssl
        from transaction_enrichment.pnu import VWorldAddressPnuResolver

        secret = "secret-pnu-ssl-key"

        def ssl_transport(url, _timeout):
            raise ssl.SSLError(1, f"[SSL] verify failed url={url}")

        resolver = VWorldAddressPnuResolver(api_key=secret, transport=ssl_transport)
        with self.assertRaises(PnuResolutionError) as raised:
            resolver.resolve("구리시 **동 ***-*")
        self.assertEqual(raised.exception.code, "PNU_SEARCH_TRANSPORT_ERROR")
        self.assertNotIn(secret, str(raised.exception))

    def test_pipeline_vworld_rejects_synthetic_standards(self):
        """P0-D: pipeline --provider vworld must reject SYNTHETIC_DEFAULT bundles."""
        from transaction_enrichment.pipeline import main as pipeline_main

        bundle = {
            "standards_source": "SYNTHETIC_DEFAULT",
            "transactions": [],
            "land_characteristics": {},
            "standard_candidates": [],
        }
        with tempfile.TemporaryDirectory() as tmpdir:
            bundle_path = Path(tmpdir) / "test_bundle.json"
            bundle_path.write_text(json.dumps(bundle), encoding="utf-8")
            result = pipeline_main([
                "--bundle", str(bundle_path),
                "--output-dir", tmpdir,
                "--provider", "vworld",
            ])
            self.assertEqual(result, 1)

    def test_heuristic_event_group_preserves_grade_and_priority(self):
        """P0-C: heuristic event group must not demote grade or priority."""
        case_a = transaction(case_id="EVT-A", area_m2=500.0)
        case_b = transaction(case_id="EVT-B", area_m2=800.0)
        provider = OfflineFixtureProvider({PNU: characteristics()})
        results, summary = run_enrichment([case_a, case_b], provider, [standard()])
        self.assertEqual(len(results), 2)
        for result in results:
            self.assertEqual(result.grade, CaseGrade.A_CANDIDATE)
            self.assertEqual(result.review_priority, ReviewPriority.A_PLUS_REVIEW)
            self.assertIsNone(result.appraisal_conclusion)
            self.assertIsNone(result.adjusted_gap_candidate)
        self.assertIn("POSSIBLE_SAME_TRANSACTION_EVENT", results[1].review_reasons)
        self.assertNotIn("DUPLICATE_TRANSACTION_EVENT_MEMBER", results[1].review_reasons)
        self.assertEqual(summary["a_plus_review_candidates"], 2)

    def test_a_plus_count_matches_summary_without_representative_filter(self):
        """run_live A+ aggregation must equal summary, with no representative filter."""
        try:
            from transaction_enrichment.run_live import count_a_plus_review
        except SystemExit:
            self.skipTest("openpyxl not available")

        case_a = transaction(case_id="CNT-A", area_m2=300.0)
        case_b = transaction(case_id="CNT-B", area_m2=600.0)
        provider = OfflineFixtureProvider({PNU: characteristics()})
        results, summary = run_enrichment([case_a, case_b], provider, [standard()])

        # Both rows fall in one heuristic event group, so a representative
        # filter would undercount here.
        self.assertEqual(len(results), 2)
        self.assertIn("POSSIBLE_SAME_TRANSACTION_EVENT", results[1].review_reasons)
        self.assertFalse(results[1].is_event_representative)

        a_plus_total = count_a_plus_review(results)
        self.assertEqual(a_plus_total, summary["a_plus_review_candidates"])
        self.assertEqual(a_plus_total, 2)
        for result in results:
            self.assertIsNone(result.appraisal_conclusion)
            self.assertIsNone(result.adjusted_gap_candidate)

    def test_runtime_error_classified_as_internal_not_transport(self):
        """P1: unexpected RuntimeError must be INTERNAL_ERROR, not TRANSPORT_ERROR."""
        secret = "secret-internal-key"

        def bad_transport(url, _timeout):
            raise RuntimeError("something unexpected happened")

        provider = VWorldLandCharacteristicsProvider(api_key=secret, transport=bad_transport)
        with self.assertRaises(ProviderError) as raised:
            provider.get_by_pnu(PNU, standard_year=2023)
        self.assertEqual(raised.exception.code, "VWORLD_INTERNAL_ERROR")
        self.assertNotEqual(raised.exception.code, "VWORLD_TRANSPORT_ERROR")
        self.assertNotIn(secret, str(raised.exception))
        self.assertNotIn("something unexpected", str(raised.exception))

    def test_pnu_resolver_runtime_error_classified_as_internal(self):
        """P1: unexpected RuntimeError in PNU resolver must be INTERNAL_ERROR."""
        from transaction_enrichment.pnu import VWorldAddressPnuResolver

        secret = "secret-pnu-internal-key"

        def bad_transport(url, _timeout):
            raise RuntimeError("unexpected pnu error")

        resolver = VWorldAddressPnuResolver(api_key=secret, transport=bad_transport)
        with self.assertRaises(PnuResolutionError) as raised:
            resolver.resolve("구리시 **동 ***-*")
        self.assertEqual(raised.exception.code, "PNU_SEARCH_INTERNAL_ERROR")
        self.assertNotEqual(raised.exception.code, "PNU_SEARCH_TRANSPORT_ERROR")
        self.assertNotIn(secret, str(raised.exception))
        self.assertNotIn("unexpected pnu error", str(raised.exception))

    def test_pipeline_vworld_writes_to_local_only(self):
        """P0-A: pipeline --provider vworld must write to local_only/ subdir."""
        from transaction_enrichment.pipeline import main as pipeline_main

        bundle = {
            "standards_source": "VERIFIED_INPUT",
            "transactions": [],
            "land_characteristics": {},
            "standard_candidates": [],
        }
        with tempfile.TemporaryDirectory() as tmpdir:
            bundle_path = Path(tmpdir) / "test_bundle.json"
            bundle_path.write_text(json.dumps(bundle), encoding="utf-8")
            out_dir = Path(tmpdir) / "output"
            pipeline_main([
                "--bundle", str(bundle_path),
                "--output-dir", str(out_dir),
                "--provider", "vworld",
            ])
            self.assertTrue((out_dir / "local_only" / "transaction_case_enrichment.json").exists())
            self.assertFalse((out_dir / "transaction_case_enrichment.json").exists())


class XlsxZoningNormalizationTests(unittest.TestCase):
    """Real 실거래가/공시지가 sources abbreviate 용도지역 (e.g. 개발제한, 1종일주);
    TARGET_COMBOS keys use the full legal name. Without normalization every
    row in the 6 target combos is silently dropped and total_cases becomes 0.
    """

    def test_known_abbreviations_normalize_to_target_combo_zonings(self):
        from transaction_enrichment.xlsx_converter import TARGET_COMBOS, _normalize_zoning

        target_zonings = {zoning for zoning, _category in TARGET_COMBOS}
        self.assertEqual(_normalize_zoning("개발제한"), "개발제한구역")
        self.assertEqual(_normalize_zoning("1종일주"), "제1종일반주거지역")
        self.assertIn(_normalize_zoning("개발제한"), target_zonings)
        self.assertIn(_normalize_zoning("1종일주"), target_zonings)

    def test_unmapped_zoning_passes_through_unchanged(self):
        from transaction_enrichment.xlsx_converter import _normalize_zoning

        self.assertEqual(_normalize_zoning("특수한구역명"), "특수한구역명")

    def test_full_legal_name_is_idempotent(self):
        from transaction_enrichment.xlsx_converter import _normalize_zoning

        self.assertEqual(_normalize_zoning("개발제한구역"), "개발제한구역")
        self.assertEqual(_normalize_zoning("제1종일반주거지역"), "제1종일반주거지역")

    def test_filter_target_combos_matches_abbreviated_source_zoning(self):
        from transaction_enrichment.xlsx_converter import _normalize_zoning, filter_target_combos

        combos = {("개발제한구역", "전"): ["S_GB_FIELD_01", "S_GB_FIELD_02"]}
        row = {"zoning": _normalize_zoning("개발제한"), "land_category": "전"}
        result = filter_target_combos([row], combos)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["_standard_candidate_ids"], ["S_GB_FIELD_01", "S_GB_FIELD_02"])

    def test_target_combos_allow_multiple_candidates_per_combo(self):
        """The scoring in precheck._candidate_score picks the closest match among
        several registered candidates per combo — TARGET_COMBOS must support that."""
        from transaction_enrichment.xlsx_converter import TARGET_COMBOS

        for combo, ids in TARGET_COMBOS.items():
            self.assertGreater(len(ids), 0, f"{combo} has no standard candidates")
            self.assertEqual(len(ids), len(set(ids)), f"{combo} has duplicate ids")


class _FlakyProvider(OfflineFixtureProvider):
    """Fails with a given ProviderError code on each PNU's first lookup only."""

    def __init__(self, fixtures, *, fail_code="VWORLD_API_ERROR", always_fail=False):
        super().__init__(fixtures)
        self._fail_code = fail_code
        self._always_fail = always_fail
        self._attempts: dict[str, int] = {}

    def get_by_pnu(self, pnu, *, standard_year=None):
        self._attempts[pnu] = self._attempts.get(pnu, 0) + 1
        if self._always_fail or self._attempts[pnu] == 1:
            raise ProviderError(self._fail_code, "stub failure")
        return super().get_by_pnu(pnu, standard_year=standard_year)


class RetryTransportFailuresTests(unittest.TestCase):
    """Retry pass for the 28-failure follow-up: retry only transport-class
    codes (VWORLD_API_ERROR, PNU_SEARCH_FAILED) once; never touch ambiguous
    fail-closed outcomes like VWORLD_MULTIPLE_EXACT_MATCHES."""

    def test_transient_failure_recovers_on_retry(self):
        from transaction_enrichment.run_live import retry_transport_failures

        provider = _FlakyProvider({PNU: characteristics()})
        case = transaction()
        results, _summary = run_enrichment([case], provider, [standard()])
        self.assertEqual(results[0].provider_status, "VWORLD_API_ERROR")

        merged, retried, recovered = retry_transport_failures(
            results, {case.case_id: case}, provider, [standard()], resolver=None
        )
        self.assertEqual(retried, 1)
        self.assertEqual(recovered, 1)
        self.assertEqual(merged[0].provider_status, "SUCCESS")

    def test_persistent_failure_stays_failed_after_retry(self):
        from transaction_enrichment.run_live import retry_transport_failures

        provider = _FlakyProvider({PNU: characteristics()}, always_fail=True)
        case = transaction()
        results, _summary = run_enrichment([case], provider, [standard()])
        self.assertEqual(results[0].provider_status, "VWORLD_API_ERROR")

        merged, retried, recovered = retry_transport_failures(
            results, {case.case_id: case}, provider, [standard()], resolver=None
        )
        self.assertEqual(retried, 1)
        self.assertEqual(recovered, 0)
        self.assertEqual(merged[0].provider_status, "VWORLD_API_ERROR")

    def test_multiple_exact_matches_is_never_retried(self):
        from transaction_enrichment.run_live import retry_transport_failures

        provider = _FlakyProvider(
            {PNU: characteristics()}, fail_code="VWORLD_MULTIPLE_EXACT_MATCHES", always_fail=True
        )
        case = transaction()
        results, _summary = run_enrichment([case], provider, [standard()])
        self.assertEqual(results[0].provider_status, "VWORLD_MULTIPLE_EXACT_MATCHES")

        merged, retried, recovered = retry_transport_failures(
            results, {case.case_id: case}, provider, [standard()], resolver=None
        )
        self.assertEqual(retried, 0)
        self.assertEqual(recovered, 0)
        self.assertEqual(merged[0].provider_status, "VWORLD_MULTIPLE_EXACT_MATCHES")
        # Untouched: still the exact same result object, not a re-attempted one.
        self.assertIs(merged[0], results[0])

    def test_retry_preserves_original_event_membership(self):
        """Retrying a subset must not recompute event grouping from that subset alone."""
        from transaction_enrichment.run_live import retry_transport_failures

        provider = _FlakyProvider({PNU: characteristics()})
        case_a = transaction(case_id="A")
        case_b = transaction(case_id="B", area_m2=999)  # shares the same event key as A
        results, _summary = run_enrichment([case_a, case_b], provider, [standard()])
        by_id = {r.transaction.case_id: r for r in results}
        self.assertEqual(by_id["A"].event_member_count, 2)
        self.assertEqual(by_id["B"].event_member_count, 2)

        # Only "A" failed (provider only fails the first lookup per PNU, and
        # both cases share the same PNU/fixture, so only one of the two — the
        # one enrich_transaction_case reaches first — trips the stub failure).
        failing_ids = [cid for cid, r in by_id.items() if r.provider_status != "SUCCESS"]
        self.assertEqual(len(failing_ids), 1)

        cases_by_id = {"A": case_a, "B": case_b}
        merged, retried, recovered = retry_transport_failures(
            results, cases_by_id, provider, [standard()], resolver=None
        )
        self.assertEqual(retried, 1)
        self.assertEqual(recovered, 1)
        merged_by_id = {r.transaction.case_id: r for r in merged}
        # event_member_count must still reflect the full original group (2),
        # not the retry subset (1).
        self.assertEqual(merged_by_id["A"].event_member_count, 2)
        self.assertEqual(merged_by_id["B"].event_member_count, 2)


if __name__ == "__main__":
    unittest.main()
