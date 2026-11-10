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
  type Conversation,
  type ConversationMessage,
  type ConversationSummary,
  type NewConversationMessage,
  type IndexableKnowledge,
  type InferenceRecord,
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
import { applyMigrations } from "./postgres-migrate.ts";

const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations/", import.meta.url));
const SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

/** Chave estável de advisory lock a partir de um nome; cabe em 48 bits, portanto em int8. */
function lockKey(name: string): number {
  return parseInt(createHash("sha256").update(name).digest("hex").slice(0, 12), 16);
}

/** Chave da trava de agendador de uma instalação; a migração de dados a usa para excluir servidores. */
export function schedulerLockKey(installation: string, schema?: string): number {
  return lockKey(`scheduler:${installation}:${schema ?? ""}`);
}

export interface PostgresLedgerOptions {
  connectionString: string;
  /** Esquema dedicado (útil para isolar testes). Omitido: usa o esquema padrão do usuário. */
  schema?: string;
  installation: string;
  destinationJournal: boolean;
  /** Máximo de conexões do pool. */
  poolSize?: number;
  /**
   * Garante um único agendador por instalação com um advisory lock de sessão, mantido por
   * uma conexão dedicada até `close()`. Se o processo morrer, o servidor libera a trava.
   */
  schedulerLock: boolean;
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

