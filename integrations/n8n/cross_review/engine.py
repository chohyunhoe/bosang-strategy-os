"""Durable review orchestration; paid transport stays in n8n credentials storage."""
from __future__ import annotations

import copy
import re
import time
from datetime import datetime, timezone
from decimal import Decimal

from .contract import check_review, digest, validate_job
from .rules import run_rules
from .providers import build_request, parse_response


def stamp(value):
    return datetime.fromtimestamp(value, timezone.utc).isoformat()


def safe_code(error):
    """Only fixed error identifiers cross the HTTP/log boundary."""
    code = str(error)
    return code if re.fullmatch(r"[A-Z][A-Z0-9_]{1,95}", code) else "REVIEW_OPERATION_FAILED"


class Engine:
    def __init__(self, ledger, mode="mock", clock=time.time, installation=None):
        if mode not in ("mock", "live"):
            raise ValueError("INVALID_EXECUTION_MODE")
        self.ledger, self.mode, self.clock = ledger, mode, clock
        self.installation = installation or {}

    def submit(self, request):
        job = validate_job(request)
        job["execution_mode"] = self.mode
        identity = digest(job)
        job.update(state="READY", approval_status="PENDING", submission_status="NOT_SUBMITTED",
                   revision_count=0, rules=run_rules(job), evidence_mode=self.mode.upper(),
                   bso_status="NOT_RECORDED", history=[])
        stored, created = self.ledger.register(job, identity)
        if stored.get("execution_mode") != self.mode:
            raise ValueError("EXECUTION_MODE_CONFLICT")
        if any(i.get("severity") == "P0" for i in stored["rules"]["issues"]):
            self._block(stored["job_id"], "P0_SOURCE_OR_IDENTITY_FAILURE")
        return {"created": created, "result": self.summary(stored["job_id"])}

    def _current(self, job):
        return [t for t in self.ledger.tasks(job["job_id"])
                if t.get("artifact_version") == job["artifact_version"]
                and t.get("artifact_hash") == job["artifact_hash"]
                and t.get("snapshot_id") == job["snapshot_id"]
                and t.get("manifest_hash") == job["manifest_hash"]]

    def _config(self, job, reviewer):
        return job["model_config"]["claude" if reviewer == "reviser" else reviewer]

    def _credit_preflight(self, job, reviewers):
        if self.mode == "mock":
            return
        if self.installation.get("verified") is not True or not self.installation.get("n8n_version"):
            raise ValueError("N8N_INSTALLATION_UNVERIFIED")
        if job.get("funding", {}).get("mode") != "FREE_CREDITS_ONLY":
            raise ValueError("FREE_CREDITS_ONLY_REQUIRED")
        credits = {c["account_ref"]: c for c in self.ledger.credits()}
        needed = {}
        for reviewer in reviewers:
            cfg = self._config(job, reviewer)
            installed = self.installation.get("bindings", {}).get(cfg["provider"], {})
            if installed.get("credential_ref") != cfg["credential_ref"] or installed.get("account_ref") != cfg["account_ref"]:
                raise ValueError("N8N_CREDENTIAL_ACCOUNT_UNVERIFIED")
            # A reservation must cover the request's maximum possible charge;
            # arbitrary estimates cannot protect a credit-only instruction.
            bound = installed.get("model_bounds", {}).get(cfg["model_id"], {})
            if bound.get("verified") is not True or bound.get("price_as_of") != cfg["price_as_of"]:
                raise ValueError("MODEL_COST_BOUND_UNVERIFIED")
            if bound.get("currency") != job["budget"]["currency"]:
                raise ValueError("MODEL_TARIFF_CURRENCY_UNVERIFIED")
            for field in ("input_per_million", "output_per_million", "cached_input_per_million", "cache_creation_per_million"):
                if cfg.get(field) != bound.get(field) or field in ("input_per_million", "output_per_million") and field not in bound:
                    raise ValueError("MODEL_TARIFF_UNVERIFIED")
            if cfg.get("allowed_actual_models", [cfg["model_id"]]) != bound.get("allowed_actual_models", [cfg["model_id"]]):
                raise ValueError("ACTUAL_MODEL_ALLOWLIST_UNVERIFIED")
            if Decimal(cfg["reserve_cost"]) < Decimal(str(bound.get("maximum_request_cost", "Infinity"))):
                raise ValueError("RESERVATION_BELOW_PROVEN_COST_BOUND")
            if cfg["max_output_tokens"] > int(bound.get("max_output_tokens", 0)):
                raise ValueError("OUTPUT_EXCEEDS_PROVEN_COST_BOUND")
            account = cfg["account_ref"]
            credit = credits.get(account)
            if not credit or credit.get("provider") != cfg["provider"] or credit.get("currency") != job["budget"]["currency"]:
                raise ValueError("CREDIT_BALANCE_UNVERIFIED")
            if credit.get("paid_fallback") not in (False, 0):
                raise ValueError("PAID_FALLBACK_FORBIDDEN")
            now = self.clock()
            if float(credit["expires_at"]) <= now or now - float(credit["verified_at"]) > 86400:
                raise ValueError("CREDIT_PROOF_EXPIRED")
            # A captured operator proof belongs in the runner's private ledger,
            # never in user/model supplied input. The balance is not inferred.
            needed[account] = needed.get(account, Decimal(0)) + Decimal(cfg["reserve_cost"])
        for account, amount in needed.items():
            c = credits[account]
            held = Decimal(str(c.get("reserved", c.get("held", "0"))))
            if Decimal(c["available"]) - Decimal(c.get("spent", "0")) - held < amount:
                raise ValueError("FREE_CREDIT_LIMIT")

    def _plan(self, job, reviewer):
        cfg = self._config(job, reviewer)
        plan = {k: job[k] for k in ("artifact_version", "artifact_hash", "snapshot_id", "manifest_hash")}
        plan.update(reviewer=reviewer, provider=cfg["provider"], model_id=cfg["model_id"],
                    account_ref=cfg["account_ref"], credential_ref=cfg["credential_ref"], reserve_cost=cfg["reserve_cost"],
                    funding_mode="MOCK" if self.mode == "mock" else "FREE_CREDITS_ONLY")
        if self.mode == "live":
            credit = next(c for c in self.ledger.credits() if c["account_ref"] == cfg["account_ref"])
            plan["credit_proof_id"] = credit["proof_id"]
        reviews = {t["reviewer"]: t["result"] for t in self._current(job)
                   if t["status"] == "COMPLETED" and t.get("accepted", True)}
        request = build_request(job, reviewer, reviews=reviews if reviewer in ("gpt", "reviser") else None,
                                rules=job["rules"])
        if self.mode == "live":
            bound = self.installation["bindings"][cfg["provider"]]["model_bounds"][cfg["model_id"]]
            from .contract import canonical
            if len(canonical(request["body"]).encode("utf-8")) > int(bound.get("max_input_bytes", 0)):
                raise ValueError("INPUT_EXCEEDS_PROVEN_COST_BOUND")
        plan["request"] = request
        plan["request_hash"] = digest(request["body"])
        return plan

    def _payload(self, job, task):
        return {**{k: task[k] for k in ("ticket_id", "reviewer", "provider", "model_id", "artifact_version")},
                "job_id": job["job_id"], "credential_ref": task["credential_ref"], "account_ref": task["account_ref"],
                "request": copy.deepcopy(task["request"]), "evidence_mode": self.mode.upper()}

    def dispatch(self, owner):
        if not isinstance(owner, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", owner):
            raise ValueError("DISPATCH_OWNER_REQUIRED")
        self.ledger.recover(self.clock())
        pending = []
        for initial in self.ledger.list_jobs():
            job = self.ledger.get(initial["job_id"])
            if job.get("execution_mode") != self.mode or job["state"] not in ("READY", "COLLECTING", "ADJUDICATING", "REVISING", "REVERIFYING", "RUNNING"):
                continue
            if any(i.get("severity") == "P0" for i in job["rules"]["issues"]):
                self._block(job["job_id"], "P0_SOURCE_OR_IDENTITY_FAILURE")
                continue
            current = self._current(job)
            if any(t["status"] == "BLOCKED_RECONCILE" for t in current):
                continue
            reserved = [t for t in current if t["status"] == "RESERVED"]
            if reserved:
                # Re-delivering a reservation is safe: /start performs the
                # persistent compare-and-swap before any n8n provider node.
                pending.extend(self._payload(job, t) for t in reserved)
                continue
            if any(t["status"] == "RUNNING" for t in current):
                continue
            completed = {t["reviewer"]: t for t in current if t["status"] == "COMPLETED" and t.get("accepted", True)
                         and not t.get("receipt", {}).get("validation_error")}
            failed = [t for t in current if t["status"] == "FAILED"
                      and t.get("error_code") not in ("LEASE_EXPIRED_BEFORE_START", "STALE_ARTIFACT_BEFORE_START")]
            if failed:
                self._block(job["job_id"], "REVIEWER_FAILED", partial=bool(completed))
                continue
            if not self.ledger.claim(job["job_id"], owner, self.clock(), lease_seconds=600):
                continue
            try:
                required = ["claude"] if job["profile"] == "QUICK" else ["claude", "gemini"]
                if not all(r in completed for r in required):
                    reviewers = [r for r in required if r not in completed]
                    full_plan = reviewers if job["profile"] == "QUICK" else reviewers + ["gpt"]
                    self._credit_preflight(job, full_plan)
                    remaining = sum((Decimal(self._config(job, r)["reserve_cost"]) for r in full_plan), Decimal(0))
                    if Decimal(job.get("spent", "0")) + Decimal(job.get("reserved", "0")) + remaining > Decimal(job["budget"]["limit"]):
                        raise ValueError("FULL_REVIEW_BUDGET_REQUIRED")
                    next_state = "COLLECTING"
                elif job["profile"] == "QUICK":
                    self._finalize(job, None)
                    continue
                elif "gpt" not in completed:
                    reviewers, next_state = ["gpt"], "ADJUDICATING"
                    self._credit_preflight(job, reviewers)
                elif completed["gpt"]["result"].get("revision_needed"):
                    if "reviser" in completed:
                        self._revise(job, completed["reviser"]["result"])
                        continue
                    if job.get("revision_count", 0) >= 1 or not job["approval_scope"].get("allow_revision", False):
                        raise ValueError("REVISION_LIMIT_OR_SCOPE")
                    reviewers, next_state = ["reviser"], "REVISING"
                    self._credit_preflight(job, ["reviser", "claude", "gemini", "gpt"])
                    planned = sum((Decimal(self._config(job, r)["reserve_cost"]) for r in ["reviser", "claude", "gemini", "gpt"]), Decimal(0))
                    if Decimal(job.get("spent", "0")) + planned > Decimal(job["budget"]["limit"]):
                        raise ValueError("REVERIFICATION_BUDGET_REQUIRED")
                else:
                    self._finalize(job, completed["gpt"]["result"])
                    continue
                tasks = self.ledger.reserve(job["job_id"], owner, [self._plan(job, r) for r in reviewers], self.clock())
                self.ledger.update(job["job_id"], lambda j: j.update(state=next_state))
                job = self.ledger.get(job["job_id"])
                pending.extend(self._payload(job, t) for t in tasks)
            except (ValueError, KeyError, StopIteration) as error:
                self._block(job["job_id"], safe_code(error), partial=bool(completed))
        return {"tasks": pending, "evidence_mode": self.mode.upper()}

    def _task(self, ticket_id):
        for job in self.ledger.list_jobs():
            for task in self.ledger.tasks(job["job_id"]):
                if task["ticket_id"] == ticket_id:
                    return task
        raise ValueError("TICKET_NOT_FOUND")

    def start(self, ticket_id, execution_id):
        task = self._task(ticket_id)
        job = self.ledger.get(task["job_id"])
        if job.get("execution_mode") != self.mode or job["state"] in ("BLOCKED", "PARTIAL", "BLOCKED_RECONCILE", "READY_FOR_HUMAN"):
            raise ValueError("JOB_NOT_EXECUTABLE")
        if self.mode == "live":
            # Credits are already held. Recheck expiry and installation without
            # trying to reserve the same amount a second time.
            self._credit_preflight(job, [])
        if any(task[k] != job[k] for k in ("artifact_version", "artifact_hash", "snapshot_id", "manifest_hash")):
            raise ValueError("STALE_TICKET")
        task = self.ledger.start(ticket_id, execution_id, self.clock())
        return {"task": self._payload(job, task)}

    def complete(self, ticket_id, execution_id, provider_response):
        if self.mode != "live":
            raise ValueError("MOCK_RUNNER_REJECTS_PROVIDER_RECEIPTS")
        task = self._task(ticket_id)
        if task.get("execution_id") != execution_id or task["status"] not in ("RUNNING", "BLOCKED_RECONCILE"):
            raise ValueError("RUNNER_EXECUTION_MISMATCH")
        job = self.ledger.get(task["job_id"])
        try:
            parsed = parse_response(job, task["reviewer"], provider_response)
        except ValueError as error:
            receipt = getattr(error, "receipt", {})
            cost = getattr(error, "actual_cost", None)
            receipt = {**self._failure_receipt(task), **receipt, "actual_cost": cost, "failure_status": safe_code(error)}
            self.ledger.fail(ticket_id, safe_code(error), uncertain=False, now=self.clock(), actual_cost=cost, receipt=receipt)
            self._block(job["job_id"], safe_code(error), partial=True)
            return self.summary(job["job_id"])
        return self._accept(task, parsed["response"], parsed["receipt"], parsed["actual_cost"])

    def complete_mock(self, ticket_id, execution_id, response, actual_cost="0.01"):
        if self.mode != "mock":
            raise ValueError("MOCK_EVIDENCE_FORBIDDEN")
        task = self._task(ticket_id)
        if task.get("execution_id") != execution_id or task["status"] not in ("RUNNING", "BLOCKED_RECONCILE"):
            raise ValueError("RUNNER_EXECUTION_MISMATCH")
        return self._accept(task, response, {"provider": task["provider"], "model_id": task["model_id"],
                            "request_id": "MOCK_" + ticket_id, "usage": {"input_tokens": 1, "output_tokens": 1}}, actual_cost)

    def _accept(self, task, response, receipt, actual_cost):
        job = self.ledger.get(task["job_id"])
        ended = self.clock()
        bound_receipt = {**receipt, "provider_response_hash": receipt.get("response_hash"),
                         "evidence_mode": self.mode.upper(), "n8n_execution_id": task["execution_id"],
                         "started_at": stamp(task["started_at"]), "finished_at": stamp(ended),
                         "input_hash": task["request_hash"],
                         "prompt_version": job["prompt_version"], "response_hash": digest(response),
                         "snapshot_id": task["snapshot_id"], "manifest_hash": task["manifest_hash"],
                         "artifact_version": task["artifact_version"], "artifact_hash": task["artifact_hash"],
                         "currency": job["budget"]["currency"], "actual_cost": actual_cost,
                         "provided_scope": "EXTRACTED_TEXT_ONLY"}
        if any(task[k] != job[k] for k in ("artifact_version", "artifact_hash", "snapshot_id", "manifest_hash")):
            self.ledger.finish(task["ticket_id"], response, bound_receipt, actual_cost, ended)
            return self.summary(job["job_id"])
        # Envelope request IDs and actual models must come from the transport,
        # never from the model's generated JSON.
        try:
            if not receipt.get("request_id") or not receipt.get("model_id"):
                raise ValueError("PROVIDER_EXECUTION_PROOF_MISSING")
            allowed_models = self._config(job, task["reviewer"]).get("allowed_actual_models", [task["model_id"]])
            if receipt["model_id"] not in allowed_models:
                raise ValueError("UNAPPROVED_ACTUAL_MODEL")
            if task["reviewer"] == "reviser":
                self._check_revision(job, response)
            else:
                check_review(job, task["reviewer"], response)
            if task["reviewer"] == "gpt":
                self._check_adjudication(job, response)
        except ValueError as error:
            # Preserve billed malformed/invalid results without allowing them
            # into adjudication or losing their runner-generated evidence.
            bound_receipt["validation_error"] = safe_code(error)
            self.ledger.finish(task["ticket_id"], response, bound_receipt, actual_cost, ended)
            self._block(job["job_id"], safe_code(error), partial=True)
            return self.summary(job["job_id"])
        stored = self.ledger.finish(task["ticket_id"], response, bound_receipt, actual_cost, ended)
        if not stored.get("accepted", True):
            return self.summary(job["job_id"])
        latest = self.ledger.get(job["job_id"])
        if Decimal(latest["spent"]) + Decimal(latest["reserved"]) > Decimal(latest["budget"]["limit"]):
            self._block(job["job_id"], "ACTUAL_COST_EXCEEDED_BUDGET")
            return self.summary(job["job_id"])
        if any(f.get("severity") == "P0" for f in response.get("findings", [])):
            self._block(job["job_id"], "P0_REVIEW_FINDING")
            return self.summary(job["job_id"])
        if actual_cost is None:
            self._block(job["job_id"], "COST_UNCONFIRMED", partial=True)
        elif task["reviewer"] == "reviser":
            self._revise(job, response)
        elif task["reviewer"] == "gpt":
            self.ledger.update(job["job_id"], lambda j: j.update(adjudication=response))
            if not response.get("revision_needed"):
                self._finalize(job, response)
        return self.summary(job["job_id"])

    def _check_adjudication(self, job, response):
        reviews = [t["result"] for t in self._current(job) if t["reviewer"] in ("claude", "gemini")
                   and t["status"] == "COMPLETED" and t.get("accepted", True)]
        if len(reviews) != 2:
            raise ValueError("INDEPENDENT_REVIEWS_REQUIRED")
        finding_ids = [f["finding_id"] for r in reviews for f in r["findings"]]
        if len(set(finding_ids)) != len(finding_ids):
            raise ValueError("REVIEW_FINDING_ID_COLLISION")
        expected = set(finding_ids) | {f["finding_id"] for f in job["rules"]["issues"]} | {f["finding_id"] for f in response["findings"]}
        decisions = response.get("decisions")
        if not isinstance(decisions, list) or {d.get("finding_id") for d in decisions} != expected or len(decisions) != len(expected):
            raise ValueError("ADJUDICATION_FINDING_COVERAGE")
        for d in decisions:
            if d.get("decision") not in ("adopt", "reject", "unresolved") or not d.get("reason"):
                raise ValueError("ADJUDICATION_REASON_REQUIRED")
            if not all(k in d for k in ("counterargument", "additional_evidence", "action", "evidence")):
                raise ValueError("ADJUDICATION_DETAIL_REQUIRED")
            if d["decision"] != "unresolved" and not d["evidence"]:
                raise ValueError("ADJUDICATION_SOURCE_REQUIRED")
        if not isinstance(response.get("revision_needed"), bool):
            raise ValueError("REVISION_DECISION_REQUIRED")

    def _check_revision(self, job, response):
        if response.get("schema_version") != "lk-cross-review-revision/1.0" or response.get("reviewer") != "reviser":
            raise ValueError("INVALID_REVISION_SCHEMA")
        if any(response.get(k) != job[k] for k in ("job_id", "snapshot_id", "manifest_hash", "artifact_version", "artifact_hash")):
            raise ValueError("REVISION_BINDING_FAILED")
        if not isinstance(response.get("artifact_text"), str) or not response["artifact_text"].strip() or len(response["artifact_text"]) > 100000:
            raise ValueError("INVALID_REVISION_ARTIFACT")
        if digest(response["artifact_text"]) == job["artifact_hash"] or not isinstance(response.get("changes"), list):
            raise ValueError("REVISION_NO_CHANGE")
        if job.get("revision_count", 0) >= 1 or not job["approval_scope"].get("allow_revision"):
            raise ValueError("REVISION_LIMIT_OR_SCOPE")

    def _revise(self, job, response):
        def revise(stored):
            if stored["artifact_version"] != job["artifact_version"] or stored["artifact_hash"] != job["artifact_hash"]:
                raise ValueError("REVISION_ALREADY_APPLIED_OR_STALE")
            stored["history"].append({k: stored.get(k) for k in ("artifact_version", "artifact_hash", "artifact_text", "adjudication", "approval_status")})
            stored.update(artifact_version=stored["artifact_version"] + 1, artifact_text=response["artifact_text"],
                          artifact_hash=digest(response["artifact_text"]), approval_status="PENDING",
                          submission_status="NOT_SUBMITTED", revision_count=stored["revision_count"] + 1,
                          adjudication=None, state="REVERIFYING", bso_status="NOT_RECORDED")
            # Rule evidence describes the frozen original. Changed extracted
            # numbers may only be supplied as a new validated input; a writer
            # cannot rewrite rule inputs or clear a failed source gate.
            stored["rules"] = run_rules(stored)
        self.ledger.update(job["job_id"], revise)

    def _finalize(self, job, adjudication):
        current = self.ledger.get(job["job_id"])
        if current.get("cost_unconfirmed") or Decimal(current["spent"]) + Decimal(current["reserved"]) > Decimal(current["budget"]["limit"]):
            self._block(current["job_id"], "COST_UNCONFIRMED" if current.get("cost_unconfirmed") else "ACTUAL_COST_EXCEEDED_BUDGET")
            return
        if current["state"] == "BLOCKED" and current.get("error_code"):
            return
        tasks = self._current(current)
        required = ["claude"] if current["profile"] == "QUICK" else ["claude", "gemini", "gpt"]
        done = {t["reviewer"] for t in tasks if t["status"] == "COMPLETED" and t.get("accepted", True)
                and not t.get("receipt", {}).get("validation_error")}
        issues = list(current["rules"]["issues"])
        unresolved = [d for d in (adjudication or {}).get("decisions", []) if d["decision"] == "unresolved"]
        for t in tasks:
            if t["reviewer"] in ("claude", "gemini", "gpt") and t["status"] == "COMPLETED":
                for f in t["result"].get("findings", []):
                    if f.get("severity") in ("P0", "P1"):
                        decision = next((d for d in (adjudication or {}).get("decisions", []) if d["finding_id"] == f["finding_id"]), None)
                        if decision is None or decision["decision"] != "reject":
                            issues.append(f)
        ready = set(required) <= done and current["rules"]["passed"] and not unresolved and not any(i.get("severity") in ("P0", "P1") for i in issues)
        self.ledger.update(current["job_id"], lambda j: j.update(
            state="READY_FOR_HUMAN" if ready else "PARTIAL", adjudication=adjudication,
            error_code="" if ready else "UNRESOLVED_REVIEW_OR_SOURCE_GATES",
            approval_status="PENDING", submission_status="NOT_SUBMITTED"))

    def fail(self, ticket_id, execution_id, error_code="TRANSPORT_FAILED", uncertain=True):
        task = self._task(ticket_id)
        if task.get("execution_id") != execution_id:
            raise ValueError("RUNNER_EXECUTION_MISMATCH")
        self.ledger.fail(ticket_id, safe_code(error_code), uncertain=uncertain, now=self.clock(),
                         receipt={**self._failure_receipt(task), "failure_status": safe_code(error_code)})
        self._block(task["job_id"], "BLOCKED_RECONCILE" if uncertain else safe_code(error_code), partial=not uncertain)
        return self.summary(task["job_id"])

    def _failure_receipt(self, task):
        job = self.ledger.get(task["job_id"])
        return {"provider": task["provider"], "configured_model_id": task["model_id"], "model_id": None,
                "request_id": None, "n8n_execution_id": task.get("execution_id"),
                "started_at": stamp(task["started_at"]) if task.get("started_at") is not None else None,
                "finished_at": stamp(self.clock()), "input_hash": task["request_hash"],
                "prompt_version": job["prompt_version"], "response_hash": None, "actual_cost": None,
                "currency": job["budget"]["currency"], "evidence_mode": self.mode.upper(),
                **{k: task[k] for k in ("snapshot_id", "manifest_hash", "artifact_version", "artifact_hash")}}

    def _block(self, job_id, code, partial=False):
        def block(job):
            reconcile = code in ("BLOCKED_RECONCILE", "COST_UNCONFIRMED") or job.get("cost_unconfirmed", False)
            if job.get("error_code") == "ACTUAL_COST_EXCEEDED_BUDGET":
                return
            job.update(state="BLOCKED_RECONCILE" if reconcile else "PARTIAL" if partial else "BLOCKED", error_code=code)
        self.ledger.update(job_id, block)

    def resume(self, job_id):
        job = self.ledger.get(job_id)
        if job.get("cost_unconfirmed") or any(t["status"] in ("RUNNING", "BLOCKED_RECONCILE") for t in self.ledger.tasks(job_id)):
            raise ValueError("PROVIDER_RECONCILIATION_REQUIRED")
        if any(i.get("severity") == "P0" for i in job["rules"]["issues"]):
            raise ValueError("P0_SOURCE_OR_IDENTITY_FAILURE")
        if any(t.get("receipt", {}).get("validation_error") or t.get("error_code") not in (None, "", "LEASE_EXPIRED_BEFORE_START", "STALE_ARTIFACT_RESULT", "STALE_ARTIFACT_BEFORE_START") for t in self._current(job)):
            raise ValueError("NEW_VALIDATED_JOB_REQUIRED")
        self.ledger.update(job_id, lambda j: j.update(state="READY", error_code=""))
        return self.summary(job_id)

    def summary(self, job_id):
        job = self.ledger.get(job_id)
        tasks = self._current(job)
        current = {t["reviewer"]: t for t in tasks}
        reviews = [t for t in tasks if t["reviewer"] in ("claude", "gemini") and t["status"] == "COMPLETED"
                   and t.get("accepted", False) and not t.get("receipt", {}).get("validation_error")]
        overlap = len(reviews) == 2 and max(t["started_at"] for t in reviews) < min(t["finished_at"] for t in reviews)
        issues = list(job.get("rules", {}).get("issues", []))
        issues += [f for t in reviews for f in t.get("result", {}).get("findings", [])]
        issues += (job.get("adjudication") or {}).get("findings", [])
        decisions = (job.get("adjudication") or {}).get("decisions", [])
        all_tasks = self.ledger.tasks(job_id)
        starts = [t["started_at"] for t in all_tasks if t.get("started_at") is not None]
        ends = [t["finished_at"] for t in all_tasks if t.get("finished_at") is not None]
        scopes = [{"doc_id": d["doc_id"], "sha256": d["sha256"], "pages": [p["pdf_page"] for p in d["pages"]]} for d in job["snapshot"]["documents"]]
        return {**{k: job[k] for k in ("job_id", "case_id", "artifact_version", "artifact_hash", "snapshot_id", "manifest_hash", "state")},
                "status": "DONE" if job["state"] == "READY_FOR_HUMAN" else "BLOCKED" if job["state"].startswith("BLOCKED") else "PARTIAL",
                "completion_target": "MOCK_VERIFICATION" if self.mode == "mock" else "VERIFICATION_EXECUTION",
                "evidence_mode": self.mode.upper(), "independent_cross_review": job["profile"] != "QUICK" and len(reviews) == 2,
                "concurrent_review": bool(overlap), "provided_scope": "EXTRACTED_TEXT_ONLY",
                "source_scope": scopes, "coverage": scopes,
                "actual_reviewers": [] if self.mode == "mock" else [r for r, t in current.items() if t["status"] == "COMPLETED"
                    and t.get("accepted") and not t.get("receipt", {}).get("validation_error")],
                "reviewer_completion": {r: t["status"] for r, t in current.items()},
                "important_differences": issues[:3], "rule_results": job.get("rules"),
                "key_differences": issues[:3], "unresolved": [d for d in decisions if d["decision"] == "unresolved"],
                "owner_comparison": job.get("rules", {}).get("owner_comparison", []),
                "source_locations": [{"doc_id": d["doc_id"], "original_location": d["original_location"]} for d in job["snapshot"]["documents"]],
                "duration_seconds": max(ends) - min(starts) if starts and ends else None,
                "adjudication": job.get("adjudication"), "error_code": job.get("error_code", ""),
                "reviewers": {r: {"status": "INVALID_RESPONSE" if t.get("receipt", {}).get("validation_error") else t["status"],
                    "receipt": t.get("receipt"), "ticket_id": t["ticket_id"], "actual_cost": t.get("actual_cost"),
                    "cost_reconciliation": t.get("cost_reconciliation")} for r, t in current.items()},
                "cost": {"spent": job.get("spent", "0"), "reserved": job.get("reserved", "0"), "currency": job["budget"]["currency"],
                         "unconfirmed": job.get("cost_unconfirmed", False), "final_invoice_verified": False,
                         "cost_basis": "SIMULATED" if self.mode == "mock" else "USAGE_X_VERIFIED_TARIFF_OR_PROVIDER_RECONCILIATION",
                         "funding": "FREE_CREDITS_ONLY", "simulated": self.mode == "mock"},
                "approval_status": job.get("approval_status", "PENDING"), "submission_status": job.get("submission_status", "NOT_SUBMITTED"),
                "bso_status": job.get("bso_status", "NOT_RECORDED"),
                "next_action": "사람의 해당 버전 검토 필요" if job["state"] == "READY_FOR_HUMAN" else "미해결 근거·접근·무료 크레딧 확인"}
