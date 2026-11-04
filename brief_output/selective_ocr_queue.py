from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

import fitz

TARGET_LOTS = ("120-7", "120-8")
TARGET_SERIALS = ("584", "585")
TARGET_AREAS = ("891", "4,006", "4006")
KEYWORDS = (
    "토지가격 산출",
    "토지 평가명세",
    "토지평가명세",
    "감정평가액",
    "평가명세표",
    "일련번호",
    "결정단가",
    "평가액",
)
FINAL_BLOCK_ANCHORS = (
    "그 밖의 요인",
    "그밖의요인",
    "비교표준지 공시지가 평가",
    "비교표준지공시지가평가",
    "토지 평가액의 결정",
    "토지평가액의결정",
)


def _compact(value: str) -> str:
    return re.sub(r"\s+", "", value or "")


def _has_exact_lot(text: str) -> bool:
    return any(re.search(rf"(?<!\d){re.escape(lot)}(?!\d)", text or "") for lot in TARGET_LOTS)


def _evidence_score(text: str) -> tuple[int, list[str]]:
    compact = _compact(text)
    score = 0
    reasons: list[str] = []
    keyword_hits = [keyword for keyword in KEYWORDS if _compact(keyword) in compact]
    if keyword_hits:
        score += min(8, 2 * len(keyword_hits))
        reasons.append("valuation_keyword")
    if _has_exact_lot(text):
        score += 16
        reasons.append("exact_target_lot")
    if all(re.search(rf"(?<!\d){serial}(?!\d)", text or "") for serial in TARGET_SERIALS):
        score += 14
        reasons.append("target_serial_pair")
    area_hits = sum(area.replace(",", "") in compact.replace(",", "") for area in TARGET_AREAS)
    if area_hits >= 2:
        score += 10
        reasons.append("target_area_pair")
    return score, reasons


def score_page(*, page_number: int, page_count: int, text: str, image_count: int) -> tuple[int, list[str]]:
    compact = _compact(text)
    score, reasons = _evidence_score(text)
    if page_number > max(1, page_count - 10):
        score += 2
        reasons.append("tail_page")
    if len(compact) < 800:
        score += 2
        reasons.append("low_text_density")
    elif len(compact) < 1600:
        score += 1
        reasons.append("medium_text_density")
    if image_count:
        score += min(image_count, 2)
        reasons.append("embedded_image")
    return score, reasons


def _find_final_block_start(document: fitz.Document) -> int | None:
    anchors: list[int] = []
    for index, page in enumerate(document):
        compact = _compact(page.get_text("text") or "")
        if any(_compact(anchor) in compact for anchor in FINAL_BLOCK_ANCHORS):
            anchors.append(index + 1)
    return max(anchors) if anchors else None


def _candidate_pages(document: fitz.Document, max_pages: int) -> list[dict[str, Any]]:
    page_meta: dict[int, dict[str, Any]] = {}
    evidence_pages: set[int] = set()
    for index, page in enumerate(document):
        page_number = index + 1
        text = page.get_text("text") or ""
        image_count = len(page.get_images(full=True))
        score, reasons = score_page(
            page_number=page_number,
            page_count=document.page_count,
            text=text,
            image_count=image_count,
        )
        page_meta[page_number] = {
            "page": page_number,
            "score": score,
            "reasons": reasons,
            "text_length": len(_compact(text)),
            "image_count": image_count,
        }
        if any(reason in reasons for reason in ("exact_target_lot", "target_serial_pair", "target_area_pair")):
            evidence_pages.add(page_number)

    selected_pages: set[int] = set()
    for page_number in evidence_pages:
        for neighbor in range(max(1, page_number - 1), min(document.page_count, page_number + 1) + 1):
            selected_pages.add(neighbor)

    block_start = _find_final_block_start(document)
    if block_start is not None:
        for page_number in range(max(1, block_start - 1), document.page_count + 1):
            selected_pages.add(page_number)

    # Final valuation schedules are commonly image-only and may contain no searchable anchor.
    # Always retain the last five pages so the appraisal schedule cannot disappear from the OCR queue.
    tail_start = max(1, document.page_count - 4)
    selected_pages.update(range(tail_start, document.page_count + 1))

    if not selected_pages:
        ranked = sorted(page_meta.values(), key=lambda item: (-int(item["score"]), -int(item["page"])))
        selected_pages.update(int(item["page"]) for item in ranked[:max_pages])

    ordered = sorted(selected_pages)
    mandatory = sorted(set(evidence_pages) | set(range(tail_start, document.page_count + 1)))
    if len(ordered) > max_pages:
        remaining_slots = max(0, max_pages - len(mandatory))
        optional = [page for page in ordered if page not in mandatory]
        ranked_optional = sorted(optional, key=lambda page: (-int(page_meta[page]["score"]), -page))
        ordered = sorted(set(mandatory + ranked_optional[:remaining_slots]))

    result: list[dict[str, Any]] = []
    for page_number in ordered:
        item = dict(page_meta[page_number])
        if page_number >= tail_start:
            item["score"] = int(item["score"]) + 20
            item["reasons"] = list(item["reasons"]) + ["final_valuation_tail"]
        elif block_start is not None and page_number >= max(1, block_start - 1):
            item["score"] = int(item["score"]) + 20
            item["reasons"] = list(item["reasons"]) + ["final_valuation_block"]
        result.append(item)
    return result


