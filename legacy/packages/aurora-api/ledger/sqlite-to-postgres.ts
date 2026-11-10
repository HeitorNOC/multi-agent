/**
 * Migração dos dados de uma instalação SQLite (`journey.sqlite`) para o ledger PostgreSQL.
 *
 * Garantias, na ordem em que são aplicadas:
 *  1. A origem é aberta SOMENTE LEITURA e só se nenhum servidor a estiver usando (a trava do
 *     agendador precisa estar livre). Nada é alterado na origem.
 *  2. O destino precisa estar vazio e sem servidor ativo (a trava do agendador dele é tomada
 *     durante a migração, impedindo que um servidor suba no meio).
 *  3. Tudo é copiado numa única transação. Qualquer falha desfaz tudo.
 *  4. Antes do `COMMIT`, cada tabela é verificada por contagem e por hash do conteúdo, e a
 *     ordem de listagem dos trabalhos é conferida. Divergência desfaz tudo.
 *  5. `dryRun` executa tudo, inclusive a verificação, e termina com `ROLLBACK`.
 *
 * Eventos de bancos antigos, sem `event_id`/`payload_sha`/`recorded_at`, recebem as mesmas
 * identidades legadas que o próprio servidor atribui ao abrir o banco.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import pg from "pg";
import type { PoolClient } from "pg";
import { sha } from "./event-codec.ts";
import { applyMigrations } from "./postgres-migrate.ts";
import { schedulerLockKey } from "./postgres-journey-ledger.ts";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations/", import.meta.url));
const CHUNK = 500;

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

export interface MigrationOptions {
  /** Diretório de estado da instalação de origem (contém `journey.sqlite`). */
  stateDir: string;
  connectionString: string;
  /** Esquema de destino; omitido usa o esquema padrão do usuário. */
  schema?: string;
  installation: string;
  /** Executa e verifica tudo, mas desfaz no fim. */
  dryRun?: boolean;
}

export interface TableReport {
  table: string;
  rows: number;
  /** SHA-256 do conteúdo ordenado; igual na origem e no destino quando a cópia é fiel. */
  digest: string;
}

export interface MigrationReport {
  dryRun: boolean;
  tables: TableReport[];
  /** A ordem de listagem dos trabalhos é idêntica nos dois armazenamentos. */
  jobOrderVerified: boolean;
  /** Eventos que receberam identidade legada por virem de um banco antigo. */
  legacyEventsBackfilled: number;
}

interface TableSpec {
  name: string;
  columns: string[];
  /** Colunas que identificam a linha; a ordenação dos hashes usa estas. */
  key: string[];
  /** Ordem de leitura na origem (preserva a ordem de inserção quando importa). */
  readOrder: string;
  /** Coluna de sequência no PostgreSQL a reposicionar depois da cópia. */
  sequence?: string;
  /** Tabelas que podem não existir em bancos antigos ou sem o recurso habilitado. */
  optional?: boolean;
}

const TABLES: TableSpec[] = [
  { name: "jobs", columns: ["id", "goal", "status", "plan", "review", "approval", "receipt", "error", "created"], key: ["id"], readOrder: "rowid" },
  { name: "events", columns: ["seq", "job", "at", "node", "detail", "event_id", "payload_sha", "recorded_at"], key: ["seq"], readOrder: "seq", sequence: "seq" },
  { name: "effects", columns: ["job", "hash", "receipt"], key: ["job"], readOrder: "job" },
  { name: "pilot_reference_revocations", columns: ["reference_version"], key: ["reference_version"], readOrder: "reference_version" },
  { name: "job_queue", columns: ["seq", "job", "kind", "crash", "queued_at"], key: ["seq"], readOrder: "seq", sequence: "seq" },
  { name: "job_admissions", columns: ["key", "job"], key: ["key"], readOrder: "key" },
  { name: "pilot_destination_revocations", columns: ["scope", "acknowledged"], key: ["scope"], readOrder: "scope", optional: true },
  { name: "pilot_destination_intents", columns: ["job", "intent"], key: ["job"], readOrder: "job", optional: true },
  { name: "conversations", columns: ["id", "actor", "title", "created", "updated"], key: ["id"], readOrder: "rowid", optional: true },
  { name: "conversation_messages", columns: ["seq", "conversation", "role", "text", "job", "client_id", "reply_to", "created"], key: ["seq"], readOrder: "seq", sequence: "seq", optional: true },
  { name: "knowledge_sources", columns: ["id", "title", "owner", "readers", "supersedes", "created", "revoked", "revoked_by", "latest_version"], key: ["id"], readOrder: "rowid", optional: true },
  { name: "knowledge_versions", columns: ["source", "version", "media_type", "filename", "content_sha", "bytes", "text", "valid_from", "uploaded_by", "created"], key: ["source", "version"], readOrder: "source, version", optional: true },
  { name: "inference_receipts", columns: ["job", "slot", "input_sha", "state", "output", "usage", "created", "updated"], key: ["job", "slot"], readOrder: "rowid", optional: true },
  { name: "recovery_sessions", columns: ["hash", "actor", "auth_sha", "expires"], key: ["hash"], readOrder: "hash", optional: true },
  { name: "recovery_commands", columns: ["id", "actor", "input_sha", "body", "action", "case_id", "operation_id", "evidence_sha", "status", "result", "updated"], key: ["id"], readOrder: "id", optional: true },
];

