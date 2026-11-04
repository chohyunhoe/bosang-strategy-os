from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from pypdf import PdfReader

from .semantic_table_pipeline import TableCandidate, classify_table, normalize_label


@dataclass(frozen=True)
class TextFragment:
    page: int
    x: float
    y: float
    text: str


@dataclass
class LayoutLine:
    page: int
    y: float
    fragments: list[TextFragment]

    @property
    def text(self) -> str:
        return " ".join(item.text for item in sorted(self.fragments, key=lambda item: item.x)).strip()


def _clean_text(value: str) -> str:
    return " ".join(str(value or "").replace("\u00a0", " ").split())


def _matrix_xy(tm: list[float] | tuple[float, ...], cm: list[float] | tuple[float, ...]) -> tuple[float, float]:
    tx = float(tm[4] if len(tm) > 4 else 0.0) + float(cm[4] if len(cm) > 4 else 0.0)
    ty = float(tm[5] if len(tm) > 5 else 0.0) + float(cm[5] if len(cm) > 5 else 0.0)
    return tx, ty


def extract_fragments(pdf_path: str | Path) -> list[TextFragment]:
    reader = PdfReader(str(pdf_path))
    fragments: list[TextFragment] = []
    for page_number, page in enumerate(reader.pages, start=1):
        def visitor(text: str, cm, tm, font_dict, font_size) -> None:  # noqa: ANN001
            cleaned = _clean_text(text)
            if not cleaned:
                return
            x, y = _matrix_xy(tm, cm)
            fragments.append(TextFragment(page=page_number, x=x, y=y, text=cleaned))

        page.extract_text(visitor_text=visitor)
    return fragments


def cluster_lines(fragments: Iterable[TextFragment], y_tolerance: float = 3.0) -> list[LayoutLine]:
    grouped: dict[int, list[TextFragment]] = {}
    for fragment in fragments:
        grouped.setdefault(fragment.page, []).append(fragment)

    lines: list[LayoutLine] = []
    for page, page_fragments in grouped.items():
        page_fragments = sorted(page_fragments, key=lambda item: (-item.y, item.x))
        current: list[TextFragment] = []
        anchor_y: float | None = None
        for fragment in page_fragments:
            if anchor_y is None or abs(fragment.y - anchor_y) <= y_tolerance:
                current.append(fragment)
                anchor_y = fragment.y if anchor_y is None else (anchor_y + fragment.y) / 2
                continue
            lines.append(LayoutLine(page=page, y=anchor_y, fragments=sorted(current, key=lambda item: item.x)))
            current = [fragment]
            anchor_y = fragment.y
        if current and anchor_y is not None:
            lines.append(LayoutLine(page=page, y=anchor_y, fragments=sorted(current, key=lambda item: item.x)))
    return lines


SEMANTIC_TERMS = {
    "지번", "소재지", "공시지가", "시점수정", "지역요인", "개별요인", "가로", "접근", "환경",
    "획지", "행정", "기타", "그밖의요인", "산정단가", "결정단가", "사례단가", "가격시점", "환산단가",
}


def _header_score(line: LayoutLine) -> int:
    normalized = normalize_label(line.text)
    return sum(1 for term in SEMANTIC_TERMS if normalize_label(term) in normalized)


def _numeric_score(text: str) -> int:
    money = len(re.findall(r"\d{1,3}(?:,\d{3})+", text))
    factors = len(re.findall(r"(?<!\d)(?:0|1|2)\.\d{2,5}(?!\d)", text))
    lots = len(re.findall(r"(?:[가-힣]+(?:동|리)\s*)?\d{1,4}\s*-\s*\d{1,4}", text))
    integers = len(re.findall(r"(?<!\d)\d{3,7}(?!\d)", text))
    return money * 2 + factors + lots * 2 + min(integers, 2)


def _is_header_extension(line: LayoutLine) -> bool:
    normalized = normalize_label(line.text)
    if _header_score(line) > 0:
        return True
    return any(token in normalized for token in ("조건", "비교치", "구분", "기호", "원㎡", "①", "②", "③", "④"))


def _is_data_line(line: LayoutLine) -> bool:
    return _numeric_score(line.text) >= 2


def _merge_header_block(lines: list[LayoutLine]) -> tuple[list[str], list[float], str]:
    fragments = sorted((fragment for line in lines for fragment in line.fragments), key=lambda item: item.x)
    anchors: list[float] = []
    headers: list[str] = []
    tolerance = 18.0
    for fragment in fragments:
        if not anchors or min(abs(fragment.x - anchor) for anchor in anchors) > tolerance:
            anchors.append(fragment.x)
            headers.append(fragment.text)
            continue
        index = min(range(len(anchors)), key=lambda idx: abs(fragment.x - anchors[idx]))
        if fragment.text not in headers[index]:
            headers[index] = f"{headers[index]} {fragment.text}".strip()
    ordered = sorted(zip(anchors, headers), key=lambda item: item[0])
    return [header for _, header in ordered], [anchor for anchor, _ in ordered], " | ".join(line.text for line in lines)


