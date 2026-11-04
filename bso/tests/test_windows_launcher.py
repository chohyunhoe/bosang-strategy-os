from pathlib import Path


def test_root_launcher_calls_local_powershell_wizard():
    repo = Path(__file__).resolve().parents[2]
    cmd_path = repo / "RUN_BSO_V01.cmd"
    cmd_bytes = cmd_path.read_bytes()
    cmd = cmd_bytes.decode("ascii")
    script = (repo / "scripts" / "run_bso_v01.ps1").read_text(encoding="utf-8-sig")

    assert b"\r\n" in cmd_bytes
    assert cmd_bytes.count(b"\r\n") == cmd_bytes.count(b"\n")
    assert "run_bso_v01.ps1" in cmd
    assert "ExecutionPolicy Bypass" in cmd
    assert "Sillim" in script
    assert "Gwangmyeong" in script
    assert "expected_e2e.json" in script
    assert "BSO_PDF_PASSWORD" in script
    assert "silim284111" not in script
    assert '$settings["VWORLD_API_KEY"]' in script
    assert "$env:VWORLD_API_KEY" in script
    assert "TrimStart([char]0xFEFF)" in script
    assert "UTF8Encoding]::new($false)" in script
    assert '$ErrorActionPreference = "Continue"' in script
    assert "[switch]$NoUi" in script
    assert '$null = & $python -c "import pymupdf"' in script
    assert '$python -c "import fitz"' not in script
    assert "C985" not in script


def test_sillim_e2e_fixture_is_ground_truth_only():
    repo = Path(__file__).resolve().parents[2]
    fixture = (
        repo
        / "bso"
        / "fixtures"
        / "golden_cases"
        / "sillim_1513_2"
        / "expected_e2e.json"
    ).read_text(encoding="utf-8")

    assert '"usage": "golden_case_only"' in fixture
    assert '"active_parser_hardcoding_allowed": false' in fixture
    assert '"standard_lot": "1526-2"' in fixture
