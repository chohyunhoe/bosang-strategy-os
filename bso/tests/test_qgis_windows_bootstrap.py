from pathlib import Path

from bso_graphics.qgis_windows_bootstrap import configure_windows_dll_search


def test_qgis_dll_bootstrap_is_noop_off_windows(tmp_path, monkeypatch):
    monkeypatch.setattr("bso_graphics.qgis_windows_bootstrap.os.name", "posix")
    assert configure_windows_dll_search(str(tmp_path)) == []


def test_qgis_entrypoints_configure_dll_search_before_qgis_import():
    root = Path(__file__).resolve().parents[1]
    parcel = (root / "run_parcel_verification.py").read_text(encoding="utf-8")
    sample = (root / "run_sample_brief.py").read_text(encoding="utf-8")

    assert parcel.index("configure_windows_dll_search()") < parcel.index("from qgis.core import QgsApplication")
    assert sample.index("configure_windows_dll_search()") < sample.index("from qgis.core import QgsApplication")
    assert sample.index("except (ImportError, OSError):") < sample.index("from bso_graphics.fitz_sample_brief_renderer import")
