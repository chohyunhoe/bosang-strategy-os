from bso_parser.trial_readiness import evaluate


def _field(value=None, status="EXTRACTED"):
    return {"value": value, "status": status, "evidence": []}


def test_trial_readiness_passes_with_core_blocks():
    canonical = {
        "standard_selection": {"selected_standard": _field({"dong": "테스트동", "lot": "1-1"})},
        "subject_to_standard_factors": {"rows": [_field({"lot": "2-2", "factor_total": 0.95})]},
        "case_selection": {"cases": [{"data": {"lot": "3-3"}, "field": _field({"lot": "3-3"})}]},
        "other_factor": {"decided_value": _field(4.5, "REVIEW_REQUIRED")},
        "land_schedule": {"rows": [_field({"lot": "2-2", "unit_price": 100000})]},
        "comparison_set": [
            {"role": "standard", "gis_ready": True},
            {"role": "subject", "gis_ready": True},
        ],
        "review_queue": [],
    }
    result = evaluate(canonical)
    assert result["trial_usable"] is True
    assert result["passed"] == result["total"]


def test_trial_readiness_does_not_require_gis_for_minimum_trial_use():
    canonical = {
        "standard_selection": {"selected_standard": _field({"lot": "1-1"})},
        "subject_to_standard_factors": {"rows": [_field({"lot": "2-2"})]},
        "case_selection": {"cases": [{"data": {"unit_price": 200000}, "field": _field({})}]},
        "other_factor": {"decided_value": _field(4.2, "REVIEW_REQUIRED")},
        "land_schedule": {"rows": []},
        "comparison_set": [],
        "review_queue": [{"topic": "주소 확인"}],
    }
    result = evaluate(canonical)
    assert result["passed"] == 4
    assert result["trial_usable"] is True
    assert result["review_queue_count"] == 1
