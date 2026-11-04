from bso_parser.canonical_schema import validate_canonical


def _minimal_payload():
    return {
        "schema_version": "bso_canonical_appraisal_v0.2",
        "source": {"file": "sample.pdf", "pages": 1, "text_layer_pages": 1, "ocr_pages_used": []},
        "page_roles": [{
            "page": 1,
            "labels": ["IRRELEVANT"],
            "primary": "IRRELEVANT",
            "classified_from": "text",
            "confidence": 0.5,
            "role_evidence": {},
        }],
        "sections": [],
        "standard_selection": {},
        "subject_to_standard_factors": {"rows": []},
        "case_selection": {"cases": []},
        "standard_to_case_factors": {},
        "other_factor": {},
        "land_schedule": {"rows": []},
        "verification": {"formula_checks": []},
        "comparison_set": [{
            "role": "subject",
            "dong": None,
            "lot": "1-1",
            "address_text": None,
            "attrs": {},
            "status": "REVIEW_REQUIRED",
            "gis_ready": False,
            "blocking_fields": ["dong"],
        }],
        "review_queue": [],
    }


def test_complete_minimal_payload_is_valid():
    assert validate_canonical(_minimal_payload()) == []


def test_gis_ready_with_blocking_fields_is_rejected():
    payload = _minimal_payload()
    payload["comparison_set"][0]["gis_ready"] = True
    assert any("cannot be GIS-ready" in error for error in validate_canonical(payload))


def test_missing_root_key_is_rejected():
    payload = _minimal_payload()
    del payload["case_selection"]
    assert "missing root key: case_selection" in validate_canonical(payload)


def test_reverse_factor_audit_must_be_object_when_present():
    payload = _minimal_payload()
    payload["verification"]["reverse_factor_audit"] = []
    assert "verification.reverse_factor_audit must be an object" in validate_canonical(payload)
