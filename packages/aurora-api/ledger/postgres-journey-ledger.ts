/**
 * Adaptador PostgreSQL da porta `JourneyLedger`.
 *
 * Diferenças em relação ao SQLite, todas escondidas atrás da porta:
 *  - Leituras fora de transação usam o pool e enxergam só dados confirmados (MVCC); não
 *    esperam transações em andamento.
 *  - `transaction` reserva uma conexão, abre `BEGIN` e toma um advisory lock da instalação.
 *    Isso serializa escritores também entre processos. Dentro do mesmo processo uma fila
 *    FIFO garante a ordem de chegada.
 *  - O esquema vem das migrations em `../migrations`, aplicadas por `applyMigrations`.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { Pool, PoolClient } from "pg";
import { assertEventIdentity, eventTime, projectTrace, sha } from "./event-codec.ts";
import {
  LedgerUsageError,
  patchedColumns,
  type AppendedEvent,
  type EventRecord,
  type JobGuard,
  type JobPatch,
  type JobRecord,
  type JobStatus,
  type JourneyLedger,
  type JourneyStore,
  type NewJob,
  type QueueDepth,
  type QueueEntry,
  type QueueKind,
  type ReceiptRecord,
} from "./journey-ledger.ts";
import { applyMigrations } from "./postgres-migrate.ts";

const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations/", import.meta.url));
const SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

export interface PostgresLedgerOptions {
  connectionString: string;
  /** Esquema dedicado (útil para isolar testes). Omitido: usa o esquema padrão do usuário. */
  schema?: string;
  installation: string;
  destinationJournal: boolean;
  /** Máximo de conexões do pool. */
  poolSize?: number;
}

type Db = Pick<Pool, "query">;
type Row = Record<string, unknown>;

/** Operações da porta sobre uma conexão ou pool. Não decide transações nem exclusão mútua. */
class PostgresJourneyStore implements JourneyStore {
  private readonly db: Db;
  private readonly installation: string;
  private readonly destinationJournal: boolean;

  constructor(db: Db, installation: string, destinationJournal: boolean) {
    this.db = db;
    this.installation = installation;
    this.destinationJournal = destinationJournal;
  }

  // Trabalhos ---------------------------------------------------------------
  async getJob(id: string): Promise<JobRecord | undefined> {
    const { rows } = await this.db.query(
      "SELECT id,goal,status,plan,review,approval,receipt,error,created FROM jobs WHERE id=$1",
      [id],
    );
    return rows[0] as JobRecord | undefined;
  }
  async listJobIds(): Promise<string[]> {
    const { rows } = await this.db.query("SELECT id FROM jobs ORDER BY created DESC, ordinal DESC");
    return rows.map((r) => String(r.id));
  }
  async listJobIdsByStatus(status: JobStatus): Promise<string[]> {
    const { rows } = await this.db.query("SELECT id FROM jobs WHERE status=$1", [status]);
    return rows.map((r) => String(r.id));
  }
  async latestJobForGoal(goal: string) {
    const { rows } = await this.db.query(
      "SELECT id,status FROM jobs WHERE goal=$1 ORDER BY ordinal DESC LIMIT 1",
      [goal],
    );
    return rows[0] && { id: String(rows[0].id), status: rows[0].status as JobStatus };
  }
  async insertJob(job: NewJob): Promise<void> {
    await this.db.query(
      "INSERT INTO jobs(id,goal,status,review,created) VALUES($1,$2,$3,$4,$5)",
      [job.id, job.goal, job.status, job.review ?? null, job.created],
    );
  }
  async updateJob(id: string, patch: JobPatch, guard?: JobGuard): Promise<boolean> {
    const columns = patchedColumns(patch);
    const params: unknown[] = columns.map((c) => patch[c] ?? null);
    let sql = `UPDATE jobs SET ${columns.map((c, i) => `${c}=$${i + 1}`).join(",")} WHERE id=$${columns.length + 1}`;
    params.push(id);
    if (guard) {
      if (!guard.statusIn.length) return false;
      params.push([...guard.statusIn]);
      sql += ` AND status = ANY($${params.length})`;
    }
    return ((await this.db.query(sql, params)).rowCount ?? 0) > 0;
  }

