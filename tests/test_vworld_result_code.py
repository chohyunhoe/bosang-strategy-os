"""VWorld 실패 결과코드 전달 — 오류 코드(VWORLD_API_ERROR)는 그대로, 메시지에 결과코드만 정화해 싣는다(합성 응답)."""
from __future__ import annotations

import sys
import unittest
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


if __name__ == "__main__":
    unittest.main()
