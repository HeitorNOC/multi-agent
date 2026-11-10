/** Repositórios SQL das conversas (mesmo SQL para SQLite e PostgreSQL). */
import type { Clock } from "../../../shared/clock.ts";
import type { ActorId, ConversationId, JobId } from "../../../shared/ids.ts";
import type { Sql } from "../../../platform/database/database.ts";
import { SqlEventLog, type EventLog } from "../../../platform/events/event-log.ts";
import type { Conversation, Message, MessageRole } from "../domain/conversation.ts";
import type { ConversationRepository, MessageRepository } from "../domain/repositories.ts";

type ConversationRow = { id: string; actor: string; title: string; created_at: string; updated_at: string };
type MessageRow = {
  seq: number | string;
  conversation_id: string;
  role: string;
  text: string;
  job_id: string | null;
  client_id: string | null;
  reply_to: number | string | null;
  created_at: string;
};

const toConversation = (r: ConversationRow): Conversation => ({
  id: r.id as ConversationId,
  actor: r.actor as ActorId,
  title: r.title,
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
      `INSERT INTO conversations (id, actor, title, created_at, updated_at, ordinal)
       VALUES ($1, $2, $3, $4, $5, (SELECT COALESCE(MAX(ordinal), 0) + 1 FROM conversations))`,
      [c.id, c.actor, c.title, c.createdAt, c.updatedAt],
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
}

export class SqlMessageRepository implements MessageRepository {
  private readonly sql: Sql;
  constructor(sql: Sql) {
    this.sql = sql;
  }

  async add(m: Omit<Message, "seq">) {
    const row = await this.sql.one<{ seq: number | string }>(
      `INSERT INTO conversation_messages (conversation_id, role, text, job_id, client_id, reply_to, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING seq`,
      [m.conversationId, m.role, m.text, m.jobId, m.clientId, m.replyTo, m.createdAt],
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

export interface ConversationStore {
  conversations: ConversationRepository;
  messages: MessageRepository;
  events: EventLog;
}

export const conversationStore =
  (clock: Clock) =>
  (sql: Sql): ConversationStore => ({
    conversations: new SqlConversationRepository(sql),
    messages: new SqlMessageRepository(sql),
    events: new SqlEventLog(sql, clock),
  });