  // Eventos -----------------------------------------------------------------
  async appendEvent(
    job: string,
    node: string,
    detail: unknown,
    eventId: string = String(randomUUID()),
  ): Promise<AppendedEvent> {
    assertEventIdentity(eventId, node);
    const body = sha({ job, node, detail });
    const now = new Date().toISOString();
    const inserted = await this.db.query(
      `INSERT INTO events(job,at,node,detail,event_id,payload_sha,recorded_at)
       VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (event_id) DO NOTHING RETURNING seq`,
      [job, eventTime(detail, now), node, JSON.stringify(detail), eventId, body, now],
    );
    if (inserted.rowCount) return { ok: true, event_id: eventId, replayed: false };
    const { rows } = await this.db.query("SELECT payload_sha FROM events WHERE event_id=$1", [eventId]);
    if (rows[0]?.payload_sha !== body) throw Error("Evento já vinculado a outro conteúdo");
    return { ok: true, event_id: eventId, replayed: true };
  }
  async listEvents(job: string): Promise<EventRecord[]> {
    const { rows } = await this.db.query("SELECT seq,at,node,detail FROM events WHERE job=$1 ORDER BY seq", [job]);
    return rows.map((r) => ({ seq: Number(r.seq), at: String(r.at), node: String(r.node), detail: String(r.detail) }));
  }
  async trace(job: string): Promise<unknown> {
    const { rows } = await this.db.query("SELECT * FROM events WHERE job=$1 ORDER BY seq", [job]);
    return projectTrace(this.installation, job, rows as never);
  }

  // Fila --------------------------------------------------------------------
  async enqueue(e: { job: string; kind: QueueKind; crash: boolean; queuedAt: string }): Promise<QueueEntry> {
    const { rows } = await this.db.query(
      "INSERT INTO job_queue(job,kind,crash,queued_at) VALUES($1,$2,$3,$4) RETURNING seq",
      [e.job, e.kind, Number(e.crash), e.queuedAt],
    );
    return { seq: Number(rows[0].seq), ...e };
  }
  async peekQueue(): Promise<QueueEntry | undefined> {
    const { rows } = await this.db.query("SELECT * FROM job_queue ORDER BY seq LIMIT 1");
    const r = rows[0] as Row | undefined;
    return (
      r && {
        seq: Number(r.seq),
        job: String(r.job),
        kind: r.kind as QueueKind,
        crash: Number(r.crash) === 1,
        queuedAt: String(r.queued_at),
      }
    );
  }
  async dequeue(seq: number, job: string): Promise<boolean> {
    return ((await this.db.query("DELETE FROM job_queue WHERE seq=$1 AND job=$2", [seq, job])).rowCount ?? 0) > 0;
  }
  async queueDepth(): Promise<QueueDepth> {
    const { rows } = await this.db.query(
      "SELECT count(*) AS total, count(*) FILTER (WHERE kind='new') AS fresh FROM job_queue",
    );
    return { total: Number(rows[0].total), newRequests: Number(rows[0].fresh) };
  }

  // Admissão ----------------------------------------------------------------
  async findAdmittedJob(key: string): Promise<string | undefined> {
    const { rows } = await this.db.query("SELECT job FROM job_admissions WHERE key=$1", [key]);
    return rows[0] ? String(rows[0].job) : undefined;
  }
  async recordAdmission(key: string, job: string): Promise<void> {
    await this.db.query("INSERT INTO job_admissions(key,job) VALUES($1,$2)", [key, job]);
  }

  // Efeitos -----------------------------------------------------------------
  async getEffect(job: string): Promise<ReceiptRecord | undefined> {
    const { rows } = await this.db.query("SELECT hash,receipt FROM effects WHERE job=$1", [job]);
    return rows[0] && { hash: String(rows[0].hash), receipt: String(rows[0].receipt) };
  }
  async recordEffect(job: string, hash: string, receipt: string): Promise<void> {
    await this.db.query("INSERT INTO effects(job,hash,receipt) VALUES($1,$2,$3)", [job, hash, receipt]);
  }

  // Revogação de referência -------------------------------------------------
  async revokeReference(version: string): Promise<boolean> {
    const r = await this.db.query(
      "INSERT INTO pilot_reference_revocations(reference_version) VALUES($1) ON CONFLICT DO NOTHING",
      [version],
    );
    return (r.rowCount ?? 0) > 0;
  }
  async isReferenceRevoked(version: string): Promise<boolean> {
    const { rowCount } = await this.db.query(
      "SELECT 1 FROM pilot_reference_revocations WHERE reference_version=$1",
      [version],
    );
    return (rowCount ?? 0) > 0;
  }

