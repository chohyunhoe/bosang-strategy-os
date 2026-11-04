from bso_graphics.canonical_brief_builder import build_manifest


def _field(value, page=1, status="EXTRACTED"):
    return {"value": value, "status": status, "evidence": [{"page": page, "method": "text", "snippet": "x"}]}


def _canonical(company_marker, case_marker, other_factor, unit_price, factor_items):
    target_factors = {
        "street": 1.0,
        "access": 1.03,
        "environment": 1.0,
        "parcel": 1.01,
        "administrative": 1.0,
        "other": 1.0,
    }
    return {
        "target": {"dong": "테스트동", "lot": "10-1"},
        "source": {"file": "source.pdf"},
        "schema_validation": {"valid": True},
        "standard_selection": {
            "selected_standard": _field({
                "marker": company_marker,
                "dong": "테스트동",
                "lot": "20-2",
                "official_price": 100000,
                "road": "중로각지",
                "shape": "가장형",
                "topo": "평지",
            }, page=4)
        },
        "subject_to_standard_factors": {
            "rows": [_field({"lot": "10-1", "factors": target_factors, "factor_total": 1.04}, page=8)]
        },
        "land_schedule": {
            "rows": [_field({"dong": "테스트동", "lot": "10-1", "unit_price": unit_price, "amount": unit_price * 10})]
        },
        "case_selection": {
            "cases": [{"data": {"case_marker": case_marker, "dong": "테스트동", "lot": "30-3"}}]
        },
        "other_factor": {
            "case_row": {
                "case_marker": _field(case_marker, page=9),
                "case_unit_price": _field(150000, page=9),
                "time_adjustment": _field(1.01, page=9),
                "regional_factor": _field(1.0, page=9),
                "individual_factor_total": _field(1.05, page=9),
                "adjusted_unit_price": _field(159075, page=9),
                "gap_ratio": _field(1.5, page=9),
            },
            "standard_row": {
                "official_price": _field(100000, page=9),
                "time_adjustment": _field(1.01, page=9),
                "adjusted_unit_price": _field(101000, page=9),
            },
            "decided_value": _field(other_factor, page=9),
        },
        "standard_to_case_factors": {
            "factors": _field({"items": factor_items, "total": 1.05}, page=9)
        },
        "verification": {
            "target_computation_summary": {
                "status": "EXTRACTED",
                "calculated_unit_price": unit_price - 100,
            },
            "reverse_factor_audit": {
                "candidates": [{"implied_subject_individual_factor": {"value": 1.041}}]
            },
        },
    }


def test_canonical_values_populate_both_brief_pages():
    base = {
        "case_id": "TEST",
        "sample_brief": {
            "page1_summary": ["old", "준주거", "대", "상업용", "old", "준주거", "대", "상업용", "old", "old", "old", "old"],
            "page1_review_required": False,
            "page2_review_required": False,
        },
    }
    manifest = build_manifest(base, [
        ("가법인", _canonical("A", "#2", 2.0, 210000, [1, 1, 1.01, 1.04, 1, 1])),
        ("나법인", _canonical("B", "c", 2.1, 220000, [1, 1, 1.02, 1.03, 1, 1])),
    ])

    brief = manifest["sample_brief"]
    assert brief["page1_summary"][0] == "테스트동 10-1"
    assert brief["page1_summary"][4] == "테스트동 20-2"
    assert brief["page1_summary"][8] == "A / B"
    assert brief["page1_rows"][0]["applied_price"] == "210,000"
    assert brief["page1_rows"][1]["other_factor"] == "2.10"
    assert brief["page2_calc_rows"][0]["type"] == "가법인 사례#2"
    assert brief["page2_calc_rows"][1]["lot"] == "테스트동 30-3"
    assert brief["page2_rows"][0]["environment"] == "1.01"
    assert manifest["e2e_provenance"]["canonical_sources"][0]["reverse_inferred_factor"] == 1.041