  // Conversa ---------------------------------------------------------------
  async createConversation(c: { id: string; actor: string; title: string; created: string }): Promise<void> {
    await this.db.query("INSERT INTO conversations(id,actor,title,created,updated) VALUES($1,$2,$3,$4,$4)", [
      c.id,
      c.actor,
      c.title,
      c.created,
    ]);
  }
  async getConversation(id: string): Promise<Conversation | undefined> {
    const { rows } = await this.db.query("SELECT id,actor,title,created,updated FROM conversations WHERE id=$1", [id]);
    return rows[0] && this.toConversation(rows[0]);
  }
  async listConversationsForActor(actor: string): Promise<ConversationSummary[]> {
    const { rows } = await this.db.query(
      `SELECT c.id,c.actor,c.title,c.created,c.updated,
              (SELECT count(*) FROM conversation_messages m WHERE m.conversation=c.id) AS message_count
       FROM conversations c WHERE c.actor=$1 ORDER BY c.updated DESC, c.ordinal DESC`,
      [actor],
    );
    return rows.map((r) => ({ ...this.toConversation(r), messageCount: Number(r.message_count) }));
  }
  async appendConversationMessage(m: NewConversationMessage): Promise<ConversationMessage> {
    const touched = await this.db.query("UPDATE conversations SET updated=$1 WHERE id=$2", [m.created, m.conversation]);
    if (!touched.rowCount) throw new LedgerUsageError("Conversa inexistente");
    const { rows } = await this.db.query(
      `INSERT INTO conversation_messages(conversation,role,text,job,client_id,reply_to,created)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING seq`,
      [m.conversation, m.role, m.text, m.job ?? null, m.clientId ?? null, m.replyTo ?? null, m.created],
    );
    return {
      seq: Number(rows[0].seq),
      conversation: m.conversation,
      role: m.role,
      text: m.text,
      job: m.job ?? null,
      clientId: m.clientId ?? null,
      replyTo: m.replyTo ?? null,
      created: m.created,
    };
  }
  async findConversationMessageByClientId(conversation: string, clientId: string): Promise<ConversationMessage | undefined> {
    const { rows } = await this.db.query("SELECT * FROM conversation_messages WHERE conversation=$1 AND client_id=$2", [conversation, clientId]);
    return this.toMessage(rows[0]);
  }
  async findConversationReply(conversation: string, replyTo: number): Promise<ConversationMessage | undefined> {
    const { rows } = await this.db.query(
      "SELECT * FROM conversation_messages WHERE conversation=$1 AND reply_to=$2 AND role='chief' ORDER BY seq LIMIT 1",
      [conversation, replyTo],
    );
    return this.toMessage(rows[0]);
  }
  async listConversationMessages(conversation: string, page: { afterSeq?: number; limit?: number } = {}): Promise<ConversationMessage[]> {
    const { rows } = await this.db.query(
      "SELECT * FROM conversation_messages WHERE conversation=$1 AND seq>$2 ORDER BY seq LIMIT $3",
      [conversation, page.afterSeq ?? 0, page.limit ?? 500],
    );
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
  async createKnowledgeSource(s: { id: string; title: string; owner: string; readers: string[]; supersedes: string | null; created: string }): Promise<void> {
    await this.db.query("INSERT INTO knowledge_sources(id,title,owner,readers,supersedes,created) VALUES($1,$2,$3,$4,$5,$6)", [
      s.id,
      s.title,
      s.owner,
      JSON.stringify(s.readers),
      s.supersedes,
      s.created,
    ]);
  }
  async getKnowledgeSource(id: string): Promise<KnowledgeSource | undefined> {
    const { rows } = await this.db.query("SELECT * FROM knowledge_sources WHERE id=$1", [id]);
    return rows[0] && this.toSource(rows[0]);
  }
  async listKnowledgeSources(): Promise<KnowledgeSource[]> {
    const { rows } = await this.db.query("SELECT * FROM knowledge_sources ORDER BY created DESC, ordinal DESC");
    return rows.map((r) => this.toSource(r));
  }
  async addKnowledgeVersion(v: NewKnowledgeVersion): Promise<void> {
    const bumped = await this.db.query(
      "UPDATE knowledge_sources SET latest_version=$1 WHERE id=$2 AND latest_version=$3",
      [v.version, v.source, v.version - 1],
    );
    if (!bumped.rowCount) throw new LedgerUsageError("Versão fora de sequência ou fonte inexistente");
    await this.db.query(
      `INSERT INTO knowledge_versions(source,version,media_type,filename,content_sha,bytes,text,valid_from,uploaded_by,created)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [v.source, v.version, v.mediaType, v.filename, v.contentSha, Buffer.from(v.bytes), v.text, v.validFrom, v.uploadedBy, v.created],
    );
  }
  async getKnowledgeVersion(source: string, version: number): Promise<KnowledgeVersion | undefined> {
    const { rows } = await this.db.query("SELECT * FROM knowledge_versions WHERE source=$1 AND version=$2", [source, version]);
    const r = rows[0];
    return r && { ...this.toVersionInfo(r), bytes: new Uint8Array(r.bytes as Buffer), text: String(r.text) };
  }
  async listKnowledgeVersions(source: string): Promise<KnowledgeVersionInfo[]> {
    const { rows } = await this.db.query(
      `SELECT source,version,media_type,filename,content_sha,valid_from,uploaded_by,created,octet_length(bytes) AS size_bytes
       FROM knowledge_versions WHERE source=$1 ORDER BY version DESC`,
      [source],
    );
    return rows.map((r) => this.toVersionInfo(r));
  }
  async revokeKnowledgeSource(id: string, actor: string, at: string): Promise<boolean> {
    const r = await this.db.query("UPDATE knowledge_sources SET revoked=$1,revoked_by=$2 WHERE id=$3 AND revoked IS NULL", [at, actor, id]);
    return (r.rowCount ?? 0) > 0;
  }
  async listIndexableKnowledge(): Promise<IndexableKnowledge[]> {
    const { rows } = await this.db.query(
      `SELECT s.id,s.title,s.readers,s.owner,s.supersedes,v.version,v.valid_from,v.text
       FROM knowledge_sources s JOIN knowledge_versions v ON v.source=s.id
       WHERE s.revoked IS NULL ORDER BY s.id, v.version`,
    );
    return rows.map((r) => ({
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
      sizeBytes: r.size_bytes !== undefined ? Number(r.size_bytes) : (r.bytes as Buffer).length,
    };
  }

  // Recibos de inferência ---------------------------------------------------
  async reserveInference(e: { job: string; slot: string; inputSha: string; created: string }) {
    const inserted = await this.db.query(
      `INSERT INTO inference_receipts(job,slot,input_sha,state,created,updated)
       VALUES($1,$2,$3,'reserved',$4,$4) ON CONFLICT (job,slot) DO NOTHING`,
      [e.job, e.slot, e.inputSha, e.created],
    );
    return { created: (inserted.rowCount ?? 0) > 0, record: (await this.getInference(e.job, e.slot))! };
  }
  async completeInference(job: string, slot: string, output: string, usage: string, at: string): Promise<boolean> {
    const r = await this.db.query(
      "UPDATE inference_receipts SET state='completed',output=$1,usage=$2,updated=$3 WHERE job=$4 AND slot=$5 AND state='reserved'",
      [output, usage, at, job, slot],
    );
    return (r.rowCount ?? 0) > 0;
  }
  async releaseInference(job: string, slot: string): Promise<boolean> {
    const r = await this.db.query("DELETE FROM inference_receipts WHERE job=$1 AND slot=$2 AND state='reserved'", [job, slot]);
    return (r.rowCount ?? 0) > 0;
  }
  async getInference(job: string, slot: string): Promise<InferenceRecord | undefined> {
    const { rows } = await this.db.query("SELECT * FROM inference_receipts WHERE job=$1 AND slot=$2", [job, slot]);
    return rows[0] && this.toInference(rows[0]);
  }
  async listInferences(job: string): Promise<InferenceRecord[]> {
    const { rows } = await this.db.query("SELECT * FROM inference_receipts WHERE job=$1 ORDER BY ordinal", [job]);
    return rows.map((r) => this.toInference(r));
  }
  private toInference(r: Row): InferenceRecord {
    return {
      job: String(r.job),
      slot: String(r.slot),
      inputSha: String(r.input_sha),
      state: r.state as InferenceRecord["state"],
      output: r.output === null ? null : String(r.output),
      usage: r.usage === null ? null : String(r.usage),
      created: String(r.created),
      updated: String(r.updated),
    };
  }

  // Central de recuperação ------------------------------------------------
  async createRecoverySession(s: RecoverySession): Promise<void> {
    await this.db.query("INSERT INTO recovery_sessions(hash,actor,auth_sha,expires) VALUES($1,$2,$3,$4)", [
      s.hash,
      s.actor,
      s.authSha,
      s.expires,
    ]);
  }
  async findRecoverySession(hash: string): Promise<RecoverySession | undefined> {
    const { rows } = await this.db.query("SELECT hash,actor,auth_sha,expires FROM recovery_sessions WHERE hash=$1", [hash]);
    const r = rows[0] as Row | undefined;
    return r && { hash: String(r.hash), actor: String(r.actor), authSha: String(r.auth_sha), expires: Number(r.expires) };
  }
  async deleteRecoverySession(hash: string): Promise<void> {
    await this.db.query("DELETE FROM recovery_sessions WHERE hash=$1", [hash]);
  }
  async getRecoveryCommand(id: string): Promise<RecoveryCommand | undefined> {
    const { rows } = await this.db.query("SELECT * FROM recovery_commands WHERE id=$1", [id]);
    return this.toCommand(rows[0]);
  }
  async getRecoveryCommandForActor(id: string, actor: string): Promise<RecoveryCommand | undefined> {
    const { rows } = await this.db.query("SELECT * FROM recovery_commands WHERE id=$1 AND actor=$2", [id, actor]);
    return this.toCommand(rows[0]);
  }
  async insertRecoveryCommand(c: RecoveryCommand): Promise<void> {
    await this.db.query(
      `INSERT INTO recovery_commands(id,actor,input_sha,body,action,case_id,operation_id,evidence_sha,status,result,updated)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [c.id, c.actor, c.inputSha, c.body, c.action, c.caseId, c.operationId, c.evidenceSha, c.status, c.result, c.updated],
    );
  }
  async updateRecoveryCommandStatus(
    id: string,
    status: RecoveryCommandStatus,
    updated: string,
    result?: string,
  ): Promise<void> {
    if (result === undefined)
      await this.db.query("UPDATE recovery_commands SET status=$1,updated=$2 WHERE id=$3", [status, updated, id]);
    else
      await this.db.query("UPDATE recovery_commands SET status=$1,result=$2,updated=$3 WHERE id=$4", [
        status,
        result,
        updated,
        id,
      ]);
  }
  async listDispatchingRecoveryCommands(): Promise<{ id: string; caseId: string }[]> {
    const { rows } = await this.db.query("SELECT id,case_id FROM recovery_commands WHERE status='dispatching'");
    return rows.map((r) => ({ id: String(r.id), caseId: String(r.case_id) }));
  }
  async listRecoveryCommandsForActor(actor: string): Promise<RecoveryCommandSummary[]> {
    const { rows } = await this.db.query(
      `SELECT id,actor,action,case_id,operation_id,evidence_sha,status,updated
       FROM recovery_commands WHERE actor=$1 ORDER BY updated DESC`,
      [actor],
    );
    return rows.map((r) => ({
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
  private readonly schedulerClient: PoolClient | undefined;
  private readonly schedulerKey: number | undefined;

  private constructor(
    pool: Pool,
    options: PostgresLedgerOptions,
    scheduler?: { client: PoolClient; key: number },
  ) {
    this.schedulerClient = scheduler?.client;
    this.schedulerKey = scheduler?.key;
    this.pool = pool;
    this.installation = options.installation;
    this.destinationJournal = options.destinationJournal;
    this.store = new PostgresJourneyStore(pool, options.installation, options.destinationJournal);
    // Uma chave estável por instalação; cabe em 48 bits, portanto em int8.
    this.lockKey = lockKey("journey:" + options.installation);
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
    let scheduler: { client: PoolClient; key: number } | undefined;
    try {
      if (options.schedulerLock) {
        const key = schedulerLockKey(options.installation, schema);
        const client = await pool.connect();
        const { rows } = await client.query("SELECT pg_try_advisory_lock($1) AS acquired", [key]);
        if (!rows[0].acquired) {
          client.release();
          throw new LedgerUsageError("Já existe um agendador ativo para esta instalação");
        }
        scheduler = { client, key };
      }
      await applyMigrations(pool, MIGRATIONS_DIR);
      if (!options.destinationJournal) {
        const { rowCount } = await pool.query("SELECT 1 FROM pilot_destination_intents LIMIT 1");
        if (rowCount)
          throw new Error("Esta sessão possui um diário de destino e requer sua configuração");
      }
    } catch (error) {
      if (scheduler) {
        await scheduler.client.query("SELECT pg_advisory_unlock($1)", [scheduler.key]).catch(() => {});
        scheduler.client.release();
      }
      await pool.end();
      throw error;
    }
    return new PostgresJourneyLedger(pool, options, scheduler);
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
  reserveInference = (e: { job: string; slot: string; inputSha: string; created: string }) => this.run((st) => st.reserveInference(e));
  completeInference = (job: string, slot: string, output: string, usage: string, at: string) => this.run((st) => st.completeInference(job, slot, output, usage, at));
  releaseInference = (job: string, slot: string) => this.run((st) => st.releaseInference(job, slot));
  getInference = (job: string, slot: string) => this.run((st) => st.getInference(job, slot));
  listInferences = (job: string) => this.run((st) => st.listInferences(job));
  createRecoverySession = (s: RecoverySession) => this.run((st) => st.createRecoverySession(s));
  findRecoverySession = (hash: string) => this.run((st) => st.findRecoverySession(hash));
  deleteRecoverySession = (hash: string) => this.run((st) => st.deleteRecoverySession(hash));
  getRecoveryCommand = (id: string) => this.run((st) => st.getRecoveryCommand(id));
  getRecoveryCommandForActor = (id: string, actor: string) => this.run((st) => st.getRecoveryCommandForActor(id, actor));
  insertRecoveryCommand = (c: RecoveryCommand) => this.run((st) => st.insertRecoveryCommand(c));
  updateRecoveryCommandStatus = (id: string, status: RecoveryCommandStatus, updated: string, result?: string) => this.run((st) => st.updateRecoveryCommandStatus(id, status, updated, result));
  listDispatchingRecoveryCommands = () => this.run((st) => st.listDispatchingRecoveryCommands());
  listRecoveryCommandsForActor = (actor: string) => this.run((st) => st.listRecoveryCommandsForActor(actor));

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
    if (this.schedulerClient) {
      await this.schedulerClient.query("SELECT pg_advisory_unlock($1)", [this.schedulerKey]).catch(() => {});
      this.schedulerClient.release();
    }
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