def _assign_cells(line: LayoutLine, anchors: list[float]) -> list[str]:
    if not anchors:
        return []
    cells: list[list[str]] = [[] for _ in anchors]
    for fragment in sorted(line.fragments, key=lambda item: item.x):
        nearest_index = min(range(len(anchors)), key=lambda index: abs(fragment.x - anchors[index]))
        cells[nearest_index].append(fragment.text)
    return [" ".join(parts).strip() for parts in cells]


def _serialize_line(line: LayoutLine) -> dict[str, object]:
    return {
        "page": line.page,
        "y": round(line.y, 3),
        "text": line.text,
        "header_score": _header_score(line),
        "numeric_score": _numeric_score(line.text),
        "fragments": [
            {"x": round(item.x, 3), "y": round(item.y, 3), "text": item.text}
            for item in sorted(line.fragments, key=lambda item: item.x)
        ],
    }


def build_layout_diagnostics(pdf_path: str | Path) -> dict[str, object]:
    fragments = extract_fragments(pdf_path)
    lines = cluster_lines(fragments)
    raw_lines = [_serialize_line(line) for line in lines if _header_score(line) > 0 or _numeric_score(line.text) > 0]

    by_page: dict[int, list[LayoutLine]] = {}
    for line in lines:
        by_page.setdefault(line.page, []).append(line)

    blocks: list[dict[str, object]] = []
    for page, page_lines in by_page.items():
        page_lines = sorted(page_lines, key=lambda item: -item.y)
        for index, line in enumerate(page_lines):
            if _header_score(line) < 1:
                continue
            window = page_lines[index:index + 36]
            blocks.append(
                {
                    "page": page,
                    "anchor_index": index,
                    "anchor_y": round(line.y, 3),
                    "anchor_text": line.text,
                    "anchor_header_score": _header_score(line),
                    "window": [_serialize_line(item) for item in window],
                }
            )
    return {"raw_layout_lines": raw_lines, "table_blocks_before_filter": blocks}


def detect_table_candidates(
    lines: Iterable[LayoutLine],
    max_header_rows: int = 4,
    max_scan_rows: int = 36,
) -> list[TableCandidate]:
    by_page: dict[int, list[LayoutLine]] = {}
    for line in lines:
        by_page.setdefault(line.page, []).append(line)

    candidates: list[TableCandidate] = []
    for page, page_lines in by_page.items():
        page_lines = sorted(page_lines, key=lambda item: -item.y)
        for index, line in enumerate(page_lines):
            if _header_score(line) < 2:
                continue

            header_block = [line]
            cursor = index + 1
            while cursor < len(page_lines) and len(header_block) < max_header_rows:
                next_line = page_lines[cursor]
                if _is_data_line(next_line):
                    break
                if not _is_header_extension(next_line):
                    break
                header_block.append(next_line)
                cursor += 1

            headers, anchors, header_text = _merge_header_block(header_block)
            if len(headers) < 2:
                continue

            rows: list[list[str]] = []
            row_lines: list[LayoutLine] = []
            scanned = 0
            for following in page_lines[cursor:]:
                scanned += 1
                if scanned > max_scan_rows:
                    break
                if _header_score(following) >= 4 and rows:
                    break
                if not _is_data_line(following):
                    continue
                cells = _assign_cells(following, anchors)
                if sum(bool(cell) for cell in cells) >= 1:
                    rows.append(cells)
                    row_lines.append(following)

            if not rows:
                continue

            candidate = TableCandidate(
                page=page,
                headers=headers,
                rows=rows,
                bbox=(min(anchors), min(item.y for item in row_lines), max(anchors), header_block[0].y),
                source="pdf_layout_multiline",
                metadata={
                    "header_text": header_text,
                    "header_score": sum(_header_score(item) for item in header_block),
                    "header_rows": len(header_block),
                    "data_rows": len(rows),
                },
            )
            candidates.append(candidate)
    return candidates


def extract_semantic_tables(pdf_path: str | Path) -> list[dict[str, object]]:
    fragments = extract_fragments(pdf_path)
    lines = cluster_lines(fragments)
    output: list[dict[str, object]] = []
    for candidate in detect_table_candidates(lines):
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
                "source": candidate.source,
                "metadata": candidate.metadata,
            }
        )
    return output
