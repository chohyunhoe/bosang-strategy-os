# -*- coding: utf-8 -*-
"""QGIS-independent assembly of the final two-page validation brief."""
from __future__ import annotations

import os
from pathlib import Path

import fitz


PAGE_W, PAGE_H = 595.0, 842.0
MARGIN = 20.0
INK = (0.13, 0.13, 0.13)
BORDER = (0.28, 0.33, 0.42)
HEADER = (0.87, 0.90, 0.94)
LIGHT = (0.95, 0.95, 0.95)
RED = (0.79, 0.15, 0.18)


def _font_paths() -> tuple[str | None, str | None]:
    configured = os.environ.get("BSO_KOREAN_FONT")
    regular = Path(configured) if configured else Path("C:/Windows/Fonts/malgun.ttf")
    bold = Path("C:/Windows/Fonts/malgunbd.ttf")
    return (str(regular) if regular.is_file() else None, str(bold) if bold.is_file() else None)


def _text(page, rect, text, *, size=8.0, bold=False, align=1, color=INK):
    regular, bold_path = _font_paths()
    fontfile = bold_path if bold and bold_path else regular
    fontname = "bso-bold" if bold and bold_path else "bso-regular" if regular else "korea"
    page.insert_textbox(
        fitz.Rect(rect),
        str(text),
        fontsize=size,
        fontname=fontname,
        fontfile=fontfile,
        color=color,
        align=align,
        lineheight=1.15,
    )


def _cell(page, rect, value, *, fill=(1, 1, 1), size=7.1, bold=False, color=INK, align=1):
    rect = fitz.Rect(rect)
    page.draw_rect(rect, color=BORDER, fill=fill, width=0.65)
    _text(page, rect + (2, 2, -2, -2), value, size=size, bold=bold, align=align, color=color)


def _table(page, x, y, widths, row_h, rows, *, header_rows=1, highlight_cols=None):
    highlight_cols = set(highlight_cols or [])
    for row_index, row in enumerate(rows):
        xx = x
        for col_index, width in enumerate(widths):
            header = row_index < header_rows
            color = RED if not header and col_index in highlight_cols else INK
            _cell(
                page,
                (xx, y, xx + width, y + row_h),
                row[col_index] if col_index < len(row) else "",
                fill=HEADER if header else (1, 1, 1),
                size=6.2 if header else 6.8,
                bold=header or col_index == 0,
                color=color,
            )
            xx += width
        y += row_h
    return y


def _map(
    page,
    output_dir: Path,
    candidates: list[str],
    rect,
    review_required: bool,
    status: str,
    missing_text: str = "지도 출력 없음",
):
    rect = fitz.Rect(rect)
    path = next((output_dir / name for name in candidates if (output_dir / name).is_file()), None)
    page.draw_rect(rect, color=BORDER, fill=(1, 1, 1), width=0.8)
    if path:
        page.insert_image(rect, filename=str(path), keep_proportion=True)
    else:
        _text(page, rect, missing_text, size=15, bold=True, color=(0.4, 0.4, 0.4))
    if review_required or not str(status).startswith("VERIFIED"):
        banner = fitz.Rect(rect.x0 + 8, rect.y0 + 8, rect.x1 - 8, rect.y0 + 28)
        page.draw_rect(banner, color=RED, fill=(0.99, 0.89, 0.89), width=0.7)
        message = "REVIEW_REQUIRED · 확정 위치도로 사용 금지" if review_required else "DRAFT · PC 육안검수 전"
        _text(page, banner + (3, 3, -3, -3), message, size=7.4, bold=True, color=RED)


def _claims(page, y, text, disclaimer):
    _text(page, (MARGIN, y, PAGE_W - MARGIN, y + 16), "주장사항", size=9.0, bold=True, align=0)
    box = fitz.Rect(MARGIN, y + 16, PAGE_W - MARGIN, PAGE_H - 38)
    page.draw_rect(box, color=BORDER, fill=(1, 1, 1), width=0.8)
    _text(page, box + (10, 9, -10, -9), text, size=7.8, align=0)
    page.draw_line((MARGIN, PAGE_H - 28), (PAGE_W - MARGIN, PAGE_H - 28), color=(0.62, 0.65, 0.69), width=0.5)
    _text(page, (MARGIN, PAGE_H - 25, PAGE_W - MARGIN, PAGE_H - 8), disclaimer, size=5.3, align=0, color=(0.36, 0.39, 0.43))


