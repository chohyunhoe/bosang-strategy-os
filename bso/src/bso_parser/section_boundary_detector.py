# -*- coding: utf-8 -*-
"""역할 라벨의 연속 구간을 섹션으로 묶는다."""


def detect_sections(page_roles: list) -> list:
    sections = []
    open_sections = {}
    for page_role in page_roles:
        labels = set(page_role["labels"]) - {"IRRELEVANT"}
        for role in list(open_sections):
            if role not in labels:
                start = open_sections.pop(role)
                sections.append({"role": role, "page_start": start, "page_end": page_role["page"] - 1})
        for role in labels:
            open_sections.setdefault(role, page_role["page"])
    last_page = page_roles[-1]["page"] if page_roles else 0
    for role, start in open_sections.items():
        sections.append({"role": role, "page_start": start, "page_end": last_page})
    for section in sections:
        section["pages"] = list(range(section["page_start"], section["page_end"] + 1))
    return sorted(sections, key=lambda section: (section["page_start"], section["role"]))


def pages_for_role(sections: list, role: str) -> list:
    pages = []
    for section in sections:
        if section["role"] == role:
            pages.extend(section["pages"])
    return sorted(set(pages))
