/** Conversa do gestor com o Chief of Staff: cada pessoa só enxerga as próprias conversas. */
import type { ActorId, ConversationId, JobId } from "../../../shared/ids.ts";

export interface Conversation {
  readonly id: ConversationId;
  readonly actor: ActorId;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
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
  readonly createdAt: string;
}

export const DEFAULT_TITLE = "Nova conversa";
