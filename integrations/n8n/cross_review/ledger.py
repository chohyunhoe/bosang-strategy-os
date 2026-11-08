"""Durable execution and cost ledger. No network or provider credentials live here.

Every mutating operation takes a short SQLite write transaction. A reservation
does not prove a provider ran: only ``start`` consumes an attempt, and an unknown
outcome retains its reservation until a provider record reconciles it.
"""

from contextlib import contextmanager
from copy import deepcopy
from decimal import Decimal, InvalidOperation
import json
import math
import os
from pathlib import Path
import re
import sqlite3
from urllib.parse import urlsplit
import uuid


def _money(value):
    if not isinstance(value, str):
        raise ValueError("COST_DECIMAL_STRING_REQUIRED")
    try:
        number = Decimal(value)
    except InvalidOperation as exc:
        raise ValueError("COST_INVALID") from exc
    if not number.is_finite() or number < 0:
        raise ValueError("COST_INVALID")
    return number


def _now(value):
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
        raise ValueError("TIME_INVALID")
    return value


def _dump(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _binding(value):
    return tuple(value.get(key) for key in ("snapshot_id", "manifest_hash", "artifact_version", "artifact_hash"))


class Ledger:
    def __init__(self, path):
        self.path = str(Path(path).resolve())
        target = Path(path)
        if target.is_symlink():
            raise ValueError("LEDGER_SYMLINK_REJECTED")
        target.parent.mkdir(parents=True, exist_ok=True)
        # Create with restrictive permissions before SQLite opens auxiliary files.
        fd = os.open(self.path, os.O_CREAT | os.O_RDWR, 0o600)
        os.close(fd)
        os.chmod(self.path, 0o600)
        with self._transaction() as connection:
            connection.execute("CREATE TABLE IF NOT EXISTS jobs (job_id TEXT PRIMARY KEY, input_hash TEXT NOT NULL, body TEXT NOT NULL)")
            connection.execute("CREATE TABLE IF NOT EXISTS tasks (ticket_id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(job_id), body TEXT NOT NULL)")
            connection.execute("CREATE INDEX IF NOT EXISTS tasks_by_job ON tasks(job_id)")
            connection.execute("CREATE TABLE IF NOT EXISTS credits (account_ref TEXT PRIMARY KEY, body TEXT NOT NULL)")
            connection.execute("CREATE TABLE IF NOT EXISTS credit_proofs (account_ref TEXT NOT NULL, proof_id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(account_ref, proof_id))")

    @contextmanager
    def _transaction(self):
        connection = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        connection.row_factory = sqlite3.Row
        try:
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("BEGIN IMMEDIATE")
            yield connection
            connection.execute("COMMIT")
        except BaseException:
            if connection.in_transaction:
                connection.execute("ROLLBACK")
            raise
        finally:
            connection.close()
            for suffix in ("", "-wal", "-shm"):
                try:
                    os.chmod(self.path + suffix, 0o600)
                except FileNotFoundError:
                    pass

    @staticmethod
    def _job(connection, job_id):
        row = connection.execute("SELECT body FROM jobs WHERE job_id=?", (job_id,)).fetchone()
        if row is None:
            raise ValueError("JOB_NOT_FOUND")
        return json.loads(row["body"])

    @staticmethod
    def _task(connection, ticket_id):
        row = connection.execute("SELECT body FROM tasks WHERE ticket_id=?", (ticket_id,)).fetchone()
        if row is None:
            raise ValueError("TICKET_NOT_FOUND")
        return json.loads(row["body"])

    @staticmethod
    def _tasks(connection, job_id):
        return [json.loads(row["body"]) for row in connection.execute("SELECT body FROM tasks WHERE job_id=? ORDER BY rowid", (job_id,))]

    @staticmethod
    def _save_job(connection, job):
        connection.execute("UPDATE jobs SET body=? WHERE job_id=?", (_dump(job), job["job_id"]))

    @staticmethod
    def _save_task(connection, task):
        connection.execute("UPDATE tasks SET body=? WHERE ticket_id=?", (_dump(task), task["ticket_id"]))

    def register(self, job, input_hash):
        job = deepcopy(job)
        job_id = job["job_id"]
        budget = job.get("budget", {})
        limit = _money(budget.get("limit"))
        maximum = budget.get("max_attempts", 10)
        if limit <= 0 or not isinstance(maximum, int) or isinstance(maximum, bool) or not 1 <= maximum <= 10 or not budget.get("currency"):
            raise ValueError("BUDGET_INVALID")
        with self._transaction() as connection:
            row = connection.execute("SELECT input_hash,body FROM jobs WHERE job_id=?", (job_id,)).fetchone()
            if row is not None:
                if row["input_hash"] != input_hash:
                    raise ValueError("JOB_ID_INPUT_CONFLICT")
                return json.loads(row["body"]), False
            job.update(input_hash=input_hash, state="READY", spent="0", reserved="0", attempts=0,
                       approval_status="PENDING", submission_status="NOT_SUBMITTED",
                       lease_owner=None, lease_expires=0, lease_generation=0, cost_unconfirmed=False)
            connection.execute("INSERT INTO jobs(job_id,input_hash,body) VALUES(?,?,?)", (job_id, input_hash, _dump(job)))
            return job, True

    def get(self, job_id):
        with self._transaction() as connection:
            return self._job(connection, job_id)

    def list_jobs(self):
        with self._transaction() as connection:
            return [json.loads(row["body"]) for row in connection.execute("SELECT body FROM jobs ORDER BY rowid")]

    @staticmethod
    def _credit(connection, account_ref):
        row = connection.execute("SELECT body FROM credits WHERE account_ref=?", (account_ref,)).fetchone()
        if row is None:
            raise ValueError("CREDIT_BALANCE_UNVERIFIED")
        return json.loads(row["body"])

    @staticmethod
    def _save_credit(connection, credit):
        connection.execute("UPDATE credits SET body=? WHERE account_ref=?", (_dump(credit), credit["account_ref"]))

    def configure_credit(self, account_ref, provider, currency, available, proof_id,
                         verified_at, expires_at, paid_fallback=False):
        """Record operator-verified free-credit metadata, never a secret.

        Proof IDs cannot be reused to replenish a spent balance. Refresh is
        deferred while any call is financially unresolved, including reservations.
        """
        _money(available)
        _now(verified_at)
        _now(expires_at)
        if not all(isinstance(v, str) and v for v in (account_ref, provider, currency, proof_id)) or expires_at <= verified_at or paid_fallback is not False:
            raise ValueError("FREE_CREDIT_PROOF_INVALID")
        proof = dict(account_ref=account_ref, provider=provider, currency=currency,
                     available=available, proof_id=proof_id, verified_at=verified_at,
                     expires_at=expires_at, paid_fallback=False)
        with self._transaction() as connection:
            old_proof = connection.execute("SELECT body FROM credit_proofs WHERE account_ref=? AND proof_id=?", (account_ref, proof_id)).fetchone()
            row = connection.execute("SELECT body FROM credits WHERE account_ref=?", (account_ref,)).fetchone()
            current = json.loads(row["body"]) if row else None
            if old_proof is not None:
                if json.loads(old_proof["body"]) != proof or current["proof_id"] != proof_id:
                    raise ValueError("CREDIT_PROOF_REUSE_CONFLICT")
                return current
            if current:
                if current["provider"] != provider or current["currency"] != currency or verified_at <= current["verified_at"]:
                    raise ValueError("CREDIT_PROOF_ACCOUNT_CONFLICT")
                if _money(current["held"]) != 0:
                    raise ValueError("CREDIT_REFRESH_IN_FLIGHT_BLOCKED")
            credit = {**proof, "spent": "0", "held": "0"}
            connection.execute("INSERT INTO credit_proofs(account_ref,proof_id,body) VALUES(?,?,?)", (account_ref, proof_id, _dump(proof)))
            connection.execute("INSERT INTO credits(account_ref,body) VALUES(?,?) ON CONFLICT(account_ref) DO UPDATE SET body=excluded.body", (account_ref, _dump(credit)))
            return credit

    def credits(self):
        with self._transaction() as connection:
            return [json.loads(row["body"]) for row in connection.execute("SELECT body FROM credits ORDER BY account_ref")]

    def _release_credit(self, connection, task, actual_cost=None):
        if task.get("funding_mode", "MOCK") != "FREE_CREDITS_ONLY":
            return
        credit = self._credit(connection, task["account_ref"])
        if credit["proof_id"] != task["credit_proof_id"]:
            raise ValueError("CREDIT_PROOF_CHANGED_DURING_CALL")
        credit["held"] = str(_money(credit["held"]) - _money(task["reserve_cost"]))
        if actual_cost is not None:
            credit["spent"] = str(_money(credit["spent"]) + _money(actual_cost))
        self._save_credit(connection, credit)

    def update(self, job_id, mutator):
        """Apply an orchestration update atomically, preserving ledger accounting.

        Changing the current artifact invalidates prior approval and releases
        only unstarted work. In-flight work remains financially accountable.
        """
        with self._transaction() as connection:
            original = self._job(connection, job_id)
            changed = deepcopy(original)
            returned = mutator(changed)
            if returned is not None:
                changed = returned
            for key in ("job_id", "input_hash", "spent", "reserved", "attempts", "lease_owner", "lease_expires", "lease_generation", "cost_unconfirmed"):
                if changed.get(key) != original.get(key):
                    raise ValueError("LEDGER_FIELDS_IMMUTABLE")
            if (changed.get("snapshot_id"), changed.get("manifest_hash")) != (original.get("snapshot_id"), original.get("manifest_hash")):
                raise ValueError("SNAPSHOT_IMMUTABLE")
            if _binding(changed) != _binding(original):
                if changed.get("artifact_version", 0) <= original.get("artifact_version", 0):
                    raise ValueError("ARTIFACT_VERSION_MUST_ADVANCE")
                changed["approval_status"] = "PENDING"
                changed["submission_status"] = "NOT_SUBMITTED"
                for task in self._tasks(connection, job_id):
                    if task["status"] == "RESERVED":
                        changed["reserved"] = str(_money(changed["reserved"]) - _money(task["reserve_cost"]))
                        self._release_credit(connection, task)
                        task.update(status="FAILED", error_code="STALE_ARTIFACT_BEFORE_START", accepted=False, reservation_held=False)
                        self._save_task(connection, task)
                    elif task["status"] == "RUNNING":
                        task.update(status="BLOCKED_RECONCILE", error_code="ARTIFACT_CHANGED_DURING_CALL", accepted=False)
                        self._save_task(connection, task)
                        changed["state"] = "BLOCKED_RECONCILE"
                        changed["cost_unconfirmed"] = True
            self._save_job(connection, changed)
            return changed

    def claim(self, job_id, owner, now, lease_seconds=120):
        _now(now)
        if not owner or not isinstance(lease_seconds, (int, float)) or lease_seconds <= 0:
            raise ValueError("LEASE_INVALID")
        with self._transaction() as connection:
            job = self._job(connection, job_id)
            if job["state"] in ("BLOCKED_RECONCILE", "BLOCKED", "LIVE_BLOCKED", "APPROVED", "APPLIED", "READY_FOR_HUMAN"):
                return False
            if job["lease_owner"] and job["lease_expires"] > now and job["lease_owner"] != owner:
                return False
            if job["lease_owner"] and job["lease_expires"] <= now:
                self._expire(connection, job, now)
                if job["state"] == "BLOCKED_RECONCILE":
                    return False
            if job["lease_owner"] != owner or job["lease_expires"] <= now:
                job["lease_generation"] += 1
            job.update(lease_owner=owner, lease_expires=now + lease_seconds)
            self._save_job(connection, job)
            return True

    def reserve(self, job_id, owner, plans, now):
        _now(now)
        if not plans:
            raise ValueError("EMPTY_CALL_PLAN")
        with self._transaction() as connection:
            job = self._job(connection, job_id)
            if job["lease_owner"] != owner or job["lease_expires"] <= now:
                raise ValueError("LIVE_LEASE_REQUIRED")
            if job["state"] in ("BLOCKED_RECONCILE", "BLOCKED", "LIVE_BLOCKED", "APPROVED", "APPLIED", "READY_FOR_HUMAN") or job["cost_unconfirmed"]:
                raise ValueError("JOB_DISPATCH_BLOCKED")
            existing = self._tasks(connection, job_id)
            reserved_slots = sum(task["status"] == "RESERVED" for task in existing)
            if job["attempts"] + reserved_slots + len(plans) > job["budget"].get("max_attempts", 10):
                raise ValueError("ATTEMPT_LIMIT")
            total = Decimal("0")
            seen = set()
            account_totals = {}
            for plan in plans:
                if _binding(plan) != _binding(job):
                    raise ValueError("PLAN_VERSION_MISMATCH")
                key = (plan.get("reviewer"), _binding(plan))
                if not plan.get("reviewer") or not plan.get("provider") or not plan.get("model_id"):
                    raise ValueError("PLAN_PROVIDER_REQUIRED")
                if key in seen or any((task["reviewer"], _binding(task)) == key and task["status"] in ("RESERVED", "RUNNING", "COMPLETED", "BLOCKED_RECONCILE") for task in existing):
                    raise ValueError("DUPLICATE_REVIEW_DISPATCH")
                seen.add(key)
                amount = _money(plan.get("reserve_cost"))
                if amount <= 0:
                    raise ValueError("POSITIVE_COST_RESERVATION_REQUIRED")
                total += amount
                mode = plan.get("funding_mode", "MOCK")
                if mode == "FREE_CREDITS_ONLY":
                    account_ref = plan.get("account_ref")
                    credit = self._credit(connection, account_ref)
                    if credit["provider"] != plan["provider"] or credit["currency"] != job["budget"]["currency"] or credit["proof_id"] != plan.get("credit_proof_id") or credit["expires_at"] <= now or credit["verified_at"] > now or credit["paid_fallback"] is not False:
                        raise ValueError("CREDIT_BALANCE_UNVERIFIED")
                    account_totals[account_ref] = account_totals.get(account_ref, Decimal("0")) + amount
                elif mode != "MOCK":
                    raise ValueError("FREE_CREDITS_ONLY_REQUIRED")
            if _money(job["spent"]) + _money(job["reserved"]) + total > _money(job["budget"]["limit"]):
                raise ValueError("BUDGET_LIMIT")
            for account_ref, amount in account_totals.items():
                credit = self._credit(connection, account_ref)
                if _money(credit["spent"]) + _money(credit["held"]) + amount > _money(credit["available"]):
                    raise ValueError("FREE_CREDIT_LIMIT")
                credit["held"] = str(_money(credit["held"]) + amount)
                self._save_credit(connection, credit)
            tickets = []
            for plan in plans:
                task = deepcopy(plan)
                task.update(ticket_id=str(uuid.uuid4()), job_id=job_id, lease_generation=job["lease_generation"],
                            lease_owner=owner, status="RESERVED", reserved_at=now, reservation_held=True,
                            execution_id=None, started_at=None, finished_at=None, actual_cost=None, accepted=False)
                connection.execute("INSERT INTO tasks(ticket_id,job_id,body) VALUES(?,?,?)", (task["ticket_id"], job_id, _dump(task)))
                tickets.append(task)
            job["reserved"] = str(_money(job["reserved"]) + total)
            job["state"] = "RUNNING"
            self._save_job(connection, job)
            return tickets

    def start(self, ticket_id, execution_id, now):
        _now(now)
        if not isinstance(execution_id, str) or not execution_id:
            raise ValueError("EXECUTION_ID_REQUIRED")
        with self._transaction() as connection:
            task = self._task(connection, ticket_id)
            job = self._job(connection, task["job_id"])
            if task["status"] != "RESERVED":
                raise ValueError("TICKET_ALREADY_STARTED_OR_CLOSED")
            if task["lease_generation"] != job["lease_generation"] or task["lease_owner"] != job["lease_owner"] or job["lease_expires"] <= now:
                raise ValueError("STALE_LEASE")
            if _binding(task) != _binding(job) or job["state"] in ("BLOCKED", "BLOCKED_RECONCILE", "LIVE_BLOCKED"):
                raise ValueError("STALE_OR_BLOCKED_TASK")
            if task.get("funding_mode", "MOCK") == "FREE_CREDITS_ONLY":
                credit = self._credit(connection, task["account_ref"])
                if credit["proof_id"] != task["credit_proof_id"] or credit["expires_at"] <= now or credit["paid_fallback"] is not False:
                    raise ValueError("CREDIT_BALANCE_UNVERIFIED")
            if job["attempts"] >= job["budget"].get("max_attempts", 10):
                raise ValueError("ATTEMPT_LIMIT")
            job["attempts"] += 1
            task.update(status="RUNNING", execution_id=execution_id, started_at=now, attempt=job["attempts"])
            self._save_task(connection, task)
            self._save_job(connection, job)
            return task

    def _settle(self, connection, job, task, actual_cost):
        if actual_cost is None:
            if task["actual_cost"] is None:
                job["cost_unconfirmed"] = True
            return
        amount = _money(actual_cost)
        if task["actual_cost"] is not None:
            if _money(task["actual_cost"]) != amount:
                raise ValueError("COST_RECONCILIATION_CONFLICT")
            return
        task["actual_cost"] = str(amount)
        job["spent"] = str(_money(job["spent"]) + amount)
        if task["reservation_held"]:
            self._release_credit(connection, task, str(amount))
            job["reserved"] = str(_money(job["reserved"]) - _money(task["reserve_cost"]))
            task["reservation_held"] = False

    def finish(self, ticket_id, result, receipt, actual_cost, now):
        _now(now)
        with self._transaction() as connection:
            task = self._task(connection, ticket_id)
            job = self._job(connection, task["job_id"])
            if task["status"] == "COMPLETED":
                if task.get("result") != result or task.get("receipt") != receipt:
                    raise ValueError("TICKET_RESULT_CONFLICT")
                # Re-delivery with newly available cost can settle a completed call.
                self._settle(connection, job, task, actual_cost)
            elif task["status"] in ("RUNNING", "BLOCKED_RECONCILE"):
                self._settle(connection, job, task, actual_cost)
                task.update(status="COMPLETED", result=deepcopy(result), receipt=deepcopy(receipt), finished_at=now,
                            accepted=_binding(task) == _binding(job), error_code="" if _binding(task) == _binding(job) else "STALE_ARTIFACT_RESULT")
            else:
                raise ValueError("STARTED_CALL_REQUIRED")
            self._save_task(connection, task)
            self._refresh_cost_state(connection, job)
            if _money(job["spent"]) + _money(job["reserved"]) > _money(job["budget"]["limit"]):
                job["state"] = "BLOCKED"
                job["error_code"] = "ACTUAL_COST_EXCEEDED_BUDGET"
            self._save_job(connection, job)
            return task

    def fail(self, ticket_id, error_code, uncertain, now, actual_cost=None, receipt=None):
        _now(now)
        with self._transaction() as connection:
            task = self._task(connection, ticket_id)
            job = self._job(connection, task["job_id"])
            if task["status"] not in ("RUNNING", "BLOCKED_RECONCILE"):
                raise ValueError("STARTED_CALL_REQUIRED")
            self._settle(connection, job, task, actual_cost)
            task.update(status="BLOCKED_RECONCILE" if uncertain else "FAILED", error_code=str(error_code), finished_at=now, accepted=False)
            if receipt is not None:
                if not isinstance(receipt, dict):
                    raise ValueError("RECEIPT_OBJECT_REQUIRED")
                task["receipt"] = deepcopy(receipt)
            job["state"] = "BLOCKED_RECONCILE" if uncertain or actual_cost is None else "PARTIAL"
            self._save_task(connection, task)
            self._refresh_cost_state(connection, job)
            self._save_job(connection, job)
            return task

    def reconcile_cost(self, ticket_id, actual_cost, proof, now):
        """Settle an unknown cost using a private operator-verified provider record.

        This is an administrative operation, not a model/HTTP callback. It does
        not prove a successful review, resume execution, or grant any approval.
        A verified zero must carry the same provider-record proof as other sums.
        """
        _now(now)
        amount = _money(actual_cost)
        fields = {"source", "provider", "account_ref", "request_id", "reference", "verified_at"}
        if not isinstance(proof, dict) or set(proof) != fields or proof.get("source") != "PROVIDER_RECORD":
            raise ValueError("COST_PROVIDER_RECORD_REQUIRED")
        for key in ("provider", "account_ref", "request_id", "reference"):
            if not isinstance(proof.get(key), str) or not proof[key].strip():
                raise ValueError("COST_PROVIDER_RECORD_INVALID")
        _now(proof["verified_at"])
        if proof["verified_at"] > now:
            raise ValueError("COST_PROOF_TIME_INVALID")
        if any(re.search(r"sk-(?:proj-)?[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9_./+-]{16,}", value) for value in proof.values() if isinstance(value, str)):
            raise ValueError("COST_PROOF_SECRET_FORBIDDEN")
        official_hosts = {
            "anthropic": {"console.anthropic.com", "platform.claude.com", "api.anthropic.com"},
            "google": {"console.cloud.google.com", "aistudio.google.com", "generativelanguage.googleapis.com"},
            "openai": {"platform.openai.com", "api.openai.com"},
        }
        reference = urlsplit(proof["reference"])
        if (len(proof["reference"]) > 2048 or reference.scheme != "https"
                or reference.hostname not in official_hosts.get(proof["provider"], set())
                or reference.username is not None or reference.password is not None
                or reference.query or reference.fragment or reference.port not in (None, 443)):
            raise ValueError("COST_PROOF_OFFICIAL_REFERENCE_REQUIRED")
        with self._transaction() as connection:
            task = self._task(connection, ticket_id)
            job = self._job(connection, task["job_id"])
            if task["started_at"] is None:
                raise ValueError("STARTED_CALL_REQUIRED")
            if proof["provider"] != task["provider"] or proof["account_ref"] != task.get("account_ref"):
                raise ValueError("COST_PROOF_ACCOUNT_MISMATCH")
            if proof["verified_at"] < task["started_at"]:
                raise ValueError("COST_PROOF_TIME_INVALID")
            receipt = task.get("receipt", {})
            known_ids = {receipt.get(key) for key in ("request_id", "official_response_id") if receipt.get(key)}
            if known_ids and proof["request_id"] not in known_ids:
                raise ValueError("COST_PROOF_REQUEST_MISMATCH")
            if task["actual_cost"] is not None:
                if (_money(task["actual_cost"]) != amount
                        or task.get("cost_reconciliation") != proof):
                    raise ValueError("COST_RECONCILIATION_CONFLICT")
                return task
            self._settle(connection, job, task, actual_cost)
            task["cost_reconciliation"] = deepcopy(proof)
            task["cost_reconciled_at"] = now
            self._save_task(connection, task)
            self._refresh_cost_state(connection, job)
            if _money(job["spent"]) + _money(job["reserved"]) > _money(job["budget"]["limit"]):
                job["state"] = "BLOCKED"
                job["error_code"] = "ACTUAL_COST_EXCEEDED_BUDGET"
            self._save_job(connection, job)
            return task

    def tasks(self, job_id):
        with self._transaction() as connection:
            self._job(connection, job_id)
            return self._tasks(connection, job_id)

    def _refresh_cost_state(self, connection, job):
        tasks = self._tasks(connection, job["job_id"])
        job["cost_unconfirmed"] = any(task["started_at"] is not None and task["actual_cost"] is None for task in tasks)
        if not job["cost_unconfirmed"] and not any(task["status"] in ("RESERVED", "RUNNING", "BLOCKED_RECONCILE") for task in tasks):
            # A new n8n schedule execution can claim the next stage immediately.
            # Never keep an otherwise idle owner lease across review stages.
            job.update(lease_owner=None, lease_expires=0, lease_generation=job["lease_generation"] + 1)

    def _expire(self, connection, job, now):
        uncertain = False
        for task in self._tasks(connection, job["job_id"]):
            if task["status"] == "RESERVED":
                job["reserved"] = str(_money(job["reserved"]) - _money(task["reserve_cost"]))
                self._release_credit(connection, task)
                task.update(status="FAILED", error_code="LEASE_EXPIRED_BEFORE_START", finished_at=now, reservation_held=False)
                self._save_task(connection, task)
            elif task["status"] in ("RUNNING", "BLOCKED_RECONCILE"):
                uncertain = True
                task.update(status="BLOCKED_RECONCILE", error_code="LEASE_EXPIRED_AFTER_START", accepted=False)
                self._save_task(connection, task)
        job.update(lease_owner=None, lease_expires=0, lease_generation=job["lease_generation"] + 1)
        if uncertain:
            job["state"] = "BLOCKED_RECONCILE"
        elif job["state"] not in ("APPROVED", "APPLIED", "READY_FOR_HUMAN", "BLOCKED", "LIVE_BLOCKED"):
            job["state"] = "READY"
        self._refresh_cost_state(connection, job)
        self._save_job(connection, job)

    def recover(self, now):
        _now(now)
        recovered = []
        with self._transaction() as connection:
            jobs = [json.loads(row["body"]) for row in connection.execute("SELECT body FROM jobs")]
            for job in jobs:
                if job["lease_owner"] and job["lease_expires"] <= now:
                    self._expire(connection, job, now)
                    recovered.append(job)
        return recovered
