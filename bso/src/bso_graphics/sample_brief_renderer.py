# -*- coding: utf-8 -*-
from __future__ import annotations

from pathlib import Path


def _qt():
    from qgis.PyQt.QtCore import QRectF, Qt
    from qgis.PyQt.QtGui import QColor, QFont, QImage, QPainter, QPdfWriter, QPen
    return locals()


def _font(q, size: int, bold: bool = False):
    weight = q["QFont"].Weight.Bold if bold else q["QFont"].Weight.Normal
    return q["QFont"]("Malgun Gothic", size, weight)


def _text(p, q, rect, text, size=18, bold=False, align=None, color="#202020"):
    if align is None:
        align = q["Qt"].AlignmentFlag.AlignCenter
    p.setPen(q["QColor"](color))
    p.setFont(_font(q, size, bold))
    p.drawText(rect, int(align | q["Qt"].TextFlag.TextWordWrap), str(text))


def _cell(p, q, rect, text, *, fill="#ffffff", size=17, bold=False, color="#202020", align=None, border="#48546a"):
    p.setPen(q["QPen"](q["QColor"](border), 1.4))
    p.setBrush(q["QColor"](fill))
    p.drawRect(rect)
    _text(p, q, rect.adjusted(5, 3, -5, -3), text, size=size, bold=bold, align=align, color=color)


def _table(p, q, x, y, widths, row_h, rows, header_rows=1, highlight_cols=None):
    highlight_cols = set(highlight_cols or [])
    yy = y
    for ridx, row in enumerate(rows):
        xx = x
        for cidx, width in enumerate(widths):
            value = row[cidx] if cidx < len(row) else ""
            header = ridx < header_rows
            fill = "#dfe6ee" if header else "#ffffff"
            color = "#c9252d" if (not header and cidx in highlight_cols) else "#202020"
            _cell(p, q, q["QRectF"](xx, yy, width, row_h), value, fill=fill, size=15 if header else 16, bold=header or cidx == 0, color=color)
            xx += width
        yy += row_h
    return yy


def _draw_image(p, q, path: Path, rect):
    if not path.exists():
        _cell(p, q, rect, "지도 출력 없음", fill="#f4f4f4", size=24, bold=True, color="#666666")
        return False
    image = q["QImage"](str(path))
    if image.isNull():
        _cell(p, q, rect, "지도 이미지 로드 실패", fill="#f4f4f4", size=22, bold=True, color="#8a2c2c")
        return False
    scaled = image.scaled(int(rect.width()), int(rect.height()), q["Qt"].AspectRatioMode.KeepAspectRatio, q["Qt"].TransformationMode.SmoothTransformation)
    x = rect.x() + (rect.width() - scaled.width()) / 2
    y = rect.y() + (rect.height() - scaled.height()) / 2
    p.drawImage(q["QRectF"](x, y, scaled.width(), scaled.height()), scaled)
    p.setPen(q["QPen"](q["QColor"]("#48546a"), 1.4))
    p.setBrush(q["Qt"].BrushStyle.NoBrush)
    p.drawRect(rect)
    return True


def _map_status_banner(p, q, rect, status: str, review_required: bool = False):
    if status.startswith("VERIFIED") and not review_required:
        return
    if review_required:
        text = "REVIEW_REQUIRED · 사례 위치 미확정 · 확정 위치도로 사용 금지"
        fill = "#fde2e2"
        color = "#9b1c1c"
    else:
        text = "DRAFT · PC QGIS 육안검수 전"
        fill = "#fff2c7"
        color = "#7a5600"
    banner = q["QRectF"](rect.x() + 14, rect.y() + 14, rect.width() - 28, 42)
    _cell(p, q, banner, text, fill=fill, size=16, bold=True, color=color, border=color)


def _footer(p, q, width: int, height: int, disclaimer: str):
    y = height - 42
    p.setPen(q["QPen"](q["QColor"]("#9aa4af"), 1.0))
    p.drawLine(42, y - 4, width - 42, y - 4)
    _text(
        p,
        q,
        q["QRectF"](42, y, width - 84, 34),
        disclaimer,
        size=11,
        align=q["Qt"].AlignmentFlag.AlignLeft | q["Qt"].AlignmentFlag.AlignVCenter,
        color="#5c6570",
    )


