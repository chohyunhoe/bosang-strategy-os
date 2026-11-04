"""LK role defaults for QGIS Recipe Engine steps 1 through 5."""

from __future__ import annotations

from pathlib import Path

from app.qgisrecipe.contracts import (
    BasemapRecipe,
    LayerRecipe,
    LayerRole,
    RecipeConfig,
)

_STYLE_ROOT = Path(__file__).parent / "templates" / "styles"


def build_lk_recipe_config(
    *,
    gpkg_path: Path,
    target_crs: str,
    basemap: BasemapRecipe | None = None,
    project_variables: dict[str, str | int | float | bool] | None = None,
) -> RecipeConfig:
    """Build the locked LK layer order, role colors and label expressions."""

    layers = (
        LayerRecipe(
            role=LayerRole.SUBJECT,
            gpkg_layer="subject_parcels",
            display_name="대상토지",
            qml_path=_STYLE_ROOT / "subject.qml",
            label_expression='"addr_jibun"',
            required=True,
        ),
        LayerRecipe(
            role=LayerRole.STANDARD,
            gpkg_layer="standard_parcels",
            display_name="비교표준지",
            qml_path=_STYLE_ROOT / "standard.qml",
            label_expression="concat('표준지 ', \"addr_jibun\")",
            required=False,
        ),
        LayerRecipe(
            role=LayerRole.CASE,
            gpkg_layer="case_parcels",
            display_name="평가사례",
            qml_path=_STYLE_ROOT / "case.qml",
            label_expression="concat('사례 ', \"addr_jibun\")",
            required=False,
        ),
        LayerRecipe(
            role=LayerRole.BIZ_ZONE,
            gpkg_layer="biz_zone",
            display_name="사업구역",
            qml_path=_STYLE_ROOT / "biz_zone.qml",
            required=False,
        ),
    )
    return RecipeConfig(
        gpkg_path=gpkg_path,
        target_crs=target_crs,
        layers=layers,
        basemap=basemap,
        project_variables=project_variables or {},
    )
