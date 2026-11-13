/**
 * Trabalho: um pedido que passa pela fila, pelo worker, pela aprovação humana e pela entrega.
 *
 * Entidade imutável. Toda mudança passa por uma transição de `transitions.ts`, que valida o
 * estado atual e devolve uma nova versão; o repositório grava com controle de versão.
 */
import type { JobId } from "../../../shared/ids.ts";
import type { Json } from "../../../shared/json.ts";

export const JOB_STATUSES = [
  "queued",
  "running",
  "awaiting_approval",
  "completed",
  "failed",
  "interrupted",
  "recovery_required",
  "closed_unknown",
  "rejected",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Estados finais: o trabalho não volta para a fila. */
export const TERMINAL: ReadonlySet<JobStatus> = new Set(["completed", "rejected", "closed_unknown"]);

/** Parecer vinculado ao trabalho; `hash` prende a aprovação a este conteúdo exato. */
export interface Review {
  readonly hash: string;
  readonly [field: string]: Json;
}

export interface Job {
  readonly id: JobId;
  readonly goal: string;
  /** Fontes do Cérebro anexadas ao pedido (imagens da conversa, por exemplo); chegam aos especialistas. */
  readonly attachments: readonly string[];
  readonly status: JobStatus;
  /**
   * Plano aprovado pelo CEO na conversa (time e motivo), quando houver. O worker usa este no passo
   * de plano em vez de pedir ao modelo; a validação acontece ali, com o time já contratado.
   */
  readonly preset: Json | null;
  readonly plan: Json | null;
  readonly review: Review | null;
  /** Hash do parecer aprovado; `null` enquanto não houver aprovação. */
  readonly approval: string | null;
  readonly receipt: Json | null;
  /** Motivo do estado atual quando ele exige atenção (falha, interrupção, revisão). */
  readonly error: string | null;
  readonly createdAt: string;
  /** Versão para controle otimista; incrementada a cada gravação. */
  readonly version: number;
}

export function newJob(input: { id: JobId; goal: string; createdAt: string; attachments?: readonly string[]; preset?: Json | null }): Job {
  return {
    id: input.id,
    goal: input.goal,
    attachments: input.attachments ?? [],
    status: "queued",
    preset: input.preset ?? null,
    plan: null,
    review: null,
    approval: null,
    receipt: null,
    error: null,
    createdAt: input.createdAt,
    version: 0,
  };
}
