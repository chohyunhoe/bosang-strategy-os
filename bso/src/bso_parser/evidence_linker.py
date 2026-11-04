# -*- coding: utf-8 -*-
"""추출값과 페이지 근거를 evidence_id로 연결한다."""
from .models import Field, Evidence


def link(canonical: dict) -> dict:
    counter = 0
    index = []

    def walk(obj, path):
        nonlocal counter
        if isinstance(obj, Field):
            for evidence in obj.evidence:
                if isinstance(evidence, Evidence) and evidence.evidence_id is None:
                    counter += 1
                    evidence.evidence_id = f"E{counter:04d}"
                    index.append({"evidence_id": evidence.evidence_id, "path": path,
                                  "page": evidence.page, "method": evidence.method,
                                  "snippet": evidence.snippet})
            return
        if isinstance(obj, dict):
            for key, value in obj.items():
                walk(value, f"{path}.{key}" if path else key)
        elif isinstance(obj, list):
            for position, value in enumerate(obj):
                walk(value, f"{path}[{position}]")

    walk(canonical, "")
    canonical["evidence_index"] = index
    return canonical
