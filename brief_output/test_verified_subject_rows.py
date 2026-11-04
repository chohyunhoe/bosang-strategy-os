from __future__ import annotations

import unittest

from .verified_subject_rows import verified_subject_rows


class VerifiedSubjectRowsTests(unittest.TestCase):
    def test_central_golden_case_rows_are_provenance_tagged(self) -> None:
        rows = verified_subject_rows()
        self.assertEqual({row["lot_number"] for row in rows}, {"120-7", "120-8"})
        self.assertTrue(all(row["company_hint"] == "중앙감정평가법인" for row in rows))
        self.assertTrue(all(row["extraction_path"] == "verified_page_capture" for row in rows))

    def test_verified_amounts_match_share_applied_schedule(self) -> None:
        by_lot = {row["lot_number"]: row for row in verified_subject_rows()}
        self.assertEqual(by_lot["120-7"]["decided_unit_price"], 882000.0)
        self.assertEqual(by_lot["120-7"]["appraised_amount"], 392931000.0)
        self.assertEqual(by_lot["120-8"]["decided_unit_price"], 882000.0)
        self.assertEqual(by_lot["120-8"]["appraised_amount"], 1766646000.0)


if __name__ == "__main__":
    unittest.main()
