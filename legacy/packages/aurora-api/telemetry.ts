/** Durable local events and read-only metadata projections; no scheduling. */
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  assertEventIdentity,
  eventTime,
  projectTrace,
  sha,
} from "./ledger/event-codec.ts";
export class Events {
  db: DatabaseSync;
  installation: string;
  constructor(db: DatabaseSync, installation: string) {
    this.db = db;
    this.installation = installation;
    const columns = new Set(
      (db.prepare("PRAGMA table_info(events)").all() as any[]).map(
        (x) => x.name,
      ),
    );
    for (const column of ["event_id", "payload_sha", "recorded_at"])
      if (!columns.has(column))
        db.exec("ALTER TABLE events ADD COLUMN " + column + " TEXT");
    for (const row of db
      .prepare(
        "SELECT seq,job,node,detail,at FROM events WHERE event_id IS NULL",
      )
      .all() as any[])
      db.prepare(
        "UPDATE events SET event_id=?,payload_sha=?,recorded_at=? WHERE seq=?",
      ).run(
        "legacy:" + installation + ":" + row.seq,
        sha({ job: row.job, node: row.node, detail: JSON.parse(row.detail) }),
        row.at,
        row.seq,
      );
    db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS event_identity ON events(event_id)",
    );
  }
  append(
    job: string,
    node: string,
    detail: any,
    eventId = String(randomUUID()),
  ) {
    assertEventIdentity(eventId, node);
    const body = sha({ job, node, detail }),
      old = this.db
        .prepare("SELECT event_id,payload_sha FROM events WHERE event_id=?")
        .get(eventId) as any;
    if (old) {
      if (old.payload_sha !== body)
        throw Error("Evento já vinculado a outro conteúdo");
      return { ok: true, event_id: eventId, replayed: true };
    }
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO events(job,at,node,detail,event_id,payload_sha,recorded_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        job,
        eventTime(detail, now),
        node,
        JSON.stringify(detail),
        eventId,
        body,
        now,
      );
    return { ok: true, event_id: eventId, replayed: false };
  }
  trace(job: string) {
    const rows = this.db
      .prepare("SELECT * FROM events WHERE job=? ORDER BY seq")
      .all(job) as any[];
    return projectTrace(this.installation, job, rows);
  }
}
