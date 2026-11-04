"""Lazy PyQGIS runtime used only on a QGIS-enabled workstation."""

from __future__ import annotations

import importlib
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from app.qgisrecipe.contracts import LayerRole


class PyQgisRuntime:
    """In-process runtime for Recipe Engine steps 1 through 5.

    Imports are intentionally delayed until construction so normal CI and FastAPI health
    checks remain usable without QGIS installed.
    """

    def __init__(self, *, prefix_path: str | None = None) -> None:
        self._core = importlib.import_module("qgis.core")
        self._qtgui = importlib.import_module("qgis.PyQt.QtGui")
        app_type = self._core.QgsApplication
        if prefix_path:
            app_type.setPrefixPath(prefix_path, True)
        self._app = app_type([], False)
        self._app.initQgis()
        self._project = self._core.QgsProject.instance()
        self._layers: dict[LayerRole, Any] = {}
        self._ephemeral_layer_ids: list[str] = []
        self._basemap_attribution: str | None = None

    def initialize_project(
        self,
        *,
        target_crs: str,
        variables: Mapping[str, str | int | float | bool],
    ) -> None:
        self._project.clear()
        crs = self._core.QgsCoordinateReferenceSystem(target_crs)
        if not crs.isValid():
            raise RuntimeError(f"Invalid QGIS CRS: {target_crs}")
        self._project.setCrs(crs)
        for key, value in variables.items():
            self._core.QgsExpressionContextUtils.setProjectVariable(
                self._project,
                key,
                value,
            )

    def load_vector_layer(
        self,
        *,
        gpkg_path: Path,
        layer_name: str,
        display_name: str,
        role: LayerRole,
    ) -> bool:
        uri = f"{gpkg_path}|layername={layer_name}"
        layer = self._core.QgsVectorLayer(uri, display_name, "ogr")
        if not layer.isValid():
            return False
        self._project.addMapLayer(layer)
        self._layers[role] = layer
        return True

    def apply_named_style(self, *, role: LayerRole, qml_path: Path) -> None:
        layer = self._layer(role)
        ok, message = layer.loadNamedStyle(str(qml_path))
        if not ok:
            raise RuntimeError(f"QML style load failed for {role}: {message}")
        layer.triggerRepaint()

    def apply_labeling(self, *, role: LayerRole, expression: str) -> None:
        layer = self._layer(role)
        settings = self._core.QgsPalLayerSettings()
        settings.fieldName = expression
        settings.isExpression = True

        text_format = self._core.QgsTextFormat()
        text_format.setSize(9)
        buffer = self._core.QgsTextBufferSettings()
        buffer.setEnabled(True)
        buffer.setSize(1)
        buffer.setColor(self._qtgui.QColor("white"))
        text_format.setBuffer(buffer)
        settings.setFormat(text_format)

        layer.setLabeling(self._core.QgsVectorLayerSimpleLabeling(settings))
        layer.setLabelsEnabled(True)
        layer.triggerRepaint()

    def add_xyz_basemap(
        self,
        *,
        name: str,
        url: str,
        attribution: str,
        persist: bool,
    ) -> None:
        uri = f"type=xyz&url={url}"
        layer = self._core.QgsRasterLayer(uri, name, "wms")
        if not layer.isValid():
            raise RuntimeError("Configured XYZ basemap could not be loaded")
        self._project.addMapLayer(layer, addToLegend=True)
        if not persist:
            self._ephemeral_layer_ids.append(layer.id())
        self._basemap_attribution = attribution

    def snapshot_metadata(self) -> dict[str, Any]:
        qgis_type = self._core.Qgis
        return {
            "qgis_version": str(qgis_type.QGIS_VERSION),
            "project_crs": self._project.crs().authid(),
            "loaded_roles": [role.value for role in self._layers],
            "ephemeral_basemap": bool(self._ephemeral_layer_ids),
            "basemap_attribution": self._basemap_attribution,
        }

    def remove_ephemeral_layers(self) -> None:
        for layer_id in self._ephemeral_layer_ids:
            self._project.removeMapLayer(layer_id)
        self._ephemeral_layer_ids.clear()

    def close(self) -> None:
        self.remove_ephemeral_layers()
        self._project.clear()
        self._app.exitQgis()

    def _layer(self, role: LayerRole) -> Any:
        try:
            return self._layers[role]
        except KeyError as exc:
            raise RuntimeError(f"Layer not loaded for role: {role}") from exc
