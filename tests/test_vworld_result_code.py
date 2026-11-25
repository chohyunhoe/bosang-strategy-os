"""VWorld 실패 결과코드 전달 — 오류 코드(VWORLD_API_ERROR)는 그대로, 메시지에 결과코드만 정화해 싣는다(합성 응답)."""
from __future__ import annotations

import os
import sys
import unittest
from unittest import mock
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from transaction_enrichment import providers as tp  # noqa: E402

PNU = "9901101000101230004"


def parse(payload):
    return tp.parse_vworld_land_characteristics(payload, expected_pnu=PNU, expected_year=2025)


class ResultCodeTests(unittest.TestCase):
    def test_incorrect_key_in_root(self):
        with self.assertRaises(tp.ProviderError) as ctx:
            parse({"landCharacteristicss": {"resultCode": "INCORRECT_KEY", "resultMsg": "인증키 정보가 올바르지 않습니다."}})
        self.assertEqual(ctx.exception.code, "VWORLD_API_ERROR")
        self.assertIn("resultCode=INCORRECT_KEY", str(ctx.exception))

    def test_error_object_in_response(self):
        with self.assertRaises(tp.ProviderError) as ctx:
            parse({"response": {"status": "ERROR", "error": {"level": "2", "code": "UNREGISTERED_DOMAIN", "text": "x"}}})
        self.assertEqual(ctx.exception.code, "VWORLD_API_ERROR")
        self.assertIn("resultCode=UNREGISTERED_DOMAIN", str(ctx.exception))

    def test_result_code_is_sanitized(self):
        msg = tp._vworld_result_message("bad key=abc123&x<script>")
        self.assertRegex(msg, r"resultCode=[A-Z0-9_]+\)$")
        self.assertNotIn("<", msg)
        self.assertNotIn("=abc", msg.split("resultCode")[0])


class RefererAuthTests(unittest.TestCase):
    """VWorld 서버 호출: 등록 서비스 URL은 Referer 헤더로 보내고 domain 파라미터는 보내지 않는다(2026-11-24 실측 INCORRECT_KEY 원인)."""

    def _capture(self, **env):
        seen = {}

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                return b'{"landCharacteristicss":{"resultCode":"","field":[]}}'

        def fake_urlopen(request, timeout):
            seen["url"] = request.full_url
            seen["referer"] = request.get_header("Referer")
            return FakeResponse()

        with mock.patch.dict("os.environ", env, clear=False), mock.patch.object(tp.urllib.request, "urlopen", fake_urlopen):
            for name in ("VWORLD_DOMAIN", "VWORLD_API_DOMAIN"):
                if name not in env:
                    os.environ.pop(name, None)
            provider = tp.VWorldLandCharacteristicsProvider(api_key="SYNTHETIC-KEY-0000")
            provider.get_by_pnu(PNU, standard_year=2025)  # 빈 field(자료 없음) — 관심사는 요청 형태
        return seen

    def test_referer_from_vworld_domain_and_no_domain_param(self):
        seen = self._capture(VWORLD_DOMAIN="https://registered.example")
        self.assertEqual(seen["referer"], "https://registered.example")
        self.assertNotIn("domain=", seen["url"])

    def test_falls_back_to_vworld_api_domain(self):
        seen = self._capture(VWORLD_API_DOMAIN="https://registered-api.example")
        self.assertEqual(seen["referer"], "https://registered-api.example")

    def test_custom_transport_keeps_two_arg_contract(self):
        calls = []
        provider = tp.VWorldLandCharacteristicsProvider(api_key="SYNTHETIC-KEY-0000", domain="https://x.example",
                                                         transport=lambda url, timeout: calls.append(url) or {"landCharacteristicss": {"resultCode": "", "field": []}})
        provider.get_by_pnu(PNU, standard_year=2025)
        self.assertEqual(len(calls), 1)
        self.assertNotIn("domain=", calls[0])


class CadastralGeometryTests(unittest.TestCase):
    """연속지적 경계: 같은 PNU exact-one만, MultiPolygon·구멍 보존, 주변 조회 범위 제한(합성 응답)."""

    def _provider(self, features):
        payload = {"response": {"status": "OK", "result": {"featureCollection": {"features": features}}}}
        return tp.VWorldCadastralGeometryProvider(api_key="SYNTHETIC-KEY-0000", transport=lambda url, timeout: payload)

    SQ = {"type": "Polygon", "coordinates": [[[127, 36], [127.001, 36], [127.001, 36.001], [127, 36]], [[127.0002, 36.0001], [127.0004, 36.0001], [127.0003, 36.0003], [127.0002, 36.0001]]]}

    def test_exact_one_keeps_holes_as_multipolygon(self):
        r = self._provider([{"properties": {"pnu": PNU, "jibun": "123-4 대"}, "geometry": self.SQ}]).target(PNU)
        self.assertEqual(r["status"], "EXACT_ONE")
        self.assertEqual(r["geometry"]["type"], "MultiPolygon")
        self.assertEqual(len(r["geometry"]["coordinates"][0]), 2)

    def test_multiple_or_other_pnu_not_confirmed(self):
        two = [{"properties": {"pnu": PNU}, "geometry": self.SQ}] * 2
        self.assertEqual(self._provider(two).target(PNU)["status"], "NOT_UNIQUE")
        other = [{"properties": {"pnu": "9901101000101239999"}, "geometry": self.SQ}]
        self.assertEqual(self._provider(other).target(PNU)["status"], "NOT_FOUND")

    def test_neighbors_bbox_limited_to_korea_and_size(self):
        p = self._provider([])
        with self.assertRaises(tp.ProviderError):
            p.neighbors([0, 0, 0.001, 0.001], PNU)
        with self.assertRaises(tp.ProviderError):
            p.neighbors([127, 36, 127.05, 36.05], PNU)
        self.assertEqual(p.neighbors([127, 36, 127.005, 36.005], PNU), [])


if __name__ == "__main__":
    unittest.main()
