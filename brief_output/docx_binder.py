"""bso_brief_output_v0.1 -> DOCX 슬롯 바인딩 엔진.

`docx_template.py`가 만든 NATIVE 템플릿(`{{SLOT}}` placeholder만 있는 빈 문서)을
읽어, `BriefOutput` 데이터로 슬롯을 채운 새 DOCX 파일을 만든다.

원칙(``docx_slot_manifest.json`` rules, AGENTS.md 표현 원칙과 동일):
- 슬롯명은 문서 내에서 유일해야 하고, 매니페스트의 모든 슬롯이 정확히 한 번씩 채워져야 한다.
- 원본 템플릿 파일은 열기만 하고 절대 덮어쓰지 않는다. 항상 새 output 파일에 저장한다.
- 그래픽 자산이 준비되지 않은 슬롯(``GraphicAsset.status != "ready"``)은 이미지를 만들어
  내지 않고, 검수자가 알아볼 수 있는 명시적 대기 문구만 남긴다.
- 누락된 숫자·문구는 추정하지 않고 ``확인 필요``로 남긴다(이미 ``generator.py``가
  이 형식으로 채워 넘긴다. 여기서는 그 문자열을 그대로 옮길 뿐, 새로 판단하지 않는다).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from docx import Document
from docx.document import Document as DocumentObject
from docx.text.paragraph import Paragraph

from .models import BriefOutput, GraphicAsset, PagePayload, SlotBinding, TablePayload

ROOT = Path(__file__).resolve().parent
MANIFEST_PATH = ROOT / "docx_slot_manifest.json"

PENDING_GRAPHIC_NOTE = "[그래픽 대기: {asset_id} — 지도/도면 자산 미생성, 후속 연결 필요. 전문가 검토 필요.]"
MISSING_TABLE_NOTE = "[표 데이터 대기: {payload_key} — 후속 연결 필요]"
DISCLAIMER_TEXT = (
    "본 문서는 검토 보조 자료이며 감정평가 업무를 대체하지 않습니다. "
    "쟁점 후보와 수치는 모두 수동 검수와 전문가 검토가 필요한 초안입니다. "
    "보상금 증액 가능성이나 감정평가 적정성을 단정하지 않습니다."
)


class SlotBindingError(ValueError):
    """슬롯 계약(유일성·필수 슬롯 존재)이 깨졌을 때 발생한다."""


def load_manifest() -> dict:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def _page_lookup(output: BriefOutput) -> dict[str, PagePayload]:
    return {page.page_id: page for page in output.page_payloads}


def _table_lookup(output: BriefOutput) -> dict[str, TablePayload]:
    tables: dict[str, TablePayload] = {}
    for page in output.page_payloads:
        for table in page.tables:
            tables[table.table_id] = table
    return tables


def _graphic_lookup(output: BriefOutput) -> dict[str, GraphicAsset]:
    return {asset.asset_id: asset for asset in output.graphics_bundle}


def resolve_text(output: BriefOutput, payload_key: str) -> str:
    if payload_key == "disclaimer":
        return DISCLAIMER_TEXT

    if payload_key == "analysis_bundle.issue_candidates":
        issues = output.analysis_bundle.get("issue_candidates", [])
        if not issues:
            return "현재 구조화 데이터에서 별도 쟁점 후보가 생성되지 않았다."
        lines = []
        for idx, issue in enumerate(issues, start=1):
            lines.append(f"{idx}. [쟁점 후보 · 전문가 검토 필요] {issue['title']}")
            lines.append(f"   요약: {issue['summary']}")
            if issue.get("evidence"):
                lines.append("   근거: " + "; ".join(str(item) for item in issue["evidence"]))
            if issue.get("additional_review"):
                lines.append("   추가 확인자료: " + "; ".join(issue["additional_review"]))
        return "\n".join(lines)

    pages = _page_lookup(output)
    if "." in payload_key:
        page_id, field = payload_key.split(".", 1)
        page = pages.get(page_id)
        if page is not None:
            if field == "title":
                return page.title
            if field == "paragraphs":
                return "\n".join(page.paragraphs) if page.paragraphs else "확인 필요"

    return "확인 필요"


def find_placeholder_paragraphs(document: DocumentObject) -> dict[str, Paragraph]:
    found: dict[str, list[Paragraph]] = {}
    for paragraph in document.paragraphs:
        text = paragraph.text.strip()
        if text.startswith("{{") and text.endswith("}}"):
            found.setdefault(text, []).append(paragraph)

    duplicates = {slot: paras for slot, paras in found.items() if len(paras) > 1}
    if duplicates:
        raise SlotBindingError(
            "템플릿에 중복된 슬롯이 있습니다: " + ", ".join(sorted(duplicates))
        )
    return {slot: paras[0] for slot, paras in found.items()}


def _clear_paragraph(paragraph: Paragraph) -> None:
    for run in list(paragraph.runs):
        run.text = ""
    while len(paragraph.runs) > 1:
        paragraph.runs[-1]._element.getparent().remove(paragraph.runs[-1]._element)


def _set_text(paragraph: Paragraph, text: str) -> None:
    _clear_paragraph(paragraph)
    lines = text.split("\n")
    if paragraph.runs:
        paragraph.runs[0].text = lines[0]
    else:
        paragraph.add_run(lines[0])
    for extra in lines[1:]:
        paragraph.add_run().add_break()
        paragraph.add_run(extra)


def _insert_table_after(document: DocumentObject, paragraph: Paragraph, table: TablePayload) -> None:
    docx_table = document.add_table(rows=1 + len(table.rows), cols=len(table.columns))
    docx_table.style = "Table Grid"
    for col_idx, header in enumerate(table.columns):
        docx_table.rows[0].cells[col_idx].text = str(header)
    for row_idx, row in enumerate(table.rows, start=1):
        for col_idx, value in enumerate(row):
            docx_table.rows[row_idx].cells[col_idx].text = "확인 필요" if value is None else str(value)

    paragraph._p.addnext(docx_table._tbl)
    paragraph._p.getparent().remove(paragraph._p)


def bind_docx(
    output: BriefOutput,
    template_path: Path,
    output_path: Path,
    manifest: dict | None = None,
) -> Path:
    manifest = manifest or load_manifest()
    slots_by_name: dict[str, dict] = {slot["slot"]: slot for slot in manifest["slots"]}

    document = Document(str(template_path))
    placeholders = find_placeholder_paragraphs(document)

    missing = set(slots_by_name) - set(placeholders)
    if missing:
        raise SlotBindingError("템플릿에서 찾지 못한 필수 슬롯: " + ", ".join(sorted(missing)))
    extra = set(placeholders) - set(slots_by_name)
    if extra:
        raise SlotBindingError("매니페스트에 없는 슬롯이 템플릿에 있습니다: " + ", ".join(sorted(extra)))

    bindings: dict[str, SlotBinding] = {b.slot_name: b for b in output.docx_assembly}
    unbound = set(slots_by_name) - set(bindings)
    if unbound:
        raise SlotBindingError("docx_assembly에 바인딩이 없는 슬롯: " + ", ".join(sorted(unbound)))

    tables = _table_lookup(output)
    graphics = _graphic_lookup(output)

    for slot_name, slot_def in slots_by_name.items():
        paragraph = placeholders[slot_name]
        binding = bindings[slot_name]
        slot_type = slot_def["type"]

        if slot_type == "table":
            table = tables.get(binding.payload_key)
            if table is None:
                _set_text(paragraph, MISSING_TABLE_NOTE.format(payload_key=binding.payload_key))
            else:
                _insert_table_after(document, paragraph, table)
        elif slot_type == "image":
            asset = graphics.get(binding.payload_key)
            if asset is not None and asset.status == "ready" and asset.file_name:
                _clear_paragraph(paragraph)
                paragraph.add_run().add_picture(asset.file_name)
            else:
                asset_id = asset.asset_id if asset is not None else binding.payload_key
                _set_text(paragraph, PENDING_GRAPHIC_NOTE.format(asset_id=asset_id))
        elif slot_type in ("text", "issues"):
            _set_text(paragraph, resolve_text(output, binding.payload_key))
        else:  # pragma: no cover - manifest is a fixed, known set of types
            raise SlotBindingError(f"알 수 없는 슬롯 타입: {slot_type}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    document.save(output_path)
    return output_path


def bind_from_json(brief_json_path: Path, template_path: Path, output_path: Path) -> Path:
    raw = json.loads(brief_json_path.read_text(encoding="utf-8"))
    output = BriefOutput.model_validate(raw)
    return bind_docx(output, template_path, output_path)