def _page1(doc, brief, output_dir, status, disclaimer):
    page = doc.new_page(width=PAGE_W, height=PAGE_H)
    _text(page, (MARGIN, 12, PAGE_W - MARGIN, 38), brief.get("page1_title") or "자동표1", size=12.5, bold=True, align=0)
    summary = brief.get("page1_summary") or []
    rows = [
        ["구분", "지번", "용도지역", "지목", "현황", "기호", "공시지가", "도로", "형상·지세"],
        ["대상", *(summary + ["—"] * 4)[:4], "", "", "", ""],
        ["표준지", *((summary + ["—"] * 12)[4:12])],
    ]
    widths = [40, 78, 66, 39, 47, 35, 67, 60, 123]
    y = _table(page, MARGIN, 43, widths, 22, rows)
    map_rect = (MARGIN, y + 7, PAGE_W - MARGIN, y + 287)
    _map(page, output_dir, ["subject_vs_standard.png", "review-map.png"], map_rect,
         bool(brief.get("page1_review_required")), status)
    _cell(page, (MARGIN, map_rect[3], PAGE_W - MARGIN, map_rect[3] + 18), "각 토지 위치도", fill=LIGHT, size=8.0, bold=True)
    factor_rows = [["평가법인", "가로", "접근", "환경", "획지", "행정", "기타", "누계", "그 밖의 요인", "적용단가"]]
    for item in brief.get("page1_rows") or []:
        factor_rows.append([item.get(k, "—") for k in ("company", "street", "access", "environment", "parcel", "admin", "other", "total", "other_factor", "applied_price")])
    widths2 = [62, 40, 40, 40, 40, 40, 40, 48, 75, 130]
    y2 = _table(page, MARGIN, map_rect[3] + 24, widths2, 23, factor_rows, highlight_cols={1, 2, 3, 4})
    _claims(page, y2 + 16, brief.get("page1_claims") or "", disclaimer)


def _page2(doc, brief, output_dir, status, disclaimer):
    page = doc.new_page(width=PAGE_W, height=PAGE_H)
    _text(page, (MARGIN, 12, PAGE_W - MARGIN, 38), brief.get("page2_title") or "자동표2", size=12.5, bold=True, align=0)
    calc_rows = [["구분", "지번", "단가", "시점수정", "지역요인", "개별요인", "산정단가"]]
    for item in brief.get("page2_calc_rows") or []:
        calc_rows.append([item.get(k, "—") for k in ("type", "lot", "price", "time_factor", "regional_factor", "individual_factor", "calculated_price")])
    widths = [68, 105, 80, 68, 61, 66, 107]
    y = _table(page, MARGIN, 43, widths, 23, calc_rows)
    review = bool(brief.get("page2_review_required"))
    map_unavailable = bool(brief.get("page2_map_unavailable"))
    if map_unavailable:
        review = True
        map_candidates = []
        missing_text = str(brief.get("page2_map_unavailable_message") or "평가사례 위치도 생성 불가")
    else:
        map_candidates = ["standard_vs_case.png", "subject_vs_standard.png"]
        missing_text = "지도 출력 없음"
    map_rect = (MARGIN, y + 7, PAGE_W - MARGIN, y + 287)
    _map(page, output_dir, map_candidates, map_rect, review, status, missing_text=missing_text)
    factor_rows = [["평가법인", "가로", "접근", "환경", "획지", "행정", "기타", "누계", "격차율", "결정"]]
    for item in brief.get("page2_rows") or []:
        factor_rows.append([item.get(k, "—") for k in ("company", "street", "access", "environment", "parcel", "admin", "other", "total", "gap_ratio", "decision")])
    widths2 = [62, 40, 40, 40, 40, 40, 40, 48, 75, 130]
    y2 = _table(page, MARGIN, map_rect[3] + 8, widths2, 23, factor_rows, highlight_cols={1, 2, 3, 4})
    claims = brief.get("page2_claims") or ""
    if review:
        claims += "\n\n※ 사례 위치·지번은 원문 대조 전까지 확정 위치도로 사용할 수 없습니다."
    _claims(page, y2 + 16, claims.strip(), disclaimer)


def generate_sample_brief(manifest: dict, output_dir: Path) -> list[Path]:
    brief = manifest.get("sample_brief") or {}
    if not brief:
        return []
    output_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = output_dir / "final_sample_brief.pdf"
    page_paths = [output_dir / "final_sample_page1.png", output_dir / "final_sample_page2.png"]
    for path in [pdf_path, *page_paths]:
        if path.exists():
            path.unlink()
    status = str(manifest.get("map_output_status") or "DRAFT_UNTIL_PC_VISUAL_REVIEW")
    disclaimer = str(manifest.get("output_disclaimer") or "")
    doc = fitz.open()
    _page1(doc, brief, output_dir, status, disclaimer)
    _page2(doc, brief, output_dir, status, disclaimer)
    doc.set_metadata({"title": str(manifest.get("title") or "보상전략 OS 검증 브리프"), "producer": "Bosang Strategy OS"})
    if hasattr(doc, "subset_fonts"):
        doc.subset_fonts()
    doc.save(pdf_path, deflate=True, garbage=4)
    doc.close()
    rendered = fitz.open(pdf_path)
    for index, path in enumerate(page_paths):
        pix = rendered[index].get_pixmap(matrix=fitz.Matrix(150 / 72, 150 / 72), alpha=False)
        pix.save(path)
    rendered.close()
    return [*page_paths, pdf_path]
