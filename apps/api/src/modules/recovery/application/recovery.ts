/**
 * Central de recuperação: decisões humanas sobre trabalhos cujo resultado não é conhecido.
 *
 * Um trabalho vai para `recovery_required` quando algo pode ter acontecido sem registro — por
 * exemplo, uma chamada ao modelo reservada e sem recibo depois de uma queda. O sistema nunca
 * repete isso sozinho. Uma pessoa decide, com justificativa registrada:
 *  - encerrar sem resultado confirmado (`closed_unknown`); ou
 *  - autorizar repetir exatamente os passos pendentes que ela conferiu, e o trabalho volta à fila.
 */
import { conflict, ensure, invalid } from "../../../shared/errors.ts";
import type { ActorId, JobId } from "../../../shared/ids.ts";
import { stream } from "../../../platform/events/event-log.ts";
import type { JobsDeps } from "../../jobs/application/deps.ts";
import { loadJob } from "../../jobs/application/load-job.ts";
import { requireQueueSpace } from "../../jobs/application/queue-limits.ts";
import * as transitions from "../../jobs/domain/transitions.ts";

const REASON = { min: 20, max: 500 };

export interface RecoveryCase {
  job: { id: JobId; goal: string; status: string; error: string | null; created_at: string; worker_active: boolean };
  /** Passos de modelo reservados sem recibo: o resultado é desconhecido. */
  pending_steps: { slot: string; reserved_at: string }[];
  /** Eventos que explicam como o trabalho chegou aqui. */
  evidence: { seq: number; kind: string; at: string; detail: unknown }[];
}

const EVIDENCE = new Set(["inference_unknown", "inference_failed", "server_restart_reconciled", "job_dequeued", "effect_receipt", "human_approved"]);

export async function listRecoveryCases(deps: JobsDeps): Promise<{ cases: RecoveryCase[] }> {
  const jobs = await deps.uow.read.jobs.listByStatus("recovery_required");
  const cases = await Promise.all(
    jobs.map(async (job) => {
      const receipts = await deps.uow.read.inferences.list(job.id);
      const events = await deps.uow.read.events.list(stream.job(job.id));
      return {
        job: { id: job.id, goal: job.goal, status: job.status, error: job.error, created_at: job.createdAt, worker_active: deps.workers.isActive(job.id) },
        pending_steps: receipts.filter((r) => r.state === "reserved").map((r) => ({ slot: r.slot, reserved_at: r.createdAt })),
        evidence: events.filter((e) => EVIDENCE.has(e.kind)).map((e) => ({ seq: e.seq, kind: e.kind, at: e.occurredAt, detail: e.detail })),
      };
    }),
  );
  return { cases };
}

function requireReason(reason: string) {
  const text = reason.trim();
  ensure(text.length >= REASON.min && text.length <= REASON.max, () =>
    invalid("invalid_reason", `Informe uma justificativa de ${REASON.min} a ${REASON.max} caracteres`),
  );
  return text;
}

/** Encerra sem resultado confirmado. Repetir é inofensivo. */
export async function closeAsUnknown(deps: JobsDeps, input: { jobId: JobId; actor: ActorId; reason: string }) {
  const reason = requireReason(input.reason);
  ensure(!deps.workers.isActive(input.jobId), () => conflict("worker_active", "Worker ainda está ativo"));
  return deps.uow.run(async (s) => {
    const job = await loadJob(s.jobs, input.jobId);
    if (job.status === "closed_unknown") return { job, replayed: true };
    const closed = await s.jobs.save(transitions.closeAsUnknown(job, reason));
    await s.events.append(stream.job(job.id), { kind: "recovery_closed", detail: { actor: input.actor, reason, from: job.status } });
    return { job: closed, replayed: false };
  });
}

/**
 * Autoriza repetir os passos pendentes. A pessoa informa exatamente os passos que conferiu; se o
 * conjunto mudou desde que ela olhou, a autorização é recusada.
 */
export async function authorizeRetry(deps: JobsDeps, input: { jobId: JobId; actor: ActorId; reason: string; steps: readonly string[] }) {
  const reason = requireReason(input.reason);
  ensure(!deps.workers.isActive(input.jobId), () => conflict("worker_active", "Worker ainda está ativo"));
  return deps.uow.run(async (s) => {
    const job = await loadJob(s.jobs, input.jobId);
    ensure(job.status === "recovery_required", () => conflict("not_in_recovery", "O trabalho não está aguardando revisão"));
    const pending = (await s.inferences.list(job.id)).filter((r) => r.state === "reserved").map((r) => r.slot).sort();
    const confirmed = [...new Set(input.steps)].sort();
    ensure(pending.join("|") === confirmed.join("|"), () => conflict("steps_changed", "Os passos pendentes mudaram; inspecione novamente"));
    for (const slot of pending) await s.inferences.release({ jobId: job.id, slot });
    await s.events.append(stream.job(job.id), { kind: "recovery_retry_authorized", detail: { actor: input.actor, reason, steps: pending } });
    await requireQueueSpace(s.queue, deps.limits, "resume");
    const queued = await s.jobs.save(transitions.requeue(job));
    const entry = await s.queue.add({ jobId: job.id, kind: "resume", crashAfterEffect: false, queuedAt: deps.clock.now() });
    await s.events.append(stream.job(job.id), { kind: "job_queued", detail: { position: entry.seq, kind: "resume" } });
    return { job: queued, replayed: false };
  });
}
