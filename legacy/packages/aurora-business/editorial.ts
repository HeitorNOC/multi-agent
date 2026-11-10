/** Trusted backend worker. Caller identity must come from verified API authentication. */
import { DatabaseSync } from "node:sqlite";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFileSync, realpathSync, lstatSync } from "node:fs";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const sources: Record<string, string> = {
  "politica-remoto": "publico",
  aquisicao: "financeiro",
};
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function loadNote(root: string, name: string) {
  if (
    isAbsolute(name) ||
    name.includes(":") ||
    name.includes("\\") ||
    !name.endsWith(".md")
  )
    throw Error("invalid vault path");
  const base = realpathSync(root),
    candidate = resolve(base, name),
    rel = relative(base, candidate);
  if (rel.startsWith("..") || isAbsolute(rel)) throw Error("vault traversal");
  let part = base;
  for (const component of rel.split(sep)) {
    part = resolve(part, component);
    if (lstatSync(part).isSymbolicLink()) throw Error("symlink not allowed");
  }
  const actual = realpathSync(candidate);
  if (relative(base, actual).startsWith("..")) throw Error("vault escape");
  const bytes = readFileSync(actual);
  if (bytes.length > 65536) throw Error("note too large");
  const raw = bytes.toString("utf8");
  if (!Buffer.from(raw).equals(bytes)) throw Error("invalid UTF-8");
  const lines = raw.split(/\r?\n/);
  if (lines[0] !== "---") throw Error("frontmatter required");
  const end = lines.indexOf("---", 1);
  if (end < 1) throw Error("frontmatter terminator");
  const meta: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    const m = /^(source|version|valid_at|domain): ([a-zA-Z0-9_:.+\-]+)$/.exec(
      line,
    );
    if (!m || Object.hasOwn(meta, m[1]))
      throw Error("unsupported or duplicate property");
    meta[m[1]] = m[2];
  }
  if (!sources[meta.source] || sources[meta.source] !== meta.domain)
    throw Error("registered source classification required");
  if (
    !/^[1-9]\d*$/.test(meta.version) ||
    !Number.isSafeInteger(Number(meta.version))
  )
    throw Error("version required");
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(meta.valid_at) ||
    !Number.isFinite(Date.parse(meta.valid_at)) ||
    new Date(meta.valid_at).toISOString().replace(".000Z", "Z") !==
      meta.valid_at
  )
    throw Error("UTC validity required");
  const content = lines
    .slice(end + 1)
    .join("\n")
    .trim();
  if (!content) throw Error("empty content");
  return {
    path: name,
    source: meta.source,
    version: Number(meta.version),
    domain: meta.domain,
    valid_at: meta.valid_at,
    content,
    raw_sha: hash(raw),
    content_sha: hash(content),
  };
}

