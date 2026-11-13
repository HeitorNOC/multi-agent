"""Independent HTTP destination and adapter journal. No product connector is enabled."""

import hmac
import hashlib
import json
import secrets
import sqlite3
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing, contextmanager
from http.client import RemoteDisconnected
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest
from reference_destination import encode, fingerprint

DESTINATION = Path(__file__).with_name("reference_destination.py")
ROOT = DESTINATION.parents[2]


def call(url, key, action, body):
    raw = encode(body)
    path = "/" + action
    signature = hmac.digest(key, path.encode() + b"\n" + raw, "sha256").hex()
    request = Request(url + path, raw, {"X-Signature": signature})
    try:
        response = urlopen(request, timeout=12)
    except HTTPError as error:
        response = error
    with response:
        return response.status, json.load(response)


@contextmanager
def destination(config):
    with subprocess.Popen(
        [sys.executable, "-X", "utf8", str(DESTINATION)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        encoding="utf-8",
    ) as server:
        try:
            server.stdin.write(json.dumps(config) + "\n")
            server.stdin.close()
            startup = server.stdout.readline()
            assert startup, "Destino não iniciou"
            yield f"http://127.0.0.1:{json.loads(startup)['port']}"
        finally:
            server.terminate()
            server.wait(timeout=10)


class AdapterJournal:
    def __init__(self, path, url, key):
        self.path, self.url, self.key = path, url, key
        with closing(sqlite3.connect(path)) as db, db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY, digest TEXT, state TEXT, receipt TEXT)"
            )

    def dispatch(self, intent):
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute(
                "INSERT INTO deliveries VALUES(?,?,'unknown',NULL)",
                (intent["id"], fingerprint(intent)),
            )
        status, result = call(self.url, self.key, "send", {"intent": intent})
        if status == 200:
            self.confirm(intent, result["receipt"])
        return status, result

    def state(self, intent):
        with closing(sqlite3.connect(self.path)) as db:
            return db.execute(
                "SELECT state,receipt FROM deliveries WHERE id=? AND digest=?",
                (intent["id"], fingerprint(intent)),
            ).fetchone()

    def reconcile(self, intent):
        assert self.state(intent), "Intenção local não registrada"
        status, result = call(self.url, self.key, "lookup", {"intent": intent})
        assert status == 200
        if result["receipt"]:
            self.confirm(intent, result["receipt"])
        return result["receipt"]

    def confirm(self, intent, receipt):
        assert receipt["intent"] == intent["id"] and receipt["digest"] == fingerprint(
            intent
        )
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute(
                "UPDATE deliveries SET state='confirmed',receipt=? WHERE id=? AND digest=?",
                (json.dumps(receipt), intent["id"], fingerprint(intent)),
            )


def intent(id_, scope, *, epoch=1):
    return {
        "id": id_,
        "scope": scope,
        "epoch": epoch,
        "payload": {"operation": "record_fixture", "value": 15},
    }


def test_external_destination_revocation_and_lost_receipt(tmp_path):
    control, executor = secrets.token_bytes(32), secrets.token_bytes(32)
    remote_db = tmp_path / "destination.sqlite"
    journal = tmp_path / "adapter.sqlite"
    before = intent("wait-before-effect", "scope-before")
    after = intent("lose-after-commit", "scope-after")
    another = intent("another-after-revocation", "scope-after")
    unknown = intent("lose-before-commit", "scope-unknown")
    repeated = intent("concurrent-repetition", "scope-repetition")
    config = {
        "database": str(remote_db),
        "controller": control.hex(),
        "executor": executor.hex(),
        "hold_intent": before["id"],
        "drop_intent": after["id"],
        "drop_before_intent": unknown["id"],
    }
    with destination(config) as url:
        for item in (before, after, another, repeated, unknown):
            assert call(url, control, "grant", {"intent": item}) == (
                200,
                {"granted": True},
            )
        assert call(url, executor, "revoke", {"scope": before["scope"]})[0] == 403
        with ThreadPoolExecutor(max_workers=2) as pool:
            inflight = pool.submit(call, url, executor, "send", {"intent": before})
            try:
                assert call(url, control, "arrived", {}) == (200, {"arrived": True})
                assert call(url, control, "revoke", {"scope": before["scope"]}) == (
                    200,
                    {"revoked": True},
                )
            finally:
                assert call(url, control, "release", {})[0] == 200
            assert inflight.result() == (
                409,
                {"error": "authorization_revoked_or_stale"},
            )
            assert call(url, executor, "lookup", {"intent": before}) == (
                200,
                {"receipt": None},
            )
            duplicates = [
                pool.submit(call, url, executor, "send", {"intent": repeated})
                for _ in range(2)
            ]
            first, second = [task.result() for task in duplicates]
            assert first == second and first[0] == 200 and first[1]["receipt"]

        client = AdapterJournal(journal, url, executor)
        with pytest.raises(RemoteDisconnected):
            client.dispatch(after)
        assert client.state(after) == ("unknown", None)
        with pytest.raises(RemoteDisconnected):
            client.dispatch(unknown)
        assert client.state(unknown) == ("unknown", None)
        assert call(url, control, "revoke", {"scope": after["scope"]}) == (
            200,
            {"revoked": True},
        )

    with destination(config) as restarted_url:
        reopened = AdapterJournal(journal, restarted_url, executor)
        receipt = reopened.reconcile(after)
        assert receipt and reopened.state(after) == ("confirmed", json.dumps(receipt))
        assert reopened.reconcile(unknown) is None
        assert reopened.state(unknown) == ("unknown", None)
        with pytest.raises(sqlite3.IntegrityError):
            reopened.dispatch(unknown)
        assert call(restarted_url, executor, "send", {"intent": after}) == (
            200,
            {"receipt": receipt},
        )
        assert call(restarted_url, executor, "send", {"intent": another}) == (
            409,
            {"error": "authorization_revoked_or_stale"},
        )
        changed = {**after, "payload": {**after["payload"], "value": 99}}
        assert call(restarted_url, executor, "send", {"intent": changed}) == (
            409,
            {"error": "intent_conflict"},
        )
        stale = intent("stale-epoch", repeated["scope"], epoch=0)
        assert call(restarted_url, control, "grant", {"intent": stale}) == (
            409,
            {"error": "authorization_revoked_or_stale"},
        )

    with closing(sqlite3.connect(remote_db)) as db:
        assert db.execute("SELECT id FROM effects ORDER BY id").fetchall() == [
            (repeated["id"],),
            (after["id"],),
        ]
        assert db.execute("SELECT scope,kind FROM events ORDER BY seq").fetchall() == [
            ("scope-before", "revoked"),
            ("scope-repetition", "effect"),
            ("scope-after", "effect"),
            ("scope-after", "revoked"),
        ]


