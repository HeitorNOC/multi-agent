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
  type Conversation,
  type ConversationMessage,
  type ConversationSummary,
  type NewConversationMessage,
  type IndexableKnowledge,
  type KnowledgeSource,
  type KnowledgeVersion,
  type KnowledgeVersionInfo,
  type NewKnowledgeVersion,
  type QueueKind,
  type ReceiptRecord,
  type RecoveryCommand,
  type RecoveryCommandStatus,
  type RecoveryCommandSummary,
  type RecoverySession,
} from "./journey-ledger.ts";

export interface SqliteLedgerOptions {
  /** Diretório do estado da instalação; o arquivo é `journey.sqlite`. */
  stateDir: string;
  /** Identificador da instalação, usado nos eventos e na telemetria. */
  installation: string;
  /** Habilita o diário de destino do piloto (revogações e intenções externas). */
  destinationJournal: boolean;
  /**
   * Garante um único agendador por instalação. A trava é tomada antes de qualquer acesso ao
   * esquema e vale até `close()` ou o fim do processo. Se outro já a detém, a abertura falha.
   */
  schedulerLock: boolean;
}

/** Trava exclusiva de longa duração, mantida por uma conexão que nunca confirma a transação. */
function acquireSchedulerLock(stateDir: string): DatabaseSync {
  const owner = new DatabaseSync(join(stateDir, "scheduler-owner.sqlite"), { timeout: 0 });
  try {
    owner.exec("BEGIN EXCLUSIVE");
  } catch {
    owner.close();
    throw new LedgerUsageError("Já existe um agendador ativo para este diretório de estado");
  }
  return owner;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,goal TEXT,status TEXT,plan TEXT,review TEXT,approval TEXT,receipt TEXT,error TEXT,created TEXT);
  CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,job TEXT,at TEXT,node TEXT,detail TEXT);
  CREATE TABLE IF NOT EXISTS effects(job TEXT PRIMARY KEY,hash TEXT NOT NULL,receipt TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS pilot_reference_revocations(reference_version TEXT PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS job_queue(seq INTEGER PRIMARY KEY AUTOINCREMENT,job TEXT UNIQUE NOT NULL,kind TEXT NOT NULL,crash INTEGER NOT NULL,queued_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS job_admissions(key TEXT PRIMARY KEY,job TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,actor TEXT NOT NULL,title TEXT NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS conversation_messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,conversation TEXT NOT NULL,role TEXT NOT NULL,text TEXT NOT NULL,job TEXT,client_id TEXT,reply_to INTEGER,created TEXT NOT NULL,UNIQUE(conversation,client_id));
  CREATE TABLE IF NOT EXISTS knowledge_sources(id TEXT PRIMARY KEY,title TEXT NOT NULL,owner TEXT NOT NULL,readers TEXT NOT NULL,supersedes TEXT,created TEXT NOT NULL,revoked TEXT,revoked_by TEXT,latest_version INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS knowledge_versions(source TEXT NOT NULL,version INTEGER NOT NULL,media_type TEXT NOT NULL,filename TEXT NOT NULL,content_sha TEXT NOT NULL,bytes BLOB NOT NULL,text TEXT NOT NULL,valid_from TEXT NOT NULL,uploaded_by TEXT NOT NULL,created TEXT NOT NULL,PRIMARY KEY(source,version));
  CREATE TABLE IF NOT EXISTS recovery_sessions(hash TEXT PRIMARY KEY,actor TEXT,auth_sha TEXT,expires INTEGER);
  CREATE TABLE IF NOT EXISTS recovery_commands(id TEXT PRIMARY KEY,actor TEXT,input_sha TEXT,body TEXT,action TEXT,case_id TEXT,operation_id TEXT,evidence_sha TEXT,status TEXT,result TEXT,updated TEXT);`;

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
    const r = this.db.prepare("SELECT * FROM jobs WHERE id=?").get(id) as Row | undefined;
    // `node:sqlite` devolve objetos sem protótipo; copiar mantém o mesmo formato do PostgreSQL.
    return r && ({ ...r } as unknown as JobRecord);
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

  // Conversa ---------------------------------------------------------------
  createConversation(c: { id: string; actor: string; title: string; created: string }): void {
    this.db
      .prepare("INSERT INTO conversations(id,actor,title,created,updated) VALUES(?,?,?,?,?)")
      .run(c.id, c.actor, c.title, c.created, c.created);
  }
  getConversation(id: string): Conversation | undefined {
    const r = this.db.prepare("SELECT id,actor,title,created,updated FROM conversations WHERE id=?").get(id) as Row | undefined;
    return r && this.toConversation(r);
  }
  listConversationsForActor(actor: string): ConversationSummary[] {
    return this.rows(
      `SELECT c.id,c.actor,c.title,c.created,c.updated,
              (SELECT count(*) FROM conversation_messages m WHERE m.conversation=c.id) AS message_count
       FROM conversations c WHERE c.actor=? ORDER BY c.updated DESC, c.rowid DESC`,
      actor,
    ).map((r) => ({ ...this.toConversation(r), messageCount: Number(r.message_count) }));
  }
  appendConversationMessage(m: NewConversationMessage): ConversationMessage {
    const touched = this.db.prepare("UPDATE conversations SET updated=? WHERE id=?").run(m.created, m.conversation);
    if (!Number(touched.changes)) throw new LedgerUsageError("Conversa inexistente");
    const res = this.db
      .prepare("INSERT INTO conversation_messages(conversation,role,text,job,client_id,reply_to,created) VALUES(?,?,?,?,?,?,?)")
      .run(m.conversation, m.role, m.text, m.job ?? null, m.clientId ?? null, m.replyTo ?? null, m.created);
    return {
      seq: Number(res.lastInsertRowid),
      conversation: m.conversation,
      role: m.role,
      text: m.text,
      job: m.job ?? null,
      clientId: m.clientId ?? null,
      replyTo: m.replyTo ?? null,
      created: m.created,
    };
  }
  findConversationMessageByClientId(conversation: string, clientId: string): ConversationMessage | undefined {
    return this.toMessage(
      this.db.prepare("SELECT * FROM conversation_messages WHERE conversation=? AND client_id=?").get(conversation, clientId) as Row | undefined,
    );
  }
  findConversationReply(conversation: string, replyTo: number): ConversationMessage | undefined {
    return this.toMessage(
      this.db
        .prepare("SELECT * FROM conversation_messages WHERE conversation=? AND reply_to=? AND role='chief' ORDER BY seq LIMIT 1")
        .get(conversation, replyTo) as Row | undefined,
    );
  }
  listConversationMessages(conversation: string, page: { afterSeq?: number; limit?: number } = {}): ConversationMessage[] {
    const rows = this.db
      .prepare("SELECT * FROM conversation_messages WHERE conversation=? AND seq>? ORDER BY seq LIMIT ?")
      .all(conversation, page.afterSeq ?? 0, page.limit ?? 500) as Row[];
    return rows.map((r) => this.toMessage(r)!);
  }
  private toConversation(r: Row): Conversation {
    return { id: String(r.id), actor: String(r.actor), title: String(r.title), created: String(r.created), updated: String(r.updated) };
  }
  private toMessage(r: Row | undefined): ConversationMessage | undefined {
    return (
      r && {
        seq: Number(r.seq),
        conversation: String(r.conversation),
        role: r.role as ConversationMessage["role"],
        text: String(r.text),
        job: r.job === null ? null : String(r.job),
        clientId: r.client_id === null ? null : String(r.client_id),
        replyTo: r.reply_to === null ? null : Number(r.reply_to),
        created: String(r.created),
      }
    );
  }

  // Cérebro ----------------------------------------------------------------
  createKnowledgeSource(s: { id: string; title: string; owner: string; readers: string[]; supersedes: string | null; created: string }): void {
    this.db
      .prepare("INSERT INTO knowledge_sources(id,title,owner,readers,supersedes,created) VALUES(?,?,?,?,?,?)")
      .run(s.id, s.title, s.owner, JSON.stringify(s.readers), s.supersedes, s.created);
  }
  getKnowledgeSource(id: string): KnowledgeSource | undefined {
    const r = this.db.prepare("SELECT * FROM knowledge_sources WHERE id=?").get(id) as Row | undefined;
    return r && this.toSource(r);
  }
  listKnowledgeSources(): KnowledgeSource[] {
    return this.rows("SELECT * FROM knowledge_sources ORDER BY created DESC, rowid DESC").map((r) => this.toSource(r));
  }
  addKnowledgeVersion(v: NewKnowledgeVersion): void {
    const bumped = this.db
      .prepare("UPDATE knowledge_sources SET latest_version=? WHERE id=? AND latest_version=?")
      .run(v.version, v.source, v.version - 1);
    if (!Number(bumped.changes)) throw new LedgerUsageError("Versão fora de sequência ou fonte inexistente");
    this.db
      .prepare("INSERT INTO knowledge_versions VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(v.source, v.version, v.mediaType, v.filename, v.contentSha, v.bytes, v.text, v.validFrom, v.uploadedBy, v.created);
  }
  getKnowledgeVersion(source: string, version: number): KnowledgeVersion | undefined {
    const r = this.db.prepare("SELECT * FROM knowledge_versions WHERE source=? AND version=?").get(source, version) as Row | undefined;
    return r && { ...this.toVersionInfo(r), bytes: new Uint8Array(r.bytes as Uint8Array), text: String(r.text) };
  }
  listKnowledgeVersions(source: string): KnowledgeVersionInfo[] {
    return this.rows(
      "SELECT source,version,media_type,filename,content_sha,valid_from,uploaded_by,created,length(bytes) AS size_bytes FROM knowledge_versions WHERE source=? ORDER BY version DESC",
      source,
    ).map((r) => this.toVersionInfo(r));
  }
  revokeKnowledgeSource(id: string, actor: string, at: string): boolean {
    return Number(this.db.prepare("UPDATE knowledge_sources SET revoked=?,revoked_by=? WHERE id=? AND revoked IS NULL").run(at, actor, id).changes) > 0;
  }
  listIndexableKnowledge(): IndexableKnowledge[] {
    return this.rows(
      `SELECT s.id,s.title,s.readers,s.owner,s.supersedes,v.version,v.valid_from,v.text
       FROM knowledge_sources s JOIN knowledge_versions v ON v.source=s.id
       WHERE s.revoked IS NULL ORDER BY s.id, v.version`,
    ).map((r) => ({
      source: String(r.id),
      title: String(r.title),
      readers: JSON.parse(String(r.readers)),
      owner: String(r.owner),
      supersedes: r.supersedes === null ? null : String(r.supersedes),
      version: Number(r.version),
      validFrom: String(r.valid_from),
      text: String(r.text),
    }));
  }
  private toSource(r: Row): KnowledgeSource {
    return {
      id: String(r.id),
      title: String(r.title),
      owner: String(r.owner),
      readers: JSON.parse(String(r.readers)),
      supersedes: r.supersedes === null ? null : String(r.supersedes),
      created: String(r.created),
      revoked: r.revoked === null ? null : String(r.revoked),
      revokedBy: r.revoked_by === null ? null : String(r.revoked_by),
      latestVersion: Number(r.latest_version),
    };
  }
  private toVersionInfo(r: Row): KnowledgeVersionInfo {
    return {
      source: String(r.source),
      version: Number(r.version),
      mediaType: String(r.media_type),
      filename: String(r.filename),
      contentSha: String(r.content_sha),
      validFrom: String(r.valid_from),
      uploadedBy: String(r.uploaded_by),
      created: String(r.created),
      sizeBytes: r.size_bytes !== undefined ? Number(r.size_bytes) : (r.bytes as Uint8Array).length,
    };
  }

  // Central de recuperação ------------------------------------------------
  createRecoverySession(s: RecoverySession): void {
    this.db.prepare("INSERT INTO recovery_sessions VALUES(?,?,?,?)").run(s.hash, s.actor, s.authSha, s.expires);
  }
  findRecoverySession(hash: string): RecoverySession | undefined {
    const r = this.db.prepare("SELECT * FROM recovery_sessions WHERE hash=?").get(hash) as Row | undefined;
    return r && { hash: String(r.hash), actor: String(r.actor), authSha: String(r.auth_sha), expires: Number(r.expires) };
  }
  deleteRecoverySession(hash: string): void {
    this.db.prepare("DELETE FROM recovery_sessions WHERE hash=?").run(hash);
  }
  getRecoveryCommand(id: string): RecoveryCommand | undefined {
    return this.toCommand(this.db.prepare("SELECT * FROM recovery_commands WHERE id=?").get(id) as Row | undefined);
  }
  getRecoveryCommandForActor(id: string, actor: string): RecoveryCommand | undefined {
    return this.toCommand(
      this.db.prepare("SELECT * FROM recovery_commands WHERE id=? AND actor=?").get(id, actor) as Row | undefined,
    );
  }
  insertRecoveryCommand(c: RecoveryCommand): void {
    this.db
      .prepare("INSERT INTO recovery_commands VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run(c.id, c.actor, c.inputSha, c.body, c.action, c.caseId, c.operationId, c.evidenceSha, c.status, c.result, c.updated);
  }
  updateRecoveryCommandStatus(id: string, status: RecoveryCommandStatus, updated: string, result?: string): void {
    if (result === undefined)
      this.db.prepare("UPDATE recovery_commands SET status=?,updated=? WHERE id=?").run(status, updated, id);
    else this.db.prepare("UPDATE recovery_commands SET status=?,result=?,updated=? WHERE id=?").run(status, result, updated, id);
  }
  listDispatchingRecoveryCommands(): { id: string; caseId: string }[] {
    return this.rows("SELECT id,case_id FROM recovery_commands WHERE status='dispatching'").map((r) => ({
      id: String(r.id),
      caseId: String(r.case_id),
    }));
  }
  listRecoveryCommandsForActor(actor: string): RecoveryCommandSummary[] {
    return this.rows(
      "SELECT id,actor,action,case_id,operation_id,evidence_sha,status,updated FROM recovery_commands WHERE actor=? ORDER BY updated DESC",
      actor,
    ).map((r) => ({
      id: String(r.id),
      actor: String(r.actor),
      action: String(r.action),
      caseId: String(r.case_id),
      operationId: String(r.operation_id),
      evidenceSha: String(r.evidence_sha),
      status: r.status as RecoveryCommandStatus,
      updated: String(r.updated),
    }));
  }
  private toCommand(r: Row | undefined): RecoveryCommand | undefined {
    return (
      r && {
        id: String(r.id),
        actor: String(r.actor),
        inputSha: String(r.input_sha),
        body: String(r.body),
        action: String(r.action),
        caseId: String(r.case_id),
        operationId: String(r.operation_id),
        evidenceSha: String(r.evidence_sha),
        status: r.status as RecoveryCommandStatus,
        result: r.result === null ? null : String(r.result),
        updated: String(r.updated),
      }
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
  async createConversation(c: { id: string; actor: string; title: string; created: string }) { this.core.createConversation(c); }
  async getConversation(id: string) { return this.core.getConversation(id); }
  async listConversationsForActor(actor: string) { return this.core.listConversationsForActor(actor); }
  async appendConversationMessage(m: NewConversationMessage) { return this.core.appendConversationMessage(m); }
  async findConversationMessageByClientId(conversation: string, clientId: string) { return this.core.findConversationMessageByClientId(conversation, clientId); }
  async findConversationReply(conversation: string, replyTo: number) { return this.core.findConversationReply(conversation, replyTo); }
  async listConversationMessages(conversation: string, page?: { afterSeq?: number; limit?: number }) { return this.core.listConversationMessages(conversation, page); }
  async createKnowledgeSource(s: { id: string; title: string; owner: string; readers: string[]; supersedes: string | null; created: string }) { this.core.createKnowledgeSource(s); }
  async getKnowledgeSource(id: string) { return this.core.getKnowledgeSource(id); }
  async listKnowledgeSources() { return this.core.listKnowledgeSources(); }
  async addKnowledgeVersion(v: NewKnowledgeVersion) { this.core.addKnowledgeVersion(v); }
  async getKnowledgeVersion(source: string, version: number) { return this.core.getKnowledgeVersion(source, version); }
  async listKnowledgeVersions(source: string) { return this.core.listKnowledgeVersions(source); }
  async revokeKnowledgeSource(id: string, actor: string, at: string) { return this.core.revokeKnowledgeSource(id, actor, at); }
  async listIndexableKnowledge() { return this.core.listIndexableKnowledge(); }
  async createRecoverySession(s: RecoverySession) { this.core.createRecoverySession(s); }
  async findRecoverySession(hash: string) { return this.core.findRecoverySession(hash); }
  async deleteRecoverySession(hash: string) { this.core.deleteRecoverySession(hash); }
  async getRecoveryCommand(id: string) { return this.core.getRecoveryCommand(id); }
  async getRecoveryCommandForActor(id: string, actor: string) { return this.core.getRecoveryCommandForActor(id, actor); }
  async insertRecoveryCommand(c: RecoveryCommand) { this.core.insertRecoveryCommand(c); }
  async updateRecoveryCommandStatus(id: string, status: RecoveryCommandStatus, updated: string, result?: string) { this.core.updateRecoveryCommandStatus(id, status, updated, result); }
  async listDispatchingRecoveryCommands() { return this.core.listDispatchingRecoveryCommands(); }
  async listRecoveryCommandsForActor(actor: string) { return this.core.listRecoveryCommandsForActor(actor); }
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
  private schedulerOwner: DatabaseSync | undefined;

  constructor(options: SqliteLedgerOptions) {
    mkdirSync(options.stateDir, { recursive: true });
    if (options.schedulerLock) this.schedulerOwner = acquireSchedulerLock(options.stateDir);
    try {
      const db = new DatabaseSync(join(options.stateDir, "journey.sqlite"));
      this.core = new SqliteJourneyCore(db, options.installation, options.destinationJournal);
    } catch (error) {
      this.schedulerOwner?.close();
      throw error;
    }
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

  createConversation = (c: { id: string; actor: string; title: string; created: string }) => this.run((st) => st.createConversation(c));
  getConversation = (id: string) => this.run((st) => st.getConversation(id));
  listConversationsForActor = (actor: string) => this.run((st) => st.listConversationsForActor(actor));
  appendConversationMessage = (m: NewConversationMessage) => this.run((st) => st.appendConversationMessage(m));
  findConversationMessageByClientId = (conversation: string, clientId: string) => this.run((st) => st.findConversationMessageByClientId(conversation, clientId));
  findConversationReply = (conversation: string, replyTo: number) => this.run((st) => st.findConversationReply(conversation, replyTo));
  listConversationMessages = (conversation: string, page?: { afterSeq?: number; limit?: number }) => this.run((st) => st.listConversationMessages(conversation, page));
  createKnowledgeSource = (s: { id: string; title: string; owner: string; readers: string[]; supersedes: string | null; created: string }) => this.run((st) => st.createKnowledgeSource(s));
  getKnowledgeSource = (id: string) => this.run((st) => st.getKnowledgeSource(id));
  listKnowledgeSources = () => this.run((st) => st.listKnowledgeSources());
  addKnowledgeVersion = (v: NewKnowledgeVersion) => this.run((st) => st.addKnowledgeVersion(v));
  getKnowledgeVersion = (source: string, version: number) => this.run((st) => st.getKnowledgeVersion(source, version));
  listKnowledgeVersions = (source: string) => this.run((st) => st.listKnowledgeVersions(source));
  revokeKnowledgeSource = (id: string, actor: string, at: string) => this.run((st) => st.revokeKnowledgeSource(id, actor, at));
  listIndexableKnowledge = () => this.run((st) => st.listIndexableKnowledge());
  createRecoverySession = (s: RecoverySession) => this.run((st) => st.createRecoverySession(s));
  findRecoverySession = (hash: string) => this.run((st) => st.findRecoverySession(hash));
  deleteRecoverySession = (hash: string) => this.run((st) => st.deleteRecoverySession(hash));
  getRecoveryCommand = (id: string) => this.run((st) => st.getRecoveryCommand(id));
  getRecoveryCommandForActor = (id: string, actor: string) => this.run((st) => st.getRecoveryCommandForActor(id, actor));
  insertRecoveryCommand = (c: RecoveryCommand) => this.run((st) => st.insertRecoveryCommand(c));
  updateRecoveryCommandStatus = (id: string, status: RecoveryCommandStatus, updated: string, result?: string) => this.run((st) => st.updateRecoveryCommandStatus(id, status, updated, result));
  listDispatchingRecoveryCommands = () => this.run((st) => st.listDispatchingRecoveryCommands());
  listRecoveryCommandsForActor = (actor: string) => this.run((st) => st.listRecoveryCommandsForActor(actor));

  setSingleActiveJob = (enabled: boolean) =>
    this.exclusive(async () => this.core.setSingleActiveJob(enabled));

  async transaction<T>(work: (tx: JourneyStore) => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      this.core.db.exec("BEGIN IMMEDIATE");
      try {
        const value = await this.inTransaction.run(true, () => work(this.store));
        this.core.db.exec("COMMIT");
        return value;
      } catch (error) {
        this.core.db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  async close(): Promise<void> {
    await this.exclusive(async () => {
      this.core.db.close();
      this.schedulerOwner?.close();
    });
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
