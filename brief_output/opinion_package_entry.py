# -*- coding: utf-8 -*-
"""로컬 출력 브리지용 재결·이의 의견서 작성자료 진입점.

    python -m brief_output.opinion_package_entry <case.json> <out_dir> [map.png|map-manifest.json]

분석보고서·수치표와 같은 어댑터·QA 계층을 지나온 결과를 의견서 작성자료 DOCX 로 옮긴다.
stdout 은 JSON 한 줄만 쓴다. 종료코드 0=성공, 2=fail-closed 중단.
"""
from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path

from .build_case_brief import apply_adapter_qa
from .generator import build_output
from .killerkit_adapter import AdapterError, AdapterSafetyError, adapt_case
from .opinion_package import DOCUMENT_TITLE, OpinionPackageError, build_opinion_package


def run(
    case_path: Path,
    out_dir: Path,
    map_image: Path | None = None,
    map_images: list[dict] | None = None,
) -> dict:
    case = json.loads(case_path.read_text(encoding="utf-8"))
    output = apply_adapter_qa(build_output(adapt_case(case)))
    stem = f"{output.run_meta.run_id}.opinion"
    result = build_opinion_package(
        output,
        case,
        out_dir / f"{stem}.docx",
        map_image=map_image,
        map_images=map_images,
    )
    return {
        "ok": True,
        "document_title": DOCUMENT_TITLE,
        "output_status": output.run_meta.status,
        "file_stem": stem,
        "project_name": output.project_meta.project_name,
        "docx_path": result["path"],
        "sections": result["sections"],
        "map_embedded": result["map_embedded"],
        "map_count": result["map_count"],
        "counts": result["counts"],
        "review_warnings": result["review_warnings"],
        "unlinked_subject_parcels": result["unlinked_subject_parcels"],
    }


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) not in (2, 3):
        print(json.dumps({"ok": False, "error_code": "BAD_ARGUMENTS"}, ensure_ascii=False))
        return 2
    map_image = Path(args[2]) if len(args) == 3 and args[2] else None
    map_images = None
    if map_image and map_image.suffix.lower() == ".json":
        raw_items = json.loads(map_image.read_text(encoding="utf-8"))
        map_images = [item for item in raw_items if isinstance(item, dict)] if isinstance(raw_items, list) else []
        map_image = None
    try:
        print(json.dumps(run(Path(args[0]), Path(args[1]), map_image, map_images), ensure_ascii=False))
        return 0
    except AdapterSafetyError as error:
        print(json.dumps({"ok": False, "error_code": "AUTO_CONFIRMED_BOUNDARY", "message": str(error)}, ensure_ascii=False))
        return 2
    except OpinionPackageError as error:
        print(json.dumps({"ok": False, "error_code": "FORBIDDEN_PHRASE", "message": str(error)}, ensure_ascii=False))
        return 2
    except AdapterError as error:
        print(json.dumps({"ok": False, "error_code": "FAIL_CLOSED", "message": str(error)}, ensure_ascii=False))
        return 2
    except Exception as error:  # noqa: BLE001 - 브리지가 원인을 UI 로 되돌려 줘야 한다
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"ok": False, "error_code": "GENERATION_FAILED", "message": str(error)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
