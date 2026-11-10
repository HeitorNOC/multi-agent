/**
 * Decisões humanas sobre um trabalho: aprovar, rejeitar e retomar.
 * Aprovar e retomar devolvem o trabalho à fila (vagas reservadas para retomadas); repetir uma
 * decisão já tomada é inofensivo (`replayed`).
 */
import { conflict, ensure } from "../../../shared/errors.ts";
import type { ActorId, JobId } from "../../../shared/ids.ts";
import { stream } from "../../../platform/events/event-log.ts";
import type { Job } from "../domain/job.ts";
import * as transitions from "../domain/transitions.ts";
import type { JobsStore } from "../infrastructure/jobs-store.ts";
import type { JobsDeps } from "./deps.ts";
import { loadJob } from "./load-job.ts";
import { requireQueueSpace } from "./queue-limits.ts";

type Decision = Promise<{ job: Job; replayed: boolean }>;

function requireIdle(deps: JobsDeps, jobId: JobId) {
  ensure(!deps.workers.isActive(jobId), () => conflict("worker_active", "Worker ainda está ativo"));
}

async function enqueueResume(deps: JobsDeps, store: JobsStore, job: Job, crashAfterEffect = false) {
  await requireQueueSpace(store.queue, deps.limits, "resume");
  const queued = await store.jobs.save(transitions.requeue(job));
  const entry = await store.queue.add({ jobId: job.id, kind: "resume", crashAfterEffect, queuedAt: deps.clock.now() });
  await store.events.append(stream.job(job.id), { kind: "job_queued", detail: { position: entry.seq, kind: "resume" } });
  return queued;
}

export async function approveJob(
  deps: JobsDeps,
  input: { jobId: JobId; hash: string; actor: ActorId; crashAfterEffect?: boolean },
): Decision {
  requireIdle(deps, input.jobId);
  return deps.uow.run(async (store) => {
    const job = await loadJob(store.jobs, input.jobId);
    if (job.status === "queued" && job.approval === input.hash) return { job, replayed: true };
    const approved = transitions.approve(job, input.hash);
    await store.events.append(stream.job(job.id), { kind: "human_approved", detail: { hash: input.hash, actor: input.actor } });
    return { job: await enqueueResume(deps, store, approved, input.crashAfterEffect), replayed: false };
  });
}

export async function rejectJob(deps: JobsDeps, input: { jobId: JobId; hash: string; actor: ActorId }): Decision {
  requireIdle(deps, input.jobId);
  return deps.uow.run(async (store) => {
    const job = await loadJob(store.jobs, input.jobId);
    const rejected = await store.jobs.save(transitions.reject(job, input.hash));
    await store.events.append(stream.job(job.id), { kind: "human_rejected", detail: { hash: input.hash, actor: input.actor } });
    return { job: rejected, replayed: false };
  });
}

export async function resumeJob(deps: JobsDeps, input: { jobId: JobId; actor: ActorId }): Decision {
  requireIdle(deps, input.jobId);
  return deps.uow.run(async (store) => {
    const job = await loadJob(store.jobs, input.jobId);
    if (job.status === "queued") return { job, replayed: true };
    await store.events.append(stream.job(job.id), { kind: "resume_requested", detail: { actor: input.actor, from: job.status } });
    return { job: await enqueueResume(deps, store, job), replayed: false };
  });
}
