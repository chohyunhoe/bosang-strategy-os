from __future__ import annotations

import hashlib
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from docx import Document

from .docx_binder import SlotBindingError, bind_docx, find_placeholder_paragraphs, load_manifest
from .docx_template import build_template
from .generator import build_output
from .models import BriefOutput, ReviewStatus

ROOT = Path(__file__).resolve().parent


def _load_case() -> BriefOutput:
    raw = json.loads((ROOT / "golden_case_shinmh_input.json").read_text(encoding="utf-8"))
    return BriefOutput.model_validate(raw)


class DocxTemplateTests(unittest.TestCase):
    def test_template_has_exactly_the_manifest_slots_once_each(self) -> None:
        manifest = load_manifest()
        with TemporaryDirectory() as tmp:
            template_path = build_template(manifest, Path(tmp) / "template.docx")
            document = Document(str(template_path))
            placeholders = find_placeholder_paragraphs(document)
        expected = {slot["slot"] for slot in manifest["slots"]}
        self.assertEqual(set(placeholders), expected)
        self.assertEqual(len(expected), 16)

    def test_template_header_and_footer_carry_safety_language(self) -> None:
        with TemporaryDirectory() as tmp:
            template_path = build_template(output_path=Path(tmp) / "template.docx")
            document = Document(str(template_path))
        footer_text = document.sections[0].footer.paragraphs[0].text
        self.assertIn("검토 보조", footer_text)
        self.assertIn("전문가 검토 필요", footer_text)


class DocxBinderTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.template_path = build_template(output_path=Path(self._tmp.name) / "template.docx")
        self.template_hash_before = hashlib.sha256(self.template_path.read_bytes()).hexdigest()

    def test_golden_case_binds_all_slots_with_no_raw_placeholders_left(self) -> None:
        output = build_output(_load_case())
        output_path = Path(self._tmp.name) / "brief.docx"

        bind_docx(output, self.template_path, output_path)

        document = Document(str(output_path))
        for paragraph in document.paragraphs:
            text = paragraph.text.strip()
            self.assertFalse(
                text.startswith("{{") and text.endswith("}}"),
                f"unresolved slot left in output: {text}",
            )

    def test_table_slots_produce_native_tables_with_correct_shape(self) -> None:
        output = build_output(_load_case())
        output_path = Path(self._tmp.name) / "brief.docx"
        bind_docx(output, self.template_path, output_path)

        document = Document(str(output_path))
        self.assertEqual(len(document.tables), 4)
        table_ids = {table.table_id for table in output.page_payloads[0].tables + output.page_payloads[1].tables + output.page_payloads[2].tables + output.page_payloads[3].tables}
        self.assertEqual(
            table_ids,
            {
                "subject_appraisal_summary",
                "valuation_structure_comparison",
                "individual_factor_comparison",
                "other_factor_comparison",
            },
        )
        structure_table = next(t for t in document.tables if t.rows[0].cells[0].text == "평가법인" and len(t.rows[0].cells) == 9)
        self.assertEqual(len(structure_table.rows), 1 + len(output.valuation_bundle))

    def test_missing_individual_factor_values_show_as_needs_review_in_table(self) -> None:
        case = _load_case()
        for row in case.valuation_bundle:
            row.individual_factors.street_condition = None
            row.individual_factors.access_condition = None
            row.individual_factors.environment_condition = None
            row.individual_factors.parcel_condition = None
            row.individual_factors.administrative_condition = None
            row.individual_factors.other_condition = None
            row.individual_factors.overall_individual_factor = None
            row.individual_factors.review_status = ReviewStatus.FAIL
        output = build_output(case)
        output_path = Path(self._tmp.name) / "brief.docx"
        bind_docx(output, self.template_path, output_path)

        document = Document(str(output_path))
        factor_table = next(t for t in document.tables if t.rows[0].cells[0].text == "평가법인" and len(t.rows[0].cells) == 9 and t.rows[0].cells[1].text == "가로")
        for row in factor_table.rows[1:]:
            self.assertEqual(row.cells[1].text, "확인 필요")

    def test_pending_graphics_leave_explicit_note_and_do_not_crash(self) -> None:
        output = build_output(_load_case())
        self.assertTrue(all(asset.status == "pending" for asset in output.graphics_bundle))

        output_path = Path(self._tmp.name) / "brief.docx"
        bind_docx(output, self.template_path, output_path)

        document = Document(str(output_path))
        full_text = "\n".join(p.text for p in document.paragraphs)
        for asset in output.graphics_bundle:
            self.assertIn(f"[그래픽 대기: {asset.asset_id}", full_text)
        self.assertEqual(len(document.inline_shapes), 0)

    def test_binding_does_not_modify_the_template_file(self) -> None:
        output = build_output(_load_case())
        output_path = Path(self._tmp.name) / "brief.docx"
        bind_docx(output, self.template_path, output_path)

        template_hash_after = hashlib.sha256(self.template_path.read_bytes()).hexdigest()
        self.assertEqual(self.template_hash_before, template_hash_after)
        self.assertNotEqual(output_path.resolve(), self.template_path.resolve())

    def test_footer_disclaimer_preserved_in_output(self) -> None:
        output = build_output(_load_case())
        output_path = Path(self._tmp.name) / "brief.docx"
        bind_docx(output, self.template_path, output_path)

        document = Document(str(output_path))
        footer_text = document.sections[0].footer.paragraphs[0].text
        self.assertIn("검토 보조", footer_text)

    def test_template_missing_a_slot_raises(self) -> None:
        manifest = load_manifest()
        broken_manifest = {
            **manifest,
            "slots": manifest["slots"] + [{"slot": "{{PAGE6_EXTRA}}", "page": 6, "type": "text", "required": True}],
        }
        output = build_output(_load_case())
        output_path = Path(self._tmp.name) / "brief.docx"
        with self.assertRaises(SlotBindingError):
            bind_docx(output, self.template_path, output_path, manifest=broken_manifest)

    def test_duplicate_slot_in_template_raises(self) -> None:
        document = Document(str(self.template_path))
        document.add_paragraph("{{PAGE1_TITLE}}")
        duplicated_path = Path(self._tmp.name) / "duplicated.docx"
        document.save(duplicated_path)

        output = build_output(_load_case())
        output_path = Path(self._tmp.name) / "brief.docx"
        with self.assertRaises(SlotBindingError):
            bind_docx(output, duplicated_path, output_path)


if __name__ == "__main__":
    unittest.main()
