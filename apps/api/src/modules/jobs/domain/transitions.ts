/**
 * Transições do trabalho. Funções puras: recebem um `Job`, validam o estado e devolvem a nova
 * versão. Nenhuma toca o banco; os casos de uso gravam o resultado e o evento correspondente.
 */
import { conflict, ensure } from "../../../shared/errors.ts";
import { canonical, type Json } from "../../../shared/json.ts";
import type { Job, JobStatus, Review } from "./job.ts";

/** De onde cada estado pode ser alcançado. Qualquer outra mudança é recusada. */
const ALLOWED_FROM: Record<JobStatus, readonly JobStatus[]> = {
  queued: ["awaiting_approval", "interrupted", "failed"],
  running: ["queued"],
  awaiting_approval: ["running"],
  completed: ["running"],
  failed: ["running", "queued"],
  interrupted: ["running"],
  recovery_required: ["running", "queued", "interrupted", "failed"],
  closed_unknown: ["recovery_required", "interrupted", "failed", "queued"],
  rejected: ["awaiting_approval", "running"],
};

function move(job: Job, to: JobStatus, changes: Partial<Job> = {}): Job {
  ensure(ALLOWED_FROM[to].includes(job.status), () =>
    conflict("invalid_transition", `Trabalho em "${job.status}" não pode ir para "${to}"`),
  );
  return { ...job, ...changes, status: to };
}

/** O worker começou a executar o trabalho que estava na fila. */
export const start = (job: Job): Job => move(job, "running", { error: null });

/** Volta para a fila: retomada depois de aprovação, interrupção ou falha. */
export const requeue = (job: Job): Job => move(job, "queued", { error: null });

/** Vincula o plano. Repetir o mesmo plano é aceito (retomada); trocar por outro, não. */
export function attachPlan(job: Job, plan: Json): Job {
  ensure(job.status === "running", () => conflict("not_running", "Plano só pode ser vinculado durante a execução"));
  if (job.plan !== null) {
    ensure(canonical(job.plan) === canonical(plan), () => conflict("plan_already_bound", "Plano já vinculado"));
    return job;
  }
  return { ...job, plan };
}

/** Vincula o parecer, com a mesma regra de repetição do plano. */
export function attachReview(job: Job, review: Review): Job {
  ensure(job.status === "running", () => conflict("not_running", "Parecer só pode ser vinculado durante a execução"));
  if (job.review !== null) {
    ensure(canonical(job.review) === canonical(review), () => conflict("review_already_bound", "Parecer original já vinculado"));
    return job;
  }
  return { ...job, review };
}

/** O worker terminou esta etapa; o resultado diz o próximo estado. */
export function finishRun(job: Job, outcome: "awaiting_approval" | "completed" | "failed" | "interrupted", error: string | null = null): Job {
  return move(job, outcome, { error });
}

/** Um humano aprova o parecer exato. */
export function approve(job: Job, hash: string): Job {
  ensure(job.status === "awaiting_approval" && job.review?.hash === hash, () =>
    conflict("approval_mismatch", "Parecer alterado ou trabalho não está aguardando aprovação"),
  );
  return { ...job, approval: hash };
}

/** Um humano rejeita o parecer exato; o trabalho termina. */
export function reject(job: Job, hash: string): Job {
  ensure(job.status === "awaiting_approval" && job.review?.hash === hash, () =>
    conflict("approval_mismatch", "Parecer alterado ou trabalho não está aguardando aprovação"),
  );
  return move(job, "rejected", { approval: null });
}

/** O servidor reiniciou com o trabalho em execução: o resultado do worker não é conhecido. */
export const interruptOnRestart = (job: Job): Job =>
  move(job, "interrupted", { error: "Servidor reiniciado; retome para continuar do último ponto salvo" });

/** Algo precisa de revisão humana antes de continuar (por exemplo, inferência sem recibo). */
export const requireRecovery = (job: Job, reason: string): Job => move(job, "recovery_required", { error: reason });

/** Encerrado sem resultado confirmado, depois de revisão humana. */
export const closeAsUnknown = (job: Job, reason: string): Job => move(job, "closed_unknown", { error: reason });

/** O efeito aprovado foi executado; o recibo fica no trabalho. */
export function recordReceipt(job: Job, receipt: Json): Job {
  ensure(job.approval !== null, () => conflict("not_approved", "Efeito exige aprovação do parecer exato"));
  return { ...job, receipt };
}