def test_upstream_revocation_requires_destination_confirmation(tmp_path):
    control, executor = secrets.token_bytes(32), secrets.token_bytes(32)
    config = {
        "database": str(tmp_path / "destination.sqlite"),
        "controller": control.hex(),
        "executor": executor.hex(),
    }
    first = intent("in-transit", "scope-sync")
    second = intent("after-acknowledgment", first["scope"])
    with destination(config) as url:
        for item in (first, second):
            assert call(url, control, "grant", {"intent": item})[0] == 200
        with (
            closing(sqlite3.connect(tmp_path / "upstream.sqlite")) as upstream,
            upstream,
        ):
            upstream.execute("CREATE TABLE revocations(scope TEXT PRIMARY KEY)")
            upstream.execute("INSERT INTO revocations VALUES(?)", (first["scope"],))
        # No revocation has reached the destination yet.
        status, committed = call(url, executor, "send", {"intent": first})
        assert status == 200 and committed["receipt"]
        assert call(url, control, "revoke", {"scope": first["scope"]}) == (
            200,
            {"revoked": True},
        )
        assert call(url, executor, "send", {"intent": second}) == (
            409,
            {"error": "authorization_revoked_or_stale"},
        )
        assert call(url, executor, "lookup", {"intent": first}) == (200, committed)


@contextmanager
def controlled_reference_backend():
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            replies = {
                "status": {"phase": "ready", "usage": {"calls": 0}},
                "model_job_status": {"status": "resumable"},
                "pilot_recheck_reference": {"ok": True},
                "pilot_report": {
                    "citations": [{"source": "politica", "version": 1}],
                    "reference_check": {
                        "status": "confirmed",
                        "issuer": "financeiro-ficticio",
                        "field": "refund_deadline_business_days",
                        "version": 1,
                    },
                },
            }
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(encode(replies.get(request["action"], {})))

    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as backend:
        thread = threading.Thread(target=backend.serve_forever, daemon=True)
        thread.start()
        try:
            yield f"http://127.0.0.1:{backend.server_port}"
        finally:
            backend.shutdown()
            thread.join(timeout=3)


@contextmanager
def aurora_api(config):
    with subprocess.Popen(
        ["node", str(ROOT / "demo/server.ts")],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        cwd=ROOT,
        encoding="utf-8",
    ) as api:
        try:
            api.stdin.write(json.dumps(config))
            api.stdin.close()
            startup = api.stdout.readline()
            assert startup, "API não iniciou"
            url = json.loads(startup)["url"]
            cookie = None

            def request(path, data=None):
                headers = {
                    "Content-Type": "application/json",
                    **({"Cookie": cookie} if cookie else {}),
                }
                req = Request(
                    url + path, None if data is None else encode(data), headers
                )
                try:
                    response = urlopen(req, timeout=12)
                except HTTPError as error:
                    response = error
                with response:
                    return response.status, json.load(response), response.headers

            status, _, headers = request(
                "/api/pilot/login",
                {"id": "operador", "password": "laboratorio-conector-ficticio"},
            )
            assert status == 200
            cookie = headers["Set-Cookie"].split(";", 1)[0]

            def wait_for_job(id_, state):
                deadline = time.monotonic() + 10
                while time.monotonic() < deadline:
                    code, snapshot, _ = request("/api/state")
                    assert code == 200
                    job = next(item for item in snapshot["jobs"] if item["id"] == id_)
                    if job["status"] == state and not job["worker_active"]:
                        return job
                    time.sleep(0.05)
                raise AssertionError(f"Estado {state} não alcançado")

            yield request, wait_for_job
        finally:
            api.terminate()
            api.wait(timeout=10)


