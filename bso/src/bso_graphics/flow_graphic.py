# -*- coding: utf-8 -*-
from __future__ import annotations

from pathlib import Path


def _generate_with_fitz(flow: dict, output_dir: Path) -> list[Path]:
    """QGIS가 없는 CI에서 사용하는 결정론적 PyMuPDF 폴백."""
    import fitz

    series = flow.get("series") or []
    if not series:
        return []
    step_count = max(len(item.get("steps") or []) for item in series)
    if step_count == 0:
        return []

    width = int(max(1400, 230 + step_count * 220))
    row_height = 145
    height = int(150 + len(series) * row_height + 70)
    title = str(flow.get("title") or "그 밖의 요인 산정흐름")
    note = str(flow.get("note") or "수치는 감정평가서 원문 대조를 위한 검토 보조자료입니다.")

    output_dir.mkdir(parents=True, exist_ok=True)
    png_path = output_dir / "other_factor_flow.png"
    pdf_path = output_dir / "other_factor_flow.pdf"
    for path in (png_path, pdf_path):
        if path.exists():
            path.unlink()

    document = fitz.open()
    page = document.new_page(width=width, height=height)
    font_name = "korea"
    page.draw_rect(fitz.Rect(0, 0, width, height), color=(1, 1, 1), fill=(1, 1, 1))
    page.insert_textbox(
        fitz.Rect(35, 20, width - 35, 80), title,
        fontsize=22, fontname=font_name, color=(0.08, 0.14, 0.18), align=0,
    )

    fills = [(0.92, 0.96, 0.97), (0.96, 0.97, 0.99), (0.98, 0.95, 0.91)]
    for row_index, item in enumerate(series):
        y = 100 + row_index * row_height
        name_rect = fitz.Rect(30, y + 25, 180, y + 95)
        page.draw_rect(name_rect, color=(0.06, 0.37, 0.46), fill=(0.06, 0.37, 0.46), radius=0.12)
        page.insert_textbox(
            name_rect, str(item.get("name") or f"계열 {row_index + 1}"),
            fontsize=14, fontname=font_name, color=(1, 1, 1), align=1,
        )
        steps = item.get("steps") or []
        cell_width = (width - 240) / step_count
        for step_index in range(step_count):
            x = 205 + step_index * cell_width
            rect = fitz.Rect(x, y + 10, x + cell_width - 35, y + 110)
            page.draw_rect(rect, color=(0.57, 0.62, 0.66), fill=fills[step_index % len(fills)], radius=0.08)
            if step_index < len(steps):
                step = steps[step_index]
                label = step.get("label") if isinstance(step, dict) else step[0]
                value = step.get("value") if isinstance(step, dict) else step[1]
                page.insert_textbox(
                    fitz.Rect(rect.x0 + 8, rect.y0 + 8, rect.x1 - 8, rect.y0 + 38),
                    str(label), fontsize=10, fontname=font_name, color=(0.14, 0.18, 0.20), align=1,
                )
                page.insert_textbox(
                    fitz.Rect(rect.x0 + 8, rect.y0 + 42, rect.x1 - 8, rect.y1 - 8),
                    str(value), fontsize=15, fontname=font_name, color=(0.14, 0.18, 0.20), align=1,
                )
            if step_index < step_count - 1:
                mid_y = (rect.y0 + rect.y1) / 2
                start_x = rect.x1 + 4
                end_x = rect.x1 + 25
                page.draw_line(fitz.Point(start_x, mid_y), fitz.Point(end_x, mid_y), color=(0.28, 0.28, 0.28), width=2)
                page.draw_polyline([
                    fitz.Point(end_x - 7, mid_y - 6),
                    fitz.Point(end_x, mid_y),
                    fitz.Point(end_x - 7, mid_y + 6),
                ], color=(0.28, 0.28, 0.28), width=2)

    page.insert_textbox(
        fitz.Rect(35, height - 48, width - 35, height - 20), note,
        fontsize=9, fontname=font_name, color=(0.35, 0.35, 0.35), align=0,
    )
    document.save(pdf_path)
    page.get_pixmap(matrix=fitz.Matrix(1.0, 1.0), alpha=False).save(png_path)
    document.close()
    if not png_path.exists() or not pdf_path.exists():
        raise RuntimeError("flow fallback output failed")
    return [png_path, pdf_path]


