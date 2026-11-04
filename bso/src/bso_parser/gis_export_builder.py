# -*- coding: utf-8 -*-
"""관계 확정 후 QGIS/VWorld 지오코딩용 비교군 데이터 생성."""
import csv
import io


def _addr(dong, lot):
    parts = [part for part in (dong, lot) if part]
    return " ".join(parts) if len(parts) == 2 else None


def _row(role, dong, lot, attrs, status):
    blocking = []
    if not dong:
        blocking.append("dong")
    if not lot:
        blocking.append("lot")
    return {
        "role": role,
        "dong": dong,
        "lot": lot,
        "address_text": _addr(dong, lot),
        "attrs": attrs,
        "status": status,
        "gis_ready": not blocking and status == "EXTRACTED",
        "blocking_fields": blocking,
    }


def build(canonical: dict) -> list:
    rows = []
    std = canonical.get("standard_selection", {}).get("selected_standard")
    if std is not None and getattr(std, "value", None):
        value = std.value
        rows.append(_row("standard", value.get("dong"), value.get("lot"),
                         {key: value.get(key) for key in ("road", "shape", "topo", "zoning", "official_price")},
                         std.status))
    for case in canonical.get("case_selection", {}).get("cases", []):
        data = case["data"]
        rows.append(_row("case", data.get("dong"), data.get("lot"),
                         {key: data.get(key) for key in ("case_type", "land_use", "zoning", "unit_price", "price_date")},
                         case["field"].status))
    for item in canonical.get("land_schedule", {}).get("rows", []):
        value = item.value
        if value:
            rows.append(_row("subject", value.get("dong"), value.get("lot"),
                             {key: value.get(key) for key in ("land_use_raw", "area_sqm", "ownership_share", "unit_price")},
                             item.status))
    return rows


def ready_rows(rows: list) -> list:
    return [row for row in rows if row.get("gis_ready")]


def to_csv(rows: list, ready_only: bool = True) -> str:
    selected = ready_rows(rows) if ready_only else rows
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["role", "dong", "lot", "address_text", "status", "gis_ready", "blocking_fields", "attrs"])
    for row in selected:
        writer.writerow([row["role"], row["dong"], row["lot"], row["address_text"], row["status"],
                         row["gis_ready"], row["blocking_fields"], row["attrs"]])
    return buf.getvalue()
