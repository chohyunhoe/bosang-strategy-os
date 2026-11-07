"""End-to-end orchestration with synthetic responses; external calls stay zero."""
import copy
import json
import tempfile
import unittest

from integrations.n8n.cross_review.contract import canonical, digest
from integrations.n8n.cross_review.engine import Engine
from integrations.n8n.cross_review.ledger import Ledger
from tests.cross_review.fixtures import finding, make_job, make_response


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.now = 1000.0
        self.ledger = Ledger(self.folder.name + "/review.sqlite3")
        self.engine = Engine(self.ledger, clock=lambda: self.now)

    def start_pair(self, job):
        self.engine.submit(job)
        tasks = self.engine.dispatch("parent1")["tasks"]
        self.assertEqual({t["reviewer"] for t in tasks}, {"claude", "gemini"})
        for i, task in enumerate(tasks):
            self.now += 1
            self.engine.start(task["ticket_id"], "child" + str(i))
        return tasks

    def close_pair(self, job, tasks, findings=None):
        for i, task in enumerate(tasks):
            self.now += 1
            self.engine.complete_mock(task["ticket_id"], "child" + str(i),
                                      make_response(job, task["reviewer"], findings=findings))

    def judge(self, job, revision_needed=False):
        task = self.engine.dispatch("parent2")["tasks"][0]
        self.assertEqual(task["reviewer"], "gpt")
        self.engine.start(task["ticket_id"], "judge")
        stored = self.ledger.get(job["job_id"])
        ids = [f["finding_id"] for t in self.ledger.tasks(job["job_id"])
               if t["artifact_version"] == stored["artifact_version"] and t["reviewer"] in ("claude", "gemini")
               for f in t["result"]["findings"]]
        ids += [i["finding_id"] for i in stored["rules"]["issues"]]
        evidence = [job["rule_input"]["reference_rows"][0]["evidence"]]
        decisions = [{"finding_id": fid, "decision": "adopt", "reason": "Source comparison confirms the difference",
                      "evidence": evidence, "counterargument": "Owner identity was checked",
                      "additional_evidence": [], "action": "Revise and reverify"} for fid in ids]
        response = make_response(stored, "gpt", decisions=decisions)
        response["revision_needed"] = revision_needed
        self.now += 1
        self.engine.complete_mock(task["ticket_id"], "judge", response)
        return response

    def test_12_17_normal_independent_overlapping_pipeline(self):
        job = make_job()
        tasks = self.start_pair(job)
        requests = [json.dumps(t["request"]["body"], ensure_ascii=False) for t in tasks]
        self.assertTrue(all(job["manifest_hash"] in r and "completed_reviews" not in r for r in requests))
        self.close_pair(job, tasks)
        self.judge(job)
        summary = self.engine.summary(job["job_id"])
        self.assertEqual(summary["state"], "READY_FOR_HUMAN")
        self.assertTrue(summary["independent_cross_review"])
        self.assertTrue(summary["concurrent_review"])
        self.assertEqual(summary["evidence_mode"], "MOCK")
        self.assertEqual(summary["approval_status"], "PENDING")
        self.assertEqual(summary["submission_status"], "NOT_SUBMITTED")
        self.assertEqual(summary["cost"]["spent"], "0.03")
        self.assertEqual(len(self.ledger.tasks(job["job_id"])), 3)

    def test_14_consensus_wrong_answer_cannot_override_rules(self):
        job = make_job(mismatch=True)
        tasks = self.start_pair(job)
        self.close_pair(job, tasks)
        self.judge(job)
        self.assertEqual(self.engine.summary(job["job_id"])["state"], "PARTIAL")

    def test_21_discrepancy_revision_new_version_both_reviews_and_judge(self):
        job = make_job(mismatch=True)
        original_snapshot = copy.deepcopy(job["snapshot"])
        tasks = self.start_pair(job)
        self.close_pair(job, tasks, findings=[finding(job)])
        self.judge(job, revision_needed=True)
        writer = self.engine.dispatch("parent3")["tasks"][0]
        self.assertEqual(writer["reviewer"], "reviser")
        self.engine.start(writer["ticket_id"], "writer")
        corrected = canonical({"schema_version": "lk-owner-comparison/1.0", "rows": job["rule_input"]["reference_rows"]})
        revision = {"schema_version": "lk-cross-review-revision/1.0", **{k: job[k] for k in ("job_id", "snapshot_id", "manifest_hash", "artifact_version", "artifact_hash")},
                    "reviewer": "reviser", "artifact_text": corrected, "changes": ["Correct owner amounts using frozen source"]}
        self.now += 1
        self.engine.complete_mock(writer["ticket_id"], "writer", revision)
        new = self.ledger.get(job["job_id"])
        self.assertEqual(new["artifact_version"], 2)
        self.assertNotEqual(new["artifact_hash"], job["artifact_hash"])
        self.assertEqual(new["snapshot"], original_snapshot)
        self.assertTrue(new["rules"]["passed"])
        self.assertEqual(new["approval_status"], "PENDING")
        tasks = self.engine.dispatch("parent4")["tasks"]
        self.assertEqual(len(tasks), 2)
        for i, task in enumerate(tasks):
            self.engine.start(task["ticket_id"], "child" + str(i))
        self.close_pair(new, tasks)
        self.judge(new)
        self.assertEqual(self.engine.summary(job["job_id"])["state"], "READY_FOR_HUMAN")
        self.assertEqual(len(self.ledger.tasks(job["job_id"])), 7)

    def test_22_one_reviewer_failure_never_succeeds(self):
        job = make_job()
        tasks = self.start_pair(job)
        self.engine.complete_mock(tasks[0]["ticket_id"], "child0", make_response(job, tasks[0]["reviewer"]))
        self.engine.fail(tasks[1]["ticket_id"], "child1", "AUTHENTICATION_FAILED", uncertain=False)
        self.assertEqual(self.engine.dispatch("other")["tasks"], [])
        self.assertNotEqual(self.engine.summary(job["job_id"])["state"], "READY_FOR_HUMAN")

    def test_23_timeout_restart_no_recall_and_late_receipt_settles(self):
        job = make_job()
        tasks = self.start_pair(job)
        self.engine.fail(tasks[0]["ticket_id"], "child0", "TRANSPORT_TIMEOUT", uncertain=True)
        self.now += 700
        restarted = Engine(Ledger(self.ledger.path), clock=lambda: self.now)
        self.assertEqual(restarted.dispatch("restarted")["tasks"], [])
        self.assertEqual(self.ledger.get(job["job_id"])["attempts"], 2)
        restarted.complete_mock(tasks[0]["ticket_id"], "child0", make_response(job, tasks[0]["reviewer"]))
        self.assertEqual(self.ledger.tasks(job["job_id"])[0]["actual_cost"], "0.01")
        self.assertEqual(self.ledger.get(job["job_id"])["state"], "BLOCKED_RECONCILE")

    def test_24_entire_initial_plan_required_before_first_call(self):
        job = make_job()
        job["budget"]["limit"] = "0.20"
        self.engine.submit(job)
        self.assertEqual(self.engine.dispatch("parent")["tasks"], [])
        self.assertEqual(self.ledger.get(job["job_id"])["attempts"], 0)
        self.assertEqual(self.engine.summary(job["job_id"])["error_code"], "FULL_REVIEW_BUDGET_REQUIRED")

    def test_25_provably_unstarted_expired_reservations_can_recover(self):
        job = make_job()
        self.engine.submit(job)
        old = self.engine.dispatch("parent")["tasks"]
        self.now += 700
        new = self.engine.dispatch("restart")["tasks"]
        self.assertEqual(len(new), 2)
        self.assertTrue({t["ticket_id"] for t in old}.isdisjoint(t["ticket_id"] for t in new))
        self.assertEqual(self.ledger.get(job["job_id"])["attempts"], 0)
        self.assertEqual(self.ledger.get(job["job_id"])["reserved"], "0.20")

    def test_30_quick_is_not_independent_or_human_approved(self):
        job = make_job(profile="QUICK")
        self.engine.submit(job)
        task = self.engine.dispatch("parent")["tasks"][0]
        self.engine.start(task["ticket_id"], "quick")
        self.engine.complete_mock(task["ticket_id"], "quick", make_response(job))
        self.engine.dispatch("next")
        summary = self.engine.summary(job["job_id"])
        self.assertEqual(summary["state"], "READY_FOR_HUMAN")
        self.assertFalse(summary["independent_cross_review"])
        self.assertEqual(summary["approval_status"], "PENDING")

    def test_request_and_source_hashes_are_immutable_per_ticket(self):
        job = make_job()
        tasks = self.start_pair(job)
        original = self.ledger.tasks(job["job_id"])[0]
        self.close_pair(job, tasks)
        receipt = self.ledger.tasks(job["job_id"])[0]["receipt"]
        self.assertEqual(receipt["input_hash"], original["request_hash"])
        self.assertEqual(receipt["input_hash"], digest(original["request"]["body"]))

    def test_unknown_cost_and_budget_overrun_cannot_be_finalized(self):
        job = make_job()
        tasks = self.start_pair(job)
        self.engine.complete_mock(tasks[0]["ticket_id"], "child0", make_response(job, tasks[0]["reviewer"]), actual_cost=None)
        self.assertEqual(self.engine.summary(job["job_id"])["state"], "BLOCKED_RECONCILE")
        self.assertTrue(self.engine.summary(job["job_id"])["cost"]["unconfirmed"])

    def test_p0_owner_collision_blocks_before_any_provider_dispatch(self):
        job = make_job()
        job["rule_input"]["reference_rows"][1]["owner_id"] = "M1"
        self.engine.submit(job)
        self.assertEqual(self.engine.dispatch("parent")["tasks"], [])
        self.assertEqual(self.ledger.get(job["job_id"])["attempts"], 0)

    def test_live_mode_cannot_use_mock_credit_claims_or_unverified_install(self):
        live = Engine(self.ledger, mode="live", clock=lambda: self.now)
        job = make_job()
        live.submit(job)
        self.assertEqual(live.dispatch("parent")["tasks"], [])
        self.assertEqual(live.summary(job["job_id"])["error_code"], "N8N_INSTALLATION_UNVERIFIED")
        self.assertEqual(self.ledger.get(job["job_id"])["attempts"], 0)

    def installed_live_engine(self, job, configure_credits=True, credit_ttl=10000):
        bindings = {}
        for cfg in job["model_config"].values():
            bindings[cfg["provider"]] = {"credential_ref": cfg["credential_ref"], "account_ref": cfg["account_ref"],
                "model_bounds": {cfg["model_id"]: {"verified": True, "price_as_of": cfg["price_as_of"], "currency": "USD",
                  "input_per_million": cfg["input_per_million"], "output_per_million": cfg["output_per_million"],
                  "maximum_request_cost": "0.10", "max_output_tokens": 2048, "max_input_bytes": 1000000}}}
            if configure_credits:
                self.ledger.configure_credit(cfg["account_ref"], cfg["provider"], "USD", "1.00", "SYNTHETIC_PROOF",
                                             self.now, self.now + credit_ttl, False)
        return Engine(self.ledger, mode="live", clock=lambda: self.now,
                      installation={"verified": True, "n8n_version": "SYNTHETIC_INSTALLATION_TEST", "bindings": bindings})

    def test_free_credit_claim_in_job_is_not_authoritative(self):
        job = make_job()
        live = self.installed_live_engine(job, configure_credits=False)
        live.submit(job)
        self.assertEqual(live.dispatch("parent")["tasks"], [])
        self.assertEqual(live.summary(job["job_id"])["error_code"], "CREDIT_BALANCE_UNVERIFIED")

    def test_underpriced_caller_tariff_cannot_release_real_credit(self):
        job = make_job()
        live = self.installed_live_engine(job, credit_ttl=10)
        job["model_config"]["claude"]["input_per_million"] = "0"
        job["model_config"]["claude"]["output_per_million"] = "0"
        live.submit(job)
        self.assertEqual(live.dispatch("parent")["tasks"], [])
        self.assertEqual(live.summary(job["job_id"])["error_code"], "MODEL_TARIFF_UNVERIFIED")
        self.assertEqual(self.ledger.get(job["job_id"])["attempts"], 0)

    def test_installed_account_mismatch_blocks(self):
        job = make_job()
        live = self.installed_live_engine(job)
        live.installation["bindings"]["anthropic"]["account_ref"] = "different-account"
        live.submit(job)
        self.assertEqual(live.dispatch("parent")["tasks"], [])
        self.assertEqual(live.summary(job["job_id"])["error_code"], "N8N_CREDENTIAL_ACCOUNT_UNVERIFIED")

    def test_unproven_reservation_and_input_bounds_block_before_calls(self):
        for kind, expected in (("cost", "RESERVATION_BELOW_PROVEN_COST_BOUND"), ("input", "INPUT_EXCEEDS_PROVEN_COST_BOUND")):
            with self.subTest(kind=kind):
                job = make_job("SYN_BOUNDS_" + kind)
                live = self.installed_live_engine(job)
                bound = live.installation["bindings"]["anthropic"]["model_bounds"]["mock-claude"]
                bound["maximum_request_cost" if kind == "cost" else "max_input_bytes"] = "0.20" if kind == "cost" else 1
                live.submit(job)
                self.assertEqual(live.dispatch("parent")["tasks"], [])
                self.assertEqual(live.summary(job["job_id"])["error_code"], expected)
                self.assertEqual(self.ledger.get(job["job_id"])["attempts"], 0)

    def test_credit_expiry_between_reservation_and_start_blocks_call(self):
        job = make_job()
        live = self.installed_live_engine(job, credit_ttl=10)
        live.submit(job)
        task = live.dispatch("parent")["tasks"][0]
        self.now += 11
        with self.assertRaises(ValueError):
            live.start(task["ticket_id"], "never-called")
        self.assertEqual(self.ledger.get(job["job_id"])["attempts"], 0)

    def test_gpt_new_unresolved_p1_finding_is_not_ignored(self):
        job = make_job()
        tasks = self.start_pair(job)
        self.close_pair(job, tasks)
        task = self.engine.dispatch("judge-parent")["tasks"][0]
        self.engine.start(task["ticket_id"], "judge")
        decision = {"finding_id": "gpt:F1", "decision": "unresolved", "reason": "Additional source required",
                    "evidence": [], "counterargument": "New issue", "additional_evidence": ["Original needed"], "action": "Hold"}
        response = make_response(job, "gpt", findings=[finding(job)], decisions=[decision])
        self.engine.complete_mock(task["ticket_id"], "judge", response)
        self.assertEqual(self.engine.summary(job["job_id"])["state"], "PARTIAL")

    def test_actual_cost_above_budget_cannot_be_overwritten_by_finalizer(self):
        job = make_job()
        tasks = self.start_pair(job)
        self.close_pair(job, tasks)
        task = self.engine.dispatch("judge-parent")["tasks"][0]
        self.engine.start(task["ticket_id"], "judge")
        self.engine.complete_mock(task["ticket_id"], "judge", make_response(job, "gpt"), actual_cost="2.00")
        self.engine._finalize(job, make_response(job, "gpt"))
        self.assertEqual(self.engine.summary(job["job_id"])["state"], "BLOCKED")

    def test_20_late_old_version_result_is_audit_only(self):
        job = make_job()
        tasks = self.start_pair(job)
        def change(j):
            j.update(artifact_version=2, artifact_text=j["artifact_text"] + " ", artifact_hash=digest(j["artifact_text"] + " "))
        self.ledger.update(job["job_id"], change)
        self.engine.complete_mock(tasks[0]["ticket_id"], "child0", make_response(job, tasks[0]["reviewer"]))
        self.assertFalse(self.ledger.tasks(job["job_id"])[0]["accepted"])
        self.assertEqual(self.engine.summary(job["job_id"])["reviewers"], {})


if __name__ == "__main__":
    unittest.main()
