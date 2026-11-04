from bso_parser.golden_verifier import extract_trial_metrics, verify_against_expected


def _canonical():
    return {
        "standard_selection": {
            "selected_standard": {
                "value": {"lot": "산91-1", "official_price": 26500},
                "status": "EXTRACTED",
            }
        },
        "subject_to_standard_factors": {
            "rows": [
                {
                    "value": {"lot": "301-4", "factor_total": 0.97},
                    "status": "EXTRACTED",
                }
            ]
        },
        "other_factor": {
            "decided_value": {"value": 7.52, "status": "EXTRACTED"}
        },
        "land_schedule": {
            "rows": [
                {
                    "value": {
                        "lot": "301-4",
                        "unit_price": 605015,
                        "amount": 602000006,
                    },
                    "status": "EXTRACTED",
                }
            ]
        },
    }


def test_extract_trial_metrics():
    metrics = extract_trial_metrics(_canonical())
    assert metrics == {
        "subject_lot": "301-4",
        "standard_lot": "산91-1",
        "official_price": 26500,
        "subject_factor_total": 0.97,
        "other_factor": 7.52,
        "unit_price": 605015,
        "amount": 602000006,
    }


def test_verify_against_expected_passes_with_small_numeric_tolerance():
    result = verify_against_expected(
        _canonical(),
        {
            "subject_lot": "301-4",
            "standard_lot": "산91-1",
            "official_price": 26500,
            "subject_factor_total": 0.9705,
            "other_factor": 7.52,
            "unit_price": 605015,
            "amount": 602000006,
        },
    )
    assert result["valid"] is True
    assert result["matched"] == result["total"]


def test_verify_against_expected_reports_mismatch_without_guessing():
    result = verify_against_expected(_canonical(), {"unit_price": 601003})
    assert result["valid"] is False
    assert result["checks"][0]["actual"] == 605015
