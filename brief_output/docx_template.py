"""bso_brief_docx_v0.1 NATIVE 템플릿 생성.

`docx_slot_manifest.json`에 고정된 5페이지 16개 슬롯을 그대로 담은 빈 Word 템플릿을
만든다. 이 템플릿은 저장소에 커밋되는 원본이며, 실제 사건 데이터는 여기에 들어가지
않는다. `docx_binder.py`가 이 템플릿을 읽어 슬롯을 채운 새 파일을 별도로 만든다.
"""

from __future__ import annotations

import json
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH

ROOT = Path(__file__).resolve().parent
MANIFEST_PATH = ROOT / "docx_slot_manifest.json"
TEMPLATE_DIR = ROOT / "templates"
TEMPLATE_PATH = TEMPLATE_DIR / "bso_brief_template_v0.1.docx"

PAGE_TITLES = {
    1: "1. 요약",
    2: "2. 평가구조 비교",
    3: "3. 대상토지·비교표준지 및 개별요인",
    4: "4. 그 밖의 요인 및 단가 차이",
    5: "5. 핵심 쟁점 및 결론",
}


def load_manifest() -> dict:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def build_template(manifest: dict | None = None, output_path: Path = TEMPLATE_PATH) -> Path:
    manifest = manifest or load_manifest()

    document = Document()

    header = document.sections[0].header
    header.paragraphs[0].text = "보상전략 OS — 감정평가 1차 분석 브리프"

    footer = document.sections[0].footer
    footer.paragraphs[0].text = "검토 보조 자료 · 쟁점 후보 · 전문가 검토 필요 (감정평가·법률판단 대체 아님)"

    slots_by_page: dict[int, list[dict]] = {}
    for slot in manifest["slots"]:
        slots_by_page.setdefault(slot["page"], []).append(slot)

    for page_no in sorted(slots_by_page):
        if page_no > 1:
            document.add_page_break()
        heading = document.add_heading(PAGE_TITLES.get(page_no, f"{page_no} 페이지"), level=1)
        heading.alignment = WD_ALIGN_PARAGRAPH.LEFT
        for slot in slots_by_page[page_no]:
            placeholder = document.add_paragraph(slot["slot"])
            placeholder.style = document.styles["Normal"]

    TEMPLATE_DIR.mkdir(parents=True, exist_ok=True)
    document.save(output_path)
    return output_path


if __name__ == "__main__":
    path = build_template()
    print(path)
