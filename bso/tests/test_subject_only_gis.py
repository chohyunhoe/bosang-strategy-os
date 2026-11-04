"""subject-only 상담배포 지도 runner의 QGIS 비의존 게이트 로직 테스트.

PNU는 privacy guard 규칙에 따라 합성 네임스페이스(99999…)만 사용한다.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import run_subject_only_gis as so  # noqa: E402
from bso_graphics.manifest_loader import load_manifest  # noqa: E402

SYN = "99999000001"  # 법정동 10자리 + 일반(1)


def _pnu(main: int, sub: int, mountain: str = "1") -> str:
    return SYN[:10] + mountain + f"{main:04d}{sub:04d}"


def _manifest(tmp_path: Path, **overrides) -> dict:
    archive = tmp_path / "source" / "SYNTH.zip"
    archive.parent.mkdir(parents=True, exist_ok=True)
    archive.write_bytes(b"PK\x05\x06" + b"\x00" * 18)
    parcels = [(_pnu(2, 5), "2-5"), (_pnu(2, 116), "2-116"), (_pnu(256, 1), "256-1")]
    payload = {
        "case_id": "SYNTH_SUBJECT_ONLY",
        "subject_only": True,
        "expected_parcel_count": 3,
        "parcel_verification": {
            "enabled": True,
            "required_pnus": [{"role": "subject", "pnu": p, "expected_jibun": j} for p, j in parcels],
        },
        "layers": [{
            "role": "subject",
            "archive": "source/SYNTH.zip",
            "pnus": [p for p, _ in parcels],
            "pnu_field": "A1",
            "jibun_field": "A4",
        }],
        "working_hypothesis_groups": {"groups": [{"id": "A", "jibuns": ["2-5", "2-116"]},
                                                 {"id": "B", "jibuns": ["256-1"]}]},
    }
    payload.update(overrides)
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return load_manifest(path)


def test_pnu_to_jibun_main_sub_and_mountain():
    assert so.pnu_to_jibun(_pnu(2, 5)) == "2-5"
    assert so.pnu_to_jibun(_pnu(256, 0)) == "256"
    assert so.pnu_to_jibun(_pnu(12, 3, mountain="2")) == "산12-3"


def test_strict_jibun_rejects_what_prefix_match_would_accept():
    assert so.strict_jibun_equal("2-5", "2-5대")
    assert so.strict_jibun_equal("256-1", "256-1 대")
    assert not so.strict_jibun_equal("2-5", "2-50대")
    assert not so.strict_jibun_equal("2-5", "2-5-3대")
    assert not so.strict_jibun_equal("2", "2-5대")
    assert not so.strict_jibun_equal("", "")
    assert so.strict_jibun_equal("2-5", "2-5\ufffd")  # 지목 글자 인코딩 깨짐
    assert so.strict_jibun_equal("산12-3", "산12-3임")
    assert not so.strict_jibun_equal("256-1", "256-10대")


def test_preflight_passes_for_consistent_subject_only_manifest(tmp_path):
    assert so.subject_only_preflight(_manifest(tmp_path)) == []


def test_preflight_blocks_fake_standard_role_and_self_mismatch(tmp_path):
    manifest = _manifest(tmp_path)
    manifest["layers"].append({"role": "standard", "archive": "source/SYNTH.zip", "pnus": [_pnu(9, 9)]})
    manifest["parcel_verification"]["required_pnus"][1]["expected_jibun"] = "2-161"
    codes = {item["code"] for item in so.subject_only_preflight(manifest)}
    assert "NON_SUBJECT_ROLE_FORBIDDEN" in codes
    assert "PNU_JIBUN_SELF_MISMATCH" in codes
    assert "GROUP_MEMBER_NOT_IN_SUBJECT" in codes


def test_preflight_blocks_count_mismatch_and_missing_archive(tmp_path):
    manifest = _manifest(tmp_path, expected_parcel_count=10)
    (tmp_path / "source" / "SYNTH.zip").unlink()
    codes = {item["code"] for item in so.subject_only_preflight(manifest)}
    assert {"REQUIRED_PNU_COUNT_MISMATCH", "CADASTRAL_ARCHIVE_MISSING"} <= codes


def test_preflight_requires_subject_only_flag(tmp_path):
    codes = {item["code"] for item in so.subject_only_preflight(_manifest(tmp_path, subject_only=False))}
    assert "SUBJECT_ONLY_FLAG_REQUIRED" in codes


def test_subject_only_gate_fails_on_strict_mismatch():
    manifest = {"expected_parcel_count": 2}
    result = {
        "verified_count": 2,
        "records": [
            {"pnu": _pnu(2, 5), "expected_jibun": "2-5",
             "resolved_attributes": {"pnu": _pnu(2, 5), "jibun": "2-5-3대"}},
            {"pnu": _pnu(2, 116), "expected_jibun": "2-116",
             "resolved_attributes": {"pnu": _pnu(2, 116), "jibun": "2-116대"}},
        ],
    }
    issues = so.apply_subject_only_gate(result, manifest)
    assert [item["code"] for item in issues] == ["SUBJECT_JIBUN_STRICT_MISMATCH"]
    assert result["records"][1]["subject_only_check"]["pass"] is True


def test_subject_only_gate_fails_on_count():
    issues = so.apply_subject_only_gate({"verified_count": 9, "records": []}, {"expected_parcel_count": 10})
    assert issues[0]["code"] == "SUBJECT_VERIFIED_COUNT_MISMATCH"


def test_area_assessment_levels():
    reference = {"expected_total_m2": 1000.0, "warn_ratio": 0.01, "anomaly_ratio": 0.03}
    assert so.assess_area([500.0, 505.0], reference)["level"] == "WITHIN_TOLERANCE"
    assert so.assess_area([1020.0], reference)["level"] == "REVIEW_DIFFERENCE"
    high = so.assess_area([1100.0], reference)
    assert high["level"] == "ANOMALY_WARNING"
    assert high["difference_m2"] == 100.0
    assert so.assess_area([10.0], None)["level"] == "NO_REFERENCE"


def test_redact_removes_secret_everywhere():
    secret = "SECRET-VWORLD-KEY-123"
    payload = {"a": f"https://x/{secret}/tile", "b": [secret, {"c": "ok"}]}
    text = json.dumps(so.redact(payload, [secret]))
    assert secret not in text
    assert so.redact("short", ["abc"]) == "short"


def test_fit_extent_keeps_aspect_and_bounds():
    extent = so.fit_extent((0, 0, 100, 40), aspect=1.5, pad_ratio=0.1, min_pad=5)
    width, height = extent[2] - extent[0], extent[3] - extent[1]
    assert abs(width / height - 1.5) < 1e-9
    assert extent[0] <= -10 and extent[2] >= 110 and extent[1] <= -5 and extent[3] >= 45


def test_label_geometry_helpers():
    assert so.rects_overlap((0, 0, 10, 10), (5, 5, 10, 10))
    assert not so.rects_overlap((0, 0, 10, 10), (11, 0, 5, 5))
    assert so.segment_hits_rect((0, 5), (20, 5), (8, 0, 4, 10))
    assert not so.segment_hits_rect((0, 20), (20, 20), (8, 0, 4, 10))
    assert so.nearest_point_on_rect((10, 10, 10, 10), 0, 15) == (10, 15)
    assert len(so.leader_candidates((0, 0), 0.0, [5.0, 10.0])) == 2 * 17
    assert so.nice_scale_length(230) == 50.0


def test_launcher_is_ascii_crlf_and_does_not_echo_key():
    cmd = (HERE / "RUN_SUBJECT_ONLY_GIS.cmd").read_bytes()
    assert cmd.count(b"\r\n") == cmd.count(b"\n")
    text = cmd.decode("ascii")
    assert "run_subject_only_gis.py" in text
    assert "%VWORLD_API_KEY%" not in text  # 값 확장(출력) 자체가 없어야 한다