export function execute(c: any, p: any) {
  const readOnly = p.action === "canonical_asof";
  const db = new DatabaseSync(c.db, { readOnly });
  try {
    db.exec("PRAGMA busy_timeout=5000");
    if (!readOnly)
      db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS drafts(id TEXT PRIMARY KEY,path TEXT,source TEXT,version INTEGER,domain TEXT,valid_at TEXT,
    content TEXT,raw_sha TEXT,content_sha TEXT,author TEXT,reviewer TEXT,state TEXT,receipt TEXT,
    UNIQUE(source,version,raw_sha));
    CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY,event TEXT,draft TEXT,actor TEXT);
    CREATE TABLE IF NOT EXISTS canonical(source TEXT,version INTEGER,raw_sha TEXT,draft TEXT,known_at TEXT,PRIMARY KEY(source,version));`);
    const columns = db.prepare("PRAGMA table_info(canonical)").all() as any[];
    if (!columns.some((x) => x.name === "known_at")) {
      if (readOnly) throw Error("legacy publication knowledge time unverified");
      db.exec("ALTER TABLE canonical ADD COLUMN known_at TEXT");
    }
    const event = (name: string, id: string) =>
      db
        .prepare("INSERT INTO audit(event,draft,actor) VALUES(?,?,?)")
        .run(name, id, c.actor.id);
    if (p.action === "canonical_asof") {
      if (!sources[p.source]) throw Error("unknown source");
      if (
        !["analyst", "finance", "board"].includes(c.actor.role) ||
        (sources[p.source] === "financeiro" && c.actor.role === "analyst")
      )
        throw Error("canonical source denied");
      if (
        !Number.isFinite(Date.parse(p.as_of)) ||
        !Number.isFinite(Date.parse(p.known_at))
      )
        throw Error("as-of dates required");
      // Unknown legacy commit times cannot be reconstructed by guessing/backfilling.
      const unknown: any = db
        .prepare(
          "SELECT count(*) AS n FROM canonical WHERE source=? AND known_at IS NULL",
        )
        .get(p.source);
      if (unknown.n)
        throw Error("legacy publication knowledge time unverified");
      const d: any = db
        .prepare(
          `SELECT d.*,c.known_at FROM canonical c JOIN drafts d ON d.id=c.draft
        WHERE c.source=? AND julianday(d.valid_at)<=julianday(?) AND julianday(c.known_at)<=julianday(?)
        ORDER BY julianday(d.valid_at) DESC,d.version DESC LIMIT 1`,
        )
        .get(
          p.source,
          new Date(p.as_of).toISOString().replace(".000Z", "Z"),
          new Date(p.known_at).toISOString(),
        );
      if (!d) return { found: false };
      return {
        found: true,
        id: d.id,
        source: d.source,
        version: d.version,
        valid_at: d.valid_at,
        known_at: d.known_at,
        raw_sha: d.raw_sha,
        content_sha: d.content_sha,
        content: d.content,
        kind: "approved_source_snapshot_not_extracted_fact",
      };
    }
    if (p.action === "submit") {
      if (!["analyst", "finance"].includes(c.actor.role))
        throw Error("editor identity required");
      const n = loadNote(c.vault, p.path);
      if (n.domain === "financeiro" && c.actor.role !== "finance")
        throw Error("private editor denied");
      const existing: any = db
        .prepare(
          "SELECT * FROM drafts WHERE source=? AND version=? AND raw_sha=?",
        )
        .get(n.source, n.version, n.raw_sha);
      if (existing) {
        if (existing.author !== c.actor.id) throw Error("draft owner denied");
        return {
          id: existing.id,
          state: existing.state,
          raw_sha: existing.raw_sha,
        };
      }
      const id = randomUUID();
      db.prepare(
        `INSERT INTO drafts(id,path,source,version,domain,valid_at,content,raw_sha,content_sha,author,state)
        VALUES(?,?,?,?,?,?,?,?,?,?,'draft')`,
      ).run(
        id,
        n.path,
        n.source,
        n.version,
        n.domain,
        n.valid_at,
        n.content,
        n.raw_sha,
        n.content_sha,
        c.actor.id,
      );
      event("draft_submitted", id);
      return { id, state: "draft", raw_sha: n.raw_sha };
    }
    const d: any = db.prepare("SELECT * FROM drafts WHERE id=?").get(p.id);
    if (!d) throw Error("unknown draft");
    if (c.actor.role !== "board")
      throw Error("verified reviewer identity required");
    if (p.action === "review") {
      if (d.author === c.actor.id) throw Error("two-person review required");
      if (d.state !== "draft") throw Error("draft is not reviewable");
      if (
        loadNote(c.vault, d.path).raw_sha !== d.raw_sha ||
        p.raw_sha !== d.raw_sha
      )
        throw Error("review content changed");
      db.prepare(
        "UPDATE drafts SET state='reviewed',reviewer=? WHERE id=?",
      ).run(c.actor.id, d.id);
      event("reviewed", d.id);
      return { id: d.id, state: "reviewed", raw_sha: d.raw_sha };
    }
    if (p.action === "prepare") {
      if (!["reviewed", "published"].includes(d.state))
        throw Error("review required before publication");
      if (
        d.state !== "published" &&
        loadNote(c.vault, d.path).raw_sha !== d.raw_sha
      )
        throw Error("approved file changed");
      const previous: any = db
        .prepare("SELECT raw_sha FROM canonical WHERE source=? AND version=?")
        .get(d.source, d.version);
      if (previous && previous.raw_sha !== d.raw_sha)
        throw Error("immutable published version collision");
      const payload = {
        installation: c.installation,
        draft: d.id,
        source: d.source,
        version: d.version,
        domain: d.domain,
        valid_at: d.valid_at,
        raw_sha: d.raw_sha,
        content_sha: d.content_sha,
        reviewer: d.reviewer,
      };
      const signature = createHmac("sha256", Buffer.from(c.key, "hex"))
        .update(JSON.stringify(payload))
        .digest("hex");
      return {
        payload,
        signature,
        content: d.content,
        published: d.state === "published",
      };
    }
    if (p.action === "commit") {
      if (d.state === "published") return { id: d.id, state: d.state };
      if (d.state !== "reviewed") throw Error("review required");
      db.exec("BEGIN IMMEDIATE");
      try {
        const known = new Date().toISOString();
        db.prepare(
          "INSERT INTO canonical(source,version,raw_sha,draft,known_at) VALUES(?,?,?,?,?)",
        ).run(d.source, d.version, d.raw_sha, d.id, known);
        db.prepare(
          "UPDATE drafts SET state='published',receipt=? WHERE id=?",
        ).run(JSON.stringify(p.receipt), d.id);
        event("published", d.id);
        db.exec("COMMIT");
        return { id: d.id, state: "published", known_at: known };
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    }
    throw Error("unsupported editorial action");
  } finally {
    db.close();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  try {
    const { config, payload } = JSON.parse(text);
    console.log(JSON.stringify(execute(config, payload)));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}
