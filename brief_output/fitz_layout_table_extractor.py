from __future__ import annotations

from collections import defaultdict
from pathlib import Path
from typing import Any

import fitz

from .layout_table_extractor import LayoutLine, TextFragment, detect_table_candidates
from .semantic_table_pipeline import classify_table


def extract_fragments(pdf_path: str | Path) -> list[TextFragment]:
    fragments: list[TextFragment] = []
    with fitz.open(str(pdf_path)) as document:
        for page_number, page in enumerate(document, start=1):
            height = float(page.rect.height)
            for word in page.get_text("words", sort=False):
                x0, y0, _x1, _y1, text, _block, _line, _word = word
                cleaned = " ".join(str(text or "").replace("\u00a0", " ").split())
                if cleaned:
                    fragments.append(
                        TextFragment(
                            page=page_number,
                            x=float(x0),
                            y=height - float(y0),
                            text=cleaned,
                        )
                    )
    return fragments


def cluster_lines(fragments: list[TextFragment], y_tolerance: float = 3.5) -> list[LayoutLine]:
    by_page: dict[int, list[TextFragment]] = defaultdict(list)
    for fragment in fragments:
        by_page[fragment.page].append(fragment)

    output: list[LayoutLine] = []
    for page, page_fragments in by_page.items():
        page_fragments.sort(key=lambda item: (-item.y, item.x))
        current: list[TextFragment] = []
        anchor_y: float | None = None
        for fragment in page_fragments:
            if anchor_y is None or abs(fragment.y - anchor_y) <= y_tolerance:
                current.append(fragment)
                anchor_y = fragment.y if anchor_y is None else (anchor_y + fragment.y) / 2
            else:
                output.append(LayoutLine(page=page, y=float(anchor_y), fragments=sorted(current, key=lambda item: item.x)))
                current = [fragment]
                anchor_y = fragment.y
        if current and anchor_y is not None:
            output.append(LayoutLine(page=page, y=float(anchor_y), fragments=sorted(current, key=lambda item: item.x)))
    return output


def extract_semantic_tables(pdf_path: str | Path) -> list[dict[str, Any]]:
    fragments = extract_fragments(pdf_path)
    lines = cluster_lines(fragments)
    output: list[dict[str, Any]] = []
    for candidate in detect_table_candidates(lines, max_header_rows=4, max_scan_rows=48):
        classified = classify_table(candidate)
        output.append(
            {
                "page": candidate.page,
                "table_type": classified.table_type.value,
                "confidence": classified.confidence,
                "reasons": classified.reasons,
                "headers": candidate.headers,
                "header_map": {str(key): value for key, value in classified.header_map.items()},
                "rows": candidate.rows,
                "bbox": candidate.bbox,
                "source": "pymupdf_words",
                "metadata": candidate.metadata,
            }
        )
    return output
