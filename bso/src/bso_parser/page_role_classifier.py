# -*- coding: utf-8 -*-
"""페이지 번호 사전지식 없이 제목·헤더·수치구조로 역할을 판정한다."""
import re
from .textnorm import collapse

ROLES = (
    "STANDARD_SELECTION",
    "SUBJECT_TO_STANDARD_FACTORS",
    "STANDARD_TO_CASE_FACTORS",
    "OTHER_FACTOR_CALCULATION",
    "LAND_APPRAISAL_SCHEDULE",
    "IRRELEVANT",
)

ROLE_SIGNALS = {
    "STANDARD_SELECTION": {
        "titles": ("비교표준지선정", "비교표준지의선정", "표준지선정"),
        "headers": ("소재지", "지번", "지목", "이용상황", "용도지역", "공시지가", "선정"),
        "keywords": ("공시기준일", "적용공시지가", "선정사유"),
    },
    "SUBJECT_TO_STANDARD_FACTORS": {
        "titles": ("개별요인비교", "토지가격산출근거"),
        "headers": ("가로", "접근", "환경", "획지", "행정", "기타", "개별요인"),
        "keywords": ("대상토지", "본건", "비교표준지", "우세", "열세", "대등"),
    },
    "STANDARD_TO_CASE_FACTORS": {
        "titles": ("사례와의개별요인비교", "비교사례의선정", "비교사례", "평가사례", "거래사례"),
        "headers": (
            "사례기호", "사례단가", "거래시점", "거래금액", "토지단가",
            "가로", "접근", "환경", "획지", "개별요인",
        ),
        "keywords": ("실거래가", "사례대비", "비교표준지와사례", "사정보정"),
    },
    "OTHER_FACTOR_CALCULATION": {
        "titles": ("그밖의요인", "그밖의요인보정"),
        "headers": ("사례단가", "시점수정", "지역요인", "개별요인", "산출단가", "격차율"),
        "keywords": ("보정치결정", "보정치산출", "환산단가"),
    },
    "LAND_APPRAISAL_SCHEDULE": {
        "titles": ("토지평가명세표", "토지감정평가명세표", "토지평가조서", "보상평가조서"),
        "headers": ("일련번호", "소재지", "지번", "지목", "면적", "단가", "평가액"),
        "keywords": ("평가대상토지명세", "토지평가액산출내역"),
    },
}


def _hits(compact_text: str, values) -> int:
    return sum(1 for value in values if collapse(value) in compact_text)


def _numeric_pattern_hits(text: str) -> int:
    hits = 0
    if re.search(r"\d{1,3}(?:,\d{3})+", text or ""):
        hits += 1
    if len(re.findall(r"\b\d(?:[ .]\d{2,5})\b", text or "")) >= 3:
        hits += 1
    if re.search(r"\d+(?:\.\d+)?\s*(?:㎡|원)", text or ""):
        hits += 1
    return hits


def _structurally_supported(best: dict) -> bool:
    """설명문 속 용어만으로 표 페이지를 확정하지 않는다."""
    if best["header_hits"] >= 4:
        return True
    if best["title_hits"] > 0 and best["numeric_pattern_hits"] > 0:
        return True
    return False


def classify_page(text: str) -> dict:
    compact_text = collapse(text)
    numeric_hits = _numeric_pattern_hits(text)
    results = {}
    for role, signals in ROLE_SIGNALS.items():
        title_hits = _hits(compact_text, signals["titles"])
        header_hits = _hits(compact_text, signals["headers"])
        keyword_hits = _hits(compact_text, signals["keywords"])
        score = title_hits * 5 + header_hits * 2 + keyword_hits + numeric_hits
        results[role] = {
            "score": score,
            "title_hits": title_hits,
            "header_hits": header_hits,
            "keyword_hits": keyword_hits,
            "numeric_pattern_hits": numeric_hits,
        }
    primary = max(results, key=lambda role: results[role]["score"])
    best = results[primary]
    if best["score"] < 6 or not _structurally_supported(best):
        return {"primary": "IRRELEVANT", "labels": ["IRRELEVANT"], "confidence": 0.0,
                "role_evidence": best, "scores": {k: v["score"] for k, v in results.items()}}
    ordered = sorted((item["score"] for item in results.values()), reverse=True)
    margin = ordered[0] - ordered[1] if len(ordered) > 1 else ordered[0]
    confidence = min(0.99, 0.45 + best["title_hits"] * 0.15 + best["header_hits"] * 0.04 + margin * 0.02)
    labels = [role for role, item in results.items() if item["score"] >= 6 and _structurally_supported(item)]
    return {"primary": primary, "labels": labels or [primary], "confidence": round(confidence, 3),
            "role_evidence": best, "scores": {k: v["score"] for k, v in results.items()}}


def classify_document(doc) -> list:
    output = []
    for index in range(doc.page_count):
        text = doc.pages[index].get("text") or doc.header_text(index)
        result = classify_page(text)
        output.append({"page": index + 1, **result,
                       "classified_from": doc.page_method(index) if hasattr(doc, "page_method") else
                       ("text" if doc.pages[index].get("has_text_layer") else "header_ocr")})
    return output