  // Diário de destino -------------------------------------------------------
  async revokeDestinationScope(scope: string): Promise<boolean> {
    this.requireDestinationJournal();
    const r = await this.db.query(
      "INSERT INTO pilot_destination_revocations(scope) VALUES($1) ON CONFLICT DO NOTHING",
      [scope],
    );
    return (r.rowCount ?? 0) > 0;
  }
  async isDestinationRevocationAcknowledged(scope: string): Promise<boolean> {
    this.requireDestinationJournal();
    const { rowCount } = await this.db.query(
      "SELECT 1 FROM pilot_destination_revocations WHERE scope=$1 AND acknowledged=1",
      [scope],
    );
    return (rowCount ?? 0) > 0;
  }
  async acknowledgeDestinationRevocation(scope: string): Promise<boolean> {
    this.requireDestinationJournal();
    const r = await this.db.query(
      "UPDATE pilot_destination_revocations SET acknowledged=1 WHERE scope=$1 AND acknowledged=0",
      [scope],
    );
    return (r.rowCount ?? 0) > 0;
  }
  async getDestinationIntent(job: string): Promise<string | undefined> {
    this.requireDestinationJournal();
    const { rows } = await this.db.query("SELECT intent FROM pilot_destination_intents WHERE job=$1", [job]);
    return rows[0] ? String(rows[0].intent) : undefined;
  }
  async recordDestinationIntent(job: string, intent: string): Promise<void> {
    this.requireDestinationJournal();
    await this.db.query("INSERT INTO pilot_destination_intents(job,intent) VALUES($1,$2)", [job, intent]);
  }
  async hasPendingDestinationWork(): Promise<boolean> {
    if (!this.destinationJournal) return false;
    const { rowCount } = await this.db.query(
      `SELECT 1 FROM pilot_destination_revocations WHERE acknowledged=0
       UNION ALL
       SELECT 1 FROM pilot_destination_intents i LEFT JOIN effects e ON e.job=i.job WHERE e.job IS NULL
       LIMIT 1`,
    );
    return (rowCount ?? 0) > 0;
  }

  private requireDestinationJournal() {
    if (!this.destinationJournal) throw new LedgerUsageError("O diário de destino não está habilitado");
  }
}

export class PostgresJourneyLedger implements JourneyLedger {
  private readonly pool: Pool;
  private readonly store: PostgresJourneyStore;
  private readonly installation: string;
  private readonly destinationJournal: boolean;
  private readonly lockKey: number;
  /** Marca o contexto assíncrono que já está dentro de uma transação. */
  private readonly inTransaction = new AsyncLocalStorage<true>();
  private tail: Promise<unknown> = Promise.resolve();

  private constructor(pool: Pool, options: PostgresLedgerOptions) {
    this.pool = pool;
    this.installation = options.installation;
    this.destinationJournal = options.destinationJournal;
    this.store = new PostgresJourneyStore(pool, options.installation, options.destinationJournal);
    // Uma chave estável por instalação; cabe em 48 bits, portanto em int8.
    this.lockKey = parseInt(createHash("sha256").update("journey:" + options.installation).digest("hex").slice(0, 12), 16);
  }

  /** Abre o pool, garante o esquema e confere a consistência do diário de destino. */
  static async open(options: PostgresLedgerOptions): Promise<PostgresJourneyLedger> {
    const { schema } = options;
    if (schema !== undefined && !SCHEMA_NAME.test(schema)) throw new LedgerUsageError("Nome de esquema inválido");
    if (schema) {
      const admin = new pg.Pool({ connectionString: options.connectionString, max: 1 });
      try {
        await admin.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
      } finally {
        await admin.end();
      }
    }
    const pool = new pg.Pool({
      connectionString: options.connectionString,
      max: options.poolSize ?? 5,
      ...(schema ? { options: `-c search_path=${schema}` } : {}),
    });
    try {
      await applyMigrations(pool, MIGRATIONS_DIR);
      if (!options.destinationJournal) {
        const { rowCount } = await pool.query("SELECT 1 FROM pilot_destination_intents LIMIT 1");
        if (rowCount)
          throw new Error("Esta sessão possui um diário de destino e requer sua configuração");
      }
    } catch (error) {
      await pool.end();
      throw error;
    }
    return new PostgresJourneyLedger(pool, options);
  }

