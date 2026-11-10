/** Conversa do gestor com o Chief of Staff: cada pessoa só enxerga as próprias conversas. */
import type { ActorId, AgentId, ConversationId, JobId } from "../../../shared/ids.ts";

export interface Conversation {
  readonly id: ConversationId;
  readonly actor: ActorId;
  readonly title: string;
  /** Na Estação, o agente com quem se conversa; `null` é o Chief of Staff. */
  readonly agentId: AgentId | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Fonte citada numa resposta da Estação. */
export interface MessageCitation {
  readonly n: number;
  readonly source: string;
  readonly title: string;
  readonly version: number;
  readonly valid_from: string;
  readonly url: string;
}

export type MessageRole = "user" | "chief";

export interface Message {
  readonly seq: number;
  readonly conversationId: ConversationId;
  readonly role: MessageRole;
  readonly text: string;
  /** Trabalho aberto por esta resposta, se houver. */
  readonly jobId: JobId | null;
  /** Identidade dada pelo cliente para repetir o envio sem duplicar. */
  readonly clientId: string | null;
  /** Mensagem do gestor que esta resposta atende. */
  readonly replyTo: number | null;
  /** Fontes citadas (respostas da Estação). */
  readonly citations: readonly MessageCitation[] | null;
  readonly createdAt: string;
}

export const DEFAULT_TITLE = "Nova conversa";
