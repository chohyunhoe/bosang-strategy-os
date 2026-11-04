import json
from pathlib import Path

from bso_parser.batch_comparison import build_batch_comparison
from bso_parser.reverse_factor_audit import (
    ASSUMED_NEUTRAL,
    NOT_IDENTIFIABLE,
    REVIEW_REQUIRED,
    REVERSE_INFERENCE,
    audit_candidate,
    build_batch_reverse_audit,
    build_from_canonical,
)
from bso_parser.review_queue_builder import build as build_review_queue


FIXTURE = (
    Path(__file__).resolve().parents[1]
    / "fixtures"
    / "golden_cases"
    / "sillim_1513_2"
    / "expected_reverse_audit.json"
)


def _fixture():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_sillim_reverse_audit_preserves_inference_boundary():
    data = _fixture()
    result = build_batch_reverse_audit(data["appraisals"])
    candidates = {
        candidate["candidate_id"]: candidate
        for appraisal in result["appraisals"]
        for candidate in appraisal["candidates"]
    }

    prime = candidates["prime_cheo_1526_2"]
    line = candidates["line_k_1526_2"]
    assert prime["implied_subject_individual_factor"] == {
        "value": data["expected"]["prime_1526_2_implied_factor"],
        "status": REVERSE_INFERENCE,
    }
    assert line["implied_subject_individual_factor"]["value"] == data["expected"]["line_1526_2_implied_factor"]
    assert prime["selection_status"] == "REVIEW_REQUIRED"
    assert prime["individual_factor_breakdown"]["status"] == NOT_IDENTIFIABLE
    assert prime["individual_factor_breakdown"]["items"] is None


def test_cross_appraiser_convergence_ranks_1526_2_without_confirming_it():
    data = _fixture()
    comparison = build_batch_reverse_audit(data["appraisals"])["cross_appraiser_comparison"]
    best = comparison["best_supported_candidate"]

    assert best["standard_lot"] == data["expected"]["best_supported_standard_lot"]
    assert best["absolute_spread"] == data["expected"]["best_supported_absolute_spread"]
    assert best["status"] == "CONVERGENT_CANDIDATE"
    assert best["selection_status"] == "REVIEW_REQUIRED"
    assert comparison["status"] == "REVIEW_REQUIRED"


def test_batch_comparison_includes_reverse_audit_for_fixture_rows():
    data = _fixture()
    result = build_batch_comparison(data["appraisals"])

    assert result["appraisal_count"] == 2
    assert result["summary"]["applied_unit_price_spread"] == 500000
    best = result["reverse_factor_audit"]["cross_appraiser_comparison"]["best_supported_candidate"]
    assert best["standard_lot"] == "1526-2"


def test_missing_required_input_is_not_reverse_engineered():
    result = audit_candidate(
        {
            "standard_lot": "1-1",
            "official_price": 100000,
            "time_adjustment": None,
            "regional_factor": 1.0,
            "other_factor": 2.0,
        },
        applied_unit_price=250000,
    )
    assert result["status"] == NOT_IDENTIFIABLE
    assert result["missing_fields"] == ["time_adjustment"]
    assert "implied_subject_individual_factor" not in result


def test_canonical_audit_marks_neutral_regional_factor_as_assumption_and_queues_review():
    canonical = {
        "standard_selection": {
            "selected_standard": {
                "value": {"dong": "테스트동", "lot": "10-1", "official_price": 100000},
                "status": "EXTRACTED",
            }
        },
        "subject_to_standard_factors": {"rows": []},
        "other_factor": {
            "standard_row": {
                "standard_marker": {"value": "A", "status": "EXTRACTED"},
                "official_price": {"value": 100000, "status": "EXTRACTED"},
                "time_adjustment": {"value": 1.1, "status": "EXTRACTED"},
            },
            "decided_value": {"value": 2.0, "status": "EXTRACTED"},
        },
        "land_schedule": {
            "rows": [
                {
                    "value": {"lot": "20-2", "unit_price": 264000},
                    "status": "REVIEW_REQUIRED",
                }
            ]
        },
        "verification": {"formula_checks": []},
        "comparison_set": [],
    }
    audit = build_from_canonical(canonical)
    candidate = audit["candidates"][0]

    assert candidate["implied_subject_individual_factor"]["value"] == 1.2
    assert candidate["formula_inputs"]["regional_factor"]["status"] == "ASSUMED_NEUTRAL"
    assert candidate["formula_inputs"]["applied_unit_price"]["status"] == "REVIEW_REQUIRED"

    canonical["verification"]["reverse_factor_audit"] = audit
    queue = build_review_queue(canonical)
    assert any(item["path"] == "verification.reverse_factor_audit" for item in queue)


def test_fixture_is_not_an_active_parser_condition():
    data = _fixture()
    assert data["usage"] == "golden_case_only"
    assert data["active_parser_hardcoding_allowed"] is False


