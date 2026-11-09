/**
 * Adaptador SQLite da porta `JourneyLedger`.
 *
 * Estrutura em duas camadas:
 *  - `SqliteJourneyCore`: operações síncronas sobre uma conexão `node:sqlite`. É a única
 *    peça que conhece SQL e o esquema.
 *  - `SqliteJourneyLedger`: fachada assíncrona. Serializa o acesso à conexão com um mutex,
 *    porque uma única conexão não suporta transações concorrentes: sem isso, uma leitura
 *    de outro pedido cairia dentro da transação aberta (leitura suja) ou tentaria abrir
 *    uma transação aninhada.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Events } from "../telemetry.ts";
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

export interface SqliteLedgerOptions {
  /** Diretório do estado da instalação; o arquivo é `journey.sqlite`. */
  stateDir: string;
  /** Identificador da instalação, usado nos eventos e na telemetria. */
  installation: string;
  /** Habilita o diário de destino do piloto (revogações e intenções externas). */
  destinationJournal: boolean;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,goal TEXT,status TEXT,plan TEXT,review TEXT,approval TEXT,receipt TEXT,error TEXT,created TEXT);
  CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,job TEXT,at TEXT,node TEXT,detail TEXT);
  CREATE TABLE IF NOT EXISTS effects(job TEXT PRIMARY KEY,hash TEXT NOT NULL,receipt TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS pilot_reference_revocations(reference_version TEXT PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS job_queue(seq INTEGER PRIMARY KEY AUTOINCREMENT,job TEXT UNIQUE NOT NULL,kind TEXT NOT NULL,crash INTEGER NOT NULL,queued_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS job_admissions(key TEXT PRIMARY KEY,job TEXT NOT NULL);`;

const DESTINATION_SCHEMA = `
  CREATE TABLE IF NOT EXISTS pilot_destination_revocations(scope TEXT PRIMARY KEY, acknowledged INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS pilot_destination_intents(job TEXT PRIMARY KEY, intent TEXT NOT NULL);`;

type Row = Record<string, unknown>;

export class SqliteJourneyCore {
  readonly db: DatabaseSync;
  readonly events: Events;
  private readonly destinationJournal: boolean;

  constructor(db: DatabaseSync, installation: string, destinationJournal: boolean) {
    this.db = db;
    this.destinationJournal = destinationJournal;
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    db.exec(SCHEMA);
    if (destinationJournal) db.exec(DESTINATION_SCHEMA);
    else if (db.prepare("SELECT 1 FROM sqlite_master WHERE name='pilot_destination_intents'").get())
      throw new Error("Esta sessão possui um diário de destino e requer sua configuração");
    this.events = new Events(db, installation);
  }

  /** Mantém o nome histórico do índice para continuar válido em instalações existentes. */
  setSingleActiveJob(enabled: boolean): void {
    this.db.exec(
      enabled
        ? "CREATE UNIQUE INDEX IF NOT EXISTS one_running_job ON jobs((1)) WHERE status IN ('created','running')"
        : "DROP INDEX IF EXISTS one_running_job",
    );
  }

  // Trabalhos ---------------------------------------------------------------
  getJob(id: string): JobRecord | undefined {
    return this.db.prepare("SELECT * FROM jobs WHERE id=?").get(id) as JobRecord | undefined;
  }
  listJobIds(): string[] {
    return this.rows("SELECT id FROM jobs ORDER BY created DESC,rowid DESC").map((r) => String(r.id));
  }
  listJobIdsByStatus(status: JobStatus): string[] {
    return this.rows("SELECT id FROM jobs WHERE status=?", status).map((r) => String(r.id));
  }
  latestJobForGoal(goal: string) {
    const r = this.db
      .prepare("SELECT id,status FROM jobs WHERE goal=? ORDER BY rowid DESC LIMIT 1")
      .get(goal) as { id: string; status: JobStatus } | undefined;
    return r && { id: r.id, status: r.status };
  }
  insertJob(job: NewJob): void {
    this.db
      .prepare("INSERT INTO jobs(id,goal,status,review,created) VALUES(?,?,?,?,?)")
      .run(job.id, job.goal, job.status, job.review ?? null, job.created);
  }
  updateJob(id: string, patch: JobPatch, guard?: JobGuard): boolean {
    const columns = patchedColumns(patch);
    const values = columns.map((c) => patch[c] ?? null);
    let sql = `UPDATE jobs SET ${columns.map((c) => `${c}=?`).join(",")} WHERE id=?`;
    const params: (string | null)[] = [...values, id];
    if (guard) {
      if (!guard.statusIn.length) return false;
      sql += ` AND status IN (${guard.statusIn.map(() => "?").join(",")})`;
      params.push(...guard.statusIn);
    }
    return Number(this.db.prepare(sql).run(...params).changes) > 0;
  }

  // Eventos -----------------------------------------------------------------
  appendEvent(job: string, node: string, detail: unknown, eventId?: string): AppendedEvent {
    return this.events.append(job, node, detail, eventId) as AppendedEvent;
  }
  listEvents(job: string): EventRecord[] {
    return this.rows("SELECT seq,at,node,detail FROM events WHERE job=? ORDER BY seq", job).map(
      (r) => ({ seq: Number(r.seq), at: String(r.at), node: String(r.node), detail: String(r.detail) }),
    );
  }
  trace(job: string): unknown {
    return this.events.trace(job);
  }

  // Fila --------------------------------------------------------------------
  enqueue(e: { job: string; kind: QueueKind; crash: boolean; queuedAt: string }): QueueEntry {
    const res = this.db
      .prepare("INSERT INTO job_queue(job,kind,crash,queued_at) VALUES(?,?,?,?)")
      .run(e.job, e.kind, Number(e.crash), e.queuedAt);
    return { seq: Number(res.lastInsertRowid), ...e };
  }
  peekQueue(): QueueEntry | undefined {
    const r = this.db.prepare("SELECT * FROM job_queue ORDER BY seq LIMIT 1").get() as Row | undefined;
    return r && {
      seq: Number(r.seq),
      job: String(r.job),
      kind: r.kind as QueueKind,
      crash: Number(r.crash) === 1,
      queuedAt: String(r.queued_at),
    };
  }
  dequeue(seq: number, job: string): boolean {
    return Number(this.db.prepare("DELETE FROM job_queue WHERE seq=? AND job=?").run(seq, job).changes) > 0;
  }
  queueDepth(): QueueDepth {
    const r = this.db
      .prepare("SELECT count(*) AS total, coalesce(sum(kind='new'),0) AS fresh FROM job_queue")
      .get() as Row;
    return { total: Number(r.total), newRequests: Number(r.fresh) };
  }

  // Admissão ----------------------------------------------------------------
  findAdmittedJob(key: string): string | undefined {
    const r = this.db.prepare("SELECT job FROM job_admissions WHERE key=?").get(key) as Row | undefined;
    return r ? String(r.job) : undefined;
  }
  recordAdmission(key: string, job: string): void {
    this.db.prepare("INSERT INTO job_admissions VALUES(?,?)").run(key, job);
  }

  // Efeitos -----------------------------------------------------------------
  getEffect(job: string): ReceiptRecord | undefined {
    const r = this.db.prepare("SELECT hash,receipt FROM effects WHERE job=?").get(job) as ReceiptRecord | undefined;
    return r && { hash: r.hash, receipt: r.receipt };
  }
  recordEffect(job: string, hash: string, receipt: string): void {
    this.db.prepare("INSERT INTO effects VALUES(?,?,?)").run(job, hash, receipt);
  }

  // Revogação de referência -------------------------------------------------
  revokeReference(version: string): boolean {
    return Number(this.db.prepare("INSERT OR IGNORE INTO pilot_reference_revocations VALUES(?)").run(version).changes) > 0;
  }
  isReferenceRevoked(version: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM pilot_reference_revocations WHERE reference_version=?").get(version);
  }

  // Diário de destino -------------------------------------------------------
  revokeDestinationScope(scope: string): boolean {
    this.requireDestinationJournal();
    return Number(this.db.prepare("INSERT OR IGNORE INTO pilot_destination_revocations(scope) VALUES(?)").run(scope).changes) > 0;
  }
  isDestinationRevocationAcknowledged(scope: string): boolean {
    this.requireDestinationJournal();
    return !!this.db.prepare("SELECT 1 FROM pilot_destination_revocations WHERE scope=? AND acknowledged=1").get(scope);
  }
  acknowledgeDestinationRevocation(scope: string): boolean {
    this.requireDestinationJournal();
    return Number(this.db.prepare("UPDATE pilot_destination_revocations SET acknowledged=1 WHERE scope=? AND acknowledged=0").run(scope).changes) > 0;
  }
  getDestinationIntent(job: string): string | undefined {
    this.requireDestinationJournal();
    const r = this.db.prepare("SELECT intent FROM pilot_destination_intents WHERE job=?").get(job) as Row | undefined;
    return r ? String(r.intent) : undefined;
  }
  recordDestinationIntent(job: string, intent: string): void {
    this.requireDestinationJournal();
    this.db.prepare("INSERT INTO pilot_destination_intents VALUES(?,?)").run(job, intent);
  }
  hasPendingDestinationWork(): boolean {
    if (!this.destinationJournal) return false;
    return !!(
      this.db.prepare("SELECT 1 FROM pilot_destination_revocations WHERE acknowledged=0 LIMIT 1").get() ||
      this.db.prepare("SELECT 1 FROM pilot_destination_intents i LEFT JOIN effects e ON e.job=i.job WHERE e.job IS NULL LIMIT 1").get()
    );
  }

  private requireDestinationJournal() {
    if (!this.destinationJournal) throw new LedgerUsageError("O diário de destino não está habilitado");
  }
  private rows(sql: string, ...params: string[]): Row[] {
    return this.db.prepare(sql).all(...params) as Row[];
  }
}

/** Visão assíncrona do núcleo: cada método apenas repassa a chamada síncrona. */
class SqliteJourneyStore implements JourneyStore {
  private readonly core: SqliteJourneyCore;
  constructor(core: SqliteJourneyCore) {
    this.core = core;
  }
  async getJob(id: string) { return this.core.getJob(id); }
  async listJobIds() { return this.core.listJobIds(); }
  async listJobIdsByStatus(status: JobStatus) { return this.core.listJobIdsByStatus(status); }
  async latestJobForGoal(goal: string) { return this.core.latestJobForGoal(goal); }
  async insertJob(job: NewJob) { this.core.insertJob(job); }
  async updateJob(id: string, patch: JobPatch, guard?: JobGuard) { return this.core.updateJob(id, patch, guard); }
  async appendEvent(job: string, node: string, detail: unknown, eventId?: string) { return this.core.appendEvent(job, node, detail, eventId); }
  async listEvents(job: string) { return this.core.listEvents(job); }
  async trace(job: string) { return this.core.trace(job); }
  async enqueue(entry: { job: string; kind: QueueKind; crash: boolean; queuedAt: string }) { return this.core.enqueue(entry); }
  async peekQueue() { return this.core.peekQueue(); }
  async dequeue(seq: number, job: string) { return this.core.dequeue(seq, job); }
  async queueDepth() { return this.core.queueDepth(); }
  async findAdmittedJob(key: string) { return this.core.findAdmittedJob(key); }
  async recordAdmission(key: string, job: string) { this.core.recordAdmission(key, job); }
  async getEffect(job: string) { return this.core.getEffect(job); }
  async recordEffect(job: string, hash: string, receipt: string) { this.core.recordEffect(job, hash, receipt); }
  async revokeReference(version: string) { return this.core.revokeReference(version); }
  async isReferenceRevoked(version: string) { return this.core.isReferenceRevoked(version); }
  async revokeDestinationScope(scope: string) { return this.core.revokeDestinationScope(scope); }
  async isDestinationRevocationAcknowledged(scope: string) { return this.core.isDestinationRevocationAcknowledged(scope); }
  async acknowledgeDestinationRevocation(scope: string) { return this.core.acknowledgeDestinationRevocation(scope); }
  async getDestinationIntent(job: string) { return this.core.getDestinationIntent(job); }
  async recordDestinationIntent(job: string, intent: string) { this.core.recordDestinationIntent(job, intent); }
  async hasPendingDestinationWork() { return this.core.hasPendingDestinationWork(); }
}

/**
 * Ledger completo. Cada operação fora de transação entra na fila do mutex; dentro de
 * `transaction` o chamador usa o `tx`, que já está sob o mutex.
 */
export class SqliteJourneyLedger implements JourneyLedger {
  readonly core: SqliteJourneyCore;
  private readonly store: JourneyStore;
  /** Marca o contexto assíncrono que já está dentro de uma transação. */
  private readonly inTransaction = new AsyncLocalStorage<true>();
  private tail: Promise<unknown> = Promise.resolve();
  private transactionOpen = false;

  constructor(options: SqliteLedgerOptions) {
    mkdirSync(options.stateDir, { recursive: true });
    const db = new DatabaseSync(join(options.stateDir, "journey.sqlite"));
    this.core = new SqliteJourneyCore(db, options.installation, options.destinationJournal);
    this.store = new SqliteJourneyStore(this.core);
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

  setSingleActiveJob = (enabled: boolean) =>
    this.exclusive(async () => this.core.setSingleActiveJob(enabled));

  async transaction<T>(work: (tx: JourneyStore) => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      this.core.db.exec("BEGIN IMMEDIATE");
      this.transactionOpen = true;
      try {
        const value = await this.inTransaction.run(true, () => work(this.store));
        this.core.db.exec("COMMIT");
        return value;
      } catch (error) {
        this.core.db.exec("ROLLBACK");
        throw error;
      } finally {
        this.transactionOpen = false;
      }
    });
  }

  async close(): Promise<void> {
    await this.exclusive(async () => this.core.db.close());
  }

  /**
   * Acesso síncrono temporário para a central de recuperação, que ainda não usa a porta.
   * `assertNoOpenTransaction` falha de forma explícita se houver uma transação assíncrona
   * aberta, em vez de abrir uma transação aninhada. Remover quando a recuperação migrar.
   */
  legacySynchronousAccess(): { core: SqliteJourneyCore; assertNoOpenTransaction(): void } {
    return {
      core: this.core,
      assertNoOpenTransaction: () => {
        if (this.transactionOpen)
          throw new LedgerUsageError("Há uma transação do ledger em andamento; tente novamente");
      },
    };
  }

  private run<T>(operation: (store: JourneyStore) => Promise<T>): Promise<T> {
    return this.exclusive(() => operation(this.store));
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (this.inTransaction.getStore())
      return Promise.reject(
        new LedgerUsageError("Use o `tx` recebido: o ledger externo não pode ser chamado dentro de uma transação"),
      );
    const result = this.tail.then(work, work);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
