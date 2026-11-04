# -*- coding: utf-8 -*-
"""텍스트/수치 정규화 유틸 (범용: 특정 사업·지번·단가 하드코딩 금지)"""
import re

DONG_LOT_RE = re.compile(r"([가-힣]{1,11}[동리])\s*(산?\d{1,4}(?:-\d{1,4})?)")
LOT_ONLY_RE = re.compile(r"\b(산?\d{1,4}-\d{1,4}|산?\d{1,4})\b")
COMMA_INT_RE = re.compile(r"^\d{1,3}(?:,\d{3})+$")
SPACE_DECIMAL_RE = re.compile(r"^(\d{1,3})[ ](\d{2,6})$")
DATE_RE = re.compile(r"(\d{4})[.\s/-]+(\d{1,2})[.\s/-]+(\d{1,2})")


def ocr_sanitize(text: str) -> str:
    text = re.sub(r"\$(?=\d)", "9", text)
    text = re.sub(r"(?<=\d)\$", "9", text)
    return text.replace("，", ",")


def collapse(text: str) -> str:
    return re.sub(r"\s+", "", text or "")


def parse_number(token: str):
    t = token.strip().rstrip("%원㎡").strip()
    if not t or t in {"-", "."}:
        return None
    if COMMA_INT_RE.match(t):
        return int(t.replace(",", ""))
    m = SPACE_DECIMAL_RE.match(t)
    if m:
        return float(f"{m.group(1)}.{m.group(2)}")
    try:
        if re.fullmatch(r"\d+\.\d+", t):
            return float(t)
        if re.fullmatch(r"\d+", t):
            return int(t)
    except ValueError:
        return None
    return None


def find_factor_sequence(text: str, min_len=3, max_len=8):
    tokens = re.findall(r"(?:-|\d(?:[ .]\d{2,3})|\d\.\d{1,4})", text)
    seq, best = [], None
    for tok in tokens:
        if tok == "-":
            seq.append(None)
            continue
        v = parse_number(tok)
        if v is not None and 0.3 <= v < 10:
            seq.append(round(float(v), 4))
        else:
            if len(seq) >= min_len:
                best = seq[:max_len] if best is None or len(seq) > len(best) else best
            seq = []
    if len(seq) >= min_len and (best is None or len(seq) > len(best)):
        best = seq[:max_len]
    return best


def parse_date(text: str):
    m = DATE_RE.search(text)
    if not m:
        return None
    y, mo, d = (int(g) for g in m.groups())
    if 1980 <= y <= 2100 and 1 <= mo <= 12 and 1 <= d <= 31:
        return f"{y:04d}-{mo:02d}-{d:02d}"
    return None


STANCE_RE = re.compile(r"(우세|열세|대등|대동|유사)")


def detect_stance(text: str):
    found = []
    for m in STANCE_RE.finditer(text or ""):
        s = {"대동": "대등", "유사": "대등"}.get(m.group(1), m.group(1))
        if s not in found:
            found.append(s)
    return found
