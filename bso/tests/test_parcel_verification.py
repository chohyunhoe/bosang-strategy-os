import json
from pathlib import Path

from bso_graphics.manifest_loader import load_manifest
from bso_graphics.parcel_verification import (
    _relationship_issues,
    build_pairwise_relationships,
    remove_blocked_outputs,
    verification_fingerprint,
    verification_gate_passed,
    verification_required,
    verification_result_path,
)


def _record(label: str, pnu: str, x: float, y: float) -> dict:
    return {
        "label": label,
        "pnu": pnu,
        "centroid": {"epsg5174": {"x": x, "y": y}},
    }


def test_pairwise_relationship_distance_and_direction():
    relationships = build_pairwise_relationships([
        _record("A", "1", 0.0, 0.0),
        _record("B", "2", 100.0, 100.0),
        _record("C", "3", -100.0, 0.0),
    ])
    assert len(relationships) == 3
    ab = relationships[0]
    assert ab["distance_m"] == 141.421
    assert ab["relative_direction"] == "NE"
    assert ab["relative_direction_ko"] == "북동"
    ac = relationships[1]
    assert ac["distance_m"] == 100.0
    assert ac["relative_direction"] == "W"


def test_pairwise_constraints_fail_on_distance_and_direction():
    relationships = build_pairwise_relationships([
        _record("A", "1", 0.0, 0.0),
        _record("B", "2", 100.0, 0.0),
    ])
    issues = _relationship_issues(relationships, {
        "max_pairwise_distance_m": 90,
        "pairwise_constraints": [
            {
                "from_pnu": "1",
                "to_pnu": "2",
                "min_distance_m": 10,
                "max_distance_m": 50,
                "allowed_directions": ["N"],
            }
        ],
    })
    codes = {item["code"] for item in issues}
    assert "PAIRWISE_DISTANCE_GLOBAL_MAX_EXCEEDED" in codes
    assert "PAIRWISE_DISTANCE_ABOVE_MAX" in codes
    assert "PAIRWISE_DIRECTION_MISMATCH" in codes


def test_verification_pass_is_invalidated_when_archive_changes(tmp_path):
    archive = tmp_path / "cadastral.zip"
    archive.write_bytes(b"first")
    manifest_path = tmp_path / "case.json"
    manifest_path.write_text(json.dumps({
        "case_id": "T1",
        "layers": [
            {"role": "subject", "archive": archive.name, "pnus": ["4139011200101200007"]},
            {"role": "standard", "archive": archive.name, "pnus": ["4139011200101300007"]},
        ],
        "parcel_verification": {
            "enabled": True,
            "required_pnus": [
                {"label": "120-7", "role": "subject", "pnu": "4139011200101200007", "expected_jibun": "120-7"},
                {"label": "130-7", "role": "standard", "pnu": "4139011200101300007", "expected_jibun": "130-7"},
            ],
        },
    }), encoding="utf-8")
    manifest = load_manifest(manifest_path)
    output_dir = tmp_path / "output"
    output_dir.mkdir()
    verification_result_path(output_dir).write_text(json.dumps({
        "schema_version": "bso_parcel_verification_v0.2",
        "status": "PASS",
        "manifest_fingerprint": verification_fingerprint(manifest),
    }), encoding="utf-8")
    assert verification_gate_passed(manifest, output_dir)

    archive.write_bytes(b"changed-input")
    assert not verification_gate_passed(manifest, output_dir)


def test_all_archive_manifests_require_verification():
    root = Path(__file__).resolve().parents[1]
    gmsh = load_manifest(root / "graphics-input" / "gwangmyeong_siheung.json")
    gongju = load_manifest(root / "graphics-input" / "gongju_songseon_donghyeon.json")

    assert verification_required(gmsh)
    assert verification_required(gongju)
    gmsh_required = gmsh["parcel_verification"]["required_pnus"]
    assert [item["pnu"] for item in gmsh_required] == [
        "4139011200101200007",
        "4139011200101200008",
        "4139011200101300007",
    ]
    assert [item["expected_jibun"] for item in gmsh_required] == ["120-7", "120-8", "130-7"]
    assert all(layer.get("role") != "case" for layer in gmsh["layers"])
    assert "standard_vs_case" not in gmsh["outputs"]
    assert gmsh["sample_brief"]["page2_review_required"] is True
    assert gmsh["sample_brief"]["page2_map_unavailable"] is True
    assert "지번 마스킹" in gmsh["sample_brief"]["page2_calc_rows"][0]["lot"]
    assert "17-3" not in json.dumps(gmsh, ensure_ascii=False)
    assert gongju["parcel_verification"]["required_pnus"]


def test_archive_geometry_cannot_opt_out_of_verification(tmp_path):
    archive = tmp_path / "a.zip"
    archive.write_bytes(b"x")
    path = tmp_path / "case.json"
    path.write_text(json.dumps({
        "case_id": "T1",
        "layers": [
            {"role": "subject", "archive": archive.name, "pnus": ["4139011200101200007"]},
            {"role": "standard", "archive": archive.name, "pnus": ["4139011200101300007"]},
        ],
        "parcel_verification": {"enabled": False},
    }), encoding="utf-8")
    assert verification_required(load_manifest(path))


def test_blocked_output_cleanup_removes_intermediates_and_cache(tmp_path):
    result_path = verification_result_path(tmp_path)
    result_path.write_text('{"status":"FAIL"}', encoding="utf-8")
    (tmp_path / "overview.png").write_bytes(b"old")
    (tmp_path / "graphics_manifest_result.json").write_text("{}", encoding="utf-8")
    cache = tmp_path / "_basemap-cache"
    cache.mkdir()
    (cache / "tile.jpg").write_bytes(b"old")
    selected = tmp_path / "selected-geometry"
    selected.mkdir()
    (selected / "subject.geojson").write_text("{}", encoding="utf-8")

    remove_blocked_outputs(tmp_path)

    assert result_path.exists()
    assert sorted(path.name for path in tmp_path.iterdir()) == ["parcel_verification_result.json"]


def test_windows_gate_runs_verification_before_render_and_brief():
    root = Path(__file__).resolve().parents[1]
    cmd = (root / "RUN_GRAPHICS_GATE.cmd").read_text(encoding="utf-8")
    assert "run_parcel_verification.py" in cmd
    assert "run_graphics_gate.py" in cmd
    assert "run_sample_brief.py" in cmd
    assert cmd.index("run_parcel_verification.py") < cmd.index("run_graphics_gate.py")
    assert cmd.index("run_graphics_gate.py") < cmd.index("run_sample_brief.py")
    assert 'call "%QGIS_PYTHON%" run_parcel_verification.py' in cmd
    assert 'call "%QGIS_PYTHON%" run_graphics_gate.py' in cmd
    assert 'call "%QGIS_PYTHON%" run_sample_brief.py' in cmd


def test_standalone_windows_verification_command_exists():
    root = Path(__file__).resolve().parents[1]
    cmd = (root / "RUN_PARCEL_VERIFICATION.cmd").read_text(encoding="utf-8")
    assert "run_parcel_verification.py" in cmd
    assert "graphics-input\\gwangmyeong_siheung.json" in cmd
