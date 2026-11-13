/** Native projection boundary. LangGraph remains the workflow authority. */
import { createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { RetainedError } from "./retained.ts";
type Config = { url: string; key: string; installation: string };
export class Brain {
  db: DatabaseSync;
  c: Config;
  constructor(db: DatabaseSync, c: Config) {
    this.db = db;
    this.c = c;
    db.exec(`CREATE TABLE IF NOT EXISTS brain_releases(id TEXT PRIMARY KEY,draft TEXT,source TEXT,version INTEGER,raw_sha TEXT,content_sha TEXT,certificate TEXT);
      CREATE TABLE IF NOT EXISTS brain_control(id INTEGER PRIMARY KEY,frozen INTEGER,snapshot_sha TEXT);
      INSERT OR IGNORE INTO brain_control VALUES(1,0,NULL);`);
  }
  async call(action: string, payload: any = {}) {
    const raw = JSON.stringify({
      action,
      ...payload,
      issued: Date.now() / 1000,
    });
    let response: Response;
    try {
      response = await fetch(this.c.url + "/rpc", {
        method: "POST",
        body: raw,
        signal: AbortSignal.timeout(330000),
        headers: {
          "content-type": "application/json",
          "x-signature": createHmac("sha256", Buffer.from(this.c.key, "hex"))
            .update(raw)
            .digest("hex"),
        },
      });
    } catch {
      throw new RetainedError(503, "native brain unavailable");
    }
    if (!response.ok)
      throw new RetainedError(503, "native brain refused operation");
    return response.json();
  }
  frozen() {
    return Boolean(
      (this.db.prepare("SELECT frozen FROM brain_control").get() as any).frozen,
    );
  }
  async reference(ref: any) {
    const row = this.db
      .prepare(
        "SELECT * FROM brain_releases WHERE source=? AND version=? AND raw_sha=? AND content_sha=?",
      )
      .get(ref.source, ref.version, ref.raw_sha, ref.content_sha) as any;
    if (!row)
      throw new RetainedError(
        503,
        "canonical source has no verified native projection",
      );
    const certificate = await this.call("verify", { id: row.id });
    if (certificate.inventory_sha !== JSON.parse(row.certificate).inventory_sha)
      throw new RetainedError(503, "native receipt inventory changed");
    return certificate;
  }
  async all() {
    for (const row of this.db
      .prepare("SELECT * FROM brain_releases")
      .all() as any[])
      await this.reference(row);
  }
  async query(ref: any) {
    if (this.frozen()) throw new RetainedError(503, "brain writers frozen");
    const certificate = await this.reference(ref);
    const query =
      ref.source === "politica-remoto"
        ? "Quantos dias por semana a ACME permite trabalho remoto? Cite a fonte."
        : "Qual é o limite de aquisição e o código interno da ACME citados no documento? Cite a fonte.";
    return this.call("query", { id: certificate.id, query });
  }
  async commit(draft: any, release: any, id: string, commit: () => any) {
    const certificate = await this.call("verify", { id });
    for (const key of [
      "source",
      "version",
      "raw_sha",
      "content_sha",
      "domain",
      "reviewer",
    ])
      if (certificate.payload[key] !== release.payload[key])
        throw new RetainedError(409, "projection differs from approved source");
    const published = commit();
    this.db
      .prepare("INSERT OR IGNORE INTO brain_releases VALUES(?,?,?,?,?,?,?)")
      .run(
        id,
        draft.id,
        draft.source,
        draft.version,
        draft.raw_sha,
        draft.content_sha,
        JSON.stringify(certificate),
      );
    return { published, projection: certificate };
  }
  async checkpoint() {
    const active = this.db
      .prepare(
        "SELECT count(*) AS n FROM jobs WHERE worker IS NOT NULL AND deadline>?",
      )
      .get(Date.now()) as any;
    if (active.n)
      throw new RetainedError(
        409,
        "active workers must drain before brain checkpoint",
      );
    await this.all();
    const snapshot = await this.call("freeze");
    this.db
      .prepare("UPDATE brain_control SET frozen=1,snapshot_sha=?")
      .run(snapshot.sha);
    return snapshot;
  }
  async open() {
    const control = this.db.prepare("SELECT * FROM brain_control").get() as any;
    if (!control.frozen)
      throw new RetainedError(409, "brain is not in checkpoint recovery");
    await this.all();
    const result = await this.call("open", { sha: control.snapshot_sha });
    this.db.prepare("UPDATE brain_control SET frozen=0").run();
    return result;
  }
}
