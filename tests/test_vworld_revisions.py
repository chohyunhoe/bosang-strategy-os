"""VWorld 토지특성 동일 PNU·연도 복수 행 정리 규칙 (키 없는 합성 테스트).

- 기본값(Release v1 계약): 복수 행은 VWORLD_MULTIPLE_EXACT_MATCHES로 보류 — 변경 없음
- 옵트인(상담 시뮬레이터, dedupe_revisions=true): lastUpdtDt만 다르면 최신 갱신행 대표, 그 외 값이 다르면 VWORLD_REVISION_CONFLICT
"""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from transaction_enrichment import providers as tp  # noqa: E402
import public_data_bridge as bridge  # noqa: E402

PNU = "9901101000101230004"


def row(year: int, updated: str, **over):
    base = {
        "pnu": PNU, "stdrYear": str(year), "lndcgrCodeNm": "대", "lndpclAr": "412.5", "prposArea1Nm": "제2종일반주거지역",
        "ladUseSittnNm": "단독", "roadSideCodeNm": "세로한면(가)", "tpgrphFrmCodeNm": "세로장방", "tpgrphHgCodeNm": "평지",
        "pblntfPclnd": "1968000" if year == 2026 else "1905000", "lastUpdtDt": updated,
    }
    base.update(over)
    return base


def payload(rows):
    return {"landCharacteristicss": {"resultCode": "", "totalCount": str(len(rows)), "field": rows}}


class RevisionRuleTests(unittest.TestCase):
    def test_default_contract_unchanged_for_release_v1(self):
        with self.assertRaises(tp.ProviderError) as ctx:
            tp.parse_vworld_land_characteristics(payload([row(2026, "2026-05-31"), row(2026, "2026-07-15")]), expected_pnu=PNU, expected_year=2026)
        self.assertEqual(ctx.exception.code, "VWORLD_MULTIPLE_EXACT_MATCHES")
        with self.assertRaises(tp.ProviderError) as ctx:
            tp.parse_vworld_land_characteristics({"response": {"status": "NOT_FOUND"}}, expected_pnu=PNU, expected_year=2099)
        self.assertEqual(ctx.exception.code, "VWORLD_SCHEMA_CHANGED")

    def test_opt_in_collapses_identical_revisions_to_latest(self):
        for rows, year, latest in (
            ([row(2026, "2026-05-31"), row(2026, "2026-07-15")], 2026, "2026-07-15"),
            ([row(2025, "2025-06-30"), row(2025, "2025-11-02"), row(2025, "2025-08-01")], 2025, "2025-11-02"),
        ):
            diag: dict = {}
            record = tp.parse_vworld_land_characteristics(payload(rows), expected_pnu=PNU, expected_year=year, collapse_revisions=True, diagnostics=diag)
            self.assertEqual(record.last_updated_at, latest)
            self.assertEqual(diag["rule"], "IDENTICAL_DATA_REVISIONS")
            self.assertEqual(diag["row_count"], len(rows))
            self.assertEqual(diag["selected_last_updated"], latest)

    def test_opt_in_conflict_holds(self):
        diag: dict = {}
        with self.assertRaises(tp.ProviderError) as ctx:
            tp.parse_vworld_land_characteristics(
                payload([row(2026, "2026-05-31"), row(2026, "2026-07-15", pblntfPclnd="2010000")]),
                expected_pnu=PNU, expected_year=2026, collapse_revisions=True, diagnostics=diag)
        self.assertEqual(ctx.exception.code, "VWORLD_REVISION_CONFLICT")
        self.assertEqual(diag["conflict_fields"], ["pblntfPclnd"])
        self.assertNotIn("2010000", repr(diag))

    def test_opt_in_not_found_is_no_data_and_year_rows_excluded(self):
        self.assertIsNone(tp.parse_vworld_land_characteristics({"response": {"status": "NOT_FOUND"}}, expected_pnu=PNU, expected_year=2099, collapse_revisions=True))
        diag: dict = {}
        record = tp.parse_vworld_land_characteristics(
            payload([row(2025, "2025-06-30"), row(2026, "2026-05-31"), row(2026, "2026-07-15")]),
            expected_pnu=PNU, expected_year=2026, collapse_revisions=True, diagnostics=diag)
        self.assertEqual(record.individual_official_price, 1968000.0)
        self.assertEqual(diag["excluded_rows"], 1)

    def test_bridge_flag_only_for_consultation(self):
        fake = lambda _url, _timeout: payload([row(2026, "2026-05-31"), row(2026, "2026-07-15")])  # noqa: E731
        with mock.patch.dict(os.environ, {"VWORLD_API_KEY": "SYNTHETIC-UNIT-KEY-000"}), mock.patch.object(tp, "default_json_transport", fake):
            release = bridge.vworld_land({"pnu": PNU, "standard_year": 2026})
            consult = bridge.vworld_land({"pnu": PNU, "standard_year": 2026, "dedupe_revisions": True})
        self.assertEqual(release["error_code"], "VWORLD_MULTIPLE_EXACT_MATCHES")
        self.assertTrue(consult["ok"])
        self.assertEqual(consult["selection"]["row_count"], 2)
        self.assertNotIn("SYNTHETIC-UNIT-KEY", repr(consult))


if __name__ == "__main__":
    unittest.main()
