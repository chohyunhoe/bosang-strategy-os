# -*- coding: utf-8 -*-
"""Requirement 2: target-aware row selection in batch_comparison and golden_verifier."""
from bso_parser.batch_comparison import summarize_canonical
from bso_parser.golden_verifier import extract_trial_metrics
from bso_parser.review_queue_builder import build as build_review_queue


def _multi_row_canonical(target=None):
    canonical = {
        "standard_selection": {
            "selected_standard": {
                "value": {"dong": "가동", "lot": "10-1", "official_price": 50000},
                "status": "EXTRACTED",
            }
        },
        "subject_to_standard_factors": {
            "rows": [
                {"value": {"factor_total": 1.05}, "status": "EXTRACTED"},
            ]
        },
        "other_factor": {
            "standard_row": {
                "standard_marker": {"value": "A", "status": "EXTRACTED"},
                "official_price": {"value": 50000, "status": "EXTRACTED"},
                "time_adjustment": {"value": 1.1, "status": "EXTRACTED"},
            },
            "decided_value": {"value": 2.0, "status": "EXTRACTED"},
        },
        "land_schedule": {
            "rows": [
                {"value": {"dong": "나동", "lot": "5-1", "unit_price": 80000, "amount": 4000000}, "status": "EXTRACTED"},
                {"value": {"dong": "가동", "lot": "20-2", "unit_price": 110000, "amount": 5500000}, "status": "EXTRACTED"},
                {"value": {"dong": "다동", "lot": "30-3", "unit_price": 90000, "amount": 4500000}, "status": "EXTRACTED"},
            ]
        },
        "review_queue": [],
        "schema_validation": {"valid": True},
        "comparison_set": [],
        "verification": {"formula_checks": []},
    }
    if target:
        canonical["target"] = target
    return canonical


def test_first_row_is_different_lot_target_selects_second():
    canonical = _multi_row_canonical(target={"dong": "가동", "lot": "20-2"})
    row = summarize_canonical(canonical, "테스트법인")
    assert row["applied_unit_price"] == 110000
    assert row["amount"] == 5500000


def test_batch_comparison_uses_target():
    canonical = _multi_row_canonical(target={"dong": "가동", "lot": "20-2"})
    row = summarize_canonical(canonical, "테스트법인")
    assert row["applied_unit_price"] == 110000

    canonical_no_target = _multi_row_canonical()
    row_no = summarize_canonical(canonical_no_target, "테스트법인")
    assert row_no["applied_unit_price"] is None


def test_batch_comparison_uses_source_calculated_price_from_target_summary():
    canonical = _multi_row_canonical(target={"dong": "가동", "lot": "20-2"})
    canonical["verification"]["target_computation_summary"] = {
        "calculated_unit_price": 109876,
        "decided_unit_price": 110000,
    }

    row = summarize_canonical(canonical, "테스트법인")

    assert row["calculated_unit_price"] == 109876
    assert row["applied_unit_price"] == 110000


def test_golden_verifier_uses_target():
    canonical = _multi_row_canonical(target={"dong": "가동", "lot": "20-2"})
    metrics = extract_trial_metrics(canonical)
    assert metrics["subject_lot"] == "20-2"
    assert metrics["unit_price"] == 110000


def test_multi_row_no_target_no_fallback():
    canonical = _multi_row_canonical()
    row = summarize_canonical(canonical, "테스트법인")
    assert row["applied_unit_price"] is None
    assert row["amount"] is None

    metrics = extract_trial_metrics(canonical)
    assert metrics["subject_lot"] is None
    assert metrics["unit_price"] is None


def test_single_row_preserves_behavior():
    canonical = _multi_row_canonical()
    canonical["land_schedule"]["rows"] = [
        {"value": {"dong": "가동", "lot": "20-2", "unit_price": 110000, "amount": 5500000}, "status": "EXTRACTED"},
    ]
    row = summarize_canonical(canonical, "테스트법인")
    assert row["applied_unit_price"] == 110000

    metrics = extract_trial_metrics(canonical)
    assert metrics["subject_lot"] == "20-2"
    assert metrics["unit_price"] == 110000


def test_review_queue_target_zero_matches():
    canonical = _multi_row_canonical(target={"dong": "가동", "lot": "9999-9"})
    queue = build_review_queue(canonical)
    target_items = [i for i in queue if "일치 행 없음" in i["topic"]]
    assert len(target_items) == 1
    assert target_items[0]["priority"] == "high"


def test_review_queue_target_multiple_matches():
    canonical = _multi_row_canonical(target={"dong": "가동", "lot": "20-2"})
    canonical["land_schedule"]["rows"].append(
        {"value": {"dong": "가동", "lot": "20-2", "unit_price": 120000}, "status": "EXTRACTED"}
    )
    queue = build_review_queue(canonical)
    target_items = [i for i in queue if "복수 일치" in i["topic"]]
    assert len(target_items) == 1
    assert target_items[0]["priority"] == "high"
