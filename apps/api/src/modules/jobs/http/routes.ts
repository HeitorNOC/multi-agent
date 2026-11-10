/**
 * Rotas de trabalhos.
 * - Públicas (`/api/jobs`): pedir, acompanhar e decidir.
 * - Do worker (`/internal/jobs/:id/...`): só o processo da execução atual, com o segredo e a
 *   concessão dele, pode relatar plano, parecer, efeito e eventos.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { forbidden } from "../../../shared/errors.ts";
import { AdmissionKey, JobId } from "../../../shared/ids.ts";
import type { HttpContext, HttpModule } from "../../../platform/http/app.ts";
import { admitJob } from "../application/admit-job.ts";
import { approveJob, rejectJob, resumeJob } from "../application/decide-job.ts";
import type { JobsDeps } from "../application/deps.ts";
import { listJobViews, viewJob } from "../application/job-view.ts";
import { recordEffect, recordPlan, recordReview, recordWorkerEvent } from "../application/worker-reports.ts";
import * as schema from "./schemas.ts";

export interface WorkerAccess {
  acceptsToken(token: unknown): boolean;
  holdsLease(jobId: JobId, lease: unknown): boolean;
}

export interface JobsHttpDeps {
  jobs: JobsDeps;
  /** Acorda o agendador quando algo entra na fila. */
  wake(): void;
  workerAccess: WorkerAccess;
}

const jobIdOf = (req: FastifyRequest) => JobId.parse((req.params as { id?: unknown }).id);

export function jobsHttp(deps: JobsHttpDeps): HttpModule {
  return (app, { actor }) => {
    publicRoutes(app, deps, actor);
    workerRoutes(app, deps);
  };
}

function publicRoutes(app: FastifyInstance, { jobs, wake }: JobsHttpDeps, actor: HttpContext["actor"]) {
  app.post("/api/jobs", async (req, reply) => {
    const header = req.headers["idempotency-key"];
    const key = header === undefined ? undefined : AdmissionKey.parse(header);
    const { job, replayed } = await admitJob(jobs, { request: req.body as never, key });
    if (!replayed) wake();
    return reply.code(replayed ? 200 : 201).send(await viewJob(jobs, job.id));
  });

  app.get("/api/jobs", async () => {
    const depth = await jobs.uow.read.queue.depth();
    return {
      jobs: await listJobViews(jobs),
      queue: {
        capacity: jobs.limits.capacity,
        resume_reserve: jobs.limits.resumeReserve,
        max_workers: jobs.limits.maxWorkers,
        pending: depth.total,
        new_pending: depth.newRequests,
        running: jobs.workers.count(),
      },
    };
  });

  app.get("/api/jobs/:id", async (req) => viewJob(jobs, jobIdOf(req)));

  app.post("/api/jobs/:id/approve", async (req, reply) => {
    const body = schema.approveBody.parse(req.body);
    const id = jobIdOf(req);
    const { replayed } = await approveJob(jobs, { jobId: id, hash: body.hash, actor: actor(req), crashAfterEffect: body.crash_after_effect });
    if (!replayed) wake();
    return reply.code(202).send(await viewJob(jobs, id));
  });

  app.post("/api/jobs/:id/reject", async (req) => {
    const body = schema.rejectBody.parse(req.body);
    const id = jobIdOf(req);
    await rejectJob(jobs, { jobId: id, hash: body.hash, actor: actor(req) });
    return viewJob(jobs, id);
  });

  app.post("/api/jobs/:id/resume", async (req, reply) => {
    const id = jobIdOf(req);
    const { replayed } = await resumeJob(jobs, { jobId: id, actor: actor(req) });
    if (!replayed) wake();
    return reply.code(202).send(await viewJob(jobs, id));
  });
}

function workerRoutes(app: FastifyInstance, { jobs, workerAccess }: JobsHttpDeps) {
  /** Confere o segredo do worker e a concessão da execução atual deste trabalho. */
  function authorize(req: FastifyRequest, lease: string): JobId {
    if (!workerAccess.acceptsToken(req.headers["x-worker-token"])) throw forbidden("worker_token_invalid", "Acesso interno negado");
    const id = jobIdOf(req);
    if (!workerAccess.holdsLease(id, lease)) throw forbidden("worker_not_active", "Executor do trabalho não está ativo");
    return id;
  }

  app.post("/internal/jobs/:id/snapshot", async (req) => {
    const { lease } = schema.workerSnapshotBody.parse(req.body);
    return viewJob(jobs, authorize(req, lease));
  });

  app.post("/internal/jobs/:id/plan", async (req) => {
    const body = schema.workerPlanBody.parse(req.body);
    return { plan: await recordPlan(jobs, authorize(req, body.lease), body.plan) };
  });

  app.post("/internal/jobs/:id/review", async (req) => {
    const body = schema.workerReviewBody.parse(req.body);
    return { review: await recordReview(jobs, authorize(req, body.lease), body.report) };
  });

  app.post("/internal/jobs/:id/effect", async (req) => {
    const body = schema.workerEffectBody.parse(req.body);
    return { receipt: await recordEffect(jobs, authorize(req, body.lease), body.hash) };
  });

  app.post("/internal/jobs/:id/events", async (req) => {
    const body = schema.workerEventBody.parse(req.body);
    const id = authorize(req, body.lease);
    return recordWorkerEvent(jobs, id, { kind: body.kind, detail: body.detail, eventId: body.event_id });
  });
}
