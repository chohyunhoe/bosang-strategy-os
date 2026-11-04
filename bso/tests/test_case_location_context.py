from bso_parser.case_selection_parser import _location_from_context


def test_location_is_recovered_from_previous_rows():
    lines = [
        "평가사례 2",
        "경기도 시흥시 과림동",
        "130-7 답 자연녹지",
        "2020.06.15 500,000 보상(협의)",
    ]
    dong, lot, method = _location_from_context(lines, 3, "과림동")
    assert dong == "과림동"
    assert lot == "130-7"
    assert method == "context_inheritance"


def test_combined_dong_lot_has_priority():
    lines = ["과림동 130-7 답", "2020.06.15 500,000 보상(협의)"]
    dong, lot, method = _location_from_context(lines, 1, None)
    assert (dong, lot) == ("과림동", "130-7")
    assert method == "same_or_previous_line"


def test_missing_location_remains_missing():
    dong, lot, method = _location_from_context(["2020.06.15 500,000"], 0, None)
    assert dong is None
    assert lot is None
    assert method == "not_found"
