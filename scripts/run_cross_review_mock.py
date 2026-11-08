"""Reproduce normal and revised synthetic jobs. Makes zero provider HTTP calls."""
import argparse
import copy
import json
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from integrations.n8n.cross_review.bso import build_bso_package, export_new
from integrations.n8n.cross_review.contract import canonical, digest
from integrations.n8n.cross_review.engine import Engine
from integrations.n8n.cross_review.ledger import Ledger
from tests.cross_review.fixtures import finding, make_job, make_response


def scenario(folder, mismatch):
    label = "DISCREPANCY" if mismatch else "NORMAL"
    job = make_job("BSO_SYNTHETIC_" + label, mismatch=mismatch)
    job["bso_context"] = {"schema_version": "lk-bso-job/1.0", "document_id": "WORK_DOC_1",
                          "revision": 1, "artifact_sha256": job["artifact_hash"]}
    job["legacy_input_sha256"] = digest("Synthetic legacy handoff " + label)
    now = [1000.0]
    with tempfile.TemporaryDirectory() as work:
        ledger = Ledger(Path(work) / "mock.sqlite3")
        engine = Engine(ledger, clock=lambda: now[0])
        engine.submit(job)
        for turn in range(6):
            tasks = engine.dispatch("mock_parent_" + str(turn))["tasks"]
            if not tasks:
                break
            for i, task in enumerate(tasks):
                now[0] += 1
                engine.start(task["ticket_id"], "MOCK_CHILD_" + str(turn) + "_" + str(i))
            for i, task in enumerate(tasks):
                current = ledger.get(job["job_id"])
                reviewer = task["reviewer"]
                if reviewer == "reviser":
                    response = {"schema_version": "lk-cross-review-revision/1.0", **{k: current[k] for k in ("job_id", "snapshot_id", "manifest_hash", "artifact_version", "artifact_hash")},
                                "reviewer": reviewer,
                                "artifact_text": canonical({"schema_version": "lk-owner-comparison/1.0", "rows": current["rule_input"]["reference_rows"]}),
                                "changes": ["Swap the two incorrect draft owner amounts back to their frozen source values."]}
                elif reviewer == "gpt":
                    findings = [f for t in ledger.tasks(job["job_id"]) if t["artifact_version"] == current["artifact_version"] and t["reviewer"] in ("claude", "gemini") for f in t["result"]["findings"]]
                    findings += current["rules"]["issues"]
                    decisions = [{"finding_id": f["finding_id"], "decision": "adopt", "reason": "The original owner-specific evidence shows the exact difference.",
                                  "counterargument": "The overall total is unchanged; per-owner values are different.",
                                  "additional_evidence": [], "action": "Revise and reverify both reviewers and GPT.",
                                  "evidence": [copy.deepcopy(current["rule_input"]["reference_rows"][0]["evidence"])]} for f in findings]
                    response = make_response(current, reviewer, decisions=decisions)
                    response["revision_needed"] = mismatch and current["artifact_version"] == 1
                else:
                    response = make_response(current, reviewer, findings=[finding(current)] if mismatch and current["artifact_version"] == 1 else [])
                now[0] += 1
                engine.complete_mock(task["ticket_id"], "MOCK_CHILD_" + str(turn) + "_" + str(i), response)
        final = ledger.get(job["job_id"])
        if final["artifact_version"] > 1:
            # Synthetic mapping only: actual revised exports require a handoff
            # created in the real BSO saved revision, which is not done here.
            mapping = {"document_id": "WORK_DOC_1", "revision": final["artifact_version"], "artifact_sha256": final["artifact_hash"],
                       "job_id": "BSO_SYNTHETIC_REVISED", "input_sha256": digest("Synthetic revised handoff")}
            ledger.update(job["job_id"], lambda j: j.update(bso_mapping=mapping))
        summary = engine.summary(job["job_id"])
        if summary["state"] != "READY_FOR_HUMAN":
            raise ValueError("SYNTHETIC_PIPELINE_DID_NOT_COMPLETE")
        package = build_bso_package(ledger.get(job["job_id"]), summary)
        delivery = export_new(folder / (label.lower() + "-bso-package.json"), package)
        report = {"evidence_mode": "MOCK", "actual_provider_calls": 0, "actual_bso_auto_writes": 0,
                  "actual_free_credit_balances": "UNVERIFIED", "actual_billed_cost": None,
                  "summary": summary, "bso_export": delivery,
                  "source_hashes": job["input_refs"],
                  "artifact_versions": [{"version": h["artifact_version"], "sha256": h["artifact_hash"]} for h in final["history"]] + [{"version": final["artifact_version"], "sha256": final["artifact_hash"]}],
                  "simulated_receipts": [{"ticket_id": t["ticket_id"], "reviewer": t["reviewer"], "artifact_version": t["artifact_version"], "receipt": t.get("receipt")} for t in ledger.tasks(job["job_id"])]}
        (folder / (label.lower() + "-mock-evidence.json")).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        return {"scenario": label, "state": summary["state"], "simulated_attempts": len(ledger.tasks(job["job_id"])), "artifact_version": final["artifact_version"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output_directory", help="New directory; existing files are never overwritten")
    args = parser.parse_args()
    folder = Path(args.output_directory)
    folder.mkdir(parents=True, exist_ok=False)
    results = [scenario(folder, mismatch=False), scenario(folder, mismatch=True)]
    print(json.dumps({"evidence_mode": "MOCK", "actual_provider_calls": 0, "results": results}))


if __name__ == "__main__":
    main()
