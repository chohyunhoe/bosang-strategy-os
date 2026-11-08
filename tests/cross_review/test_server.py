import http.client
import json
import tempfile
import threading
import unittest

from integrations.n8n.cross_review.engine import Engine
from integrations.n8n.cross_review.ledger import Ledger
from integrations.n8n.cross_review.server import RunnerServer
from tests.cross_review.fixtures import make_job


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory()
        cls.engine = Engine(Ledger(cls.folder.name + "/runner.sqlite3"))
        cls.token = "synthetic-runner-test-secret-never-a-provider-key"
        cls.server = RunnerServer(("127.0.0.1", 0), cls.engine, cls.token)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)
        cls.folder.cleanup()

    def request(self, method, path, body=None, auth=True, extra=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        headers = {"Content-Type": "application/json"}
        if auth:
            headers["X-LK-Runner-Token"] = self.token
        headers.update(extra or {})
        conn.request(method, path, body=json.dumps(body).encode() if body is not None else None, headers=headers)
        response = conn.getresponse()
        status, data = response.status, json.loads(response.read())
        conn.close()
        return status, data

    def test_auth_and_browser_origin_fail_closed(self):
        self.assertEqual(self.request("GET", "/health", auth=False)[0], 403)
        self.assertEqual(self.request("GET", "/health", extra={"Origin": "https://example.invalid"})[0], 403)
        status, health = self.request("GET", "/health")
        self.assertEqual(status, 200)
        self.assertFalse(health["provider_network_in_runner"])
        self.assertFalse(health["bso_auto_sync"])

    def test_mock_http_cannot_dispatch_real_provider_tasks(self):
        status, data = self.request("POST", "/dispatch", {"owner": "parent"})
        self.assertEqual(status, 422)
        self.assertEqual(data["error_code"], "MOCK_TRANSPORT_DISABLED")

    def test_job_submit_read_idempotence_and_conflict(self):
        job = make_job("HTTP_SYNTHETIC")
        status, first = self.request("POST", "/jobs", job)
        self.assertEqual(status, 200)
        self.assertTrue(first["created"])
        self.assertFalse(self.request("POST", "/jobs", job)[1]["created"])
        self.assertEqual(self.request("GET", "/jobs/HTTP_SYNTHETIC")[1]["state"], "READY")
        job["approval_scope"]["purpose"] = "Different input, same ID"
        self.assertEqual(self.request("POST", "/jobs", job)[1]["error_code"], "JOB_ID_INPUT_CONFLICT")

    def test_error_messages_never_echo_unknown_secret_input(self):
        job = make_job("BAD_HTTP_SYNTHETIC")
        job["authorization"] = "synthetic-sentinel-must-never-leave-error-response"
        status, error = self.request("POST", "/jobs", job)
        self.assertEqual(status, 422)
        self.assertNotIn("synthetic-sentinel", json.dumps(error))
        self.assertNotIn(self.token, json.dumps(error))

    def test_weak_secret_and_non_loopback_binding_rejected(self):
        with self.assertRaisesRegex(ValueError, "LOOPBACK_AND_STRONG_RUNNER_TOKEN_REQUIRED"):
            RunnerServer(("0.0.0.0", 0), self.engine, self.token)
        with self.assertRaises(ValueError):
            RunnerServer(("127.0.0.1", 0), self.engine, "short")


if __name__ == "__main__":
    unittest.main()
