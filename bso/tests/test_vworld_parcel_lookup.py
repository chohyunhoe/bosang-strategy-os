"""bso/tools/vworld_parcel_lookup.py 키 비노출 테스트.

실제 .env·실제 키·네트워크를 쓰지 않는다. 키는 가짜 값, PNU는 합성 네임스페이스(99999…)만 사용한다.
"""
import importlib.util
import io
import json
import logging
import sys
import urllib.error
from pathlib import Path

import pytest

MODULE_PATH = Path(__file__).resolve().parents[1] / "tools" / "vworld_parcel_lookup.py"
_spec = importlib.util.spec_from_file_location("bso_vworld_parcel_lookup", MODULE_PATH)
ca = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = ca  # dataclass 처리에 모듈 등록이 필요
_spec.loader.exec_module(ca)

FAKE_KEY = "FAKE-TEST-KEY-0000-NOT-REAL"
FAKE_DOMAIN = "http://fake.test"
SYN_PNU = "9999900000100010000"


@pytest.fixture(autouse=True)
def _isolated_env(monkeypatch):
    monkeypatch.delenv("VWORLD_API_KEY", raising=False)
    monkeypatch.delenv("VWORLD_DOMAIN", raising=False)


@pytest.fixture
def config():
    return ca.VWorldConfig(api_key=FAKE_KEY, domain=FAKE_DOMAIN, source="test")


class _FakeResponse:
    def __init__(self, body: str, status: int = 200):
        self._body = body.encode("utf-8")
        self.status = status

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


def _ok_body(pnu=SYN_PNU):
    return json.dumps({"response": {"status": "OK", "result": {"featureCollection": {
        "features": [{"properties": {"pnu": pnu, "addr": "합성시 합성동 1", "jibun": "1대"}}]}}}})


def _patch_urlopen(monkeypatch, fn):
    monkeypatch.setattr(ca.urllib.request, "urlopen", fn)


def _assert_no_secret(*texts):
    for text in texts:
        assert FAKE_KEY not in str(text)


def test_env_loaded_from_given_file_and_repr_hides_key(tmp_path):
    env = tmp_path / ".env"
    env.write_text(f"VWORLD_API_KEY={FAKE_KEY}\nVWORLD_DOMAIN={FAKE_DOMAIN}\n", encoding="utf-8")
    cfg = ca.load_vworld_config(env)
    assert cfg.api_key == FAKE_KEY and cfg.domain == FAKE_DOMAIN and cfg.source == ".env"
    _assert_no_secret(repr(cfg), str(cfg))


def test_placeholder_values_are_treated_as_missing(tmp_path):
    env = tmp_path / ".env"
    env.write_text("VWORLD_API_KEY=your_vworld_api_key_here\nVWORLD_DOMAIN=your_registered_domain_here\n",
                   encoding="utf-8")
    cfg = ca.load_vworld_config(env)
    assert cfg.api_key == "" and cfg.domain == ""


def test_default_env_path_is_repo_root():
    assert ca.DEFAULT_ENV_PATH == MODULE_PATH.parents[2] / ".env"


def test_missing_key_raises_key_missing(tmp_path):
    cfg = ca.load_vworld_config(tmp_path / "absent.env")
    with pytest.raises(ca.VWorldCadastralError) as info:
        ca.fetch_parcel(SYN_PNU, cfg)
    assert info.value.code == "KEY_MISSING"


def test_invalid_pnu_rejected_before_request(monkeypatch, config):
    _patch_urlopen(monkeypatch, lambda *a, **k: pytest.fail("network must not be called"))
    with pytest.raises(ca.VWorldCadastralError) as info:
        ca.fetch_parcel("12345", config)
    assert info.value.code == "INVALID_PNU"


def test_request_matches_verified_call_shape(monkeypatch, config):
    seen = {}

    def fake(request, timeout):
        seen["url"] = request.full_url
        seen["headers"] = dict(request.header_items())
        return _FakeResponse(_ok_body())

    _patch_urlopen(monkeypatch, fake)
    ca.fetch_parcel(SYN_PNU, config)
    query = dict(ca.urllib.parse.parse_qsl(ca.urllib.parse.urlsplit(seen["url"]).query))
    assert seen["url"].startswith("https://api.vworld.kr/req/data?")
    assert query["service"] == "data" and query["request"] == "GetFeature"
    assert query["data"] == "LP_PA_CBND_BUBUN"
    assert query["attrFilter"] == f"pnu:=:{SYN_PNU}"
    assert query["domain"] == FAKE_DOMAIN
    assert query["key"] == FAKE_KEY  # 키는 쿼리에만 존재
    _assert_no_secret(json.dumps(seen["headers"]))


