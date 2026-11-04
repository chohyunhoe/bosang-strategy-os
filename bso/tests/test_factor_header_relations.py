from bso_parser.factor_comparison_parser import _header_score, _parse_factor_tokens
from bso_parser.models import NOT_APPLICABLE


def test_factor_header_requires_semantic_columns():
    score, hits = _header_score(
        "가로조건 접근조건 환경조건 획지조건 행정적조건 기타조건 개별요인 비교치"
    )
    assert score == 7
    assert "total" in hits


def test_factor_row_preserves_not_applicable_state():
    cells, total, tokens = _parse_factor_tokens("- 1.23 1.18 1.00 1.00 1.00 1.451")
    assert total == 1.451
    assert tokens[-1] == "1.451"
    assert cells["street"]["state"] == NOT_APPLICABLE
    assert cells["access"]["value"] == 1.23


def test_non_factor_numeric_sequence_is_rejected():
    cells, total, tokens = _parse_factor_tokens("2021 293,000 348,611")
    assert cells is None
    assert total is None
    assert tokens == []
