/** Visão de leitura de um trabalho para a API: o registro e a trilha, sem detalhes de armazenamento. */
import type { JobId } from "../../../shared/ids.ts";
import { stream } from "../../../platform/events/event-log.ts";
import type { Job } from "../domain/job.ts";
import type { JobsDeps } from "./deps.ts";
import { loadJob } from "./load-job.ts";

export interface JobView {
  id: string;
  goal: string;
  status: Job["status"];
  plan: Job["plan"];
  review: Job["review"];
  approved: boolean;
  receipt: Job["receipt"];
  error: string | null;
  created_at: string;
  worker_active: boolean;
  events: { seq: number; kind: string; at: string; detail: unknown }[];
}

export async function viewJob(deps: JobsDeps, id: JobId): Promise<JobView> {
  const job = await loadJob(deps.uow.read.jobs, id);
  return toView(deps, job);
}

export async function listJobViews(deps: JobsDeps): Promise<JobView[]> {
  return Promise.all((await deps.uow.read.jobs.listRecent()).map((job) => toView(deps, job)));
}

async function toView(deps: JobsDeps, job: Job): Promise<JobView> {
  const events = await deps.uow.read.events.list(stream.job(job.id));
  return {
    id: job.id,
    goal: job.goal,
    status: job.status,
    plan: job.plan,
    review: job.review,
    approved: job.approval !== null,
    receipt: job.receipt,
    error: job.error,
    created_at: job.createdAt,
    worker_active: deps.workers.isActive(job.id),
    events: events.map((e) => ({ seq: e.seq, kind: e.kind, at: e.occurredAt, detail: e.detail })),
  };
}