type Value = string | number | bigint | Uint8Array | null;

/** Forma canônica de um valor para o hash: bytes viram hexadecimal, o resto vira texto. */
const canonicalValue = (v: Value) =>
  v === null ? null : v instanceof Uint8Array ? `bytes:${Buffer.from(v).toString("hex")}` : String(v);
type Row = Value[];

export async function migrateSqliteToPostgres(options: MigrationOptions): Promise<MigrationReport> {
  const sourcePath = join(options.stateDir, "journey.sqlite");
  if (!existsSync(sourcePath)) throw new MigrationError(`Banco de origem não encontrado: ${sourcePath}`);

  const sourceLock = acquireSourceQuiescence(options.stateDir);
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: 2,
    ...(options.schema ? { options: `-c search_path=${options.schema}` } : {}),
  });
  let client: PoolClient | undefined;
  let schedulerKey: number | undefined;
  try {
    if (options.schema) {
      if (!/^[a-z_][a-z0-9_]{0,62}$/.test(options.schema)) throw new MigrationError("Nome de esquema inválido");
      await pool.query(`CREATE SCHEMA IF NOT EXISTS ${options.schema}`);
    }
    await applyMigrations(pool, MIGRATIONS_DIR);
    client = await pool.connect();
    schedulerKey = schedulerLockKey(options.installation, options.schema);
    const locked = await client.query("SELECT pg_try_advisory_lock($1) AS acquired", [schedulerKey]);
    if (!locked.rows[0].acquired)
      throw new MigrationError("Há um servidor ativo no destino; pare-o antes de migrar");
    await requireEmptyTarget(client);

    const report = await copyAndVerify(source, client, options);
    return report;
  } finally {
    if (client) {
      if (schedulerKey !== undefined)
        await client.query("SELECT pg_advisory_unlock($1)", [schedulerKey]).catch(() => {});
      client.release();
    }
    await pool.end();
    source.close();
    sourceLock?.close();
  }
}

/** Recusa migrar de uma origem em uso: a trava do agendador precisa estar livre. */
function acquireSourceQuiescence(stateDir: string): DatabaseSync | undefined {
  const lockFile = join(stateDir, "scheduler-owner.sqlite");
  // Nenhum servidor jamais rodou aqui: não há trava a respeitar e não criamos arquivos na origem.
  if (!existsSync(lockFile)) return undefined;
  const owner = new DatabaseSync(lockFile, { timeout: 0 });
  try {
    owner.exec("BEGIN EXCLUSIVE");
  } catch {
    owner.close();
    throw new MigrationError("A origem está em uso por um servidor; pare-o antes de migrar");
  }
  return owner;
}

async function requireEmptyTarget(client: PoolClient) {
  for (const table of TABLES) {
    const { rows } = await client.query(`SELECT count(*) AS n FROM ${table.name}`);
    if (Number(rows[0].n) > 0)
      throw new MigrationError(`O destino não está vazio (tabela ${table.name}); a migração não sobrescreve dados`);
  }
}

