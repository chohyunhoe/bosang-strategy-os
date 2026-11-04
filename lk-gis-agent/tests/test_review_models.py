from __future__ import annotations

from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from app.models import ReviewItem, ReviewResolutionRequest

PNU = "4139013200101200007"


def test_manual_resolution_requires_value() -> None:
    with pytest.raises(ValidationError, match="require value"):
        ReviewResolutionRequest(decision="MANUAL", resolved_by="조현회")


def test_non_manual_resolution_rejects_manual_value() -> None:
    with pytest.raises(ValidationError, match="only for MANUAL"):
        ReviewResolutionRequest(
            decision="ACCEPT_PUB",
            value="답",
            resolved_by="조현회",
        )


def test_open_item_rejects_resolution_data() -> None:
    with pytest.raises(ValidationError, match="OPEN"):
        ReviewItem(
            id="rv-1",
            pnu=PNU,
            field="jimok",
            reason="VALUE_MISMATCH",
            status="OPEN",
            decision="KEEP_APR",
        )


def test_resolved_item_requires_audit_metadata() -> None:
    with pytest.raises(ValidationError, match="require decision"):
        ReviewItem(
            id="rv-1",
            pnu=PNU,
            field="jimok",
            reason="VALUE_MISMATCH",
            status="RESOLVED",
        )


def test_valid_manual_resolved_item() -> None:
    item = ReviewItem(
        id="rv-1",
        pnu=PNU,
        field="land_use",
        pub_value="답",
        apr_value="전기타",
        reason="VALUE_MISMATCH",
        status="RESOLVED",
        decision="MANUAL",
        decided_value="답기타",
        resolved_by="조현회",
        resolved_at=datetime.now(timezone.utc),
    )
    assert item.decided_value == "답기타"
