from bso_parser.trial_report import build_markdown


def test_trial_report_contains_comparison_and_review_items():
    manifest = {
        "items": [
            {
                "company": "법인A",
                "trial_readiness": {
                    "trial_usable": False,
                    "checks": [{"name": "비교사례", "passed": False, "note": "지번 누락"}],
                },
                "golden_verification": {
                    "mismatches": [{"field": "unit_price", "actual": 100000, "expected": 110000}],
                },
            }
        ],
        "trial_usable_count": 0,
        "all_trial_usable": False,
        "golden_all_valid": False,
    }
    comparison = {
        "rows": [
            {
                "company": "법인A",
                "standard_lot": "산1-1",
                "official_price": 26500,
                "subject_factor_total": 0.97,
                "other_factor": 7.52,
                "unit_price": 100000,
                "amount": 330500000,
            }
        ]
    }
    report = build_markdown(manifest, comparison)
    assert "법인별 핵심 비교" in report
    assert "지번 누락" in report
    assert "100,000" in report
    assert "110,000" in report
