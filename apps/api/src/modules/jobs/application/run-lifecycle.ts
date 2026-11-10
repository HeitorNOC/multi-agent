/**
 * Ciclo de execução visto pelo servidor: tirar da fila e começar, encerrar quando o processo do
 * worker termina, e conciliar o que estava rodando quando o servidor reiniciou.
 */
import { stream } from "../../../platform/events/event-log.ts";
import type { JobId } from "../../../shared/ids.ts";
import type { Job } from "../domain/job.ts";
import type { QueueEntry } from "../domain/repositories.ts";
import * as transitions from "../domain/transitions.ts";
import type { JobsDeps } from "./deps.ts";
import { loadJob } from "./load-job.ts";

export type Claim = { kind: "started"; job: Job; entry: QueueEntry } | { kind: "skipped" } | { kind: "empty" };

/** Tira a próxima entrada da fila e marca o trabalho como em execução, se houver worker livre. */
export async function claimNextJob(deps: JobsDeps): Promise<Claim> {
  if (deps.workers.count() >= deps.limits.maxWorkers) return { kind: "empty" };
  return deps.uow.run(async (store) => {
    const entry = await store.queue.next();
    if (!entry) return { kind: "empty" };
    await store.queue.remove(entry);
    const job = await store.jobs.get(entry.jobId);
    if (!job || job.status !== "queued") {
      // Entrada obsoleta (o trabalho mudou de estado por outro caminho): descarta sem executar.
      await store.events.append(stream.job(entry.jobId), { kind: "queue_entry_discarded", detail: { status: job?.status ?? null } });
      return { kind: "skipped" };
    }
    const running = await store.jobs.save(transitions.start(job));
    const waitMs = Math.max(0, Date.parse(deps.clock.now()) - Date.parse(entry.queuedAt));
    await store.events.append(stream.job(job.id), { kind: "job_dequeued", detail: { position: entry.seq, wait_ms: waitMs } });
    return { kind: "started", job: running, entry };
  });
}

export interface RunResult {
  exitCode: number | null;
  /** O que o worker declarou na última linha da saída, se for legível. */
  declared?: { completed: boolean };
  spawnFailed?: boolean;
}

/** O processo do worker terminou: decide o próximo estado sem presumir sucesso. */
export async function finishRun(deps: JobsDeps, jobId: JobId, result: RunResult): Promise<Job> {
  return deps.uow.run(async (store) => {
    const job = await loadJob(store.jobs, jobId);
    await store.events.append(stream.job(jobId), { kind: "worker_stopped", detail: { exit_code: result.exitCode } });
    // Uma decisão tomada durante a execução (por exemplo, revisão por inferência sem recibo) prevalece.
    if (job.status !== "running") return job;
    const next = outcome(job, result);
    return store.jobs.save(transitions.finishRun(job, next.status, next.error));
  });
}

function outcome(job: Job, r: RunResult): { status: "awaiting_approval" | "completed" | "failed" | "interrupted"; error: string | null } {
  if (r.spawnFailed) return { status: "failed", error: "Não foi possível iniciar o worker" };
  if (r.exitCode === 88) return { status: "interrupted", error: "Interrupção de teste após o efeito; retome para conciliar" };
  if (r.exitCode !== 0) return { status: "failed", error: "Worker falhou; não há sucesso presumido" };
  if (r.declared?.completed === true && job.receipt !== null) return { status: "completed", error: null };
  if (r.declared?.completed === false && job.review !== null) return { status: "awaiting_approval", error: null };
  return { status: "failed", error: "Worker terminou sem resposta verificável" };
}

/** Na subida do servidor: o que estava em execução tem resultado desconhecido e vira interrompido. */
export async function reconcileOnRestart(deps: JobsDeps): Promise<number> {
  return deps.uow.run(async (store) => {
    const running = await store.jobs.listByStatus("running");
    for (const job of running) {
      await store.jobs.save(transitions.interruptOnRestart(job));
      await store.events.append(stream.job(job.id), { kind: "server_restart_reconciled", detail: { state: "interrupted" } });
    }
    return running.length;
  });
}
