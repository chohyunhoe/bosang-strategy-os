import json
import zipfile
from pathlib import Path

from bso_graphics.brief_slot_mapper import write_slot_map
from bso_graphics.cadastral_source import prepare_layer_specs
from bso_graphics.flow_graphic import generate_other_factor_flow
from bso_graphics.layout_exporter import write_report
from bso_graphics.manifest_loader import load_manifest
from bso_graphics.parcel_verification import _find_attribute_field
from bso_graphics.qgis_renderer import _map_profile, _preflight


class _FakeFields:
    def names(self):
        return ["A1", "A4"]


class _FakeLayer:
    def fields(self):
        return _FakeFields()


def test_manifest_requires_case_id(tmp_path):
    path = tmp_path / "bad.json"
    path.write_text(json.dumps({"layers": []}), encoding="utf-8")
    try:
        load_manifest(path)
    except ValueError as exc:
        assert "case_id" in str(exc)
    else:
        raise AssertionError("case_id 누락이 허용됨")


def test_archive_layer_requires_valid_pnu(tmp_path):
    path = tmp_path / "bad.json"
    path.write_text(json.dumps({
        "case_id": "T1",
        "layers": [
            {"role": "subject", "archive": "a.zip", "pnus": ["123"]},
            {"role": "standard", "archive": "a.zip", "pnus": ["9999999999200350001"]},
        ],
    }), encoding="utf-8")
    try:
        load_manifest(path)
    except ValueError as exc:
        assert "invalid PNU" in str(exc)
    else:
        raise AssertionError("잘못된 PNU가 허용됨")


def test_missing_archive_is_review_required_input(tmp_path):
    path = tmp_path / "case.json"
    path.write_text(json.dumps({
        "case_id": "T1",
        "layers": [
            {"role": "subject", "archive": "missing.zip", "pnus": ["9999999999102250004"], "lot": "301-4"},
            {"role": "standard", "archive": "missing.zip", "pnus": ["9999999999200350001"], "lot": "산91-1"},
            {"role": "case", "archive": "missing.zip", "pnus": ["9999999999102690005"], "lot": "505-5"},
        ],
    }), encoding="utf-8")
    manifest = load_manifest(path)
    codes = {item["code"] for item in _preflight(manifest, "dummy")}
    assert "CADASTRAL_ARCHIVE_MISSING" in codes


def test_cadastral_zip_is_prepared_without_qgis(tmp_path):
    archive_path = tmp_path / "cadastral.zip"
    with zipfile.ZipFile(archive_path, "w") as archive:
        for suffix in ("shp", "shx", "dbf", "prj"):
            archive.writestr(f"LSMD_CONT_LDREG_SAMPLE.{suffix}", "placeholder")
    manifest_path = tmp_path / "case.json"
    manifest_path.write_text(json.dumps({
        "case_id": "T1",
        "layers": [
            {"role": "subject", "archive": archive_path.name, "pnus": ["9999999999102250004"]},
            {"role": "standard", "archive": archive_path.name, "pnus": ["9999999999200350001"]},
        ],
    }), encoding="utf-8")
    manifest = load_manifest(manifest_path)
    specs = prepare_layer_specs(manifest, tmp_path / "work")
    assert Path(specs[0]["_prepared_source"]).name == "LSMD_CONT_LDREG_SAMPLE.shp"
    assert specs[0]["_subset_pnus"] == ["9999999999102250004"]


def test_case_review_blocks_only_case_output(tmp_path):
    archive = tmp_path / "a.zip"
    archive.write_bytes(b"not-opened-in-preflight")
    path = tmp_path / "case.json"
    path.write_text(json.dumps({
        "case_id": "T1",
        "layers": [
            {"role": "subject", "archive": archive.name, "pnus": ["9999999999101200007"], "lot": "120-7"},
            {"role": "standard", "archive": archive.name, "pnus": ["9999999999101300007"], "lot": "130-7"},
            {"role": "case", "archive": archive.name, "pnus": ["9999999999100170003"], "lot": "17-3", "review_required": True},
        ],
    }), encoding="utf-8")
    manifest = load_manifest(path)
    codes = {item["code"] for item in _preflight(manifest, "dummy")}
    assert "CASE_REVIEW_REQUIRED" in codes
    assert "CADASTRAL_ARCHIVE_MISSING" not in codes


