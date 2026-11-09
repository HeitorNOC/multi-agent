/** Durable local events and read-only metadata projections; no scheduling. */
import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
const canonical = (x: any): string =>
  Array.isArray(x)
    ? "[" + x.map(canonical).join(",") + "]"
    : x !== null && typeof x === "object"
      ? "{" +
        Object.keys(x)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + canonical(x[k]))
          .join(",") +
        "}"
      : JSON.stringify(x);
const sha = (x: any) => createHash("sha256").update(canonical(x)).digest("hex");
const identifier = (x: any) =>
  typeof x === "string" && /^[\w:./-]{1,200}$/.test(x) ? x : null;
const digest = (x: any) =>
  typeof x === "string" && /^[a-f0-9]{64}$/.test(x) ? x : null;
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
    if (
      !/^[\w:-]{8,200}$/.test(eventId) ||
      typeof node !== "string" ||
      node.length > 100
    )
      throw Error("Identidade de evento inválida");
    const body = sha({ job, node, detail }),
      old = this.db
        .prepare("SELECT event_id,payload_sha FROM events WHERE event_id=?")
        .get(eventId) as any;
    if (old) {
      if (old.payload_sha !== body)
        throw Error("Evento já vinculado a outro conteúdo");
      return { ok: true, event_id: eventId, replayed: true };
    }
    const now = new Date().toISOString(),
      occurred = detail?.telemetry?.occurred_at;
    this.db
      .prepare(
        "INSERT INTO events(job,at,node,detail,event_id,payload_sha,recorded_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        job,
        typeof occurred === "string" && !Number.isNaN(Date.parse(occurred))
          ? occurred
          : now,
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
    return {
      installation_id: this.installation,
      job_id: job,
      trace_id: sha({ installation: this.installation, job }).slice(0, 32),
      read_only: true,
      events: rows.map((row) => {
        const d = JSON.parse(row.detail),
          t = d.telemetry || {};
        return {
          event_id: row.event_id,
          sequence: row.seq,
          kind: row.node,
          occurred_at: row.at,
          recorded_at: row.recorded_at,
          capability_id: identifier(d.capability),
          checkpoint_id: identifier(t.checkpoint_id),
          model_slot: identifier(t.model_slot),
          worker_run_id: identifier(t.worker_run_id),
          span_id: identifier(t.span_id),
          parent_span_id: identifier(t.parent_span_id),
          input_artifact_id: digest(t.input_artifact_id),
          output_artifact_id: digest(t.output_artifact_id),
          fact_ids: Array.isArray(t.fact_ids)
            ? t.fact_ids.map(digest).filter(Boolean)
            : [],
          evidence: Array.isArray(t.evidence)
            ? t.evidence.map((x: any) => ({
                source_id: identifier(x.source_id),
                source_version: Number.isSafeInteger(x.source_version)
                  ? x.source_version
                  : null,
                source_hash: digest(x.source_hash),
                projection_id: identifier(x.projection_id),
                retrieved_fragment_id: digest(x.retrieved_fragment_id),
                canonical_fragment_id: digest(x.canonical_fragment_id),
              }))
            : [],
        };
      }),
    };
  }
}
