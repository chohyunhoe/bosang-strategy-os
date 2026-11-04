from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.models import AppraisalValueInput, CaseJob


def valid_job_payload() -> dict:
    return {
        "schema_version": "0.1",
        "case": {
            "case_id": "LK-2026-GMSH-001",
            "case_name": "광명시흥 과림동 PoC",
            "district_label": "광명시흥 공공주택지구",
        },
        "parcels": [
            {
                "role": "SUBJECT",
                "addr_jibun": "경기도 시흥시 과림동 120-7",
                "ledger": "토지",
            },
            {
                "role": "STANDARD",
                "addr_jibun": "경기도 시흥시 과림동 130-7",
                "ledger": "토지",
            },
            {
                "role": "CASE",
                "addr_jibun": "경기도 시흥시 과림동 140-1",
                "ledger": "토지",
                "case_label": "평가사례1",
                "user_values": {
                    "case_kind": "평가사례",
                    "source_doc": "중앙감정평가서 p.49",
                },
            },
        ],
        "appraisal_values": [
            {
                "target": "경기도 시흥시 과림동 120-7",
                "field": "jimok",
                "value": "답",
                "source_doc": "중앙감정평가서 평가조서",
            }
        ],
        "overlays": {
            "biz_zone": {
                "type": "user_file",
                "path": "uploads/gmsh_zone.geojson",
                "name": "광명시흥 지구계",
                "crs": "EPSG:5186",
            }
        },
    }


def test_case_job_accepts_poc_contract() -> None:
    job = CaseJob.model_validate(valid_job_payload())
    assert job.case.case_id == "LK-2026-GMSH-001"
    assert len(job.parcels) == 3
    assert job.appraisal_values[0].field.value == "jimok"


def test_case_job_requires_subject() -> None:
    payload = valid_job_payload()
    payload["parcels"] = [payload["parcels"][1]]
    with pytest.raises(ValidationError, match="SUBJECT"):
        CaseJob.model_validate(payload)


def test_parcel_requires_address_or_pnu() -> None:
    payload = valid_job_payload()
    payload["parcels"][0].pop("addr_jibun")
    with pytest.raises(ValidationError, match="pnu or addr_jibun"):
        CaseJob.model_validate(payload)


def test_invalid_pnu_is_rejected() -> None:
    payload = valid_job_payload()
    payload["parcels"][0]["pnu"] = "123"
    with pytest.raises(ValidationError):
        CaseJob.model_validate(payload)


def test_unknown_appraisal_target_is_rejected() -> None:
    payload = valid_job_payload()
    payload["appraisal_values"][0]["target"] = "경기도 시흥시 과림동 999-9"
    with pytest.raises(ValidationError, match="unknown parcels"):
        CaseJob.model_validate(payload)


def test_non_case_parcel_rejects_user_values() -> None:
    payload = valid_job_payload()
    payload["parcels"][0]["user_values"] = {"note": "금지"}
    with pytest.raises(ValidationError, match="only for CASE"):
        CaseJob.model_validate(payload)


def test_overlay_path_traversal_is_rejected() -> None:
    payload = valid_job_payload()
    payload["overlays"]["biz_zone"]["path"] = "../secret.geojson"
    with pytest.raises(ValidationError, match="safe relative path"):
        CaseJob.model_validate(payload)


def test_output_duplicates_are_rejected() -> None:
    payload = valid_job_payload()
    payload["options"] = {"outputs": ["pdf", "pdf"]}
    with pytest.raises(ValidationError, match="duplicates"):
        CaseJob.model_validate(payload)


def test_appraisal_value_input_is_frozen() -> None:
    item = AppraisalValueInput(
        target="경기도 시흥시 과림동 120-7",
        field="jimok",
        value="답",
        source_doc="평가조서",
    )
    with pytest.raises(ValidationError, match="frozen"):
        item.value = "전"
