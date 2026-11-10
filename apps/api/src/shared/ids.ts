/**
 * Identificadores com marca. Em tempo de execução são strings; para o compilador, um `JobId`
 * não é um `SourceId` nem uma string qualquer. Assim, trocar um id por outro, ou passar uma
 * entidade onde se espera um id, vira erro de compilação.
 *
 * Cada tipo tem um valor de mesmo nome com `parse` (valida texto vindo de fora) e `create`
 * (gera um novo): `JobId.parse(req.params.id)`, `JobId.create()`.
 */
import { randomUUID } from "node:crypto";
import { invalid } from "./errors.ts";

declare const brand: unique symbol;
export type Id<Kind extends string> = string & { readonly [brand]: Kind };

const SAFE_ID = /^[A-Za-z0-9_:.@#+-]{1,200}$/;

export interface IdFactory<T extends Id<string>> {
  parse(value: unknown): T;
  create(): T;
}

function idFactory<T extends Id<string>>(label: string): IdFactory<T> {
  return {
    parse(value) {
      if (typeof value !== "string" || !SAFE_ID.test(value)) throw invalid("invalid_id", `${label} inválido`);
      return value as T;
    },
    create() {
      return randomUUID() as T;
    },
  };
}

export type JobId = Id<"Job">;
export const JobId = idFactory<JobId>("Identificador de trabalho");

export type EventId = Id<"Event">;
export const EventId = idFactory<EventId>("Identificador de evento");

export type ConversationId = Id<"Conversation">;
export const ConversationId = idFactory<ConversationId>("Identificador de conversa");

export type SourceId = Id<"Source">;
export const SourceId = idFactory<SourceId>("Identificador de fonte");

export type AgentId = Id<"Agent">;
export const AgentId = idFactory<AgentId>("Identificador de agente");

/** Quem age: o usuário autenticado, o operador local ou um revisor. */
export type ActorId = Id<"Actor">;
export const ActorId = idFactory<ActorId>("Identificador de usuário");

/** Chave de idempotência enviada pelo cliente para não repetir uma admissão. */
export type AdmissionKey = Id<"AdmissionKey">;
export const AdmissionKey = {
  parse(value: unknown): AdmissionKey {
    if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{16,100}$/.test(value))
      throw invalid("invalid_admission_key", "Chave de admissão inválida");
    return value as AdmissionKey;
  },
};