def _run_tesseract(image_path: Path) -> tuple[str | None, str]:
    executable = shutil.which("tesseract")
    if not executable:
        return None, "NOT_INSTALLED"
    command = [executable, str(image_path), "stdout", "-l", "kor+eng", "--psm", "6"]
    try:
        completed = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=90)
    except (OSError, subprocess.TimeoutExpired):
        return None, "FAILED"
    if completed.returncode != 0:
        return None, "FAILED"
    return completed.stdout, "COMPLETED"


def build_queue(pdf_path: str, company: str, output_dir: Path, max_pages: int = 8) -> list[dict[str, Any]]:
    document = fitz.open(pdf_path)
    selected = _candidate_pages(document, max_pages=max_pages)
    render_dir = output_dir / "selective-ocr-pages"
    render_dir.mkdir(parents=True, exist_ok=True)
    queue: list[dict[str, Any]] = []
    for item in selected:
        page = document[int(item["page"]) - 1]
        safe_company = "central" if company.startswith("중앙") else "junghae"
        image_path = render_dir / f"{safe_company}_p{int(item['page']):03d}.png"
        page.get_pixmap(matrix=fitz.Matrix(2.5, 2.5), alpha=False).save(image_path)
        ocr_text, status = _run_tesseract(image_path)
        hits: list[dict[str, str]] = []
        source_text = ocr_text or page.get_text("text") or ""
        normalized = re.sub(r"\s+", " ", source_text)
        for lot in TARGET_LOTS:
            match = re.search(rf"(.{{0,120}}(?<!\d){re.escape(lot)}(?!\d).{{0,320}})", normalized)
            if match:
                hits.append({"lot_number": lot, "excerpt": match.group(1).strip()})
        if ocr_text:
            (render_dir / f"{safe_company}_p{int(item['page']):03d}.txt").write_text(ocr_text, encoding="utf-8")
        queue.append({
            "appraisal_company": company,
            **item,
            "rendered_file": str(image_path.relative_to(output_dir)),
            "ocr_status": status,
            "target_hits": hits,
            "review_required": not bool(hits),
        })
    document.close()
    return queue


def main() -> None:
    parser = argparse.ArgumentParser(description="대상토지 평가행 선택 OCR 큐 생성")
    parser.add_argument("--central", required=True)
    parser.add_argument("--junghae", required=True)
    parser.add_argument("--output", default="prototype-output")
    args = parser.parse_args()
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)
    queue = build_queue(args.central, "중앙감정평가법인", output_dir)
    queue.extend(build_queue(args.junghae, "정해감정평가법인", output_dir))
    summary = {
        "mode": "selective_final_valuation_block_ocr",
        "whole_document_ocr": False,
        "tesseract_available": shutil.which("tesseract") is not None,
        "selected_pages": len(queue),
        "target_hit_pages": sum(bool(item["target_hits"]) for item in queue),
        "items": queue,
    }
    (output_dir / "selective_ocr_queue.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(output_dir.resolve())


if __name__ == "__main__":
    main()
