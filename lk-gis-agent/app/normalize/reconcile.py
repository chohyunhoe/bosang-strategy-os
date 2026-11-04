"""Reconcile immutable appraisal excerpts with public-data snapshots.

The result never merges or overwrites appraisal values. It only updates the parcel's
review status and creates explicit review queue items for missing or differing public
values.
"""

from __future__ import annotations

from collections.abc import Mapping
from math import isclose
from typing import Any

from pydantic import Field

from app.models.common import AppraisalField, ScalarValue, StrictModel
from app.models.parcel import CanonicalParcel, ReconcileStatus
from app.models.review import ReviewItem, ReviewReason

_RECONCILE_FIELDS: tuple[AppraisalField, ...] = (
    AppraisalField.AREA,
    AppraisalField.JIMOK,
    AppraisalField.LAND_USE,
    AppraisalField.ROAD,
    AppraisalField.SHAPE,
    AppraisalField.TOPO,
    AppraisalField.USE_ZONE,
)


class ReconcileResult(StrictModel):
    parcel: CanonicalParcel
    review_items: tuple[ReviewItem, ...] = Field(default_factory=tuple)


def reconcile_parcel(
    parcel: CanonicalParcel,
    *,
    public_source_by_field: Mapping[str, str] | None = None,
    area_tolerance: float = 0.01,
) -> ReconcileResult:
    """Compare reviewable fields without mutating either source snapshot."""

    if area_tolerance < 0:
        raise ValueError("area_tolerance must be non-negative")

    sources = public_source_by_field or {}
    items: list[ReviewItem] = []
    missing_fields: list[str] = []
    mismatch_fields: list[str] = []

    for field in _RECONCILE_FIELDS:
        field_name = field.value
        apr_value = getattr(parcel.appraisal_values, field_name)
        if _is_missing(apr_value):
            continue

        pub_value = getattr(parcel.public_values, field_name)
        if _is_missing(pub_value):
            missing_fields.append(field_name)
            items.append(
                _review_item(
                    parcel=parcel,
                    field=field,
                    pub_value=None,
                    apr_value=apr_value,
                    pub_source=sources.get(field_name),
                    reason=ReviewReason.PUB_NOT_FOUND,
                )
            )
            continue

        if not _values_equal(
            field=field,
            public_value=pub_value,
            appraisal_value=apr_value,
            area_tolerance=area_tolerance,
        ):
            mismatch_fields.append(field_name)
            items.append(
                _review_item(
                    parcel=parcel,
                    field=field,
                    pub_value=pub_value,
                    apr_value=apr_value,
                    pub_source=sources.get(field_name),
                    reason=ReviewReason.VALUE_MISMATCH,
                )
            )

    if mismatch_fields:
        status = ReconcileStatus.MISMATCH
    elif missing_fields:
        status = ReconcileStatus.PUB_NOT_FOUND
    else:
        status = ReconcileStatus.OK

    issue_fields = tuple(sorted((*mismatch_fields, *missing_fields)))
    updated = parcel.model_copy(
        update={
            "recon_status": status,
            "mismatch_fields": issue_fields,
        },
        deep=True,
    )
    return ReconcileResult(parcel=updated, review_items=tuple(items))


def _review_item(
    *,
    parcel: CanonicalParcel,
    field: AppraisalField,
    pub_value: ScalarValue,
    apr_value: ScalarValue,
    pub_source: str | None,
    reason: ReviewReason,
) -> ReviewItem:
    return ReviewItem(
        id=f"rv-{parcel.pnu}-{field.value}",
        pnu=parcel.pnu,
        field=field,
        pub_value=pub_value,
        apr_value=apr_value,
        pub_source=pub_source,
        apr_source=parcel.appraisal_values.source_doc,
        reason=reason,
    )


def _is_missing(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def _values_equal(
    *,
    field: AppraisalField,
    public_value: ScalarValue,
    appraisal_value: ScalarValue,
    area_tolerance: float,
) -> bool:
    if field is AppraisalField.AREA:
        return isclose(
            float(public_value),
            float(appraisal_value),
            rel_tol=0,
            abs_tol=area_tolerance,
        )
    if isinstance(public_value, str) and isinstance(appraisal_value, str):
        return _normalize_text(public_value) == _normalize_text(appraisal_value)
    return public_value == appraisal_value


def _normalize_text(value: str) -> str:
    return " ".join(value.split()).casefold()
