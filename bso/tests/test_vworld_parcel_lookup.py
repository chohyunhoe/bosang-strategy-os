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


# ---- geometry (지도 중첩용 경계 도형) -------------------------------------------------
SYN_RING = [[127.0000, 37.5000], [127.0002, 37.5000], [127.0002, 37.5002], [127.0000, 37.5002], [127.0000, 37.5000]]


def _geom_body(coords=None, geometry_type="MultiPolygon", pnu=SYN_PNU, with_geometry=True):
    coords = coords if coords is not None else [[SYN_RING]]
    feature = {"properties": {"pnu": pnu, "addr": "합성시 합성동 1", "jibun": "1대"}}
    if with_geometry:
        feature["geometry"] = {"type": geometry_type, "coordinates": coords}
    return json.dumps({"response": {"status": "OK", "result": {"featureCollection": {"features": [feature]}}}})


def _query_of(url):
    return dict(ca.urllib.parse.parse_qsl(ca.urllib.parse.urlsplit(url).query))


def test_default_request_keeps_geometry_off_and_no_crs(monkeypatch, config):
    seen = {}

    def fake(request, timeout):
        seen["url"] = request.full_url
        return _FakeResponse(_ok_body())

    _patch_urlopen(monkeypatch, fake)
    result = ca.fetch_parcel(SYN_PNU, config)
    query = _query_of(seen["url"])
    assert query["geometry"] == "false" and "crs" not in query
    assert "geometry" not in result


def test_geometry_request_asks_for_wgs84(monkeypatch, config):
    seen = {}

    def fake(request, timeout):
        seen["url"] = request.full_url
        return _FakeResponse(_geom_body())

    _patch_urlopen(monkeypatch, fake)
    ca.fetch_parcel(SYN_PNU, config, include_geometry=True)
    query = _query_of(seen["url"])
    assert query["geometry"] == "true" and query["crs"] == "EPSG:4326"


def test_geometry_result_summary_and_geojson_have_no_secret(monkeypatch, config, caplog):
    _patch_urlopen(monkeypatch, lambda *a, **k: _FakeResponse(_geom_body()))
    with caplog.at_level(logging.DEBUG, logger="bso.cadastral_aerial"):
        result = ca.fetch_parcel(SYN_PNU, config, include_geometry=True)
    summary = result["geometry_summary"]
    assert summary["geometry_type"] == "MultiPolygon" and summary["vertex_count"] == 5
    assert summary["lonlat_plausible"] is True
    assert summary["bbox"] == [127.0, 37.5, 127.0002, 37.5002]
    feature = ca.to_geojson(result)
    assert feature["type"] == "Feature" and feature["geometry"]["type"] == "MultiPolygon"
    assert feature["properties"]["pnu"] == SYN_PNU
    _assert_no_secret(json.dumps(result, ensure_ascii=False), json.dumps(feature, ensure_ascii=False), caplog.text)


def test_projected_coordinates_are_flagged_and_blocked(monkeypatch, config):
    projected = [[[[200000.0, 500000.0], [200010.0, 500000.0], [200010.0, 500010.0], [200000.0, 500000.0]]]]
    _patch_urlopen(monkeypatch, lambda *a, **k: _FakeResponse(_geom_body(coords=projected)))
    result = ca.fetch_parcel(SYN_PNU, config, include_geometry=True)
    assert result["geometry_summary"]["lonlat_plausible"] is False
    with pytest.raises(ca.VWorldCadastralError) as info:
        ca.to_geojson(result)
    assert info.value.code == "GEOMETRY_CRS_UNVERIFIED"


def test_missing_or_unsupported_geometry_is_reported(monkeypatch, config):
    _patch_urlopen(monkeypatch, lambda *a, **k: _FakeResponse(_geom_body(with_geometry=False)))
    result = ca.fetch_parcel(SYN_PNU, config, include_geometry=True)
    assert result["geometry"] is None and result["geometry_summary"] is None
    with pytest.raises(ca.VWorldCadastralError) as info:
        ca.to_geojson(result)
    assert info.value.code == "GEOMETRY_MISSING"

    _patch_urlopen(monkeypatch, lambda *a, **k: _FakeResponse(_geom_body(geometry_type="Point", coords=[127.0, 37.5])))
    assert ca.fetch_parcel(SYN_PNU, config, include_geometry=True)["geometry"] is None


def test_to_geojson_requires_geometry_request(monkeypatch, config):
    _patch_urlopen(monkeypatch, lambda *a, **k: _FakeResponse(_ok_body()))
    with pytest.raises(ca.VWorldCadastralError) as info:
        ca.to_geojson(ca.fetch_parcel(SYN_PNU, config))
    assert info.value.code == "GEOMETRY_NOT_REQUESTED"


def test_write_geojson_creates_file_and_never_overwrites(monkeypatch, config, tmp_path):
    _patch_urlopen(monkeypatch, lambda *a, **k: _FakeResponse(_geom_body()))
    result = ca.fetch_parcel(SYN_PNU, config, include_geometry=True)
    target = tmp_path / "parcel.geojson"
    ca.write_geojson(result, target)
    saved = json.loads(target.read_text(encoding="utf-8"))
    assert saved["type"] == "Feature" and saved["geometry"]["coordinates"][0][0][0] == [127.0, 37.5]
    _assert_no_secret(target.read_text(encoding="utf-8"))
    with pytest.raises(ca.VWorldCadastralError) as info:
        ca.write_geojson(result, target)
    assert info.value.code == "OUTPUT_EXISTS"


def test_cli_geojson_out_prints_summary_only(monkeypatch, tmp_path, capsys, caplog):
    env = tmp_path / ".env"
    env.write_text(f"VWORLD_API_KEY={FAKE_KEY}\n", encoding="utf-8")
    out = tmp_path / "p.geojson"
    _patch_urlopen(monkeypatch, lambda *a, **k: _FakeResponse(_geom_body()))
    assert ca.main(["--pnu", SYN_PNU, "--env", str(env), "--geojson-out", str(out)]) == 0
    captured = capsys.readouterr()
    payload = json.loads(captured.out)
    assert payload["ok"] is True and payload["geometry"]["vertex_count"] == 5
    assert "coordinates" not in captured.out and out.exists()
    _assert_no_secret(captured.out, captured.err, caplog.text, out.read_text(encoding="utf-8"))
