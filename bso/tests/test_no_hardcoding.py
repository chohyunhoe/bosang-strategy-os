from pathlib import Path

FORBIDDEN = ("광명시흥", "중앙감정평가법인", "정해감정평가법인", "120-7", "120-8", "584", "585", "882000", "927000")


def test_active_parser_has_no_case_specific_constants():
    root = Path(__file__).parents[1] / "src" / "bso_parser"
    for path in root.glob("*.py"):
        text = path.read_text(encoding="utf-8")
        for token in FORBIDDEN:
            assert token not in text, f"case-specific token {token!r} found in {path.name}"