def generate_other_factor_flow(flow: dict, output_dir: Path) -> list[Path]:
    """법인별 그 밖의 요인 산정흐름을 Qt6로 생성한다."""
    try:
        from qgis.PyQt.QtCore import QRectF, Qt
        from qgis.PyQt.QtGui import QColor, QFont, QImage, QPainter, QPdfWriter, QPen
    except ModuleNotFoundError:
        return _generate_with_fitz(flow, output_dir)

    series = flow.get("series") or []
    if not series:
        return []
    step_count = max(len(item.get("steps") or []) for item in series)
    if step_count == 0:
        return []

    width = int(max(1400, 230 + step_count * 220))
    row_height = 145
    height = int(150 + len(series) * row_height + 70)
    title = str(flow.get("title") or "그 밖의 요인 산정흐름")
    note = str(flow.get("note") or "수치는 감정평가서 원문 대조를 위한 검토 보조자료입니다.")
    bold = QFont.Weight.Bold

    def draw(painter: QPainter) -> None:
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        painter.fillRect(QRectF(0, 0, width, height), QColor("white"))
        painter.setPen(QPen(QColor(20, 35, 45)))
        painter.setFont(QFont("Malgun Gothic", 22, bold))
        painter.drawText(QRectF(35, 20, width - 70, 60), Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter, title)

        colors = [QColor(234, 245, 248), QColor(245, 248, 252), QColor(251, 244, 232)]
        for row_index, item in enumerate(series):
            y = 100 + row_index * row_height
            name_rect = QRectF(30, y + 25, 150, 70)
            painter.setPen(QPen(QColor(15, 95, 118), 2))
            painter.setBrush(QColor(15, 95, 118))
            painter.drawRoundedRect(name_rect, 10, 10)
            painter.setPen(QColor("white"))
            painter.setFont(QFont("Malgun Gothic", 14, bold))
            painter.drawText(name_rect, Qt.AlignmentFlag.AlignCenter, str(item.get("name") or f"계열 {row_index + 1}"))

            steps = item.get("steps") or []
            cell_width = (width - 240) / step_count
            for step_index in range(step_count):
                x = 205 + step_index * cell_width
                rect = QRectF(x, y + 10, cell_width - 35, 100)
                painter.setPen(QPen(QColor(145, 158, 168), 2))
                painter.setBrush(colors[step_index % len(colors)])
                painter.drawRoundedRect(rect, 8, 8)
                if step_index < len(steps):
                    step = steps[step_index]
                    label = step.get("label") if isinstance(step, dict) else step[0]
                    value = step.get("value") if isinstance(step, dict) else step[1]
                    painter.setPen(QColor(35, 45, 52))
                    painter.setFont(QFont("Malgun Gothic", 10))
                    painter.drawText(QRectF(rect.x()+8, rect.y()+8, rect.width()-16, 30), Qt.AlignmentFlag.AlignCenter, str(label))
                    painter.setFont(QFont("Malgun Gothic", 15, bold))
                    painter.drawText(QRectF(rect.x()+8, rect.y()+42, rect.width()-16, 45), Qt.AlignmentFlag.AlignCenter, str(value))
                if step_index < step_count - 1:
                    mid_y = rect.center().y()
                    start_x = rect.right() + 4
                    end_x = rect.right() + 25
                    painter.setPen(QPen(QColor(70, 70, 70), 2))
                    painter.drawLine(int(start_x), int(mid_y), int(end_x), int(mid_y))
                    painter.drawLine(int(end_x-7), int(mid_y-6), int(end_x), int(mid_y))
                    painter.drawLine(int(end_x-7), int(mid_y+6), int(end_x), int(mid_y))

        painter.setPen(QColor(90, 90, 90))
        painter.setFont(QFont("Malgun Gothic", 9))
        painter.drawText(QRectF(35, height - 48, width - 70, 28), Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter, note)

    output_dir.mkdir(parents=True, exist_ok=True)
    png_path = output_dir / "other_factor_flow.png"
    pdf_path = output_dir / "other_factor_flow.pdf"
    for path in (png_path, pdf_path):
        if path.exists():
            path.unlink()

    outputs: list[Path] = []
    image = QImage(width, height, QImage.Format.Format_ARGB32)
    if image.isNull():
        raise RuntimeError(f"flow QImage allocation failed: {width}x{height}")
    image.fill(QColor("white"))
    painter = QPainter()
    try:
        if not painter.begin(image):
            raise RuntimeError("flow PNG painter begin failed")
        draw(painter)
    finally:
        if painter.isActive():
            painter.end()
    if not image.save(str(png_path), "PNG"):
        raise RuntimeError("flow PNG save failed")
    outputs.append(png_path)

    writer = QPdfWriter(str(pdf_path))
    writer.setResolution(150)
    pdf_painter = QPainter()
    try:
        if not pdf_painter.begin(writer):
            raise RuntimeError("flow PDF painter begin failed")
        sx = writer.width() / width
        sy = writer.height() / height
        scale = min(sx, sy)
        if scale <= 0:
            raise RuntimeError("flow PDF invalid page size")
        pdf_painter.scale(scale, scale)
        draw(pdf_painter)
    finally:
        if pdf_painter.isActive():
            pdf_painter.end()
    if pdf_path.exists() and pdf_path.stat().st_size > 0:
        outputs.append(pdf_path)
    else:
        raise RuntimeError("flow PDF save failed")
    return outputs