def _multi_row_canonical():
    return {
        "standard_selection": {
            "selected_standard": {
                "value": {"dong": "테스트동", "lot": "10-1", "official_price": 100000},
                "status": "EXTRACTED",
            }
        },
        "subject_to_standard_factors": {"rows": []},
        "other_factor": {
            "standard_row": {
                "standard_marker": {"value": "A", "status": "EXTRACTED"},
                "official_price": {"value": 100000, "status": "EXTRACTED"},
                "time_adjustment": {"value": 1.1, "status": "EXTRACTED"},
            },
            "decided_value": {"value": 2.0, "status": "EXTRACTED"},
        },
        "land_schedule": {
            "rows": [
                {"value": {"dong": "신림동", "lot": "1513-2", "serial": "1", "unit_price": 22000000}, "status": "EXTRACTED"},
                {"value": {"dong": "신림동", "lot": "1500-5", "serial": "2", "unit_price": 18000000}, "status": "EXTRACTED"},
                {"value": {"dong": "봉천동", "lot": "200-1", "serial": "3", "unit_price": 15000000}, "status": "EXTRACTED"},
            ]
        },
        "verification": {"formula_checks": []},
        "comparison_set": [],
    }


def test_target_lot_selects_exact_one_row():
    canonical = _multi_row_canonical()
    result = build_from_canonical(canonical, target_dong="신림동", target_lot="1513-2")
    assert result["status"] == "INFERRED_CANDIDATE"
    assert result["target_lot"] == "1513-2"
    assert len(result["candidates"]) == 1


def test_target_lot_no_match_returns_not_identifiable():
    canonical = _multi_row_canonical()
    result = build_from_canonical(canonical, target_dong="신림동", target_lot="9999-9")
    assert result["status"] == NOT_IDENTIFIABLE
    assert result["candidates"] == []
    assert "일치 행 없음" in result["note"]


def test_multi_row_no_target_refuses_auto_selection():
    canonical = _multi_row_canonical()
    result = build_from_canonical(canonical)
    assert result["status"] == NOT_IDENTIFIABLE
    assert "unique_land_schedule_row" in result.get("missing_fields", [])


def test_duplicate_target_rows_refuse_auto_sum():
    canonical = _multi_row_canonical()
    canonical["land_schedule"]["rows"].append(
        {"value": {"dong": "신림동", "lot": "1513-2", "serial": "4", "unit_price": 22000000}, "status": "EXTRACTED"}
    )
    result = build_from_canonical(canonical, target_dong="신림동", target_lot="1513-2")
    assert result["status"] == REVIEW_REQUIRED
    assert "분할평가" in result["note"]
    assert result["candidates"] == []


def test_regional_factor_assumption_preserved_with_target():
    canonical = _multi_row_canonical()
    result = build_from_canonical(canonical, target_lot="1513-2")
    candidate = result["candidates"][0]
    assert candidate["formula_inputs"]["regional_factor"]["status"] == ASSUMED_NEUTRAL


def test_convergent_candidate_still_review_required():
    data = _fixture()
    comparison = build_batch_reverse_audit(data["appraisals"])["cross_appraiser_comparison"]
    best = comparison["best_supported_candidate"]
    assert best["status"] == "CONVERGENT_CANDIDATE"
    assert best["selection_status"] == REVIEW_REQUIRED


def test_individual_factor_breakdown_not_identifiable():
    data = _fixture()
    result = build_batch_reverse_audit(data["appraisals"])
    for appraisal in result["appraisals"]:
        for candidate in appraisal["candidates"]:
            if candidate.get("status") == "INFERRED_CANDIDATE":
                assert candidate["individual_factor_breakdown"]["status"] == NOT_IDENTIFIABLE


def test_golden_fixture_not_used_as_parser_condition():
    import ast
    import os
    parser_dir = Path(__file__).resolve().parents[1] / "src" / "bso_parser"
    fixture_values = {"2.04", "1.88", "2.09", "1.091208", "1.089309", "0.001899"}
    for py_file in parser_dir.glob("*.py"):
        if py_file.name.startswith("test_"):
            continue
        source = py_file.read_text(encoding="utf-8")
        tree = ast.parse(source, filename=str(py_file))
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and str(node.value) in fixture_values:
                raise AssertionError(
                    f"{py_file.name}:{node.lineno} 에 golden fixture 값 {node.value} 하드코딩"
                )


def test_canonical_audit_runs_without_fixture():
    canonical = {
        "standard_selection": {
            "selected_standard": {
                "value": {"dong": "가동", "lot": "1-1", "official_price": 50000},
                "status": "EXTRACTED",
            }
        },
        "subject_to_standard_factors": {"rows": []},
        "other_factor": {
            "standard_row": {
                "standard_marker": {"value": "B", "status": "EXTRACTED"},
                "official_price": {"value": 50000, "status": "EXTRACTED"},
                "time_adjustment": {"value": 1.005, "status": "EXTRACTED"},
            },
            "decided_value": {"value": 1.5, "status": "EXTRACTED"},
        },
        "land_schedule": {
            "rows": [
                {"value": {"lot": "2-2", "unit_price": 100000}, "status": "EXTRACTED"}
            ]
        },
        "verification": {"formula_checks": []},
        "comparison_set": [],
    }
    result = build_from_canonical(canonical)
    assert result["status"] == "INFERRED_CANDIDATE"
    assert result["candidates"][0]["implied_subject_individual_factor"]["status"] == REVERSE_INFERENCE
