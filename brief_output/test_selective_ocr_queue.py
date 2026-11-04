from __future__ import annotations

import unittest

from .selective_ocr_queue import score_page


class SelectiveOCRQueueTests(unittest.TestCase):
    def test_tail_low_text_page_is_selected(self) -> None:
        score, reasons = score_page(page_number=47, page_count=48, text="평가명세표", image_count=1)
        self.assertGreaterEqual(score, 5)
        self.assertIn("tail_page", reasons)
        self.assertIn("low_text_density", reasons)
        self.assertIn("valuation_keyword", reasons)

    def test_ordinary_dense_body_page_is_not_selected(self) -> None:
        score, _ = score_page(page_number=10, page_count=48, text="일반 설명문 " * 500, image_count=0)
        self.assertLess(score, 5)

    def test_exact_target_lot_has_high_priority(self) -> None:
        score, reasons = score_page(page_number=30, page_count=48, text="과림동 120-7 결정단가", image_count=0)
        self.assertGreaterEqual(score, 16)
        self.assertIn("exact_target_lot", reasons)

    def test_serial_or_decimal_substring_is_not_target_lot(self) -> None:
        score, reasons = score_page(page_number=15, page_count=48, text="일련번호 120 가격 7,000원", image_count=0)
        self.assertNotIn("exact_target_lot", reasons)
        self.assertLess(score, 16)

    def test_target_serial_and_area_pairs_are_prioritized(self) -> None:
        score, reasons = score_page(
            page_number=42,
            page_count=48,
            text="일련번호 584 585 면적 891 4,006 평가액",
            image_count=0,
        )
        self.assertIn("target_serial_pair", reasons)
        self.assertIn("target_area_pair", reasons)
        self.assertGreaterEqual(score, 24)


if __name__ == "__main__":
    unittest.main()
