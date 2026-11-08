"""Fail-closed input and model-output contracts; no network or file execution."""
from __future__ import annotations

import base64
import copy
import hashlib
import json
import re
from decimal import Decimal, InvalidOperation

HASH = re.compile(r"^[a-f0-9]{64}$")
IDENTIFIER = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
FINDING_IDENTIFIER = re.compile(r"^(?:(?:claude|gemini|gpt):)?[A-Za-z0-9_-]{1,128}$")
PROVIDERS = {"claude": "anthropic", "gemini": "google", "gpt": "openai"}


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value):
    text = value if isinstance(value, str) else canonical(value)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def require(condition, code):
    if not condition:
        raise ValueError(code)


def _matches(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def decimal_string(value, code="DECIMAL_STRING_REQUIRED", positive=False):
    require(isinstance(value, str) and re.fullmatch(r"(?:0|[1-9][0-9]*)(?:\.[0-9]+)?", value) is not None, code)
    try:
        number = Decimal(value)
    except InvalidOperation:
        raise ValueError(code) from None
    require(number.is_finite() and (number > 0 if positive else number >= 0), code)
    return number


def _record(value, code):
    require(isinstance(value, dict), code)
    return value


def _text(value, code):
    require(isinstance(value, str) and bool(value.strip()), code)


def _secret_free(value):
    if isinstance(value, dict):
        for key, child in value.items():
            require(str(key).lower() not in {"api_key", "apikey", "authorization", "access_token", "secret", "password", "headers"}, "PLAINTEXT_CREDENTIAL_FORBIDDEN")
            _secret_free(child)
    elif isinstance(value, list):
        for child in value:
            _secret_free(child)
    elif isinstance(value, str):
        require(not re.search(r"(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9_./+-]{16,})", value), "PLAINTEXT_CREDENTIAL_FORBIDDEN")


def _document(document):
    d = _record(document, "DOCUMENT_SCHEMA")
    require(_matches(IDENTIFIER, d.get("doc_id")), "DOCUMENT_ID")
    require(_matches(HASH, d.get("sha256")), "DOCUMENT_HASH")
    for key in ("file_name", "original_location", "ocr_version", "extraction_version"):
        _text(d.get(key), "DOCUMENT_METADATA")
    require(type(d.get("page_count")) is int and d["page_count"] > 0, "DOCUMENT_PAGE_COUNT")
    pages = d.get("pages")
    require(isinstance(pages, list) and len(pages) == d["page_count"], "DOCUMENT_PAGE_GAP")
    require(all(isinstance(p, dict) and type(p.get("pdf_page")) is int for p in pages), "DOCUMENT_PAGE_SCHEMA")
    require(sorted(p["pdf_page"] for p in pages) == list(range(1, d["page_count"] + 1)), "DOCUMENT_PAGE_GAP")
    for p in pages:
        require("printed_page" in p and isinstance(p.get("text"), str), "DOCUMENT_PAGE_SCHEMA")
        if "image_sha256" in p:
            require(_matches(HASH, p["image_sha256"]), "IMAGE_HASH")
        if "text_sha256" in p:
            require(p["text_sha256"] == digest(p["text"]), "PAGE_TEXT_HASH")
    if "source_content" in d:
        require(isinstance(d["source_content"], str) and digest(d["source_content"]) == d["sha256"], "SOURCE_CONTENT_HASH")
        require("\f".join(p["text"] for p in sorted(pages, key=lambda x: x["pdf_page"])) == d["source_content"], "SOURCE_PAGE_TEXT_BINDING")
    elif "source_bytes_b64" in d:
        try:
            raw = base64.b64decode(d["source_bytes_b64"], validate=True)
        except (ValueError, TypeError):
            raise ValueError("SOURCE_BYTES_INVALID") from None
        require(bool(raw) and hashlib.sha256(raw).hexdigest() == d["sha256"], "SOURCE_CONTENT_HASH")
    else:
        raise ValueError("READABLE_SOURCE_BYTES_REQUIRED")
    result = copy.deepcopy(d)
    result["pages"] = sorted(result["pages"], key=lambda p: p["pdf_page"])
    return result


def freeze_snapshot(documents):
    require(isinstance(documents, list) and bool(documents), "SNAPSHOT_DOCUMENTS_REQUIRED")
    docs = sorted((_document(d) for d in documents), key=lambda d: d["doc_id"])
    require(len({d["doc_id"] for d in docs}) == len(docs), "DUPLICATE_DOCUMENT_ID")
    manifest_hash = digest({"documents": docs})
    return {"snapshot_id": "SNAP_" + manifest_hash, "manifest_hash": manifest_hash, "documents": docs}


def validate_job(job):
    j = copy.deepcopy(_record(job, "JOB_SCHEMA"))
    allowed = {"schema_version", "job_id", "case_id", "task_type", "profile", "data_class", "approval_scope", "budget", "funding", "input_refs", "snapshot_id", "manifest_hash", "snapshot", "artifact_version", "artifact_hash", "artifact_text", "artifact_format", "prompt_version", "model_config", "rule_input", "bso_context", "legacy_input_sha256", "bso_mapping"}
    require(not (set(j) - allowed), "JOB_UNKNOWN_FIELD")
    _secret_free(j)
    require(j.get("schema_version") == "lk-cross-review-job/1.0", "JOB_SCHEMA_VERSION")
    for key in ("job_id", "case_id"):
        require(_matches(IDENTIFIER, j.get(key)), "JOB_IDENTIFIER")
    _text(j.get("task_type"), "TASK_TYPE_REQUIRED")
    require(isinstance(j.get("profile"), str) and j["profile"] in {"QUICK", "INDEPENDENT", "CRITICAL"}, "PROFILE_INVALID")
    require(isinstance(j.get("data_class"), str) and j["data_class"] in {"PUBLIC", "SYNTHETIC"}, "PRIVATE_DATA_PUBLIC_ROUTE_BLOCKED")
    require(type(j.get("artifact_version")) is int and j["artifact_version"] >= 1, "ARTIFACT_VERSION")
    require(isinstance(j.get("artifact_text"), str) and bool(j["artifact_text"].strip()), "ARTIFACT_REQUIRED")
    require(j.get("artifact_hash") == digest(j["artifact_text"]), "ARTIFACT_HASH_MISMATCH")
    _text(j.get("prompt_version"), "PROMPT_VERSION_REQUIRED")
    supplied_snapshot = _record(j.get("snapshot"), "SNAPSHOT_REQUIRED")
    snapshot = freeze_snapshot(supplied_snapshot.get("documents"))
    require(all(j.get(key) == snapshot[key] == supplied_snapshot.get(key) for key in ("snapshot_id", "manifest_hash")), "SNAPSHOT_HASH_MISMATCH")
    j["snapshot"] = snapshot
    refs = j.get("input_refs")
    require(isinstance(refs, list) and len(refs) == len(snapshot["documents"]), "INPUT_REFS_REQUIRED")
    require(all(isinstance(r, dict) and _matches(IDENTIFIER, r.get("doc_id")) and _matches(HASH, r.get("sha256")) for r in refs), "INPUT_REFS_BINDING")
    require(sorted((r["doc_id"], r["sha256"]) for r in refs) == [(d["doc_id"], d["sha256"]) for d in snapshot["documents"]], "INPUT_REFS_BINDING")
    budget = _record(j.get("budget"), "BUDGET_REQUIRED")
    limit = decimal_string(budget.get("limit"), "BUDGET_LIMIT_REQUIRED", positive=True)
    require(isinstance(budget.get("currency"), str) and re.fullmatch(r"[A-Z]{3}", budget["currency"]) is not None, "BUDGET_CURRENCY")
    require(type(budget.get("max_attempts")) is int and 1 <= budget["max_attempts"] <= 10, "ATTEMPT_CAP_INVALID")
    funding = _record(j.get("funding"), "FUNDING_REQUIRED")
    require(funding.get("mode") == "FREE_CREDITS_ONLY", "PAID_FUNDING_FORBIDDEN")
    funding_accounts = funding.get("accounts", {})
    require(isinstance(funding_accounts, dict), "FUNDING_ACCOUNTS_INVALID")
    for credit in funding_accounts.values():
        require(isinstance(credit, dict) and credit.get("paid_fallback") is False, "PAID_FALLBACK_FORBIDDEN")
        if credit.get("available") is not None:
            decimal_string(credit["available"], "CREDIT_BALANCE_INVALID")
    scope = _record(j.get("approval_scope"), "APPROVAL_SCOPE_REQUIRED")
    require(scope.get("case_id") == j["case_id"], "APPROVAL_CASE_MISMATCH")
    require(isinstance(scope.get("doc_ids"), list) and all(isinstance(v, str) for v in scope["doc_ids"]) and set(scope["doc_ids"]) == {d["doc_id"] for d in snapshot["documents"]}, "APPROVAL_DOCUMENT_MISMATCH")
    require(isinstance(scope.get("providers"), list) and all(isinstance(v, str) for v in scope["providers"]) and isinstance(scope.get("accounts"), dict), "APPROVAL_PROVIDER_ACCOUNT_MISMATCH")
    require(scope.get("currency") == budget["currency"] and decimal_string(scope.get("limit"), "APPROVAL_BUDGET_REQUIRED") >= limit, "APPROVAL_BUDGET_MISMATCH")
    _text(scope.get("purpose"), "APPROVAL_PURPOSE_REQUIRED")
    require(type(scope.get("allow_revision")) is bool, "APPROVAL_REVISION_REQUIRED")
    models = _record(j.get("model_config"), "MODEL_CONFIG_REQUIRED")
    reviewers = ("claude",) if j["profile"] == "QUICK" else tuple(PROVIDERS)
    for reviewer in reviewers:
        model = _record(models.get(reviewer), "MODEL_CONFIG_REQUIRED")
        require(set(model) <= {"provider", "model_id", "credential_ref", "account_ref", "max_output_tokens", "reserve_cost", "price_as_of", "input_per_million", "output_per_million", "allowed_actual_models", "max_input_bytes", "cached_input_per_million", "cache_creation_per_million"}, "MODEL_UNKNOWN_FIELD")
        require(model.get("provider") == PROVIDERS[reviewer], "PROVIDER_ROLE_MISMATCH")
        for key in ("model_id", "credential_ref", "account_ref", "price_as_of"):
            _text(model.get(key), "MODEL_METADATA_REQUIRED")
        require(model["provider"] in scope.get("providers", []) and scope.get("accounts", {}).get(reviewer) == model["account_ref"], "APPROVAL_PROVIDER_ACCOUNT_MISMATCH")
        require(type(model.get("max_output_tokens")) is int and model["max_output_tokens"] > 0, "MODEL_TOKEN_LIMIT")
        decimal_string(model.get("reserve_cost"), "MODEL_RESERVATION_REQUIRED", positive=True)
        decimal_string(model.get("input_per_million"), "MODEL_PRICE_REQUIRED")
        decimal_string(model.get("output_per_million"), "MODEL_PRICE_REQUIRED")
        for key in ("cached_input_per_million", "cache_creation_per_million"):
            if key in model:
                decimal_string(model[key], "MODEL_PRICE_REQUIRED")
        if "allowed_actual_models" in model:
            actual_models = model["allowed_actual_models"]
            require(isinstance(actual_models, list) and bool(actual_models) and all(isinstance(v, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", v) is not None for v in actual_models), "MODEL_ACTUAL_ALLOWLIST")
            require(len(set(actual_models)) == len(actual_models), "MODEL_ACTUAL_ALLOWLIST")
        if "max_input_bytes" in model:
            require(type(model["max_input_bytes"]) is int and model["max_input_bytes"] > 0, "MODEL_INPUT_LIMIT")
    require(isinstance(j.get("rule_input"), dict), "RULE_INPUT_REQUIRED")
    return j


def validate_evidence(job, evidence):
    require(isinstance(evidence, dict), "EVIDENCE_SCHEMA")
    docs = {d["doc_id"]: d for d in job["snapshot"]["documents"]}
    d = docs.get(evidence.get("doc_id"))
    require(d is not None and evidence.get("sha256") == d["sha256"], "EVIDENCE_DOCUMENT_BINDING")
    require(type(evidence.get("pdf_page")) is int and 1 <= evidence["pdf_page"] <= d["page_count"], "EVIDENCE_PAGE_BINDING")
    if "coordinates" in evidence:
        coordinates = evidence["coordinates"]
        require(isinstance(coordinates, list) and len(coordinates) == 4 and all(isinstance(n, (int, float)) and not isinstance(n, bool) for n in coordinates), "EVIDENCE_COORDINATES")
    return copy.deepcopy(evidence)


def check_review(job, reviewer, response):
    r = copy.deepcopy(_record(response, "REVIEW_SCHEMA"))
    require(r.get("schema_version") == "lk-cross-review-response/1.0", "REVIEW_SCHEMA_VERSION")
    require(r.get("reviewer") == reviewer, "REVIEWER_MISMATCH")
    for key in ("job_id", "snapshot_id", "manifest_hash", "artifact_version", "artifact_hash"):
        require(r.get(key) == job.get(key), "REVIEW_VERSION_BINDING")
    coverage = r.get("coverage")
    require(isinstance(coverage, list) and len(coverage) == len(job["snapshot"]["documents"]), "REVIEW_COVERAGE_INCOMPLETE")
    expected = {d["doc_id"]: d for d in job["snapshot"]["documents"]}
    seen = set()
    for c in coverage:
        require(isinstance(c, dict), "REVIEW_COVERAGE_SCHEMA")
        d = expected.get(c.get("doc_id"))
        require(d is not None and d["doc_id"] not in seen and c.get("sha256") == d["sha256"], "REVIEW_SOURCE_BINDING")
        require(c.get("pages") == list(range(1, d["page_count"] + 1)), "REVIEW_COVERAGE_INCOMPLETE")
        seen.add(d["doc_id"])
    require(r.get("missing_pages") == [], "REVIEW_MISSING_PAGES")
    require(isinstance(r.get("findings"), list), "FINDINGS_REQUIRED")
    ids = set()
    required = {"finding_id", "claim", "subject_key", "evidence", "severity", "proposed_decision", "reason", "original_value", "normalized_value", "unit", "formula", "assumptions", "counterargument", "additional_evidence"}
    for f in r["findings"]:
        require(isinstance(f, dict) and required <= f.keys(), "FINDING_SCHEMA")
        require(_matches(FINDING_IDENTIFIER, f.get("finding_id")) and f["finding_id"] not in ids, "FINDING_ID")
        require(f["finding_id"].startswith(reviewer + ":"), "FINDING_REVIEWER_NAMESPACE")
        ids.add(f["finding_id"])
        for key in ("claim", "subject_key", "reason"):
            _text(f.get(key), "FINDING_TEXT_REQUIRED")
        require(isinstance(f.get("severity"), str) and f["severity"] in {"P0", "P1", "P2"} and isinstance(f.get("proposed_decision"), str) and f["proposed_decision"] in {"adopt", "reject", "unresolved"}, "FINDING_DECISION_INVALID")
        require(isinstance(f.get("evidence"), list), "EVIDENCE_SCHEMA")
        require(bool(f["evidence"]) or f["proposed_decision"] == "unresolved", "UNSUPPORTED_FINDING")
        for evidence in f["evidence"]:
            validate_evidence(job, evidence)
        require(isinstance(f.get("assumptions"), list) and isinstance(f.get("additional_evidence"), list), "FINDING_SCHEMA")
    if reviewer == "gpt":
        require(isinstance(r.get("decisions"), list) and type(r.get("revision_needed")) is bool, "ADJUDICATION_SCHEMA")
        decision_ids = set()
        for decision in r["decisions"]:
            require(isinstance(decision, dict) and {"finding_id", "decision", "reason", "counterargument", "additional_evidence", "action", "evidence"} <= decision.keys(), "ADJUDICATION_DECISION_SCHEMA")
            require(isinstance(decision.get("decision"), str) and decision["decision"] in {"adopt", "reject", "unresolved"} and _matches(FINDING_IDENTIFIER, decision["finding_id"]) and decision["finding_id"] not in decision_ids, "ADJUDICATION_DECISION_INVALID")
            decision_ids.add(decision["finding_id"])
            _text(decision.get("reason"), "ADJUDICATION_REASON_REQUIRED")
            _text(decision.get("action"), "ADJUDICATION_ACTION_REQUIRED")
            require(isinstance(decision.get("evidence"), list) and (bool(decision["evidence"]) or decision["decision"] == "unresolved"), "ADJUDICATION_EVIDENCE_REQUIRED")
            require(isinstance(decision.get("additional_evidence"), list), "ADJUDICATION_DECISION_SCHEMA")
            for evidence in decision["evidence"]:
                validate_evidence(job, evidence)
    return r
