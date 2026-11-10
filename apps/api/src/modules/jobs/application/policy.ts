/**
 * Política de trabalho: o que varia entre tipos de trabalho (demonstração, trabalho aberto…).
 * Decide o que é um pedido válido, um plano válido e um parecer válido. O resto do fluxo
 * (fila, aprovação, efeito único, recuperação) é igual para todas.
 */
import type { Json } from "../../../shared/json.ts";
import type { Job } from "../domain/job.ts";
import type { EffectPayload } from "../domain/review.ts";

/** O que o parecer pode consultar sobre o trabalho, sem acesso direto ao banco. */
export interface ReviewContext {
  /** Rótulos de trechos do Cérebro entregues a este trabalho. */
  readonly retrievedLabels: ReadonlySet<string>;
}

export interface WorkPolicy {
  readonly id: string;
  /** Valida o pedido do gestor e devolve a meta do trabalho. Lança `invalid` se recusar. */
  goal(request: Json): string;
  /** Valida a proposta de plano do worker e devolve o plano normalizado. */
  plan(proposal: Json, job: Job): Json;
  /** Valida o relatório do worker e devolve o relatório normalizado e o efeito proposto. */
  review(job: Job, report: Json, context: ReviewContext): { report: Json; payload: EffectPayload };
  /** Máximo de chamadas ao modelo permitido pelo plano. */
  modelCallLimit(plan: Json): number;
}
