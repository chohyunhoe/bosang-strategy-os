"""Authenticated loopback bridge for inactive n8n templates; no provider HTTP here."""
from __future__ import annotations

import argparse
import hmac
import json
import os
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .bso import build_bso_package
from .engine import Engine, safe_code
from .ledger import Ledger


class RunnerServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, engine, token):
        if address[0] != "127.0.0.1" or not isinstance(token, str) or len(token) < 32:
            raise ValueError("LOOPBACK_AND_STRONG_RUNNER_TOKEN_REQUIRED")
        self.engine, self.token, self.guard = engine, token, threading.RLock()
        super().__init__(address, Handler)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "LKRunner/1.0"

    def log_message(self, *_args):
        # Requests may contain case identifiers. Do not send them to stdout.
        pass

    def _reply(self, status, value):
        body = json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)
        self.close_connection = True

    def _authorized(self):
        expected_host = "127.0.0.1:" + str(self.server.server_port)
        return (self.headers.get("Host") == expected_host
                and not self.headers.get("Origin")
                and self.headers.get("Sec-Fetch-Site") not in ("cross-site", "same-site")
                and hmac.compare_digest(self.headers.get("X-LK-Runner-Token", ""), self.server.token))

    def _handle(self, post=False):
        self.connection.settimeout(10)
        if not self._authorized():
            return self._reply(403, {"error_code": "RUNNER_AUTH_REQUIRED"})
        try:
            payload = {}
            if post:
                if self.headers.get("Transfer-Encoding") or not self.headers.get("Content-Type", "").startswith("application/json"):
                    raise ValueError("JSON_BODY_REQUIRED")
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0 or length > 8 * 1024 * 1024:
                    return self._reply(413, {"error_code": "REQUEST_SIZE_LIMIT"})
                raw = self.rfile.read(length)
                if len(raw) != length:
                    raise ValueError("INCOMPLETE_REQUEST")
                payload = json.loads(raw, parse_constant=lambda _: (_ for _ in ()).throw(ValueError("JSON_INVALID")))
                if not isinstance(payload, dict):
                    raise ValueError("JSON_OBJECT_REQUIRED")
            # No external network call occurs under this short local lock.
            # Provider executions proceed independently in n8n child runs.
            with self.server.guard:
                engine = self.server.engine
                if self.path == "/health" and not post:
                    result = {"status": "READY", "mode": engine.mode, "funding": "FREE_CREDITS_ONLY",
                              "provider_network_in_runner": False, "bso_auto_sync": False}
                elif self.path.startswith("/jobs/") and not post:
                    job_id = self.path[len("/jobs/"):]
                    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", job_id):
                        raise ValueError("JOB_IDENTIFIER")
                    result = engine.summary(job_id)
                elif self.path == "/jobs" and post:
                    result = engine.submit(payload)
                elif self.path in ("/dispatch", "/start", "/complete", "/fail") and post:
                    # A mock server can never hand real provider requests to n8n.
                    if engine.mode != "live":
                        raise ValueError("MOCK_TRANSPORT_DISABLED")
                    if self.path == "/dispatch":
                        result = engine.dispatch(payload.get("owner"))
                    elif self.path == "/start":
                        result = engine.start(payload["ticket_id"], payload["execution_id"])
                    elif self.path == "/complete":
                        result = engine.complete(payload["ticket_id"], payload["execution_id"], payload["provider_response"])
                    else:
                        # HTTP errors without a response envelope are financially
                        # ambiguous. Caller assertions cannot make retries safe.
                        result = engine.fail(payload["ticket_id"], payload["execution_id"],
                                             payload.get("error_code", "TRANSPORT_FAILED"), uncertain=True)
                elif self.path == "/watchdog" and post:
                    recovered = engine.ledger.recover(engine.clock())
                    result = {"recovered": [{"job_id": j["job_id"], "state": j["state"]} for j in recovered]}
                elif self.path == "/resume" and post:
                    result = engine.resume(payload["job_id"])
                elif self.path == "/bso-export" and post:
                    result = build_bso_package(engine.ledger.get(payload["job_id"]), engine.summary(payload["job_id"]))
                else:
                    return self._reply(404, {"error_code": "ROUTE_NOT_FOUND"})
            self._reply(200, result)
        except (ValueError, KeyError, TypeError, OverflowError) as error:
            self._reply(422, {"error_code": safe_code(error)})
        except Exception:
            self._reply(500, {"error_code": "RUNNER_OPERATION_FAILED"})

    def do_GET(self):
        self._handle()

    def do_POST(self):
        self._handle(post=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default="n8n-private/cross-review.sqlite3")
    parser.add_argument("--port", type=int, default=8791)
    parser.add_argument("--mode", choices=("mock", "live"), default="mock")
    parser.add_argument("--installation", help="Private verified n8n credential/model-cost metadata JSON")
    parser.add_argument("--credit-proofs", help="Private operator-verified free-credit metadata JSON array")
    args = parser.parse_args()
    token = os.environ.get("LK_CROSS_REVIEW_TOKEN", "")
    if len(token) < 32:
        parser.error("LK_CROSS_REVIEW_TOKEN must be supplied securely (minimum 32 characters)")
    os.umask(0o077)
    ledger = Ledger(args.db)
    installation = json.loads(Path(args.installation).read_text()) if args.installation else {}
    if args.credit_proofs:
        for proof in json.loads(Path(args.credit_proofs).read_text()):
            ledger.configure_credit(**proof)
    engine = Engine(ledger, mode=args.mode, installation=installation)
    server = RunnerServer(("127.0.0.1", args.port), engine, token)
    print(json.dumps({"status": "LISTENING", "mode": args.mode, "funding": "FREE_CREDITS_ONLY", "port": server.server_port}))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
