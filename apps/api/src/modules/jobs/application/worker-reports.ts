/**
 * O que o worker relata durante a execução: plano, parecer, efeito e eventos. A concessão do
 * worker (lease) é conferida antes, na camada HTTP; aqui ficam as regras.
 */
import { randomUUID } from "node:crypto";
import { conflict, ensure } from "../../../shared/errors.ts";
import type { JobId } from "../../../shared/ids.ts";
import type { Json } from "../../../shared/json.ts";
import { stream, type EventLog } from "../../../platform/events/event-log.ts";
import type { Job } from "../domain/job.ts";
import { bindReview, verifyApproved } from "../domain/review.ts";
import * as transitions from "../domain/transitions.ts";
import type { JobsDeps } from "./deps.ts";
import { loadJob } from "./load-job.ts";

/** Registra a recusa na trilha (fora da transação que falhou) e relança. */
async function recordRejection(events: EventLog, jobId: JobId, kind: string, error: unknown): Promise<never> {
  await events.append(stream.job(jobId), { kind, detail: { reason: error instanceof Error ? error.message : "recusado" } });
  throw error;
}

export async function recordPlan(deps: JobsDeps, jobId: JobId, proposal: Json): Promise<Json> {
  const job = await loadJob(deps.uow.read.jobs, jobId);
  let plan: Json;
  try {
    plan = await deps.policy.plan(proposal, job);
  } catch (error) {
    return recordRejection(deps.uow.read.events, jobId, "plan_rejected", error);
  }
  return deps.uow.run(async (store) => {
    const current = await loadJob(store.jobs, jobId);
    const planned = transitions.attachPlan(current, plan);
    if (planned !== current) {
      await store.jobs.save(planned);
      await store.events.append(stream.job(jobId), { kind: "plan", detail: plan });
    }
    return plan;
  });
}

/**
 * Trechos do Cérebro entregues a este trabalho, pelo rótulo (evento `knowledge_retrieved`).
 * É a lista contra a qual as citações do parecer e as entradas do modelo são conferidas.
 */
export async function retrievedFragments(events: EventLog, jobId: JobId): Promise<Map<string, string>> {
  const fragments = new Map<string, string>();
  for (const event of await events.list(stream.job(jobId))) {
    if (event.kind !== "knowledge_retrieved") continue;
    for (const f of (event.detail as { fragments?: { label: string; id: string }[] }).fragments ?? []) fragments.set(f.label, f.id);
  }
  return fragments;
}

export async function recordReview(deps: JobsDeps, jobId: JobId, report: Json): Promise<Job["review"]> {
  const job = await loadJob(deps.uow.read.jobs, jobId);
  let bound;
  try {
    const reviewed = deps.policy.review(job, report, { retrievedLabels: new Set((await retrievedFragments(deps.uow.read.events, jobId)).keys()) });
    bound = bindReview(jobId, reviewed.report, reviewed.payload);
  } catch (error) {
    return recordRejection(deps.uow.read.events, jobId, "review_rejected", error);
  }
  return deps.uow.run(async (store) => {
    const current = await loadJob(store.jobs, jobId);
    const reviewed = transitions.attachReview(current, bound);
    if (reviewed !== current) {
      await store.jobs.save(reviewed);
      await store.events.append(stream.job(jobId), { kind: "review_ready", detail: { hash: bound.hash } });
    }
    return bound;
  });
}

/**
 * Executa o efeito aprovado, uma única vez. Pedir de novo (retomada depois de uma queda) devolve
 * o mesmo recibo; um hash diferente do aprovado é recusado.
 */
export async function recordEffect(deps: JobsDeps, jobId: JobId, hash: string): Promise<Json> {
  return deps.uow.run(async (store) => {
    const job = await loadJob(store.jobs, jobId);
    const review = verifyApproved(job, hash);
    const existing = await store.effects.get(jobId);
    if (existing) ensure(existing.hash === hash, () => conflict("effect_intent_mismatch", "Intenção divergente do efeito já executado"));
    const payload = review.payload as { recipient: string; content: string };
    const receipt: Json = existing?.receipt ?? {
      id: randomUUID(),
      job: jobId,
      hash,
      simulated: true,
      recipient: payload.recipient,
      content: payload.content,
      created: deps.clock.now(),
    };
    if (!existing) await store.effects.add({ jobId, hash, receipt });
    if (job.receipt === null) await store.jobs.save(transitions.recordReceipt(job, receipt));
    await store.events.append(stream.job(jobId), {
      kind: "effect_receipt",
      detail: { id: (receipt as { id: string }).id, replayed: !!existing, simulated: true },
    });
    return receipt;
  });
}

export async function recordWorkerEvent(deps: JobsDeps, jobId: JobId, event: { kind: string; detail: Json; eventId?: string }) {
  await loadJob(deps.uow.read.jobs, jobId);
  return deps.uow.read.events.append(stream.job(jobId), event);
}
