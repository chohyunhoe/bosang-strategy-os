"""SQLite tests use synthetic jobs and make zero provider calls."""

from copy import deepcopy
from decimal import Decimal
import multiprocessing
from pathlib import Path
import stat
import tempfile
import unittest

from integrations.n8n.cross_review.ledger import Ledger


def job(job_id="job-1"):
    return {"job_id": job_id, "case_id": "synthetic", "snapshot_id": "snapshot-1",
            "manifest_hash": "a" * 64, "artifact_version": 1, "artifact_hash": "b" * 64,
            "budget": {"limit": "2.00", "currency": "USD", "max_attempts": 10}}


def plan(reviewer="claude", **changes):
    value = {"reviewer": reviewer, "provider": "anthropic", "model_id": "synthetic-model",
             "reserve_cost": "0.50", "snapshot_id": "snapshot-1", "manifest_hash": "a" * 64,
             "artifact_version": 1, "artifact_hash": "b" * 64}
    value.update(changes)
    return value


def _race_claim(path, owner, barrier, queue):
    ledger = Ledger(path)
    barrier.wait()
    queue.put(ledger.claim("job-1", owner, 1))


def _race_reserve_credit(path, job_id, barrier, queue):
    ledger = Ledger(path)
    ledger.claim(job_id, job_id, 1)
    barrier.wait()
    try:
        ledger.reserve(job_id, job_id, [plan(funding_mode="FREE_CREDITS_ONLY", account_ref="account-1", credit_proof_id="proof-1", reserve_cost="0.75")], 2)
        queue.put("reserved")
    except ValueError as exc:
        queue.put(str(exc))


class LedgerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.path = str(Path(self.temporary.name) / "ledger.sqlite")
        self.ledger = Ledger(self.path)
        self.ledger.register(job(), "input-1")

    def tearDown(self):
        self.temporary.cleanup()

    def reserve(self, plans=None):
        self.assertTrue(self.ledger.claim("job-1", "dispatcher-1", 1))
        return self.ledger.reserve("job-1", "dispatcher-1", plans or [plan()], 2)

    def configure_credit(self, **changes):
        parameters = dict(account_ref="account-1", provider="anthropic", currency="USD", available="1.00", proof_id="proof-1", verified_at=0, expires_at=100)
        parameters.update(changes)
        return self.ledger.configure_credit(**parameters)

    def test_idempotency_and_different_input_conflict(self):
        first = self.ledger.get("job-1")
        stored, created = self.ledger.register(job(), "input-1")
        self.assertFalse(created)
        self.assertEqual(first, stored)
        with self.assertRaisesRegex(ValueError, "JOB_ID_INPUT_CONFLICT"):
            self.ledger.register(job(), "other-input")

    def test_two_processes_only_one_dispatcher_claims(self):
        context = multiprocessing.get_context("spawn")
        barrier, queue = context.Barrier(2), context.Queue()
        workers = [context.Process(target=_race_claim, args=(self.path, f"worker-{index}", barrier, queue)) for index in range(2)]
        for worker in workers:
            worker.start()
        results = [queue.get(timeout=15) for _ in workers]
        for worker in workers:
            worker.join(timeout=15)
            self.assertEqual(worker.exitcode, 0)
        self.assertEqual(sorted(results), [False, True])

    def test_all_parallel_costs_reserved_atomically_or_none(self):
        self.ledger.claim("job-1", "dispatcher-1", 1)
        with self.assertRaisesRegex(ValueError, "BUDGET_LIMIT"):
            self.ledger.reserve("job-1", "dispatcher-1", [plan("claude", reserve_cost="1.25"), plan("gemini", reserve_cost="1.25")], 2)
        self.assertEqual(self.ledger.tasks("job-1"), [])
        self.assertEqual(self.ledger.get("job-1")["reserved"], "0")

    def test_reservation_cannot_start_twice_after_restart(self):
        ticket = self.reserve()[0]
        self.ledger.start(ticket["ticket_id"], "n8n-1", 3)
        restarted = Ledger(self.path)
        with self.assertRaisesRegex(ValueError, "TICKET_ALREADY_STARTED"):
            restarted.start(ticket["ticket_id"], "n8n-2", 4)
        self.assertEqual(restarted.get("job-1")["attempts"], 1)

    def test_completed_stage_releases_lease_for_next_n8n_execution(self):
        ticket = self.reserve()[0]
        self.ledger.start(ticket["ticket_id"], "n8n-1", 3)
        self.ledger.finish(ticket["ticket_id"], {}, {}, "0.1", 4)
        self.assertTrue(self.ledger.claim("job-1", "next-n8n-schedule", 5))
        self.ledger.reserve("job-1", "next-n8n-schedule", [plan("gpt")], 6)

    def test_unknown_timeout_not_redispatched_and_keeps_cost(self):
        ticket = self.reserve()[0]
        self.ledger.start(ticket["ticket_id"], "n8n-1", 3)
        self.ledger.fail(ticket["ticket_id"], "TIMEOUT_ACCEPTANCE_UNKNOWN", True, 4)
        self.assertEqual(self.ledger.get("job-1")["reserved"], "0.50")
        self.assertTrue(self.ledger.get("job-1")["cost_unconfirmed"])
        self.assertFalse(self.ledger.claim("job-1", "dispatcher-2", 5))

    def test_malformed_billed_response_preserves_transport_receipt(self):
        ticket = self.reserve()[0]
        self.ledger.start(ticket["ticket_id"], "n8n-1", 3)
        receipt = {"request_id": "synthetic-official-request", "model_id": "synthetic-model", "usage": {"input_tokens": 23, "output_tokens": 17}, "failure_status": "PROVIDER_REVIEW_JSON_INVALID"}
        self.ledger.fail(ticket["ticket_id"], "PROVIDER_REVIEW_JSON_INVALID", False, 4, actual_cost="0.125", receipt=receipt)
        receipt["usage"]["input_tokens"] = 999
        stored = Ledger(self.path).tasks("job-1")[0]
        self.assertEqual(stored["receipt"]["request_id"], "synthetic-official-request")
        self.assertEqual(stored["receipt"]["usage"]["input_tokens"], 23)
        self.assertEqual(stored["actual_cost"], "0.125")
        self.assertFalse(stored["accepted"])

    def test_lease_expiry_after_call_start_blocks_reconciliation(self):
        tickets = self.reserve([plan("claude"), plan("gemini")])
        self.ledger.start(tickets[0]["ticket_id"], "n8n-1", 3)
        restarted = Ledger(self.path)
        recovered = restarted.recover(122)
        self.assertEqual(recovered[0]["state"], "BLOCKED_RECONCILE")
        self.assertEqual(recovered[0]["reserved"], "0.50")
        self.assertEqual([task["status"] for task in restarted.tasks("job-1")], ["BLOCKED_RECONCILE", "FAILED"])
        self.assertFalse(restarted.claim("job-1", "dispatcher-2", 123))

    def test_expired_unstarted_lease_can_be_reclaimed_without_double_spend(self):
        old = self.reserve()[0]
        self.assertTrue(self.ledger.claim("job-1", "dispatcher-2", 122))
        self.assertEqual(self.ledger.get("job-1")["reserved"], "0.00")
        with self.assertRaisesRegex(ValueError, "ALREADY_STARTED_OR_CLOSED"):
            self.ledger.start(old["ticket_id"], "late", 123)
        self.ledger.reserve("job-1", "dispatcher-2", [plan()], 123)

    def test_exact_decimal_accounting_and_idempotent_receipts(self):
        ticket = self.reserve()[0]
        self.ledger.start(ticket["ticket_id"], "n8n-1", 3)
        receipt = {"request_id": "official-synthetic-request"}
        self.ledger.finish(ticket["ticket_id"], {"findings": []}, receipt, "0.123456789123456789", 4)
        self.ledger.finish(ticket["ticket_id"], {"findings": []}, receipt, None, 5)
        final = self.ledger.get("job-1")
        self.assertEqual(final["spent"], "0.123456789123456789")
        self.assertEqual(Decimal(final["reserved"]), 0)
        self.assertFalse(final["cost_unconfirmed"])
        with self.assertRaisesRegex(ValueError, "RESULT_CONFLICT"):
            self.ledger.finish(ticket["ticket_id"], {"changed": True}, receipt, "0.1", 6)

    def test_version_change_invalidates_approval_and_excludes_old_response(self):
        tickets = self.reserve([plan("claude"), plan("gemini")])
        self.ledger.start(tickets[0]["ticket_id"], "n8n-1", 3)
        def revise(value):
            value.update(artifact_version=2, artifact_hash="c" * 64, approval_status="APPROVED", submission_status="SUBMITTED")
        changed = self.ledger.update("job-1", revise)
        self.assertEqual(changed["approval_status"], "PENDING")
        self.assertEqual(changed["submission_status"], "NOT_SUBMITTED")
        self.assertEqual(changed["state"], "BLOCKED_RECONCILE")
        result = self.ledger.finish(tickets[0]["ticket_id"], {"findings": []}, {}, "0.1", 4)
        self.assertFalse(result["accepted"])
        self.assertEqual(result["error_code"], "STALE_ARTIFACT_RESULT")

    def test_version_and_snapshot_plan_mismatches_block_before_reservation(self):
        self.ledger.claim("job-1", "dispatcher-1", 1)
        for bad in (plan(artifact_version=2), plan(manifest_hash="c" * 64)):
            with self.assertRaisesRegex(ValueError, "PLAN_VERSION_MISMATCH"):
                self.ledger.reserve("job-1", "dispatcher-1", [bad], 2)
        self.assertEqual(self.ledger.tasks("job-1"), [])

    def test_reserved_attempt_slots_enforce_ten_call_limit(self):
        self.reserve([plan(f"reviewer-{index}", reserve_cost="0.01") for index in range(10)])
        with self.assertRaisesRegex(ValueError, "ATTEMPT_LIMIT"):
            self.ledger.reserve("job-1", "dispatcher-1", [plan("eleventh")], 3)
        self.assertEqual(self.ledger.get("job-1")["attempts"], 0)

    def test_unknown_cost_is_never_reported_as_zero(self):
        ticket = self.reserve()[0]
        self.ledger.start(ticket["ticket_id"], "n8n-1", 3)
        task = self.ledger.finish(ticket["ticket_id"], {}, {}, None, 4)
        self.assertIsNone(task["actual_cost"])
        self.assertEqual(self.ledger.get("job-1")["reserved"], "0.50")
        with self.assertRaisesRegex(ValueError, "DISPATCH_BLOCKED"):
            self.ledger.reserve("job-1", "dispatcher-1", [plan("gpt")], 5)

    def test_database_has_private_permissions_and_update_rolls_back(self):
        self.assertEqual(stat.S_IMODE(Path(self.path).stat().st_mode), 0o600)
        def invalid(value):
            value["state"] = "BROKEN"
            value["spent"] = "999"
        with self.assertRaisesRegex(ValueError, "FIELDS_IMMUTABLE"):
            self.ledger.update("job-1", invalid)
        self.assertEqual(self.ledger.get("job-1")["state"], "READY")

    def test_missing_or_expired_free_credit_proof_blocks_before_calls(self):
        live = plan(funding_mode="FREE_CREDITS_ONLY", account_ref="account-1", credit_proof_id="proof-1")
        self.ledger.claim("job-1", "dispatcher-1", 1)
        with self.assertRaisesRegex(ValueError, "CREDIT_BALANCE_UNVERIFIED"):
            self.ledger.reserve("job-1", "dispatcher-1", [live], 2)
        self.configure_credit(expires_at=1)
        with self.assertRaisesRegex(ValueError, "CREDIT_BALANCE_UNVERIFIED"):
            self.ledger.reserve("job-1", "dispatcher-1", [live], 2)
        self.assertEqual(self.ledger.tasks("job-1"), [])

    def test_account_credit_reservations_are_atomic_across_concurrent_jobs(self):
        self.configure_credit()
        self.ledger.register(job("job-2"), "input-2")
        context = multiprocessing.get_context("spawn")
        barrier, queue = context.Barrier(2), context.Queue()
        workers = [context.Process(target=_race_reserve_credit, args=(self.path, f"job-{index + 1}", barrier, queue)) for index in range(2)]
        for worker in workers:
            worker.start()
        results = [queue.get(timeout=15) for _ in workers]
        for worker in workers:
            worker.join(timeout=15)
            self.assertEqual(worker.exitcode, 0)
        self.assertEqual(sorted(results), ["FREE_CREDIT_LIMIT", "reserved"])
        self.assertEqual(self.ledger.credits()[0]["held"], "0.75")

    def test_same_credit_proof_cannot_reset_spent_balance(self):
        self.configure_credit()
        ticket = self.reserve([plan(funding_mode="FREE_CREDITS_ONLY", account_ref="account-1", credit_proof_id="proof-1")])[0]
        self.ledger.start(ticket["ticket_id"], "n8n-1", 3)
        self.ledger.finish(ticket["ticket_id"], {}, {}, "0.40", 4)
        repeated = self.configure_credit()
        self.assertEqual(repeated["spent"], "0.40")
        self.assertEqual(repeated["held"], "0.00")
        with self.assertRaisesRegex(ValueError, "PROOF_REUSE_CONFLICT"):
            self.configure_credit(available="100.00")
        with self.assertRaisesRegex(ValueError, "FREE_CREDIT_PROOF_INVALID"):
            self.configure_credit(proof_id="paid", paid_fallback=True)

    def test_unknown_cost_holds_account_credit_across_restart(self):
        self.configure_credit()
        ticket = self.reserve([plan(funding_mode="FREE_CREDITS_ONLY", account_ref="account-1", credit_proof_id="proof-1")])[0]
        self.ledger.start(ticket["ticket_id"], "n8n-1", 3)
        self.ledger.fail(ticket["ticket_id"], "UNKNOWN_TIMEOUT", True, 4)
        restarted = Ledger(self.path)
        self.assertEqual(restarted.credits()[0]["held"], "0.50")
        with self.assertRaisesRegex(ValueError, "REFRESH_IN_FLIGHT_BLOCKED"):
            self.configure_credit(proof_id="proof-2", verified_at=5, expires_at=200)

    def test_provider_record_reconciles_unknown_cost_once_without_resuming(self):
        self.configure_credit()
        ticket = self.reserve([plan(funding_mode="FREE_CREDITS_ONLY", account_ref="account-1", credit_proof_id="proof-1")])[0]
        self.ledger.start(ticket["ticket_id"], "n8n-1", 3)
        receipt = {"request_id": "official-request-1", "model_id": "synthetic-model"}
        self.ledger.fail(ticket["ticket_id"], "UNKNOWN_TIMEOUT", True, 4, receipt=receipt)
        proof = {"source": "PROVIDER_RECORD", "provider": "anthropic", "account_ref": "account-1", "request_id": "official-request-1", "reference": "https://console.anthropic.com/settings/billing", "verified_at": 5}
        reconciled = self.ledger.reconcile_cost(ticket["ticket_id"], "0.25", proof, 6)
        proof["request_id"] = "changed-after-call"
        final = self.ledger.get("job-1")
        self.assertEqual(final["state"], "BLOCKED_RECONCILE")
        self.assertEqual(final["approval_status"], "PENDING")
        self.assertEqual(final["submission_status"], "NOT_SUBMITTED")
        self.assertFalse(final["cost_unconfirmed"])
        self.assertEqual(Decimal(final["reserved"]), 0)
        self.assertEqual(final["spent"], "0.25")
        self.assertEqual(reconciled["receipt"], receipt)
        self.assertEqual(reconciled["status"], "BLOCKED_RECONCILE")
        stored_proof = reconciled["cost_reconciliation"]
        repeated = Ledger(self.path).reconcile_cost(ticket["ticket_id"], "0.250", stored_proof, 7)
        self.assertEqual(repeated, reconciled)
        self.assertEqual(self.ledger.credits()[0]["spent"], "0.25")
        self.assertEqual(Decimal(self.ledger.credits()[0]["held"]), 0)
        with self.assertRaisesRegex(ValueError, "RECONCILIATION_CONFLICT"):
            self.ledger.reconcile_cost(ticket["ticket_id"], "0.00", stored_proof, 8)

    def test_zero_cost_requires_valid_account_request_and_official_record(self):
        ticket = self.reserve([plan(account_ref="account-1")])[0]
        self.ledger.start(ticket["ticket_id"], "n8n-1", 3)
        self.ledger.fail(ticket["ticket_id"], "UNKNOWN_TIMEOUT", True, 4, receipt={"request_id": "official-request-1"})
        proof = {"source": "PROVIDER_RECORD", "provider": "anthropic", "account_ref": "account-1", "request_id": "official-request-1", "reference": "https://console.anthropic.com/settings/billing", "verified_at": 5}
        for changes in ({"source": "MODEL_TEXT"}, {"account_ref": "other"}, {"request_id": "different-request"}, {"reference": "https://console.anthropic.com/settings/billing?api_key=secret"}, {"reference": "https://example.com/billing"}, {"verified_at": 2}):
            with self.assertRaises(ValueError):
                self.ledger.reconcile_cost(ticket["ticket_id"], "0", {**proof, **changes}, 6)
        self.assertIsNone(self.ledger.tasks("job-1")[0]["actual_cost"])
        self.assertEqual(self.ledger.get("job-1")["reserved"], "0.50")
        settled = self.ledger.reconcile_cost(ticket["ticket_id"], "0", proof, 6)
        self.assertEqual(settled["actual_cost"], "0")
        self.assertEqual(self.ledger.get("job-1")["attempts"], 1)
        changed_proof = {**proof, "reference": "https://console.anthropic.com/settings/usage"}
        with self.assertRaisesRegex(ValueError, "RECONCILIATION_CONFLICT"):
            self.ledger.reconcile_cost(ticket["ticket_id"], "0", changed_proof, 7)


if __name__ == "__main__":
    unittest.main()
