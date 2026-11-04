# -*- coding: utf-8 -*-
"""공통 모델: 추출값 = value + status + evidence. 불확실값은 REVIEW_REQUIRED."""
from dataclasses import dataclass, field, asdict
from typing import Any, List, Optional

EXTRACTED = "EXTRACTED"
REVIEW_REQUIRED = "REVIEW_REQUIRED"
NOT_FOUND = "NOT_FOUND"
NOT_APPLICABLE = "NOT_APPLICABLE"
OCR_FAILED = "OCR_FAILED"


@dataclass
class Evidence:
    page: int
    method: str
    snippet: str = ""
    evidence_id: Optional[str] = None


@dataclass
class Field:
    value: Any = None
    status: str = NOT_FOUND
    evidence: List[Evidence] = field(default_factory=list)
    note: str = ""

    @staticmethod
    def ok(value, ev: List[Evidence], note=""):
        return Field(value=value, status=EXTRACTED, evidence=ev, note=note)

    @staticmethod
    def review(value, ev, note):
        return Field(value=value, status=REVIEW_REQUIRED, evidence=ev, note=note)

    @staticmethod
    def missing(note=""):
        return Field(value=None, status=NOT_FOUND, evidence=[], note=note)

    @staticmethod
    def not_applicable(raw="-", ev=None, note=""):
        return Field(value=None, status=NOT_APPLICABLE, evidence=list(ev or []), note=note or f"raw={raw}")

    @staticmethod
    def ocr_failed(ev=None, note="OCR 판독 실패"):
        return Field(value=None, status=OCR_FAILED, evidence=list(ev or []), note=note)

    def to_dict(self):
        d = asdict(self)
        if not d.get("note"):
            d.pop("note", None)
        return d


def fdict(obj):
    if isinstance(obj, Field):
        return fdict(obj.to_dict())
    if isinstance(obj, Evidence):
        return asdict(obj)
    if isinstance(obj, dict):
        return {k: fdict(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [fdict(x) for x in obj]
    return obj
