"""Disposable destination with independent authority and a transactional effect ledger."""

import hashlib
import hmac
import json
import secrets
import sqlite3
import sys
import threading
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def encode(value):
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode()


def fingerprint(intent):
    return hashlib.sha256(encode(intent)).hexdigest()


class Refused(Exception):
    pass


def operate(db, action, data):
    if action == "revoke":
        scope = data["scope"]
        changed = db.execute(
            "UPDATE scopes SET revoked=1 WHERE scope=? AND revoked=0", (scope,)
        )
        if changed.rowcount:
            db.execute("INSERT INTO events(scope, kind) VALUES(?, 'revoked')", (scope,))
        return {
            "revoked": bool(
                db.execute(
                    "SELECT 1 FROM scopes WHERE scope=? AND revoked=1", (scope,)
                ).fetchone()
            )
        }, bool(changed.rowcount)

    intent = data["intent"]
    if (
        set(intent) != {"id", "scope", "epoch", "payload"}
        or type(intent["epoch"]) is not int
    ):
        raise Refused("invalid_intent")
    key, scope, epoch = intent["id"], intent["scope"], intent["epoch"]
    digest = fingerprint(intent)
    grant = db.execute("SELECT digest FROM grants WHERE id=?", (key,)).fetchone()
    if grant and grant[0] != digest:
        raise Refused("intent_conflict")
    if action == "grant":
        db.execute("INSERT OR IGNORE INTO scopes VALUES(?,?,0)", (scope, epoch))
        current = db.execute(
            "SELECT epoch,revoked FROM scopes WHERE scope=?", (scope,)
        ).fetchone()
        if current != (epoch, 0):
            raise Refused("authorization_revoked_or_stale")
        db.execute("INSERT OR IGNORE INTO grants VALUES(?,?)", (key, digest))
        return {"granted": True}, False
    if not grant:
        raise Refused("intent_not_granted")

    existing = db.execute("SELECT receipt FROM effects WHERE id=?", (key,)).fetchone()
    if existing or action == "lookup":
        return {"receipt": json.loads(existing[0]) if existing else None}, False
    current = db.execute(
        "SELECT epoch,revoked FROM scopes WHERE scope=?", (scope,)
    ).fetchone()
    if current != (epoch, 0):
        raise Refused("authorization_revoked_or_stale")
    receipt = {
        "id": secrets.token_hex(16),
        "intent": key,
        "digest": digest,
        "simulated": True,
    }
    db.execute("INSERT INTO effects VALUES(?,?,?)", (key, scope, json.dumps(receipt)))
    db.execute("INSERT INTO events(scope,kind) VALUES(?, 'effect')", (scope,))
    return {"receipt": receipt}, True


def main(config):
    with closing(sqlite3.connect(config["database"])) as db, db:
        db.executescript("""PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS scopes(scope TEXT PRIMARY KEY, epoch INT, revoked INT);
            CREATE TABLE IF NOT EXISTS grants(id TEXT PRIMARY KEY, digest TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS effects(id TEXT PRIMARY KEY, scope TEXT NOT NULL, receipt TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS requests(action TEXT, intent TEXT);
            CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY, scope TEXT, kind TEXT);""")
    arrived, release = threading.Event(), threading.Event()
    drop_before = {config.get("drop_before_intent")}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def respond(self, status, result):
            body = encode(result)
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            action = self.path.removeprefix("/")
            if action not in {
                "send",
                "lookup",
                "grant",
                "revoke",
                "arrived",
                "release",
                "arm-before",
            }:
                return self.respond(404, {"error": "unknown_route"})
            role = "executor" if action in {"send", "lookup"} else "controller"
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 8192:
                    return self.respond(400, {"error": "invalid_size"})
                raw = self.rfile.read(size)
                signature = hmac.digest(
                    bytes.fromhex(config[role]),
                    self.path.encode() + b"\n" + raw,
                    "sha256",
                ).hex()
                if not hmac.compare_digest(
                    signature, self.headers.get("X-Signature", "")
                ):
                    return self.respond(403, {"error": "invalid_signature"})
                if action == "arrived":
                    return self.respond(200, {"arrived": arrived.wait(5)})
                if action == "release":
                    release.set()
                    return self.respond(200, {"released": True})
                data = json.loads(raw)
                if action == "arm-before":
                    drop_before.add(data["id"])
                    return self.respond(200, {"armed": True})
                if action == "send" and data["intent"]["id"] in drop_before:
                    with closing(sqlite3.connect(config["database"])) as db, db:
                        db.execute(
                            "INSERT INTO requests VALUES('send',?)",
                            (data["intent"]["id"],),
                        )
                    return
                if action == "send" and data["intent"]["id"] == config.get(
                    "hold_intent"
                ):
                    arrived.set()
                    if not release.wait(10):
                        return self.respond(503, {"error": "fixture_barrier_timeout"})
                with closing(sqlite3.connect(config["database"], timeout=5)) as db, db:
                    db.execute("PRAGMA synchronous=FULL")
                    db.execute("BEGIN IMMEDIATE")
                    result, inserted = operate(db, action, data)
                    if action in {"send", "lookup"}:
                        db.execute(
                            "INSERT INTO requests VALUES(?,?)",
                            (action, data["intent"]["id"]),
                        )
                if (
                    inserted
                    and action == "revoke"
                    and data["scope"] == config.get("drop_revoke_scope")
                ):
                    return
                if (
                    inserted
                    and action == "send"
                    and (
                        data["intent"]["id"] == config.get("drop_intent")
                        or data["intent"]["scope"] == config.get("drop_send_scope")
                    )
                ):
                    return  # A committed effect with no HTTP receipt delivered.
                if (
                    inserted
                    and action == "send"
                    and data["intent"]["scope"] == config.get("hold_after_commit_scope")
                ):
                    arrived.set()
                    release.wait(15)
                    return
                return self.respond(200, result)
            except Refused as error:
                return self.respond(409, {"error": str(error)})
            except (KeyError, TypeError, ValueError, sqlite3.IntegrityError):
                return self.respond(400, {"error": "invalid_request"})

    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        print(json.dumps({"port": server.server_port}), flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main(json.loads(sys.stdin.readline()))
