/** Repositórios SQL das conversas (mesmo SQL para SQLite e PostgreSQL). */
import type { Clock } from "../../../shared/clock.ts";
import type { ActorId, AgentId, ConversationId, JobId } from "../../../shared/ids.ts";
import type { Sql } from "../../../platform/database/database.ts";
import { SqlEventLog, type EventLog } from "../../../platform/events/event-log.ts";
import type { Conversation, Message, MessageAttachment, MessageCitation, MessageRole } from "../domain/conversation.ts";
import type { ConversationRepository, MessageRepository } from "../domain/repositories.ts";
import type { StaffingProposal } from "../domain/staffing.ts";

type ConversationRow = { id: string; actor: string; title: string; agent_id: string | null; created_at: string; updated_at: string };
type MessageRow = {
  seq: number | string;
  conversation_id: string;
  role: string;
  text: string;
  job_id: string | null;
  client_id: string | null;
  reply_to: number | string | null;
  citations: string | null;
  attachments: string | null;
  created_at: string;
};

const toConversation = (r: ConversationRow): Conversation => ({
  id: r.id as ConversationId,
  actor: r.actor as ActorId,
  title: r.title,
  agentId: r.agent_id as AgentId | null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toMessage = (r: MessageRow): Message => ({
  seq: Number(r.seq),
  conversationId: r.conversation_id as ConversationId,
  role: r.role as MessageRole,
  text: r.text,
  jobId: r.job_id as JobId | null,
  clientId: r.client_id,
  replyTo: r.reply_to === null ? null : Number(r.reply_to),
  citations: r.citations ? (JSON.parse(r.citations) as MessageCitation[]) : null,
  attachments: r.attachments ? (JSON.parse(r.attachments) as MessageAttachment[]) : null,
  createdAt: r.created_at,
});

export class SqlConversationRepository implements ConversationRepository {
  private readonly sql: Sql;
  constructor(sql: Sql) {
    this.sql = sql;
  }

  async get(id: ConversationId) {
    const row = await this.sql.one<ConversationRow>("SELECT * FROM conversations WHERE id = $1", [id]);
    return row && toConversation(row);
  }

  async add(c: Conversation) {
    await this.sql.run(
      `INSERT INTO conversations (id, actor, title, agent_id, created_at, updated_at, ordinal)
       VALUES ($1, $2, $3, $4, $5, $6, (SELECT COALESCE(MAX(ordinal), 0) + 1 FROM conversations))`,
      [c.id, c.actor, c.title, c.agentId, c.createdAt, c.updatedAt],
    );
  }

  async touch(id: ConversationId, at: string) {
    await this.sql.run("UPDATE conversations SET updated_at = $2 WHERE id = $1", [id, at]);
  }

  async listForActor(actor: ActorId) {
    const rows = await this.sql.all<ConversationRow & { message_count: number | string }>(
      `SELECT c.*, (SELECT COUNT(*) FROM conversation_messages m WHERE m.conversation_id = c.id) AS message_count
         FROM conversations c WHERE c.actor = $1 ORDER BY c.updated_at DESC, c.ordinal DESC`,
      [actor],
    );
    return rows.map((r) => ({ ...toConversation(r), messageCount: Number(r.message_count) }));
  }

  async transferActor(from: ActorId, to: ActorId) {
    await this.sql.run("UPDATE conversations SET actor = $2 WHERE actor = $1", [from, to]);
  }
}

export class SqlMessageRepository implements MessageRepository {
  private readonly sql: Sql;
  constructor(sql: Sql) {
    this.sql = sql;
  }

  async add(m: Omit<Message, "seq">) {
    const row = await this.sql.one<{ seq: number | string }>(
      `INSERT INTO conversation_messages (conversation_id, role, text, job_id, client_id, reply_to, citations, attachments, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING seq`,
      [
        m.conversationId,
        m.role,
        m.text,
        m.jobId,
        m.clientId,
        m.replyTo,
        m.citations ? JSON.stringify(m.citations) : null,
        m.attachments?.length ? JSON.stringify(m.attachments) : null,
        m.createdAt,
      ],
    );
    return { ...m, seq: Number(row!.seq) };
  }

  async list(conversationId: ConversationId) {
    return (await this.sql.all<MessageRow>("SELECT * FROM conversation_messages WHERE conversation_id = $1 ORDER BY seq", [conversationId])).map(toMessage);
  }

  async findByClientId(conversationId: ConversationId, clientId: string) {
    const row = await this.sql.one<MessageRow>("SELECT * FROM conversation_messages WHERE conversation_id = $1 AND client_id = $2", [conversationId, clientId]);
    return row && toMessage(row);
  }

  async findReply(conversationId: ConversationId, seq: number) {
    const row = await this.sql.one<MessageRow>("SELECT * FROM conversation_messages WHERE conversation_id = $1 AND reply_to = $2", [conversationId, seq]);
    return row && toMessage(row);
  }
}

type ProposalRow = {
  id: string;
  conversation_id: string;
  question_seq: number | string;
  reply_seq: number | string;
  offer_id: string;
  request: string;
  templates: string;
  engagement: string;
  status: string;
  job_id: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
};

const toProposal = (r: ProposalRow): StaffingProposal => ({
  id: r.id,
  conversationId: r.conversation_id,
  questionSeq: Number(r.question_seq),
  replySeq: Number(r.reply_seq),
  offerId: r.offer_id,
  request: r.request,
  templates: JSON.parse(r.templates) as StaffingProposal["templates"],
  engagement: r.engagement as StaffingProposal["engagement"],
  status: r.status as StaffingProposal["status"],
  jobId: r.job_id,
  decidedBy: r.decided_by,
  decidedAt: r.decided_at,
  createdAt: r.created_at,
});

/** Propostas de contratação do Chief na conversa. */
export class SqlStaffingProposals {
  private readonly sql: Sql;
  constructor(sql: Sql) {
    this.sql = sql;
  }

  async add(p: StaffingProposal) {
    await this.sql.run(
      `INSERT INTO staffing_proposals (id, conversation_id, question_seq, reply_seq, offer_id, request, templates, engagement, status, job_id, decided_by, decided_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [p.id, p.conversationId, p.questionSeq, p.replySeq, p.offerId, p.request, JSON.stringify(p.templates), p.engagement, p.status, p.jobId, p.decidedBy, p.decidedAt, p.createdAt],
    );
  }

  async get(id: string) {
    const row = await this.sql.one<ProposalRow>("SELECT * FROM staffing_proposals WHERE id = $1", [id]);
    return row && toProposal(row);
  }

  /** Decide só se ainda estiver pendente; devolve se esta chamada decidiu. */
  async decide(id: string, status: "accepted" | "declined", jobId: string, actor: string, at: string) {
    return (
      (await this.sql.run("UPDATE staffing_proposals SET status = $2, job_id = $3, decided_by = $4, decided_at = $5 WHERE id = $1 AND status = 'pending'", [
        id,
        status,
        jobId,
        actor,
        at,
      ])) > 0
    );
  }

  async listForConversation(conversationId: string) {
    return (await this.sql.all<ProposalRow>("SELECT * FROM staffing_proposals WHERE conversation_id = $1 ORDER BY reply_seq", [conversationId])).map(toProposal);
  }
}

export interface ConversationStore {
  conversations: ConversationRepository;
  messages: MessageRepository;
  staffing: SqlStaffingProposals;
  events: EventLog;
}

export const conversationStore =
  (clock: Clock) =>
  (sql: Sql): ConversationStore => ({
    conversations: new SqlConversationRepository(sql),
    messages: new SqlMessageRepository(sql),
    staffing: new SqlStaffingProposals(sql),
    events: new SqlEventLog(sql, clock),
  });