def _claim_box(p, q, rect, text=""):
    _text(p, q, q["QRectF"](rect.x(), rect.y() - 40, rect.width(), 36), "주장사항", size=20, bold=False)
    p.setPen(q["QPen"](q["QColor"]("#48546a"), 1.5))
    p.setBrush(q["QColor"]("#ffffff"))
    p.drawRect(rect)
    if text:
        _text(p, q, rect.adjusted(18, 16, -18, -16), text, size=17, align=q["Qt"].AlignmentFlag.AlignLeft | q["Qt"].AlignmentFlag.AlignTop)


def _page1(p, q, brief: dict, output_dir: Path, width: int, height: int):
    margin = 42
    title = brief.get("page1_title") or "자동표1 – 대상토지와 비교표준지 품등비교"
    _text(p, q, q["QRectF"](margin, 20, width - 2 * margin, 70), title, size=25, bold=True, align=q["Qt"].AlignmentFlag.AlignLeft | q["Qt"].AlignmentFlag.AlignVCenter)

    summary = brief.get("page1_summary") or []
    summary_rows = [
        ["구분", "지번", "용도지역", "지목", "현황", "기호", "공시지가", "도로", "형상·지세"],
        ["대상", summary[0] if len(summary)>0 else "—", summary[1] if len(summary)>1 else "—", summary[2] if len(summary)>2 else "—", summary[3] if len(summary)>3 else "—", "", "", "", ""],
        ["표준지", summary[4] if len(summary)>4 else "—", summary[5] if len(summary)>5 else "—", summary[6] if len(summary)>6 else "—", summary[7] if len(summary)>7 else "—", summary[8] if len(summary)>8 else "—", summary[9] if len(summary)>9 else "—", summary[10] if len(summary)>10 else "—", summary[11] if len(summary)>11 else "—"],
    ]
    widths = [78, 135, 115, 70, 82, 60, 110, 100, 150]
    y = _table(p, q, margin, 95, widths, 48, summary_rows, header_rows=1)

    map_rect = q["QRectF"](margin, y + 14, width - 2 * margin, 640)
    map_file = output_dir / "subject_vs_standard.png"
    if not map_file.exists():
        map_file = output_dir / "review-map.png"
    _draw_image(p, q, map_file, map_rect)
    _map_status_banner(
        p,
        q,
        map_rect,
        str(brief.get("_map_output_status") or "DRAFT_UNTIL_PC_VISUAL_REVIEW"),
        review_required=bool(brief.get("page1_review_required")),
    )
    _cell(p, q, q["QRectF"](margin, map_rect.bottom(), width - 2 * margin, 38), "각 토지 위치도", fill="#eeeeee", size=18, bold=True)

    rows = [["평가법인", "가로", "접근", "환경", "획지", "행정", "기타", "누계", "그 밖의 요인", "적용단가"]]
    for item in brief.get("page1_rows") or []:
        rows.append([item.get(k, "—") for k in ["company","street","access","environment","parcel","admin","other","total","other_factor","applied_price"]])
    widths2 = [110, 75, 75, 75, 75, 75, 75, 85, 115, 125]
    y2 = _table(p, q, margin, map_rect.bottom() + 50, widths2, 48, rows, header_rows=1, highlight_cols={1,2,3,4})
    claim_bottom = height - 70
    _claim_box(p, q, q["QRectF"](margin, y2 + 58, width - 2 * margin, max(80, claim_bottom - (y2 + 58))), brief.get("page1_claims") or "")
    _footer(p, q, width, height, str(brief.get("_output_disclaimer") or ""))