async function copyAndVerify(source: DatabaseSync, client: PoolClient, options: MigrationOptions): Promise<MigrationReport> {
  const tables: TableReport[] = [];
  let legacyBackfilled = 0;
  await client.query("BEGIN");
  try {
    for (const spec of TABLES) {
      const read = readSource(source, spec, options.installation);
      if (!read) continue;
      legacyBackfilled += read.backfilled;
      await insertRows(client, spec, read.rows);
      if (spec.sequence) await repositionSequence(client, spec);
      const target = await readTarget(client, spec);
      const expected = digestOf(spec, read.rows);
      const actual = digestOf(spec, target);
      if (target.length !== read.rows.length || actual !== expected)
        throw new MigrationError(
          `Verificação falhou em ${spec.name}: origem ${read.rows.length} linhas (${expected.slice(0, 12)}), destino ${target.length} (${actual.slice(0, 12)})`,
        );
      tables.push({ table: spec.name, rows: read.rows.length, digest: expected });
    }
    const jobOrderVerified = await verifyJobOrder(source, client);
    if (!jobOrderVerified) throw new MigrationError("A ordem de listagem dos trabalhos difere entre origem e destino");
    await client.query(options.dryRun ? "ROLLBACK" : "COMMIT");
    return { dryRun: options.dryRun === true, tables, jobOrderVerified, legacyEventsBackfilled: legacyBackfilled };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

/** Lê uma tabela da origem. Devolve `undefined` se a tabela opcional não existe. */
function readSource(source: DatabaseSync, spec: TableSpec, installation: string): { rows: Row[]; backfilled: number } | undefined {
  const present = source.prepare("SELECT name FROM pragma_table_info(?)").all(spec.name).map((r) => String(r.name));
  if (!present.length) {
    if (spec.optional) return undefined;
    throw new MigrationError(`Tabela obrigatória ausente na origem: ${spec.name}`);
  }
  const select = spec.columns.map((c) => (present.includes(c) ? c : `NULL AS ${c}`)).join(",");
  const rows = (source.prepare(`SELECT ${select} FROM ${spec.name} ORDER BY ${spec.readOrder}`).all() as Record<string, Value>[]).map(
    // Colunas binárias vêm do SQLite como Uint8Array; o driver do PostgreSQL espera Buffer.
    (r) => spec.columns.map((c) => (r[c] instanceof Uint8Array ? Buffer.from(r[c] as Uint8Array) : (r[c] as Value))),
  );
  let backfilled = 0;
  if (spec.name === "events") {
    const idx = Object.fromEntries(spec.columns.map((c, i) => [c, i]));
    for (const row of rows) {
      if (row[idx.event_id] !== null) continue;
      // Mesma regra de identidade legada aplicada pelo servidor ao abrir um banco antigo.
      row[idx.event_id] = `legacy:${installation}:${row[idx.seq]}`;
      row[idx.payload_sha] = sha({ job: row[idx.job], node: row[idx.node], detail: JSON.parse(String(row[idx.detail])) });
      row[idx.recorded_at] = row[idx.at];
      backfilled++;
    }
  }
  return { rows, backfilled };
}

async function insertRows(client: PoolClient, spec: TableSpec, rows: Row[]) {
  const width = spec.columns.length;
  for (let start = 0; start < rows.length; start += CHUNK) {
    const chunk = rows.slice(start, start + CHUNK);
    const placeholders = chunk
      .map((_, r) => `(${spec.columns.map((__, c) => `$${r * width + c + 1}`).join(",")})`)
      .join(",");
    await client.query(`INSERT INTO ${spec.name}(${spec.columns.join(",")}) VALUES ${placeholders}`, chunk.flat());
  }
}

/**
 * Faz a próxima inserção continuar depois do maior valor copiado. `setval` não é
 * transacional: numa simulação (`dryRun`) a sequência avança mesmo com o `ROLLBACK`, o que só
 * deixa uma lacuna de numeração, sem efeito sobre os dados.
 */
async function repositionSequence(client: PoolClient, spec: TableSpec) {
  await client.query(
    `SELECT setval(pg_get_serial_sequence('${spec.name}','${spec.sequence}'), GREATEST(coalesce(max(${spec.sequence}),1),1), max(${spec.sequence}) IS NOT NULL) FROM ${spec.name}`,
  );
}

async function readTarget(client: PoolClient, spec: TableSpec): Promise<Row[]> {
  const { rows } = await client.query(`SELECT ${spec.columns.join(",")} FROM ${spec.name}`);
  return rows.map((r) => spec.columns.map((c) => r[c] as Value));
}

/** Hash do conteúdo, ordenado por chave em JS: independe de collation e do tipo numérico do driver. */
function digestOf(spec: TableSpec, rows: Row[]): string {
  const keyIdx = spec.key.map((k) => spec.columns.indexOf(k));
  const keyOf = (row: Row) => keyIdx.map((i) => row[i]);
  const compare = (a: Row, b: Row) => {
    const ka = keyOf(a), kb = keyOf(b);
    for (let i = 0; i < ka.length; i++) {
      const x = ka[i], y = kb[i];
      if (x === y || String(x) === String(y)) continue;
      return typeof x === "number" || typeof x === "bigint" ? Number(x) - Number(y) : String(x) < String(y) ? -1 : 1;
    }
    return 0;
  };
  const hash = createHash("sha256");
  for (const row of [...rows].sort(compare))
    hash.update(JSON.stringify(row.map(canonicalValue)) + "\n");
  return hash.digest("hex");
}

async function verifyJobOrder(source: DatabaseSync, client: PoolClient): Promise<boolean> {
  const fromSource = source.prepare("SELECT id FROM jobs ORDER BY created DESC,rowid DESC").all().map((r) => String(r.id));
  const { rows } = await client.query("SELECT id FROM jobs ORDER BY created DESC, ordinal DESC");
  const fromTarget = rows.map((r) => String(r.id));
  return fromSource.length === fromTarget.length && fromSource.every((id, i) => id === fromTarget[i]);
}
