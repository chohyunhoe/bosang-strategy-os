"""Orchestration for QGIS Recipe Engine steps 1 through 5."""

from __future__ import annotations

from typing import Any

from app.qgisrecipe.contracts import (
    LayerRole,
    QgisRuntime,
    RecipeConfig,
    RecipeRunResult,
    RecipeStep,
    StepReport,
    StepStatus,
)


def run_steps_1_to_5(
    config: RecipeConfig,
    runtime: QgisRuntime,
    *,
    basemap_api_key: str | None = None,
) -> RecipeRunResult:
    """Execute project init, layer load, style, labels and ephemeral basemap setup."""

    _validate_local_inputs(config)
    reports: list[StepReport] = []
    warnings: list[str] = []
    loaded_roles: list[LayerRole] = []

    runtime.initialize_project(
        target_crs=config.target_crs,
        variables=config.project_variables,
    )
    reports.append(_done(RecipeStep.PROJECT_INIT, f"Project initialized in {config.target_crs}"))

    for layer in config.layers:
        loaded = runtime.load_vector_layer(
            gpkg_path=config.gpkg_path,
            layer_name=layer.gpkg_layer,
            display_name=layer.display_name,
            role=layer.role,
        )
        if not loaded:
            message = f"GeoPackage layer not available: {layer.gpkg_layer}"
            if layer.required:
                raise RuntimeError(message)
            warnings.append(message)
            continue
        loaded_roles.append(layer.role)

    reports.append(
        _done(
            RecipeStep.LAYER_LOAD,
            f"Loaded {len(loaded_roles)} allowlisted GeoPackage layers",
        )
    )

    for layer in config.layers:
        if layer.role not in loaded_roles:
            continue
        runtime.apply_named_style(role=layer.role, qml_path=layer.qml_path)
    reports.append(_done(RecipeStep.STYLE_APPLY, "Applied LK role styles from QML"))

    labeled = 0
    for layer in config.layers:
        if layer.role not in loaded_roles or not layer.label_expression:
            continue
        runtime.apply_labeling(role=layer.role, expression=layer.label_expression)
        labeled += 1
    label_status = StepStatus.DONE if labeled else StepStatus.SKIPPED
    reports.append(
        StepReport(
            step=RecipeStep.LABEL_APPLY,
            status=label_status,
            message=f"Applied labeling to {labeled} layers" if labeled else "No labels requested",
        )
    )

    if config.basemap is None:
        reports.append(
            StepReport(
                step=RecipeStep.BASEMAP_ADD,
                status=StepStatus.SKIPPED,
                message="No basemap configured",
            )
        )
    else:
        url = materialize_basemap_url(config.basemap, api_key=basemap_api_key)
        runtime.add_xyz_basemap(
            name=config.basemap.name,
            url=url,
            attribution=config.basemap.attribution,
            persist=False,
        )
        reports.append(
            _done(
                RecipeStep.BASEMAP_ADD,
                "Added an in-memory XYZ basemap; credentials are excluded from recipe results",
            )
        )

    metadata = _sanitize_metadata(runtime.snapshot_metadata(), secret=basemap_api_key)
    return RecipeRunResult(
        steps=tuple(reports),
        loaded_roles=tuple(loaded_roles),
        runtime_metadata=metadata,
        warnings=tuple(warnings),
    )


def materialize_basemap_url(basemap: Any, *, api_key: str | None) -> str:
    """Materialize a runtime-only URL and never return it in recipe metadata."""

    if basemap.requires_api_key:
        if not api_key:
            raise ValueError("The configured basemap requires an API key")
        return basemap.url_template.replace(basemap.api_key_placeholder, api_key)
    return basemap.url_template


def _validate_local_inputs(config: RecipeConfig) -> None:
    if not config.gpkg_path.is_file():
        raise FileNotFoundError(config.gpkg_path)
    for layer in config.layers:
        if not layer.qml_path.is_file():
            raise FileNotFoundError(layer.qml_path)


def _sanitize_metadata(value: Any, *, secret: str | None) -> Any:
    if isinstance(value, dict):
        return {key: _sanitize_metadata(item, secret=secret) for key, item in value.items()}
    if isinstance(value, list):
        return [_sanitize_metadata(item, secret=secret) for item in value]
    if isinstance(value, tuple):
        return tuple(_sanitize_metadata(item, secret=secret) for item in value)
    if isinstance(value, str) and secret:
        return value.replace(secret, "<redacted>")
    return value


def _done(step: RecipeStep, message: str) -> StepReport:
    return StepReport(step=step, status=StepStatus.DONE, message=message)
