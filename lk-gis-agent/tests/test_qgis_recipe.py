"""Recipe Engine steps 1 through 5 and environment spike tests."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any
from xml.etree import ElementTree

import pytest
from pydantic import ValidationError

from app.qgisrecipe import (
    BasemapRecipe,
    LayerRecipe,
    LayerRole,
    QgisExecutionMode,
    RecipeStep,
    build_lk_recipe_config,
    probe_qgis_environment,
    run_steps_1_to_5,
)


class FakeRuntime:
    def __init__(self, *, missing: set[LayerRole] | None = None) -> None:
        self.missing = missing or set()
        self.calls: list[tuple[str, Any]] = []
        self.metadata: dict[str, Any] = {"runtime": "fake"}

    def initialize_project(self, *, target_crs: str, variables: dict) -> None:
        self.calls.append(("init", (target_crs, variables)))

    def load_vector_layer(
        self,
        *,
        gpkg_path: Path,
        layer_name: str,
        display_name: str,
        role: LayerRole,
    ) -> bool:
        self.calls.append(("load", (gpkg_path, layer_name, display_name, role)))
        return role not in self.missing

    def apply_named_style(self, *, role: LayerRole, qml_path: Path) -> None:
        self.calls.append(("style", (role, qml_path)))

    def apply_labeling(self, *, role: LayerRole, expression: str) -> None:
        self.calls.append(("label", (role, expression)))

    def add_xyz_basemap(
        self,
        *,
        name: str,
        url: str,
        attribution: str,
        persist: bool,
    ) -> None:
        self.calls.append(("basemap", (name, url, attribution, persist)))
        self.metadata["debug_url"] = url

    def snapshot_metadata(self) -> dict[str, Any]:
        return self.metadata


def gpkg(tmp_path: Path) -> Path:
    path = tmp_path / "case.gpkg"
    path.write_bytes(b"gpkg-placeholder")
    return path


def test_steps_1_to_5_run_in_locked_order(tmp_path: Path) -> None:
    runtime = FakeRuntime()
    config = build_lk_recipe_config(
        gpkg_path=gpkg(tmp_path),
        target_crs="EPSG:5186",
        project_variables={"lk_case_name": "광명시흥 PoC"},
    )

    result = run_steps_1_to_5(config, runtime)

    assert [report.step for report in result.steps] == list(RecipeStep)
    assert result.loaded_roles == (
        LayerRole.SUBJECT,
        LayerRole.STANDARD,
        LayerRole.CASE,
        LayerRole.BIZ_ZONE,
    )
    call_names = [name for name, _ in runtime.calls]
    assert call_names[0] == "init"
    assert call_names[1:5] == ["load"] * 4
    assert call_names[5:9] == ["style"] * 4
    assert call_names[9:12] == ["label"] * 3


def test_optional_missing_layer_becomes_warning(tmp_path: Path) -> None:
    runtime = FakeRuntime(missing={LayerRole.CASE, LayerRole.BIZ_ZONE})
    config = build_lk_recipe_config(gpkg_path=gpkg(tmp_path), target_crs="EPSG:5186")

    result = run_steps_1_to_5(config, runtime)

    assert result.loaded_roles == (LayerRole.SUBJECT, LayerRole.STANDARD)
    assert len(result.warnings) == 2
    assert not any(
        name == "style" and payload[0] is LayerRole.CASE for name, payload in runtime.calls
    )


def test_required_subject_layer_failure_stops_recipe(tmp_path: Path) -> None:
    runtime = FakeRuntime(missing={LayerRole.SUBJECT})
    config = build_lk_recipe_config(gpkg_path=gpkg(tmp_path), target_crs="EPSG:5186")

    with pytest.raises(RuntimeError, match="subject_parcels"):
        run_steps_1_to_5(config, runtime)


def test_basemap_key_is_runtime_only_and_redacted(tmp_path: Path) -> None:
    runtime = FakeRuntime()
    basemap = BasemapRecipe(
        name="공적 배경지도",
        url_template="https://maps.example.test/{api_key}/{z}/{x}/{y}.png",
        attribution="공적 지도 제공기관 — 공식문구 확인 필요",
        requires_api_key=True,
    )
    config = build_lk_recipe_config(
        gpkg_path=gpkg(tmp_path),
        target_crs="EPSG:5186",
        basemap=basemap,
    )

    result = run_steps_1_to_5(config, runtime, basemap_api_key="secret-key")

    basemap_calls = [payload for name, payload in runtime.calls if name == "basemap"]
    assert basemap_calls[0][1].startswith("https://maps.example.test/secret-key/")
    assert basemap_calls[0][3] is False
    assert result.runtime_metadata["debug_url"].startswith(
        "https://maps.example.test/<redacted>/"
    )
    assert "secret-key" not in result.model_dump_json()


def test_basemap_requiring_key_rejects_missing_credential(tmp_path: Path) -> None:
    config = build_lk_recipe_config(
        gpkg_path=gpkg(tmp_path),
        target_crs="EPSG:5186",
        basemap=BasemapRecipe(
            name="map",
            url_template="https://maps.example.test/{api_key}/{z}/{x}/{y}.png",
            attribution="source",
            requires_api_key=True,
        ),
    )
    with pytest.raises(ValueError, match="requires an API key"):
        run_steps_1_to_5(config, FakeRuntime())


def test_layer_recipe_enforces_role_allowlist(tmp_path: Path) -> None:
    style = tmp_path / "subject.qml"
    style.write_text("<qgis/>", encoding="utf-8")
    with pytest.raises(ValidationError, match="allowlisted"):
        LayerRecipe(
            role=LayerRole.SUBJECT,
            gpkg_layer="review_queue",
            display_name="잘못된 레이어",
            qml_path=style,
        )


def test_packaged_qml_files_are_well_formed(tmp_path: Path) -> None:
    config = build_lk_recipe_config(gpkg_path=gpkg(tmp_path), target_crs="EPSG:5186")
    for layer in config.layers:
        root = ElementTree.parse(layer.qml_path).getroot()
        assert root.tag == "qgis"
        assert root.find("renderer-v2") is not None


def test_environment_probe_prefers_in_process() -> None:
    fake_core = SimpleNamespace(Qgis=SimpleNamespace(QGIS_VERSION="3.mock"))
    report = probe_qgis_environment(
        environ={},
        import_module=lambda name: fake_core,
        which=lambda name: None,
        path_exists=lambda path: False,
    )
    assert report.detected is True
    assert report.qgis_version == "3.mock"
    assert report.recommended_mode is QgisExecutionMode.IN_PROCESS


def test_environment_probe_detects_osgeo_subprocess_launcher() -> None:
    def missing_import(name: str) -> Any:
        raise ImportError(name)

    report = probe_qgis_environment(
        environ={"OSGEO4W_ROOT": "C:/OSGeo4W"},
        import_module=missing_import,
        which=lambda name: None,
        path_exists=lambda path: path.name == "python-qgis-ltr.bat",
    )
    assert report.detected is True
    assert report.python_qgis_launcher is not None
    assert report.recommended_mode is QgisExecutionMode.SUBPROCESS


def test_environment_probe_reports_unavailable() -> None:
    def missing_import(name: str) -> Any:
        raise ImportError(name)

    report = probe_qgis_environment(
        environ={},
        import_module=missing_import,
        which=lambda name: None,
        path_exists=lambda path: False,
    )
    assert report.detected is False
    assert report.recommended_mode is QgisExecutionMode.UNAVAILABLE