def test_flow_graphic_and_slot_map_are_created(tmp_path):
    flow = {
        "title": "Flow",
        "series": [
            {
                "name": "A",
                "steps": [
                    {"label": "Case", "value": "100"},
                    {"label": "Time", "value": "1.1"},
                    {"label": "Decision", "value": "2.5"},
                ],
            }
        ],
    }
    outputs = generate_other_factor_flow(flow, tmp_path)
    assert {path.suffix for path in outputs} == {".png", ".pdf"}
    (tmp_path / "overview.png").write_bytes(b"png")
    issues = [{"code": "CASE_REVIEW_REQUIRED", "message": "check"}]
    slot_path = write_slot_map(tmp_path, issues)
    payload = json.loads(slot_path.read_text(encoding="utf-8"))
    assert payload["slots"]["PAGE1_HERO_GRAPHIC"]["status"] == "READY"
    assert payload["slots"]["PAGE3_STANDARD_GRAPHIC"]["status"] == "REVIEW_REQUIRED"
    assert payload["slots"]["PAGE4_FLOW_GRAPHIC"]["status"] == "READY"


def test_slot_map_uses_review_map_fallback(tmp_path):
    (tmp_path / "review-map.png").write_bytes(b"png")
    slot_path = write_slot_map(tmp_path, [])
    payload = json.loads(slot_path.read_text(encoding="utf-8"))
    assert payload["slots"]["PAGE1_HERO_GRAPHIC"]["status"] == "READY"
    assert payload["slots"]["PAGE3_SUBJECT_GRAPHIC"]["status"] == "READY"


def test_report_is_created_without_qgis(tmp_path):
    manifest = {"case_id": "T1", "title": "테스트"}
    result = {"status": "REVIEW_REQUIRED", "outputs": [], "issues": [{"code": "X", "message": "확인"}]}
    report = write_report(manifest, result, tmp_path)
    assert report.exists()
    assert (tmp_path / "graphics_report.md").exists()


def test_sample_brief_manifest_contract(tmp_path):
    path = tmp_path / "case.json"
    path.write_text(json.dumps({
        "case_id": "T1",
        "layers": [],
        "sample_brief": {
            "page1_title": "자동표1",
            "page1_rows": [{"company": "A", "total": "1.000"}],
            "page2_title": "자동표2",
            "page2_rows": [{"company": "A", "decision": "2.50"}],
        },
    }, ensure_ascii=False), encoding="utf-8")
    manifest = load_manifest(path)
    assert manifest["sample_brief"]["page1_rows"][0]["company"] == "A"
    assert manifest["sample_brief"]["page2_rows"][0]["decision"] == "2.50"


def test_windows_gate_chains_final_sample_renderer():
    root = Path(__file__).resolve().parents[1]
    cmd = (root / "RUN_GRAPHICS_GATE.cmd").read_text(encoding="utf-8")
    assert "run_graphics_gate.py" in cmd
    assert "run_sample_brief.py" in cmd
    assert cmd.index("run_graphics_gate.py") < cmd.index("run_sample_brief.py")


def test_pair_maps_use_landscape_profiles_with_independent_scales():
    manifest = {
        "map_profiles": {
            "subject_vs_standard": {"extent_scale": 1.16},
            "standard_vs_case": {"extent_scale": 1.12},
        }
    }
    first = _map_profile(manifest, "subject_vs_standard")
    second = _map_profile(manifest, "standard_vs_case")
    assert first["page_width_mm"] > first["page_height_mm"]
    assert second["page_width_mm"] > second["page_height_mm"]
    assert first["extent_scale"] == 1.16
    assert second["extent_scale"] == 1.12


def test_cadastral_field_mapping_supports_public_dataset_codes():
    layer = _FakeLayer()
    assert _find_attribute_field(layer, "A1", ("PNU",)) == "A1"
    assert _find_attribute_field(layer, "A4", ("JIBUN",)) == "A4"
