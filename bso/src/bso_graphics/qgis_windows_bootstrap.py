from __future__ import annotations

import os
from pathlib import Path


_DLL_DIRECTORY_HANDLES: list[object] = []


def configure_windows_dll_search(qgis_root: str | None = None) -> list[str]:
    """Register QGIS/Qt DLL folders for Python 3.8+ on Windows.

    Modern Python does not reliably use PATH when resolving extension-module
    dependencies.  Keep the returned directory handles alive for the process.
    """
    if os.name != "nt" or not hasattr(os, "add_dll_directory"):
        return []

    root_text = qgis_root or os.environ.get("QGIS_ROOT")
    if not root_text:
        prefix = os.environ.get("QGIS_PREFIX_PATH")
        if prefix:
            prefix_path = Path(prefix)
            if prefix_path.name.lower() == "qgis" and prefix_path.parent.name.lower() == "apps":
                root_text = str(prefix_path.parent.parent)
    if not root_text:
        return []

    root = Path(root_text)
    candidates = [
        root / "bin",
        root / "apps" / "qt6" / "bin",
        root / "apps" / "qgis" / "bin",
        root / "apps" / "Python312",
    ]
    registered: list[str] = []
    for candidate in candidates:
        if not candidate.is_dir():
            continue
        handle = os.add_dll_directory(str(candidate))
        _DLL_DIRECTORY_HANDLES.append(handle)
        registered.append(str(candidate))
    return registered
