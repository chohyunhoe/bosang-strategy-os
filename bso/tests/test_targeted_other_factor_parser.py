from bso_parser.other_factor_parser import parse_for_standard


class _Doc:
    def __init__(self, pages):
        self.pages = pages

    def page_text_tabular(self, index):
        return self.pages[index]

    def page_method(self, index):
        return "text"


def test_line_style_target_block_and_factor_evidence_page():
    doc = _Doc([
        "K 1.00 1.00 1.01 1.04 1.00 1.00 1.050",
        "\n".join([
            "사례기준 18,000,000 1.02000 1.00 1.050 19,278,000 K c 구분 표준지 시점수정 산출단가 1.909",
            "표준지가액 10,000,000 1.01000 10,100,000",
            "K 1.90 1.91",
        ]),
    ])

    result = parse_for_standard(doc, [1, 2], marker="K", official_price=10000000)

    assert result["case_row"]["case_marker"].value == "c"
    assert result["case_row"]["adjusted_unit_price"].value == 19278000
    assert result["case_individual_factors"].value["items"] == [1.0, 1.0, 1.01, 1.04, 1.0, 1.0]
    assert result["case_individual_factors"].evidence[0].page == 1
    assert result["decided_value"].value == 1.91


def test_prime_style_target_block_uses_header_marker():
    doc = _Doc([
        "\n".join([
            "비교표준지 ‘처’",
            "거래#5 18,000,000 1.00 1.02000 1.00 1.050 19,278,000 표준지평가 1.909",
            "표준지공시지가 표준지 10,000,000 - 1.01000 - - 10,100,000",
            "1.00 1.00 1.01 1.04 1.00 1.00 1.050",
            "처 1.90 1.91",
        ])
    ])

    result = parse_for_standard(doc, [1], marker="처", official_price=10000000)

    assert result["case_row"]["case_marker"].value == "거래#5"
    assert result["standard_row"]["standard_marker"].value == "처"
    assert result["standard_row"]["adjusted_unit_price"].value == 10100000
    assert result["case_individual_factors"].value["total"] == 1.05
    assert result["decided_value"].value == 1.91
