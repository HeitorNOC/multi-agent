"""Retained authority fixture. Independent process/store/key, not part of customer bundle."""

import hashlib
import hmac
import json
import sqlite3
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def dump(v):
    return json.dumps(v, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str)


def sha(v):
    return hashlib.sha256(dump(v).encode()).hexdigest()


class Store:
    def __init__(self, path, installation, private, caps=None):
        self.path = path
        self.installation = installation
        self.key = Ed25519PrivateKey.from_private_bytes(bytes.fromhex(private))
        self.lock = threading.Lock()
        self.caps = caps or {"model": 40, "stress": 7}
        with sqlite3.connect(path) as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute(
                "CREATE TABLE IF NOT EXISTS operations(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE,kind TEXT,input_sha TEXT,receipt_sha TEXT,context_json TEXT NOT NULL,outcome TEXT)"
            )
            db.execute(
                "CREATE TABLE IF NOT EXISTS reservations(scope TEXT,id TEXT,number INTEGER,PRIMARY KEY(scope,id),UNIQUE(scope,number))"
            )
            db.execute(
                "CREATE TABLE IF NOT EXISTS job_reservations(scope TEXT,id TEXT,units INTEGER,input_sha TEXT,PRIMARY KEY(scope,id))"
            )
            db.execute(
                "CREATE TABLE IF NOT EXISTS recovery_votes(operation_id TEXT,actor TEXT,evidence_sha TEXT,reason TEXT,PRIMARY KEY(operation_id,actor))"
            )
            db.execute(
                "CREATE TABLE IF NOT EXISTS backup_witnesses(id TEXT PRIMARY KEY,manifest_sha TEXT,head TEXT,inventory_sha TEXT,snapshot_sha TEXT)"
            )
            db.execute(
                "CREATE TABLE IF NOT EXISTS model_slots(id TEXT PRIMARY KEY,context_json TEXT NOT NULL,state TEXT NOT NULL,receipt_sha TEXT)"
            )

    def model_slot(self, db, p):
        action = p["action"]
        fields = {
            "model_slot_list": set(),
            "model_slot_admit": {"id", "context", "limit"},
            "model_slot_commit": {"id", "receipt_sha"},
            "model_slot_propose": {"id", "actor", "evidence_sha", "reason"},
            "model_slot_confirm": {"id", "actor", "evidence_sha"},
        }
        if (
            action not in fields
            or set(p) != fields[action] | {"action", "nonce", "issued"}
            or "model" not in self.caps
        ):
            raise ValueError("model slot contract")
        if action == "model_slot_list":
            return False
        id = p["id"]
        row = db.execute("SELECT * FROM model_slots WHERE id=?", (id,)).fetchone()
        if action == "model_slot_admit":
            context = p["context"]
            limit = p["limit"]
            if (
                set(context) != {"installation", "job", "slot", "input_sha", "owner"}
                or context["installation"] != self.installation
                or id != self.installation + ":model:" + sha([context["job"], context["slot"]])
            ):
                raise ValueError("model slot identity mismatch")
            if row:
                if row["context_json"] != dump(context):
                    raise ValueError("model slot input bound")
                return False
            if db.execute(
                "SELECT 1 FROM model_slots WHERE state='closed_unknown' AND json_extract(context_json,'$.job')=?",
                (context["job"],),
            ).fetchone():
                raise ValueError("model job closed as unknown")
            used = db.execute(
                "SELECT count(*) FROM model_slots WHERE json_extract(context_json,'$.job')=?",
                (context["job"],),
            ).fetchone()[0]
            max_limit = 11 if context["slot"] in (
                "citation_verification", "engineering:director_review:2"
            ) else 10
            from apps.aurora.runtime.subdelegation import TEAM_MODEL_LIMIT, TEAM_MODEL_PREFIX

            if context["slot"].startswith(TEAM_MODEL_PREFIX):
                max_limit = TEAM_MODEL_LIMIT
            if type(limit) is not int or not 1 <= limit <= max_limit or used >= limit:
                raise ValueError("job model cap exhausted")
            number = db.execute(
                "SELECT coalesce(max(number),0)+1 FROM reservations WHERE scope='model'"
            ).fetchone()[0]
            jobs = db.execute(
                "SELECT coalesce(sum(units),0) FROM job_reservations WHERE scope='model'"
            ).fetchone()[0]
            if number + jobs > self.caps["model"]:
                raise ValueError("model cap exhausted")
            db.execute("INSERT INTO reservations VALUES('model',?,?)", (id, number))
            db.execute("INSERT INTO model_slots VALUES(?,?,'admitted',NULL)", (id, dump(context)))
            return True
        if not row:
            raise ValueError("model slot not found")
        if action == "model_slot_commit":
            if row["state"] == "closed_unknown" or row["receipt_sha"] not in (
                None,
                p["receipt_sha"],
            ):
                raise ValueError("model receipt mismatch")
            db.execute(
                "UPDATE model_slots SET state='completed',receipt_sha=? WHERE id=?",
                (p["receipt_sha"], id),
            )
            return False
        context = json.loads(row["context_json"])
        actor = p["actor"]
        evidence = sha({"id": id, "context": context, "outcome": "unknown_not_reexecuted"})
        if (
            actor == context["owner"]
            or p["evidence_sha"] != evidence
            or row["state"] == "completed"
        ):
            raise ValueError("model recovery evidence or identity mismatch")
        votes = db.execute(
            "SELECT * FROM recovery_votes WHERE operation_id=? ORDER BY rowid", (id,)
        ).fetchall()
        if action == "model_slot_propose":
            reason = p["reason"]
            if not isinstance(reason, str) or not 20 <= len(reason) <= 500:
                raise ValueError("review reason required")
            if votes and (votes[0]["actor"] != actor or votes[0]["reason"] != reason):
                raise ValueError("model review immutable")
        else:
            if (
                not votes
                or votes[0]["actor"] == actor
                or len(votes) > 1
                and votes[1]["actor"] != actor
            ):
                raise ValueError("independent second reviewer required")
            reason = votes[0]["reason"]
        db.execute(
            "INSERT OR IGNORE INTO recovery_votes VALUES(?,?,?,?)", (id, actor, evidence, reason)
        )
        if action == "model_slot_confirm":
            db.execute("UPDATE model_slots SET state='closed_unknown' WHERE id=?", (id,))
        return False

    def execute(self, p):
        with self.lock, sqlite3.connect(self.path) as db:
            db.execute("PRAGMA synchronous=FULL")
            db.row_factory = sqlite3.Row
            model_action = p["action"].startswith("model_slot_")
            claimed = False
            if model_action:
                claimed = self.model_slot(db, p)
            elif p["action"] == "begin":
                if set(p) != {"action", "id", "kind", "input_sha", "context", "nonce", "issued"}:
                    raise ValueError("begin contract")
                r = db.execute("SELECT * FROM operations WHERE id=?", (p["id"],)).fetchone()
                if r and (
                    r["kind"] != p["kind"]
                    or r["input_sha"] != p["input_sha"]
                    or r["context_json"] != dump(p["context"])
                ):
                    raise ValueError("operation ID input bound")
                if not r:
                    db.execute(
                        "INSERT INTO operations(id,kind,input_sha,context_json) VALUES(?,?,?,?)",
                        (p["id"], p["kind"], p["input_sha"], dump(p["context"])),
                    )
            elif p["action"] == "backup_witness":
                if set(p) != {
                    "action",
                    "id",
                    "manifest_sha",
                    "head",
                    "inventory_sha",
                    "snapshot_sha",
                    "nonce",
                    "issued",
                }:
                    raise ValueError("backup witness contract")
                operations = []
                for r in db.execute("SELECT * FROM operations ORDER BY seq"):
                    item = dict(r)
                    item["context"] = json.loads(item.pop("context_json"))
                    operations.append(item)
                if (
                    any(r["receipt_sha"] is None for r in operations)
                    or sha(operations) != p["head"]
                ):
                    raise ValueError("backup requires current completed head")
                values = tuple(
                    p[k] for k in ("id", "manifest_sha", "head", "inventory_sha", "snapshot_sha")
                )
                prior = db.execute(
                    "SELECT * FROM backup_witnesses WHERE id=?", (p["id"],)
                ).fetchone()
                if prior and tuple(prior) != values:
                    raise ValueError("backup witness immutable")
                db.execute("INSERT OR IGNORE INTO backup_witnesses VALUES(?,?,?,?,?)", values)
            elif p["action"] == "recovery_vote":
                if set(p) != {"action", "id", "actor", "evidence_sha", "reason", "nonce", "issued"}:
                    raise ValueError("recovery vote contract")
                operation = db.execute("SELECT * FROM operations WHERE id=?", (p["id"],)).fetchone()
                if not operation or operation["receipt_sha"] is not None:
                    raise ValueError("pending operation required")
                context = json.loads(operation["context_json"])
                if (
                    operation["kind"]
                    not in (
                        "business_create",
                        "business_effect",
                        "business_read_commit",
                        "business_inference_close",
                    )
                    or not context.get("owner")
                    or p["actor"] == context["owner"]
                ):
                    raise ValueError("eligible operation and independent governance required")
                if (
                    not isinstance(p["evidence_sha"], str)
                    or len(p["evidence_sha"]) != 64
                    or not isinstance(p["reason"], str)
                    or not 20 <= len(p["reason"]) <= 500
                ):
                    raise ValueError("evidence and reason required")
                prior = db.execute(
                    "SELECT * FROM recovery_votes WHERE operation_id=? AND actor=?",
                    (p["id"], p["actor"]),
                ).fetchone()
                if prior and (
                    prior["evidence_sha"] != p["evidence_sha"] or prior["reason"] != p["reason"]
                ):
                    raise ValueError("recovery vote immutable")
                first = db.execute(
                    "SELECT * FROM recovery_votes WHERE operation_id=? LIMIT 1", (p["id"],)
                ).fetchone()
                if first and (
                    first["evidence_sha"] != p["evidence_sha"] or first["reason"] != p["reason"]
                ):
                    raise ValueError("recovery evidence changed")
                db.execute(
                    "INSERT OR IGNORE INTO recovery_votes VALUES(?,?,?,?)",
                    (p["id"], p["actor"], p["evidence_sha"], p["reason"]),
                )
            elif p["action"] in (
                "complete",
                "resolve_unknown",
                "reconcile_effect",
                "reconcile_read",
            ):
                expected = {"action", "id", "receipt_sha", "nonce", "issued"} | (
                    {"approvers"} if p["action"] != "complete" else set()
                )
                if set(p) != expected:
                    raise ValueError("complete contract")
                r = db.execute("SELECT * FROM operations WHERE id=?", (p["id"],)).fetchone()
                outcome = {
                    "resolve_unknown": "closed_unknown",
                    "reconcile_effect": "reconciled_effect",
                    "reconcile_read": "reconciled_read",
                }.get(p["action"], "committed")
                if p["action"] == "reconcile_effect" and (not r or r["kind"] != "business_effect"):
                    raise ValueError("effect reconciliation requires business_effect")
                if not r or (
                    r["receipt_sha"]
                    and (r["receipt_sha"] != p["receipt_sha"] or r["outcome"] != outcome)
                ):
                    raise ValueError("completion mismatch")
                if outcome in ("closed_unknown", "reconciled_effect", "reconciled_read"):
                    owners = json.loads(r["context_json"]).get("owner")
                    a = p["approvers"]
                    if len(a) != 2 or len(set(a)) != 2 or owners in a:
                        raise ValueError("two independent governance identities required")
                    if r["kind"].startswith("business_"):
                        votes = [
                            db.execute(
                                "SELECT * FROM recovery_votes WHERE operation_id=? AND actor=?",
                                (p["id"], actor),
                            ).fetchone()
                            for actor in a
                        ]
                        expected_kinds = (
                            ("business_create", "business_inference_close")
                            if outcome == "closed_unknown"
                            else ("business_effect",)
                            if outcome == "reconciled_effect"
                            else ("business_read_commit",)
                        )
                        if (
                            r["kind"] not in expected_kinds
                            or not all(votes)
                            or votes[0]["evidence_sha"] != votes[1]["evidence_sha"]
                            or votes[0]["reason"] != votes[1]["reason"]
                        ):
                            raise ValueError("two retained recovery votes required")
                db.execute(
                    "UPDATE operations SET receipt_sha=?,outcome=? WHERE id=?",
                    (p["receipt_sha"], outcome, p["id"]),
                )
            elif p["action"] == "reserve_job":
                if (
                    set(p)
                    != {"action", "id", "scope", "units", "input_sha", "context", "nonce", "issued"}
                    or p["scope"] not in self.caps
                ):
                    raise ValueError("job reservation contract")
                if type(p["units"]) is not int or p["units"] <= 0:
                    raise ValueError("positive job units required")
                r = db.execute(
                    "SELECT * FROM job_reservations WHERE scope=? AND id=?", (p["scope"], p["id"])
                ).fetchone()
                if r and (r["units"] != p["units"] or r["input_sha"] != p["input_sha"]):
                    raise ValueError("job reservation input bound")
                operation = db.execute("SELECT * FROM operations WHERE id=?", (p["id"],)).fetchone()
                if operation and (
                    operation["kind"] != "business_create"
                    or operation["input_sha"] != p["input_sha"]
                    or operation["context_json"] != dump(p["context"])
                ):
                    raise ValueError("operation ID input bound")
                if not r:
                    used = db.execute(
                        "SELECT coalesce(sum(units),0) FROM job_reservations WHERE scope=?",
                        (p["scope"],),
                    ).fetchone()[0]
                    calls = db.execute(
                        "SELECT count(*) FROM reservations WHERE scope=?", (p["scope"],)
                    ).fetchone()[0]
                    if used + calls + p["units"] > self.caps[p["scope"]]:
                        raise ValueError("reservation cap exhausted")
                    db.execute(
                        "INSERT INTO job_reservations VALUES(?,?,?,?)",
                        (p["scope"], p["id"], p["units"], p["input_sha"]),
                    )
                    db.execute(
                        "INSERT INTO operations(id,kind,input_sha,context_json) VALUES(?,?,?,?)",
                        (p["id"], "business_create", p["input_sha"], dump(p["context"])),
                    )
            elif p["action"] == "reserve_call":
                if (
                    set(p) != {"action", "id", "scope", "nonce", "issued"}
                    or p["scope"] not in self.caps
                ):
                    raise ValueError("reservation contract")
                row = db.execute(
                    "SELECT number FROM reservations WHERE scope=? AND id=?", (p["scope"], p["id"])
                ).fetchone()
                if not row:
                    number = (
                        db.execute(
                            "SELECT count(*) FROM reservations WHERE scope=?", (p["scope"],)
                        ).fetchone()[0]
                        + 1
                    )
                    jobs = db.execute(
                        "SELECT coalesce(sum(units),0) FROM job_reservations WHERE scope=?",
                        (p["scope"],),
                    ).fetchone()[0]
                    if number + jobs > self.caps[p["scope"]]:
                        raise ValueError("reservation cap exhausted")
                    db.execute(
                        "INSERT INTO reservations VALUES(?,?,?)", (p["scope"], p["id"], number)
                    )
            elif p["action"] != "proof":
                raise ValueError("unsupported authority operation")
            db.commit()
            rows = []
            for r in db.execute("SELECT * FROM operations ORDER BY seq"):
                item = dict(r)
                item["context"] = json.loads(item.pop("context_json"))
                rows.append(item)
            budgets = {
                scope: {
                    "cap": cap,
                    "reserved": db.execute(
                        "SELECT count(*) FROM reservations WHERE scope=?", (scope,)
                    ).fetchone()[0]
                    + db.execute(
                        "SELECT coalesce(sum(units),0) FROM job_reservations WHERE scope=?",
                        (scope,),
                    ).fetchone()[0],
                }
                for scope, cap in self.caps.items()
            }
            reservation = (
                {
                    "scope": p["scope"],
                    "id": p["id"],
                    "number": db.execute(
                        "SELECT number FROM reservations WHERE scope=? AND id=?",
                        (p["scope"], p["id"]),
                    ).fetchone()[0],
                }
                if p["action"] == "reserve_call"
                else {"scope": p["scope"], "id": p["id"], "units": p["units"]}
                if p["action"] == "reserve_job"
                else None
            )
            votes = [
                dict(r)
                for r in db.execute("SELECT * FROM recovery_votes ORDER BY operation_id,actor")
            ]
            backups = [dict(r) for r in db.execute("SELECT * FROM backup_witnesses ORDER BY id")]
            body = {
                "installation": self.installation,
                "nonce": p["nonce"],
                "issued": time.time(),
                "seq": len(rows),
                "operations": rows,
                "head": sha(rows),
                "budgets": budgets,
                "reservation": reservation,
                "recovery_votes": votes,
                "backups": backups,
            }
            if model_action:
                slots = []
                for row in db.execute("SELECT * FROM model_slots ORDER BY id"):
                    item = dict(row)
                    item["context"] = json.loads(item.pop("context_json"))
                    slots.append(item)
                body["model_slots"] = slots
                body["model_slot_votes"] = [
                    dict(r)
                    for r in db.execute(
                        "SELECT v.* FROM recovery_votes v JOIN model_slots s ON s.id=v.operation_id ORDER BY v.rowid"
                    )
                ]
                body["model_slot_claim"] = (
                    db.execute(
                        "SELECT number FROM reservations WHERE scope='model' AND id=?", (p["id"],)
                    ).fetchone()[0]
                    if claimed
                    else None
                )
            # Preserve canonical bytes across Python/JS numeric encoders. Extra
            # wire fields are authenticated by the signature and signed head.
            return {
                "payload": body,
                "payload_json": dump(body),
                "operations_json": dump(rows),
                "signature": self.key.sign(dump(body).encode()).hex(),
            }


def serve(c):
    store = Store(c["path"], c["installation"], c["private_key"], c.get("caps"))

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            try:
                size = int(self.headers.get("content-length", "0"))
                if not 0 < size <= 65536:
                    raise ValueError("request size")
                raw = self.rfile.read(size)
                sig = hmac.new(bytes.fromhex(c["secret"]), raw, hashlib.sha256).hexdigest()
                if not hmac.compare_digest(sig, self.headers.get("x-signature", "")):
                    self.send_error(401)
                    return
                p = json.loads(raw)
                if abs(time.time() - p["issued"]) > 30:
                    raise ValueError("expired request")
                result = store.execute(p)
                if c.get("evidence"):
                    with store.lock, Path(c["evidence"]).open("a", encoding="utf-8") as f:
                        f.write(dump({"request": p, "proof": result}) + "\n")
                body = dump(result).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except (ValueError, KeyError) as e:
                body = str(e).encode()
                self.send_response(409)
                self.end_headers()
                self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    print(json.dumps({"ready": True, "port": server.server_port}), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    serve(json.loads(sys.stdin.readline()))
