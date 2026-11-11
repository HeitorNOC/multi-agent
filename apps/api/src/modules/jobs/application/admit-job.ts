/**
 * Admitir um pedido: valida pela política, respeita a capacidade da fila e grava trabalho,
 * chave de idempotência, entrada na fila e eventos numa única transação.
 * Repetir com a mesma chave devolve o mesmo trabalho (`replayed`).
 */
import { conflict, ensure } from "../../../shared/errors.ts";
import { JobId, type AdmissionKey } from "../../../shared/ids.ts";
import type { Json } from "../../../shared/json.ts";
import { stream } from "../../../platform/events/event-log.ts";
import { newJob, type Job } from "../domain/job.ts";
import type { Transaction } from "../../../platform/database/unit-of-work.ts";
import type { JobsDeps } from "./deps.ts";
import { requireQueueSpace } from "./queue-limits.ts";

export interface AdmitJobInput {
  request: Json;
  /** Fontes do Cérebro anexadas ao pedido. */
  attachments?: readonly string[];
  /** Plano já aprovado pelo CEO (time e motivo); validado pela política no passo de plano. */
  preset?: Json;
  key?: AdmissionKey;
  /** Executado na mesma transação da admissão (por exemplo, a resposta da conversa). */
  onAdmitted?: (job: Job, tx: Transaction) => Promise<void>;
}

export async function admitJob(deps: JobsDeps, input: AdmitJobInput): Promise<{ job: Job; replayed: boolean }> {
  const goal = await deps.policy.goal(input.request);
  return deps.uow.run(async (store, tx) => {
    if (input.key) {
      const prior = await store.admissions.get(input.key);
      if (prior) {
        const job = await store.jobs.get(prior);
        ensure(job && job.goal === goal, () => conflict("admission_key_reused", "Chave já vinculada a outro pedido"));
        return { job, replayed: true };
      }
    }
    await requireQueueSpace(store.queue, deps.limits, "new");
    const attachments = [...new Set(input.attachments ?? [])];
    const job = await store.jobs.add(newJob({ id: JobId.create(), goal, createdAt: deps.clock.now(), attachments, preset: input.preset ?? null }));
    if (input.key) await store.admissions.add(input.key, job.id);
    const entry = await store.queue.add({ jobId: job.id, kind: "new", crashAfterEffect: false, queuedAt: deps.clock.now() });
    await store.events.append(stream.job(job.id), {
      kind: "admission",
      detail: { goal, ...(attachments.length ? { attachments } : {}), ...(input.preset ? { preset: input.preset } : {}) } as Json,
    });
    await store.events.append(stream.job(job.id), { kind: "job_queued", detail: { position: entry.seq, kind: "new" } });
    if (input.onAdmitted) await input.onAdmitted(job, tx);
    return { job, replayed: false };
  });
}
