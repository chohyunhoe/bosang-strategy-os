from bso_parser.case_selection_parser import parse


class _Doc:
    def __init__(self, pages):
        self.pages = pages

    def page_text_tabular(self, index):
        return self.pages[index]

    def page_method(self, index):
        return "text"


def test_real_transaction_heading_and_following_marker_are_supported():
    doc = _Doc([
        "\n".join([
            "비교사례의 선정",
            "실거래가",
            "2023-02-01 1,234,000",
            "테스트동 12-34",
            "c",
        ])
    ])

    result = parse(doc, [1])

    assert len(result["cases"]) == 1
    case = result["cases"][0]["data"]
    assert case["case_type"] == "transaction_case"
    assert case["case_marker"] == "c"
    assert case["dong"] == "테스트동"
    assert case["lot"] == "12-34"


def test_mixed_page_tracks_case_subsections_and_current_row_marker():
    doc = _Doc([
        "\n".join([
            "거래사례 및 감정평가사례",
            "#1 테스트동 10-1 2023.01.02 1,000,000 일반거래",
            "2) 감정평가사례",
            "#5 테스트동 20-2 2023.02.03 2,000,000 보상(협의)",
        ])
    ])

    result = parse(doc, [1])

    assert [item["data"]["case_type"] for item in result["cases"]] == [
        "transaction_case",
        "appraisal_case",
    ]
    assert [item["data"]["case_marker"] for item in result["cases"]] == ["#1", "#5"]


def test_area_decimal_before_date_does_not_shadow_the_calendar_date():
    doc = _Doc([
        "\n".join([
            "거래사례",
            "#5 617.0 1436.07 11,930,000,000 18,846,718 2024-1-10 실거래",
            "테스트동 12-37 준주거 토지배분단가",
        ])
    ])

    case = parse(doc, [1])["cases"][0]["data"]

    assert case["price_date"] == "2024-01-10"
