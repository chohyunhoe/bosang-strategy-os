import json
from pathlib import Path

from bso_parser.batch_comparison import build_batch_comparison


FIXTURE = (
    Path(__file__).resolve().parents[1]
    / "fixtures"
    / "golden_cases"
    / "gongju_songseon_donghyeon"
    / "expected_values.json"
)


def test_gongju_three_appraisers_generate_trial_comparison():
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    result = build_batch_comparison(data["appraisals"])

    assert result["appraisal_count"] == 3
    assert [row["company"] for row in result["rows"]] == ["경일", "제일", "가람"]
    assert result["summary"]["applied_unit_price_min"] == 601003
    assert result["summary"]["applied_unit_price_max"] == 605015
    assert result["summary"]["applied_unit_price_spread"] == 4012
    assert result["summary"]["amount_spread"] == 2000006


def test_fixture_is_not_an_active_parser_condition():
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert data["usage"] == "golden_case_only"
    assert data["active_parser_hardcoding_allowed"] is False
