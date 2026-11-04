# -*- coding: utf-8 -*-
from __future__ import annotations

from pathlib import Path


def _report_lines(manifest: dict, result: dict) -> list[str]:
    lines = [
        "보상전략 OS 그래픽 게이트 결과",
        f"사건: {manifest.get('title') or manifest.get('case_id')}",
        f"상태: {result.get('status')}",
        f"생성 파일: {len(result.get('outputs', []))}건",
        "",
        "출력 파일",
    ]
    outputs = result.get("outputs", [])
    lines.extend([f"- {Path(item).name}" for item in outputs] or ["- 없음"])
    lines.extend(["", "선택 geometry"])
    geometry = result.get("selected_geometry", [])
    lines.extend([f"- {Path(item).name}" for item in geometry] or ["- 없음"])
    if result.get("brief_slot_map"):
        lines.extend(["", f"브리프 슬롯맵: {Path(result['brief_slot_map']).name}"])
    lines.extend(["", "검토 필요 항목"])
    issues = result.get("issues", [])
    lines.extend([f"- {item.get('code')}: {item.get('message')}" for item in issues] or ["- 없음"])
    lines.extend([
        "",
        "위치 또는 필지 geometry가 확인되지 않은 경우 그래픽을 추정 생성하지 않습니다.",
        "본 산출물은 감정평가 또는 법률판단을 대체하지 않는 검토 보조자료입니다.",
    ])
    return lines


def _write_pdf(lines: list[str], pdf_path: Path) -> None:
    from qgis.PyQt.QtCore import QRectF, Qt
    from qgis.PyQt.QtGui import QColor, QFont, QPainter, QPdfWriter

    if pdf_path.exists():
        pdf_path.unlink()
    writer = QPdfWriter(str(pdf_path))
    writer.setResolution(150)
    painter = QPainter()
    try:
        if not painter.begin(writer):
            raise RuntimeError("report PDF painter begin failed")
        painter.setPen(QColor(25, 35, 45))
        painter.setFont(QFont("Malgun Gothic", 12))
        x = 90
        y = 90
        line_height = 34
        page_width = writer.width() - 180
        if writer.width() <= 0 or writer.height() <= 0:
            raise RuntimeError("report PDF invalid page size")
        for index, line in enumerate(lines):
            if y + line_height > writer.height() - 90:
                writer.newPage()
                y = 90
            if index == 0:
                painter.setFont(QFont("Malgun Gothic", 18, QFont.Weight.Bold))
                painter.drawText(
                    QRectF(x, y, page_width, 55),
                    Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter,
                    line,
                )
                painter.setFont(QFont("Malgun Gothic", 12))
                y += 58
                continue
            painter.drawText(
                QRectF(x, y, page_width, line_height),
                Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter,
                line,
            )
            y += line_height
    finally:
        if painter.isActive():
            painter.end()
    if not pdf_path.exists() or pdf_path.stat().st_size == 0:
        raise RuntimeError("report PDF save failed")


def write_report(manifest: dict, result: dict, output_dir: Path) -> Path:
    lines = _report_lines(manifest, result)
    markdown = output_dir / "graphics_report.md"
    markdown.write_text("\n".join(lines), encoding="utf-8")

    pdf_path = output_dir / "graphics_report.pdf"
    error_path = output_dir / "graphics_report_pdf_error.txt"
    if error_path.exists():
        error_path.unlink()
    try:
        _write_pdf(lines, pdf_path)
    except Exception as exc:
        if pdf_path.exists():
            try:
                pdf_path.unlink()
            except OSError:
                pass
        error_path.write_text(str(exc), encoding="utf-8")
    return pdf_path if pdf_path.exists() else markdown
