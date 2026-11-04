# -*- coding: utf-8 -*-
"""토지평가명세/조서 파서: 소재지 승계, 일련번호 복원, 지번·면적·지분·단가·금액 검증."""
import re
from .models import Field, Evidence

ROW_RE = re.compile(
    r"(\d{1,5})?\s*"
    r"(?:\d{1,5}(?=\s+[가-힣]{2,}[동리])\s+)?"
    r"(?:[가-힣A-Za-z|]{1,8}[ |]{1,3}){0,3}"
    r"(산?\d{3,4}-\d{3,4}|산?\d{1,4}-\d{1,4}|산?\d{2,4})\s+"
    r"(?:[가-힣]{1,3}[ |]{0,2}){0,2}"
    r"[^\d\n]{0,8}?"
    r"([\d,]+(?:\.\d+)?)\s+"
    r"(?:[\d,]+\.\d+\s+)?"
    r"(?:\*\s*(\d+)\s*/\s*(\d+)\s+)?"
    r"([\d,]{4,})\s+"
    r"([\d, ]{7,}?)"
    r"(?:\s+([^\d\s].*))?$"
)
LOT_NORM_RE = re.compile(r"(산?)(\d+)(?:-(\d+))?$")
DONG_RE = re.compile(r"([가-힣]{2,10}동)\b")
SERIAL_BEFORE_LOT_RE = re.compile(r"(?:^|\s)(\d{1,5})(?=\s+[^\n]{0,30}(?:산?\d{1,4}-\d{1,4}))")


def _norm_lot(lot):
    match = LOT_NORM_RE.match(lot or "")
    if not match:
        return lot
    main = str(int(match.group(2)))
    return f"{match.group(1)}{main}-{int(match.group(3))}" if match.group(3) else f"{match.group(1)}{main}"


def _num(value):
    return float(value.replace(",", "").replace(" ", ""))


def _recover_serial(line, direct):
    if direct:
        return direct
    match = SERIAL_BEFORE_LOT_RE.search(line)
    return match.group(1) if match else None


def parse(doc, pages: list, amount_tolerance: float = 1.0) -> dict:
    output = {"rows": [], "raw_pages": pages}
    last_dong = None
    for page_number in pages:
        raw = doc.page_text_tabular(page_number - 1) if hasattr(doc, 'page_text_tabular') else doc.page_text(page_number - 1)
        if not raw.strip():
            continue
        method = doc.page_method(page_number - 1)
        for raw_line in raw.splitlines():
            line = " ".join(raw_line.replace("|", " ").replace("｜", " ").split())
            dong_match = DONG_RE.search(line)
            if dong_match:
                last_dong = dong_match.group(1)
            if len(line) < 15:
                continue
            match = ROW_RE.search(line)
            if not match:
                continue
            area = _num(match.group(3))
            unit = _num(match.group(6))
            amount = _num(match.group(7))
            if unit < 100 or amount < 1000 or area <= 0:
                continue
            share = None
            if match.group(4) and match.group(5):
                share = f"{match.group(4)}/{match.group(5)}"
                share_factor = int(match.group(4)) / int(match.group(5))
            else:
                share_factor = 1.0
            expected = area * share_factor * unit
            verified = abs(expected - amount) <= max(amount_tolerance, expected * 2e-6)
            dong = dong_match.group(1) if dong_match else last_dong
            serial = _recover_serial(line, match.group(1))
            row = {
                "serial": serial,
                "dong": dong,
                "lot": _norm_lot(match.group(2)),
                "area_sqm": area,
                "ownership_share": share,
                "unit_price": int(unit),
                "amount": int(amount),
                "remark": (match.group(8) or "").strip() or None,
                "amount_check": {"expected": round(expected), "match": verified},
            }
            evidence = [Evidence(page=page_number, method=method, snippet=line[:200])]
            notes = []
            if not serial:
                notes.append("일련번호 미판독")
            if not dong:
                notes.append("소재지 동 미판독")
            if not verified:
                notes.append("금액 ≠ 면적×지분×단가")
            if notes:
                output["rows"].append(Field.review(row, evidence, note="; ".join(notes) + " — 원문 확인 필요"))
            else:
                output["rows"].append(Field.ok(row, evidence))
    return output