def _page2(p, q, brief: dict, output_dir: Path, width: int, height: int):
    margin = 42
    title = brief.get("page2_title") or "자동표2 – 비교표준지와 사례 품등비교"
    _text(p, q, q["QRectF"](margin, 20, width - 2 * margin, 70), title, size=25, bold=True, align=q["Qt"].AlignmentFlag.AlignLeft | q["Qt"].AlignmentFlag.AlignVCenter)

    calc_rows = [["구분", "지번", "단가", "시점수정", "지역요인", "개별요인", "산정단가"]]
    for item in brief.get("page2_calc_rows") or []:
        calc_rows.append([item.get(k, "—") for k in ["type","lot","price","time_factor","regional_factor","individual_factor","calculated_price"]])
    widths = [105, 175, 125, 115, 105, 115, 140]
    y = _table(p, q, margin, 95, widths, 54, calc_rows, header_rows=1)

    map_rect = q["QRectF"](margin, y + 14, width - 2 * margin, 640)
    review_required = bool(brief.get("page2_review_required"))
    map_unavailable = bool(brief.get("page2_map_unavailable"))
    if map_unavailable:
        review_required = True
        _cell(
            p,
            q,
            map_rect,
            str(brief.get("page2_map_unavailable_message") or "평가사례 위치도 생성 불가"),
            fill="#f4f4f4",
            size=18,
            bold=True,
        )
    else:
        map_file = output_dir / "standard_vs_case.png"
        if not map_file.exists():
            map_file = output_dir / "subject_vs_standard.png"
            review_required = True
        _draw_image(p, q, map_file, map_rect)
    _map_status_banner(
        p,
        q,
        map_rect,
        str(brief.get("_map_output_status") or "DRAFT_UNTIL_PC_VISUAL_REVIEW"),
        review_required=review_required,
    )

    rows = [["평가법인", "가로", "접근", "환경", "획지", "행정", "기타", "누계", "격차율 산출", "결정"]]
    for item in brief.get("page2_rows") or []:
        rows.append([item.get(k, "—") for k in ["company","street","access","environment","parcel","admin","other","total","gap_ratio","decision"]])
    widths2 = [110, 75, 75, 75, 75, 75, 75, 85, 115, 125]
    y2 = _table(p, q, margin, map_rect.bottom() + 14, widths2, 48, rows, header_rows=1, highlight_cols={1,2,3,4})
    claims = brief.get("page2_claims") or ""
    if review_required:
        claims = (claims + "\n\n※ 사례 위치·지번은 원문 대조 전까지 검토 필요 상태이며 확정 위치도로 사용할 수 없습니다.").strip()
    claim_bottom = height - 70
    _claim_box(p, q, q["QRectF"](margin, y2 + 58, width - 2 * margin, max(80, claim_bottom - (y2 + 58))), claims)
    _footer(p, q, width, height, str(brief.get("_output_disclaimer") or ""))


def generate_sample_brief(manifest: dict, output_dir: Path) -> list[Path]:
    raw_brief = manifest.get("sample_brief") or {}
    if not raw_brief:
        return []
    brief = dict(raw_brief)
    brief["_output_disclaimer"] = manifest.get("output_disclaimer") or (
        "본 자료는 감정평가서 기재값의 구조화 결과이며, 감정평가 판단을 대체하지 않습니다. 제출 전 전문가 검토가 필요합니다."
    )
    brief["_map_output_status"] = manifest.get("map_output_status") or "DRAFT_UNTIL_PC_VISUAL_REVIEW"

    q = _qt()
    width, height = 1240, 1754
    output_dir.mkdir(parents=True, exist_ok=True)
    page_paths = [output_dir / "final_sample_page1.png", output_dir / "final_sample_page2.png"]
    pdf_path = output_dir / "final_sample_brief.pdf"
    for path in [*page_paths, pdf_path]:
        if path.exists():
            path.unlink()

    images = []
    for page_no, draw_fn in enumerate((_page1, _page2), start=1):
        image = q["QImage"](width, height, q["QImage"].Format.Format_ARGB32)
        if image.isNull():
            raise RuntimeError("sample brief QImage allocation failed")
        image.fill(q["QColor"]("white"))
        painter = q["QPainter"]()
        try:
            if not painter.begin(image):
                raise RuntimeError("sample brief painter begin failed")
            painter.setRenderHint(q["QPainter"].RenderHint.Antialiasing, True)
            draw_fn(painter, q, brief, output_dir, width, height)
        finally:
            if painter.isActive():
                painter.end()
        if not image.save(str(page_paths[page_no - 1]), "PNG"):
            raise RuntimeError(f"sample brief page {page_no} PNG save failed")
        images.append(image)

    writer = q["QPdfWriter"](str(pdf_path))
    writer.setResolution(150)
    painter = q["QPainter"]()
    try:
        if not painter.begin(writer):
            raise RuntimeError("sample brief PDF painter begin failed")
        for idx, image in enumerate(images):
            if idx > 0:
                writer.newPage()
            target = q["QRectF"](0, 0, writer.width(), writer.height())
            painter.drawImage(target, image)
    finally:
        if painter.isActive():
            painter.end()
    if not pdf_path.exists() or pdf_path.stat().st_size == 0:
        raise RuntimeError("sample brief PDF save failed")
    return [*page_paths, pdf_path]
