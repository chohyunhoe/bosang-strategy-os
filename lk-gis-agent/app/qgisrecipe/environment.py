"""QGIS environment detection without importing PyQGIS at module load time."""

from __future__ import annotations

import importlib
import os
import shutil
import sys
from collections.abc import Callable, Mapping
from enum import StrEnum
from pathlib import Path
from typing import Any

from pydantic import Field

from app.models.common import StrictModel


class QgisExecutionMode(StrEnum):
    IN_PROCESS = "IN_PROCESS"
    SUBPROCESS = "SUBPROCESS"
    UNAVAILABLE = "UNAVAILABLE"


class QgisEnvironmentReport(StrictModel):
    detected: bool
    qgis_version: str | None = None
    prefix_path: str | None = None
    python_executable: str
    qgis_process: str | None = None
    python_qgis_launcher: str | None = None
    recommended_mode: QgisExecutionMode
    notes: tuple[str, ...] = Field(default_factory=tuple)


def probe_qgis_environment(
    *,
    environ: Mapping[str, str] | None = None,
    import_module: Callable[[str], Any] = importlib.import_module,
    which: Callable[[str], str | None] = shutil.which,
    path_exists: Callable[[Path], bool] = Path.exists,
) -> QgisEnvironmentReport:
    """Inspect importability and launchers; never fixes a QGIS version in code."""

    env = dict(os.environ if environ is None else environ)
    notes: list[str] = []
    version: str | None = None
    importable = False

    try:
        core = import_module("qgis.core")
        qgis_type = getattr(core, "Qgis", None)
        version = str(getattr(qgis_type, "QGIS_VERSION", "unknown"))
        importable = True
    except (ImportError, RuntimeError, AttributeError) as exc:
        notes.append(f"PyQGIS import unavailable: {type(exc).__name__}")

    prefix_path = env.get("QGIS_PREFIX_PATH") or _candidate_prefix(env, path_exists)
    qgis_process = which("qgis_process") or which("qgis_process-qgis-ltr")
    launcher = _candidate_launcher(env, path_exists)

    if importable:
        mode = QgisExecutionMode.IN_PROCESS
    elif launcher or qgis_process:
        mode = QgisExecutionMode.SUBPROCESS
    else:
        mode = QgisExecutionMode.UNAVAILABLE

    if mode is QgisExecutionMode.SUBPROCESS:
        notes.append("QGIS launcher detected; subprocess spike required on the target Windows PC")
    if mode is QgisExecutionMode.UNAVAILABLE:
        notes.append("Install or expose QGIS/OSGeo4W before executing the recipe")

    return QgisEnvironmentReport(
        detected=importable or bool(launcher or qgis_process),
        qgis_version=version,
        prefix_path=prefix_path,
        python_executable=sys.executable,
        qgis_process=qgis_process,
        python_qgis_launcher=launcher,
        recommended_mode=mode,
        notes=tuple(notes),
    )


def _candidate_prefix(
    environ: Mapping[str, str],
    path_exists: Callable[[Path], bool],
) -> str | None:
    candidates = [
        candidate
        for root in _osgeo_roots(environ)
        for candidate in (root / "apps" / "qgis-ltr", root / "apps" / "qgis")
    ]
    for candidate in candidates:
        if path_exists(candidate):
            return str(candidate)
    return None


def _candidate_launcher(
    environ: Mapping[str, str],
    path_exists: Callable[[Path], bool],
) -> str | None:
    candidates: list[Path] = []
    for root in _osgeo_roots(environ):
        candidates.extend(
            [
                root / "bin" / "python-qgis-ltr.bat",
                root / "bin" / "python-qgis.bat",
            ]
        )
    for candidate in candidates:
        if path_exists(candidate):
            return str(candidate)
    return None


def _osgeo_roots(environ: Mapping[str, str]) -> tuple[Path, ...]:
    roots: list[Path] = []
    configured = environ.get("OSGEO4W_ROOT")
    if configured:
        roots.append(Path(configured))
    if os.name == "nt":
        roots.extend((Path("C:/OSGeo4W"), Path("C:/OSGeo4W64")))
    return tuple(dict.fromkeys(roots))
