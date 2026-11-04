"""Command-line QGIS environment probe for the target workstation."""

from __future__ import annotations

import json

from app.qgisrecipe.environment import probe_qgis_environment


def main() -> None:
    report = probe_qgis_environment()
    print(json.dumps(report.model_dump(mode="json"), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
