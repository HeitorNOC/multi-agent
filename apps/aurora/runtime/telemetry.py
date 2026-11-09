"""Worker outbox and restricted evidence artifacts. No task scheduling or model calls."""

import datetime
import hashlib
import json
import pathlib
import sqlite3
import uuid


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def digest(value):
    return hashlib.sha256(encoded(value).encode()).hexdigest()


class Outbox:
    def __init__(self, path, job, sender):
        self.path = str(path)
        self.job = job
        self.sender = sender
        self.run = uuid.uuid4().hex
        pathlib.Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.db() as db:
            db.executescript("""CREATE TABLE IF NOT EXISTS outbox(seq INTEGER PRIMARY KEY,event_id TEXT UNIQUE,job TEXT,body TEXT,delivered INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS artifacts(sha TEXT,job TEXT,kind TEXT,body TEXT,PRIMARY KEY(job,sha));""")

    def db(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA synchronous=FULL")
        return db

    def artifact(self, kind, value):
        sha = digest(value)
        with self.db() as db:
            db.execute(
                "INSERT OR IGNORE INTO artifacts VALUES(?,?,?,?)",
                (sha, self.job, kind, encoded(value)),
            )
        return sha

    def emit(self, node, detail):
        event_id = str(uuid.uuid4())
        telemetry = {
            **detail.get("telemetry", {}),
            "occurred_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "worker_run_id": self.run,
        }
        body = {"node": node, "event_id": event_id, "detail": {**detail, "telemetry": telemetry}}
        with self.db() as db:
            db.execute(
                "INSERT INTO outbox(event_id,job,body) VALUES(?,?,?)",
                (event_id, self.job, encoded(body)),
            )
        self.deliver(event_id, body)

    def deliver(self, event_id, body):
        result = self.sender(body)
        if result.get("event_id") != event_id:
            raise ValueError("Server did not acknowledge exact durable event")
        with self.db() as db:
            db.execute("UPDATE outbox SET delivered=1 WHERE event_id=?", (event_id,))

    def flush(self):
        with self.db() as db:
            pending = db.execute(
                "SELECT event_id,body FROM outbox WHERE job=? AND delivered=0 ORDER BY seq",
                (self.job,),
            ).fetchall()
        for event_id, body in pending:
            self.deliver(event_id, json.loads(body))


def reconcile_sources(retrieved, published):
    """Read permitted canonical documents; no expected numeric answers are present here."""
    originals = {d["source"]: d for d in published}
    result = []
    for row in retrieved:
        source = originals.get(row["source"])
        if (
            not source
            or source["version"] != row["version"]
            or hashlib.sha256(source["content"].encode()).hexdigest() != row["sha256"]
            or source["sha256"] != row["sha256"]
        ):
            raise ValueError("Canonical source/version/hash differs from retrieved projection")
        if row.get("projection_id") != source["projection"]:
            raise ValueError("Canonical source projection differs")
        result.append(
            {
                **row,
                "canonical_text": source["content"],
                "canonical_read": "full approved short fixture document; hash verified",
            }
        )
    return result