def test_aurora_persists_pending_revocation_and_reconciles_without_redispatch(tmp_path):
    control, executor = secrets.token_bytes(32), secrets.token_bytes(32)
    scope = encode(
        ["financeiro-ficticio", "refund_deadline_business_days", "politica", 1]
    ).decode()
    state = tmp_path / "aurora-state"
    remote_db = tmp_path / "destination.sqlite"
    destination_config = {
        "database": str(remote_db),
        "controller": control.hex(),
        "executor": executor.hex(),
        "drop_revoke_scope": scope,
        "drop_send_scope": scope,
    }
    salt = secrets.token_bytes(16)
    verifier = hashlib.scrypt(
        b"laboratorio-conector-ficticio", salt=salt, n=16384, r=8, p=1, dklen=32
    )
    with (
        destination(destination_config) as target,
        controlled_reference_backend() as backend,
    ):
        api_config = {
            "root": str(ROOT),
            "state": str(state),
            "backend": backend,
            "token": secrets.token_hex(32),
            "queueCapacity": 4,
            "governedModelSlots": True,
            "python": sys.executable,
            "worker": str(DESTINATION.with_name("fixture_reference_worker.py")),
            "policyModule": (ROOT / "apps/aurora/domain/pilot-policy.ts").as_uri(),
            "pilotRefundReference": True,
            "pilotExpiresAt": int(time.time() * 1000) + 600000,
            "pilotAccounts": [
                {
                    "id": "operador",
                    "role": "operator",
                    "salt": salt.hex(),
                    "verifier": verifier.hex(),
                }
            ],
            "pilotDestination": {
                "url": target,
                "controller": control.hex(),
                "executor": executor.hex(),
            },
        }
        with aurora_api(api_config) as (request, wait_for_job):
            code, created, _ = request(
                "/api/jobs", {"goal": "Ensaio do conector descartável"}
            )
            assert code == 202
            job = wait_for_job(created["id"], "awaiting_approval")
            review = job["review"]
            exact = {
                "id": review["hash"],
                "scope": scope,
                "epoch": 1,
                "payload": review["payload"],
            }
            assert call(target, control, "grant", {"intent": exact}) == (
                200,
                {"granted": True},
            )
            assert (
                request(f"/api/jobs/{job['id']}/approve", {"hash": review["hash"]})[0]
                == 202
            )
            failed = wait_for_job(job["id"], "failed")
            assert failed["receipt"] is None
            command = {"job": job["id"], "hash": review["hash"]}
            code, reply, _ = request("/api/pilot/revoke-reference", command)
            assert code == 202 and reply["destination"] == "pending"
            assert request("/api/pilot/stop", {})[0] == 409

        with closing(sqlite3.connect(state / "journey.sqlite")) as db:
            assert db.execute(
                "SELECT acknowledged FROM pilot_destination_revocations"
            ).fetchall() == [(0,)]
            assert db.execute(
                "SELECT count(*) FROM pilot_destination_intents"
            ).fetchone() == (1,)

        with aurora_api(api_config) as (request, wait_for_job):
            code, reply, _ = request("/api/pilot/revoke-reference", command)
            assert code == 200 and reply == {
                "revoked": True,
                "repeated": True,
                "destination": "acknowledged",
            }
            code, reply, _ = request("/api/pilot/connector/reconcile", command)
            assert code == 200 and reply["status"] == "confirmed"
            assert request(f"/api/jobs/{job['id']}/resume", {})[0] == 202
            completed = wait_for_job(job["id"], "completed")
            assert completed["receipt"] == reply["receipt"]
            assert (
                sum(
                    e["node"] == "destination_revocation_acknowledged"
                    for e in completed["events"]
                )
                == 1
            )

    with (
        closing(sqlite3.connect(state / "journey.sqlite")) as db,
        closing(sqlite3.connect(remote_db)) as remote,
    ):
        assert db.execute(
            "SELECT acknowledged FROM pilot_destination_revocations"
        ).fetchall() == [(1,)]
        assert db.execute("SELECT count(*) FROM effects").fetchone() == (1,)
        assert remote.execute("SELECT count(*) FROM effects").fetchone() == (1,)
        assert remote.execute(
            "SELECT action FROM requests ORDER BY rowid"
        ).fetchall() == [("send",), ("lookup",)]