def test_success_result_and_logs_have_no_secret(monkeypatch, config, caplog):
    _patch_urlopen(monkeypatch, lambda *a, **k: _FakeResponse(_ok_body()))
    with caplog.at_level(logging.DEBUG, logger="bso.cadastral_aerial"):
        result = ca.fetch_parcel(SYN_PNU, config)
    assert result["http"] == 200 and result["status"] == "OK"
    assert result["feature_count"] == 1 and result["pnu_match"] is True
    _assert_no_secret(json.dumps(result, ensure_ascii=False), caplog.text)


def test_secret_echoed_in_response_is_redacted(monkeypatch, config):
    body = json.dumps({"response": {"status": "OK", "result": {"featureCollection": {
        "features": [{"properties": {"pnu": SYN_PNU, "addr": f"echo {FAKE_KEY}"}}]}}}})
    _patch_urlopen(monkeypatch, lambda *a, **k: _FakeResponse(body))
    result = ca.fetch_parcel(SYN_PNU, config)
    _assert_no_secret(json.dumps(result, ensure_ascii=False))


def test_vworld_error_code_passes_only_safe_code(monkeypatch, config, caplog):
    body = json.dumps({"response": {"status": "ERROR", "error": {
        "code": "INCORRECT_KEY", "text": f"bad key {FAKE_KEY}"}}})
    _patch_urlopen(monkeypatch, lambda *a, **k: _FakeResponse(body))
    with caplog.at_level(logging.DEBUG, logger="bso.cadastral_aerial"):
        with pytest.raises(ca.VWorldCadastralError) as info:
            ca.fetch_parcel(SYN_PNU, config)
    assert info.value.code == "INCORRECT_KEY" and info.value.http == 200
    _assert_no_secret(str(info.value), caplog.text)
    assert "bad key" not in caplog.text


def test_unsafe_error_code_is_replaced(monkeypatch, config):
    body = json.dumps({"response": {"status": "ERROR", "error": {"code": f"x {FAKE_KEY}"}}})
    _patch_urlopen(monkeypatch, lambda *a, **k: _FakeResponse(body))
    with pytest.raises(ca.VWorldCadastralError) as info:
        ca.fetch_parcel(SYN_PNU, config)
    assert info.value.code == "UNRECOGNIZED_ERROR_CODE"
    _assert_no_secret(str(info.value))


def test_network_error_message_and_chain_have_no_secret(monkeypatch, config, caplog):
    def fail(request, timeout):
        raise urllib.error.URLError(f"cannot reach {request.full_url}")

    _patch_urlopen(monkeypatch, fail)
    with caplog.at_level(logging.DEBUG, logger="bso.cadastral_aerial"):
        with pytest.raises(ca.VWorldCadastralError) as info:
            ca.fetch_parcel(SYN_PNU, config)
    assert info.value.code == "NETWORK_ERROR"
    assert info.value.__cause__ is None and info.value.__suppress_context__ is True
    _assert_no_secret(str(info.value), repr(info.value), caplog.text)


def test_http_error_keeps_status_only(monkeypatch, config, caplog):
    def fail(request, timeout):
        raise urllib.error.HTTPError(request.full_url, 403, "Forbidden", {}, io.BytesIO(FAKE_KEY.encode()))

    _patch_urlopen(monkeypatch, fail)
    with caplog.at_level(logging.DEBUG, logger="bso.cadastral_aerial"):
        with pytest.raises(ca.VWorldCadastralError) as info:
            ca.fetch_parcel(SYN_PNU, config)
    assert info.value.code == "HTTP_ERROR" and info.value.http == 403
    assert info.value.__cause__ is None
    _assert_no_secret(str(info.value), caplog.text)


def test_non_json_body_not_echoed(monkeypatch, config):
    _patch_urlopen(monkeypatch, lambda *a, **k: _FakeResponse(f"<html>{FAKE_KEY}</html>"))
    with pytest.raises(ca.VWorldCadastralError) as info:
        ca.fetch_parcel(SYN_PNU, config)
    assert info.value.code == "NON_JSON_RESPONSE"
    _assert_no_secret(str(info.value))


def test_cli_output_has_no_secret(monkeypatch, tmp_path, capsys, caplog):
    env = tmp_path / ".env"
    env.write_text(f"VWORLD_API_KEY={FAKE_KEY}\n", encoding="utf-8")
    _patch_urlopen(monkeypatch, lambda *a, **k: _FakeResponse(_ok_body()))
    assert ca.main(["--pnu", SYN_PNU, "--env", str(env)]) == 0
    out = capsys.readouterr()
    payload = json.loads(out.out)
    assert payload["ok"] is True and payload["http"] == 200
    _assert_no_secret(out.out, out.err, caplog.text)
