# -*- coding: utf-8 -*-
"""산식 검증. 실패 시 값을 수정하지 않고 검토자료만 생성한다."""


def _get(field):
    return field.value if field is not None and getattr(field, "status", None) == "EXTRACTED" else None


def _check(check_id, calculated, stated, rel_tol):
    diff = abs(calculated - stated)
    ok = stated != 0 and diff / abs(stated) <= rel_tol
    return {"check_id": check_id, "calculated": round(calculated, 4), "stated": stated,
            "rel_diff": round(diff / abs(stated), 6) if stated else None,
            "status": "pass" if ok else "fail"}


def verify_other_factor(other: dict, rel_tol: float = 0.005) -> list:
    checks = []
    case_row = other.get("case_row")
    standard_row = other.get("standard_row")
    if case_row:
        values = [_get(case_row[key]) for key in ("case_unit_price", "time_adjustment", "regional_factor", "individual_factor_total", "adjusted_unit_price")]
        if None not in values:
            price, time, regional, individual, stated = values
            checks.append(_check("case_numerator", price * time * regional * individual, stated, rel_tol))
    if standard_row:
        values = [_get(standard_row[key]) for key in ("official_price", "time_adjustment", "adjusted_unit_price")]
        if None not in values:
            price, time, stated = values
            checks.append(_check("standard_denominator", price * time, stated, rel_tol))
    if case_row and standard_row:
        numerator = _get(case_row["adjusted_unit_price"])
        denominator = _get(standard_row["adjusted_unit_price"])
        ratio = _get(case_row["gap_ratio"])
        if None not in (numerator, denominator, ratio):
            checks.append(_check("gap_ratio", numerator / denominator, ratio, rel_tol))
    return checks


def verify_unit_price(standard_price, time_adj, regional, individual, other_factor, applied_unit_price, rel_tol=0.005):
    if None in (standard_price, time_adj, regional, individual, other_factor, applied_unit_price):
        return None
    return _check("applied_unit_price", standard_price * time_adj * regional * individual * other_factor,
                  applied_unit_price, rel_tol)