  getJob = (id: string) => this.run((s) => s.getJob(id));
  listJobIds = () => this.run((s) => s.listJobIds());
  listJobIdsByStatus = (status: JobStatus) => this.run((s) => s.listJobIdsByStatus(status));
  latestJobForGoal = (goal: string) => this.run((s) => s.latestJobForGoal(goal));
  insertJob = (job: NewJob) => this.run((s) => s.insertJob(job));
  updateJob = (id: string, patch: JobPatch, guard?: JobGuard) => this.run((s) => s.updateJob(id, patch, guard));
  appendEvent = (job: string, node: string, detail: unknown, eventId?: string) => this.run((s) => s.appendEvent(job, node, detail, eventId));
  listEvents = (job: string) => this.run((s) => s.listEvents(job));
  trace = (job: string) => this.run((s) => s.trace(job));
  enqueue = (entry: { job: string; kind: QueueKind; crash: boolean; queuedAt: string }) => this.run((s) => s.enqueue(entry));
  peekQueue = () => this.run((s) => s.peekQueue());
  dequeue = (seq: number, job: string) => this.run((s) => s.dequeue(seq, job));
  queueDepth = () => this.run((s) => s.queueDepth());
  findAdmittedJob = (key: string) => this.run((s) => s.findAdmittedJob(key));
  recordAdmission = (key: string, job: string) => this.run((s) => s.recordAdmission(key, job));
  getEffect = (job: string) => this.run((s) => s.getEffect(job));
  recordEffect = (job: string, hash: string, receipt: string) => this.run((s) => s.recordEffect(job, hash, receipt));
  revokeReference = (version: string) => this.run((s) => s.revokeReference(version));
  isReferenceRevoked = (version: string) => this.run((s) => s.isReferenceRevoked(version));
  revokeDestinationScope = (scope: string) => this.run((s) => s.revokeDestinationScope(scope));
  isDestinationRevocationAcknowledged = (scope: string) => this.run((s) => s.isDestinationRevocationAcknowledged(scope));
  acknowledgeDestinationRevocation = (scope: string) => this.run((s) => s.acknowledgeDestinationRevocation(scope));
  getDestinationIntent = (job: string) => this.run((s) => s.getDestinationIntent(job));
  recordDestinationIntent = (job: string, intent: string) => this.run((s) => s.recordDestinationIntent(job, intent));
  hasPendingDestinationWork = () => this.run((s) => s.hasPendingDestinationWork());

  /** Mesmo nome do índice do SQLite, para as instalações poderem trocar de adaptador. */
  async setSingleActiveJob(enabled: boolean): Promise<void> {
    this.assertOutsideTransaction();
    await this.pool.query(
      enabled
        ? "CREATE UNIQUE INDEX IF NOT EXISTS one_running_job ON jobs((1)) WHERE status IN ('created','running')"
        : "DROP INDEX IF EXISTS one_running_job",
    );
  }

  async transaction<T>(work: (tx: JourneyStore) => Promise<T>): Promise<T> {
    this.assertOutsideTransaction();
    const result = this.tail.then(() => this.runTransaction(work));
    this.tail = result.catch(() => undefined);
    return result;
  }

  async close(): Promise<void> {
    await this.tail;
    await this.pool.end();
  }

  private async runTransaction<T>(work: (tx: JourneyStore) => Promise<T>): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    let discard = false;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [this.lockKey]);
      const tx = new PostgresJourneyStore(client, this.installation, this.destinationJournal);
      const value = await this.inTransaction.run(true, () => work(tx));
      await client.query("COMMIT");
      return value;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        discard = true; // conexão em estado desconhecido: não volta para o pool
      }
      throw error;
    } finally {
      client.release(discard ? true : undefined);
    }
  }

  private run<T>(operation: (store: JourneyStore) => Promise<T>): Promise<T> {
    try {
      this.assertOutsideTransaction();
    } catch (error) {
      return Promise.reject(error);
    }
    return operation(this.store);
  }

  private assertOutsideTransaction() {
    if (this.inTransaction.getStore())
      throw new LedgerUsageError("Use o `tx` recebido: o ledger externo não pode ser chamado dentro de uma transação");
  }
}
