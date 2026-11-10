import type { ActorId, ConversationId } from "../../../shared/ids.ts";
import type { Conversation, Message } from "./conversation.ts";

export interface ConversationRepository {
  get(id: ConversationId): Promise<Conversation | undefined>;
  add(conversation: Conversation): Promise<void>;
  /** Marca atividade nova (a conversa sobe na lista). */
  touch(id: ConversationId, at: string): Promise<void>;
  /** Da mais recente para a mais antiga, com o total de mensagens. */
  listForActor(actor: ActorId): Promise<(Conversation & { messageCount: number })[]>;
}

export interface MessageRepository {
  add(message: Omit<Message, "seq">): Promise<Message>;
  list(conversationId: ConversationId): Promise<Message[]>;
  findByClientId(conversationId: ConversationId, clientId: string): Promise<Message | undefined>;
  /** A resposta do Chief of Staff à mensagem `seq`, se já existir. */
  findReply(conversationId: ConversationId, seq: number): Promise<Message | undefined>;
}
