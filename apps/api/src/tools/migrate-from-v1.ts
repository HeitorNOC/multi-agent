/**
 * Migração de dados da v1 (journey ledger, SQLite ou PostgreSQL) para a v2, numa única transação
 * no destino: ou tudo entra, ou nada.
 *
 * O que muda no caminho:
 *  - Eventos: `job`/`node`/`at` viram `stream`/`kind`/`occurred_at`; trabalhos ganham o prefixo
 *    `job:`; o `payload_sha` é recalculado com a regra da v2.
 *  - Parecer: a v1 calculava o hash com `JSON.stringify`; a v2 usa JSON canônico. O conteúdo é o
 *    mesmo, então o hash é recalculado e aprovação e efeito passam a apontar para ele. Cada troca
 *    fica registrada na trilha do trabalho (`migrated_review_rehashed`).
 *  - Estado `created` (transitório na v1) vira `interrupted`, que pode ser retomado.
 *  - Ficam de fora tabelas da bancada Aurora (piloto, sessões e comandos da recuperação antiga);
 *    o relatório informa quantas linhas havia em cada uma.
 *
 * Uso (destino pela configuração AURORA_* de sempre):
 *   node src/tools/migrate-from-v1.ts --from-sqlite <journey.sqlite>
 *   node src/tools/migrate-from-v1.ts --from-postgres <url> [--from-schema <esquema>]
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadConfig } from "../config.ts";
import { systemClock } from "../shared/clock.ts";
import { hashOf, type Json } from "../shared/json.ts";
import type { Database, Row, Sql, SqlValue } from "../platform/database/database.ts";
import { migrate } from "../platform/database/migrate.ts";
import { PostgresDatabase } from "../platform/database/postgres.ts";
import { SqliteDatabase } from "../platform/database/sqlite.ts";

const SKIPPED_TABLES = ["pilot_reference_revocations", "pilot_destination_revocations", "pilot_destination_intents", "recovery_sessions", "recovery_commands"];
const STREAM_PREFIXES = ["knowledge:", "conversation:", "recovery:"];

export interface MigrationReport {
  copied: Record<string, number>;
  rehashed: number;
  skipped: Record<string, number>;
}

const text = (v: unknown) => (v === null || v === undefined ? null : String(v));
const parse = (v: unknown): Json | null => (v === null || v === undefined || v === "" ? null : (JSON.parse(String(v)) as Json));
const streamOf = (job: string) => (STREAM_PREFIXES.some((p) => job.startsWith(p)) ? job : `job:${job}`);

async function tableExists(db: Database, table: string) {
  const sql =
    db.dialect === "sqlite"
      ? "SELECT name FROM sqlite_master WHERE type = 'table' AND name = $1"
      : "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1";
  return !!(await db.sql.one(sql, [table]));
}

async function columns(db: Database, table: string): Promise<Set<string>> {
  if (db.dialect === "sqlite") return new Set((await db.sql.all<{ name: string }>(`PRAGMA table_info(${table})`)).map((r) => r.name));
  const rows = await db.sql.all<{ name: string }>(
    "SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1",
    [table],
  );
  return new Set(rows.map((r) => r.name));
}

/** Linhas da tabela da v1 na ordem de inserção (rowid no SQLite, ordinal/seq no PostgreSQL). */
async function rows(db: Database, table: string, order: string): Promise<Row[]> {
  if (!(await tableExists(db, table))) return [];
  const cols = await columns(db, table);
  const by = db.dialect === "sqlite" ? (cols.has("seq") ? "seq" : "rowid") : cols.has(order) ? order : [...cols][0]!;
  return db.sql.all(`SELECT * FROM ${table} ORDER BY ${by}`);
}

/** Recalcula o hash do parecer com a regra da v2 e devolve o parecer normalizado. */
function rebind(review: Json | null): { review: Json | null; from?: string; to?: string } {
  if (!review || typeof review !== "object" || Array.isArray(review)) return { review };
  const r = review as { job?: Json; report?: Json; payload?: Json; hash?: Json };
  const bound = { job: r.job ?? null, report: r.report ?? null, payload: r.payload ?? null };
  const hash = hashOf(bound);
  return { review: { ...bound, hash }, from: typeof r.hash === "string" ? r.hash : undefined, to: hash };
}

