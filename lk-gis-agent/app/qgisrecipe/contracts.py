"""Contracts for QGIS Recipe Engine steps 1 through 5."""

from __future__ import annotations

from collections.abc import Mapping
from enum import StrEnum
from pathlib import Path
from typing import Any, Literal, Protocol

from pydantic import Field, model_validator

from app.models.common import EPSGCode, StrictModel


class LayerRole(StrEnum):
    SUBJECT = "SUBJECT"
    STANDARD = "STANDARD"
    CASE = "CASE"
    BIZ_ZONE = "BIZ_ZONE"


class RecipeStep(StrEnum):
    PROJECT_INIT = "PROJECT_INIT"
    LAYER_LOAD = "LAYER_LOAD"
    STYLE_APPLY = "STYLE_APPLY"
    LABEL_APPLY = "LABEL_APPLY"
    BASEMAP_ADD = "BASEMAP_ADD"


class StepStatus(StrEnum):
    DONE = "DONE"
    SKIPPED = "SKIPPED"
    WARNING = "WARNING"


_ALLOWED_LAYERS: dict[LayerRole, str] = {
    LayerRole.SUBJECT: "subject_parcels",
    LayerRole.STANDARD: "standard_parcels",
    LayerRole.CASE: "case_parcels",
    LayerRole.BIZ_ZONE: "biz_zone",
}


class LayerRecipe(StrictModel):
    role: LayerRole
    gpkg_layer: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_]+$")
    display_name: str = Field(min_length=1, max_length=120)
    qml_path: Path
    label_expression: str | None = Field(default=None, max_length=500)
    required: bool = True

    @model_validator(mode="after")
    def validate_layer_allowlist(self) -> LayerRecipe:
        expected = _ALLOWED_LAYERS[self.role]
        if self.gpkg_layer != expected:
            raise ValueError(f"{self.role} must use the allowlisted layer {expected}")
        if self.qml_path.suffix.lower() != ".qml":
            raise ValueError("QGIS named styles must use .qml files")
        return self


class BasemapRecipe(StrictModel):
    name: str = Field(min_length=1, max_length=120)
    provider: Literal["xyz"] = "xyz"
    url_template: str = Field(min_length=8, max_length=1000)
    attribution: str = Field(min_length=1, max_length=500)
    requires_api_key: bool = False
    api_key_placeholder: str = "{api_key}"

    @model_validator(mode="after")
    def validate_basemap(self) -> BasemapRecipe:
        if not self.url_template.startswith("https://"):
            raise ValueError("Basemap URLs must use HTTPS")
        placeholder_count = self.url_template.count(self.api_key_placeholder)
        if self.requires_api_key and placeholder_count != 1:
            raise ValueError("API-key basemaps require exactly one key placeholder")
        if not self.requires_api_key and placeholder_count:
            raise ValueError("Key placeholders require requires_api_key=true")
        return self


class RecipeConfig(StrictModel):
    gpkg_path: Path
    target_crs: EPSGCode
    layers: tuple[LayerRecipe, ...] = Field(min_length=1)
    basemap: BasemapRecipe | None = None
    project_variables: dict[str, str | int | float | bool] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_unique_layers(self) -> RecipeConfig:
        roles = [layer.role for layer in self.layers]
        names = [layer.gpkg_layer for layer in self.layers]
        if len(set(roles)) != len(roles):
            raise ValueError("Each layer role may appear only once")
        if len(set(names)) != len(names):
            raise ValueError("Each GeoPackage layer may appear only once")
        if LayerRole.SUBJECT not in roles:
            raise ValueError("SUBJECT layer recipe is required")
        return self


class StepReport(StrictModel):
    step: RecipeStep
    status: StepStatus
    message: str = Field(min_length=1, max_length=500)


class RecipeRunResult(StrictModel):
    steps: tuple[StepReport, ...]
    loaded_roles: tuple[LayerRole, ...]
    runtime_metadata: dict[str, Any] = Field(default_factory=dict)
    warnings: tuple[str, ...] = ()


class QgisRuntime(Protocol):
    """Minimal runtime boundary used by both PyQGIS and CI fakes."""

    def initialize_project(
        self,
        *,
        target_crs: str,
        variables: Mapping[str, str | int | float | bool],
    ) -> None: ...

    def load_vector_layer(
        self,
        *,
        gpkg_path: Path,
        layer_name: str,
        display_name: str,
        role: LayerRole,
    ) -> bool: ...

    def apply_named_style(self, *, role: LayerRole, qml_path: Path) -> None: ...

    def apply_labeling(self, *, role: LayerRole, expression: str) -> None: ...

    def add_xyz_basemap(
        self,
        *,
        name: str,
        url: str,
        attribution: str,
        persist: bool,
    ) -> None: ...

    def snapshot_metadata(self) -> dict[str, Any]: ...
