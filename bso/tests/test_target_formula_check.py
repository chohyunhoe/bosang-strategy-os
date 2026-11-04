from bso_parser.models import Field
from bso_parser.pipeline import _target_unit_price_check


def test_target_formula_check_ignores_unrelated_schedule_rows():
    other = {
        "standard_row": {
            "official_price": Field.ok(100000, []),
            "time_adjustment": Field.ok(1.01, []),
        },
        "decided_value": Field.ok(2.0, []),
    }
    subject_factors = {
        "rows": [
            Field.ok({"lot": "10-1", "factor_total": 1.05}, []),
            Field.ok({"lot": "20-2", "factor_total": 1.10}, []),
        ]
    }
    target_summary = {"decided_unit_price": 222000}

    check = _target_unit_price_check(other, subject_factors, target_summary, "20-2")

    assert check["check_id"] == "applied_unit_price"
    assert check["calculated"] == 222200.0
    assert check["stated"] == 222000
    assert check["status"] == "pass"