export async function migrateFromV1(source: Database, target: Database, now = systemClock.now()): Promise<MigrationReport> {
  await migrate(target, now);
  const existing = await target.sql.one<{ n: number | string }>("SELECT COUNT(*) AS n FROM jobs");
  if (Number(existing!.n) > 0) throw new Error("O banco de destino já tem trabalhos; a migração exige um destino vazio.");

  const v1 = {
    jobs: await rows(source, "jobs", "ordinal"),
    events: await rows(source, "events", "seq"),
    effects: await rows(source, "effects", "job"),
    queue: await rows(source, "job_queue", "seq"),
    admissions: await rows(source, "job_admissions", "key"),
    inferences: await rows(source, "inference_receipts", "ordinal"),
    conversations: await rows(source, "conversations", "ordinal"),
    messages: await rows(source, "conversation_messages", "seq"),
    sources: await rows(source, "knowledge_sources", "ordinal"),
    versions: await rows(source, "knowledge_versions", "source"),
  };
  const skipped: Record<string, number> = {};
  for (const table of SKIPPED_TABLES) if (await tableExists(source, table)) skipped[table] = (await rows(source, table, "rowid")).length;

  const report: MigrationReport = { copied: {}, rehashed: 0, skipped };
  const count = (table: string, n: number) => (report.copied[table] = n);

  await target.transaction(async (tx: Sql) => {
    const hashes = new Map<string, { from: string; to: string }>();
    let ordinal = 0;
    for (const j of v1.jobs) {
      const id = String(j.id);
      const { review, from, to } = rebind(parse(j.review));
      if (from && to && from !== to) hashes.set(id, { from, to });
      const mapHash = (h: unknown) => (h !== null && h !== undefined && from && String(h) === from ? to! : text(h));
      const status = j.status === "created" || !j.status ? "interrupted" : String(j.status);
      await tx.run(
        `INSERT INTO jobs (id, goal, status, plan, review, approval, receipt, error, created_at, ordinal, version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1)`,
        [id, String(j.goal ?? ""), status, text(j.plan), review === null ? null : JSON.stringify(review), mapHash(j.approval), text(j.receipt), text(j.error), String(j.created ?? now), ++ordinal],
      );
    }
    count("jobs", v1.jobs.length);

    const seen = new Set<string>();
    for (const e of v1.events) {
      const streamId = streamOf(String(e.job));
      const kind = String(e.node);
      const detail = parse(e.detail) ?? {};
      const eventId = e.event_id ? String(e.event_id) : `v1-event-${e.seq}`;
      if (seen.has(eventId)) continue;
      seen.add(eventId);
      await tx.run(
        "INSERT INTO events (seq, stream, kind, detail, event_id, payload_sha, occurred_at, recorded_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        [Number(e.seq), streamId, kind, JSON.stringify(detail), eventId, hashOf({ stream: streamId, kind, detail }), String(e.at ?? now), String(e.recorded_at ?? e.at ?? now)],
      );
    }
    count("events", seen.size);
    let extra = Math.max(0, ...v1.events.map((e) => Number(e.seq)));
    for (const [jobId, { from, to }] of hashes) {
      const streamId = `job:${jobId}`;
      const detail = { from, to, reason: "Hash do parecer recalculado com JSON canônico na migração para a v2; o conteúdo não mudou." };
      await tx.run(
        "INSERT INTO events (seq, stream, kind, detail, event_id, payload_sha, occurred_at, recorded_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)",
        [++extra, streamId, "migrated_review_rehashed", JSON.stringify(detail), `v1-rehash-${jobId}`, hashOf({ stream: streamId, kind: "migrated_review_rehashed", detail }), now],
      );
    }
    report.rehashed = hashes.size;

    for (const f of v1.effects) {
      const jobId = String(f.job);
      const h = hashes.get(jobId);
      const hash = h && String(f.hash) === h.from ? h.to : String(f.hash);
      const receipt = parse(f.receipt) as Record<string, Json> | null;
      if (receipt && h && receipt.hash === h.from) receipt.hash = h.to;
      await tx.run("INSERT INTO effect_receipts (job_id, hash, receipt) VALUES ($1, $2, $3)", [jobId, hash, JSON.stringify(receipt)]);
      if (receipt && h) await tx.run("UPDATE jobs SET receipt = $2 WHERE id = $1 AND receipt IS NOT NULL", [jobId, JSON.stringify(receipt)]);
    }
    count("effect_receipts", v1.effects.length);

    for (const q of v1.queue)
      await tx.run("INSERT INTO job_queue (seq, job_id, kind, crash_after_effect, queued_at) VALUES ($1, $2, $3, $4, $5)", [
        Number(q.seq),
        String(q.job),
        String(q.kind),
        Number(q.crash) ? 1 : 0,
        String(q.queued_at),
      ]);
    count("job_queue", v1.queue.length);

    for (const a of v1.admissions) await tx.run("INSERT INTO admissions (key, job_id) VALUES ($1, $2)", [String(a.key), String(a.job)]);
    count("admissions", v1.admissions.length);

    ordinal = 0;
    for (const r of v1.inferences)
      await tx.run(
        `INSERT INTO inference_receipts (job_id, slot, input_sha, state, output, usage, created_at, updated_at, ordinal)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [String(r.job), String(r.slot), String(r.input_sha), String(r.state), text(r.output), text(r.usage), String(r.created), String(r.updated), ++ordinal],
      );
    count("inference_receipts", v1.inferences.length);

    ordinal = 0;
    for (const s of v1.sources)
      await tx.run(
        `INSERT INTO knowledge_sources (id, title, owner, readers, supersedes, created_at, revoked_at, revoked_by, latest_version, ordinal)
         VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, $9)`,
        [String(s.id), String(s.title), String(s.owner), String(s.readers), String(s.created), text(s.revoked), text(s.revoked_by), Number(s.latest_version), ++ordinal],
      );
    // `supersedes` aponta para outra fonte: gravado depois que todas existem.
    for (const s of v1.sources) if (s.supersedes) await tx.run("UPDATE knowledge_sources SET supersedes = $2 WHERE id = $1", [String(s.id), String(s.supersedes)]);
    count("knowledge_sources", v1.sources.length);

    for (const v of v1.versions) {
      const bytes = v.bytes instanceof Uint8Array ? new Uint8Array(v.bytes) : new Uint8Array(Buffer.from(String(v.bytes)));
      await tx.run(
        `INSERT INTO knowledge_versions (source_id, version, filename, media_type, content_sha, size_bytes, bytes, text, valid_from, uploaded_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [String(v.source), Number(v.version), String(v.filename), String(v.media_type), String(v.content_sha), bytes.length, bytes as SqlValue, String(v.text), String(v.valid_from), String(v.uploaded_by), String(v.created)],
      );
    }
    count("knowledge_versions", v1.versions.length);

    ordinal = 0;
    for (const c of v1.conversations)
      await tx.run("INSERT INTO conversations (id, actor, title, created_at, updated_at, ordinal) VALUES ($1, $2, $3, $4, $5, $6)", [
        String(c.id),
        String(c.actor),
        String(c.title),
        String(c.created),
        String(c.updated),
        ++ordinal,
      ]);
    count("conversations", v1.conversations.length);

    for (const m of v1.messages)
      await tx.run(
        `INSERT INTO conversation_messages (seq, conversation_id, role, text, job_id, client_id, reply_to, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [Number(m.seq), String(m.conversation), String(m.role), String(m.text), text(m.job), text(m.client_id), m.reply_to === null ? null : Number(m.reply_to), String(m.created)],
      );
    count("conversation_messages", v1.messages.length);

    // No PostgreSQL, as sequências precisam continuar depois dos números copiados.
    if (target.dialect === "postgres")
      for (const table of ["events", "job_queue", "conversation_messages"])
        await tx.one(`SELECT setval(pg_get_serial_sequence('${table}', 'seq'), GREATEST(COALESCE((SELECT MAX(seq) FROM ${table}), 0), 1))`);
  });
  return report;
}

async function main() {
  const { values } = parseArgs({ options: { "from-sqlite": { type: "string" }, "from-postgres": { type: "string" }, "from-schema": { type: "string" } } });
  const fromSqlite = values["from-sqlite"];
  const fromPostgres = values["from-postgres"];
  if (!fromSqlite === !fromPostgres) throw new Error("Informe --from-sqlite <arquivo> ou --from-postgres <url>.");
  const source: Database = fromSqlite
    ? new SqliteDatabase(fromSqlite)
    : await PostgresDatabase.connect({ connectionString: fromPostgres!, schema: values["from-schema"], lockName: "aurora-v1-read" });
  const config = loadConfig();
  const target: Database =
    config.database.dialect === "postgres"
      ? await PostgresDatabase.connect({ connectionString: config.database.url, schema: config.database.schema, lockName: "aurora" })
      : new SqliteDatabase(config.database.path);
  try {
    console.log(JSON.stringify(await migrateFromV1(source, target), null, 2));
  } finally {
    await source.close();
    await target.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
