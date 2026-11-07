"""Publicly safe synthetic contracts. These are never live credit evidence."""
import copy
import json

from integrations.n8n.cross_review.contract import digest, freeze_snapshot


def make_job(job_id="SYNTHETIC_REVIEW", mismatch=False, profile="CRITICAL", structured=True):
    quotes = {"M1": "Synthetic owner M1: amount 1000 won, factor 0.90.", "M2": "Owner M2: amount 2000 won, factor 1.10."}
    source = " ".join(quotes.values())
    document = {"doc_id": "SYN_DOC", "sha256": digest(source), "file_name": "synthetic.txt", "page_count": 1,
                "original_location": "synthetic://fixture/document", "ocr_version": "none-text-original/1", "extraction_version": "synthetic/1",
                "evidence_version": 2, "source_content": source,
                "pages": [{"pdf_page": 1, "printed_page": "1", "text": source}]}
    snapshot = freeze_snapshot([document])
    evidence = {"doc_id": "SYN_DOC", "sha256": document["sha256"], "pdf_page": 1}
    rows = [{"doc_id": "SYN_DOC", "owner_id_type": "member_number", "owner_id": owner, "property_id": "PROPERTY_1", "appraisal_id": "APPRAISAL_A",
             "amount": amount, "unit": "원", "factors": {"individual": factor}, "evidence": copy.deepcopy(evidence), "source_quote": quotes[owner], "verified_by": "SYNTHETIC_GROUND_TRUTH"}
            for owner, amount, factor in (("M1", "1000", "0.90"), ("M2", "2000", "1.10"))]
    artifact = "Synthetic owner comparison: M1 1000 won; M2 2000 won."
    candidate = copy.deepcopy(rows)
    if mismatch:
        candidate[0]["amount"], candidate[1]["amount"] = candidate[1]["amount"], candidate[0]["amount"]
        artifact = "Synthetic owner comparison: M1 2000 won; M2 1000 won."
    if structured:
        artifact = json.dumps({"schema_version": "lk-owner-comparison/1.0", "rows": candidate}, ensure_ascii=False, sort_keys=True)
    models = {}
    for reviewer, provider in (("claude", "anthropic"), ("gemini", "google"), ("gpt", "openai")):
        models[reviewer] = {"provider": provider, "model_id": "mock-" + reviewer, "credential_ref": "EXISTING_N8N_" + reviewer.upper(),
                            "account_ref": "mock-account-" + reviewer, "max_output_tokens": 2048, "reserve_cost": "0.10", "price_as_of": "2026-11-07",
                            "input_per_million": "1.00", "output_per_million": "2.00"}
    return {"schema_version": "lk-cross-review-job/1.0", "job_id": job_id, "case_id": "SYN_CASE", "task_type": "OWNER_COMPARISON", "profile": profile, "data_class": "SYNTHETIC",
            "approval_scope": {"case_id": "SYN_CASE", "doc_ids": ["SYN_DOC"], "providers": ["anthropic", "google", "openai"], "purpose": "synthetic acceptance test", "accounts": {r: m["account_ref"] for r, m in models.items()}, "currency": "USD", "limit": "1.00", "allow_revision": True},
            "budget": {"limit": "1.00", "currency": "USD", "max_attempts": 10},
            "funding": {"mode": "FREE_CREDITS_ONLY", "accounts": {m["account_ref"]: {"provider": m["provider"], "currency": "USD", "available": "1.00", "verified_at": "2026-11-07T00:00:00Z", "expires_at": "2099-01-01T00:00:00Z", "paid_fallback": False, "source": "MOCK"} for m in models.values()}},
            "input_refs": [{"doc_id": "SYN_DOC", "sha256": document["sha256"]}], "snapshot_id": snapshot["snapshot_id"], "manifest_hash": snapshot["manifest_hash"], "snapshot": snapshot,
            "artifact_version": 1, "artifact_hash": digest(artifact), "artifact_text": artifact, "artifact_format": "lk-owner-comparison/1.0" if structured else "text/plain", "prompt_version": "lk-independent/1.0", "model_config": models,
            "rule_input": {"evidence_version": 2, "parse_status": "READY", "reference_rows": rows, "candidate_rows": candidate, "calculations": [], "image_checks": [], "legal_sources": []}}


def make_response(job, reviewer="claude", findings=None, decisions=None):
    response = {"schema_version": "lk-cross-review-response/1.0", **{k: job[k] for k in ("job_id", "snapshot_id", "manifest_hash", "artifact_version", "artifact_hash")}, "reviewer": reviewer,
                "coverage": [{"doc_id": d["doc_id"], "sha256": d["sha256"], "pages": list(range(1, d["page_count"] + 1))} for d in job["snapshot"]["documents"]], "missing_pages": [], "findings": copy.deepcopy(findings or [])}
    for item in response["findings"]:
        if isinstance(item.get("finding_id"), str) and ":" not in item["finding_id"]:
            item["finding_id"] = reviewer + ":" + item["finding_id"]
    if reviewer == "gpt":
        response.update({"decisions": copy.deepcopy(decisions or []), "revision_needed": False})
    return response


def finding(job, finding_id="F1", severity="P1", decision="adopt"):
    return {"finding_id": finding_id, "claim": "Synthetic amount requires comparison", "subject_key": "M1/PROPERTY_1", "evidence": [copy.deepcopy(job["rule_input"]["reference_rows"][0]["evidence"])],
            "severity": severity, "proposed_decision": decision, "reason": "Source amount is explicit", "original_value": "1000", "normalized_value": "1000", "unit": "원", "formula": "source amount", "assumptions": [], "counterargument": "Compare the exact owner identifier", "additional_evidence": []}
