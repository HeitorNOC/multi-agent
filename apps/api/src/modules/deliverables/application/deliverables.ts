/**
 * Casos de uso das entregas.
 *
 * - O efeito aprovado de um trabalho vira uma entrega (ou a próxima versão de uma entrega cujo
 *   ajuste foi pedido), na mesma transação do recibo do efeito.
 * - Pedir ajustes reabre o trabalho: a admissão do trabalho de revisão e a mudança da entrega
 *   acontecem na mesma transação; se a admissão for recusada (fila cheia, time vazio), nada muda.
 */
import type { Clock } from "../../../shared/clock.ts";
import { ensure, notFound } from "../../../shared/errors.ts";
import { type ActorId, type JobId } from "../../../shared/ids.ts";
import type { Json } from "../../../shared/json.ts";
import type { Transaction, UnitOfWork } from "../../../platform/database/unit-of-work.ts";
import { randomUUID } from "node:crypto";
import { stream } from "../../../platform/events/event-log.ts";
import type { EffectDelivery } from "../../jobs/application/deps.ts";
import { accept, addRevision, newDeliverable, requestChanges, revisionGoal, type Deliverable, type DeliverableId } from "../domain/deliverable.ts";
import type { DeliverablesStore } from "../infrastructure/sql-deliverables.ts";
import { toMarkdown, type DeliverableContent } from "./markdown.ts";

/** Abre o trabalho de revisão; `onAdmitted` roda na transação da admissão. Devolve o id do trabalho. */
export type ReopenJob = (goal: string, onAdmitted: (jobId: JobId, tx: Transaction) => Promise<void>) => Promise<JobId>;

export interface DeliverablesDeps {
  uow: UnitOfWork<DeliverablesStore>;
  clock: Clock;
  reopen: ReopenJob;
}

const streamOf = (id: DeliverableId) => stream.deliverable(id);

/** Liga o efeito aprovado dos trabalhos às entregas. */
export function deliveryFor(uow: UnitOfWork<DeliverablesStore>, clock: Clock): EffectDelivery {
  return {
    async deliver({ job, review }, tx) {
      const s = uow.join(tx);
      const now = clock.now();
      const content = { goal: job.goal, report: review.report, payload: review.payload } as unknown as DeliverableContent;
      const reopening = await s.deliverables.reopeningFor(job.id);
      let deliverable: Deliverable;
      if (reopening) {
        const current = await s.deliverables.get(reopening.deliverableId);
        ensure(current, () => notFound("deliverable_not_found", "Entrega da revisão não encontrada"));
        deliverable = addRevision(current, now);
        await s.deliverables.save(deliverable);
      } else {
        deliverable = newDeliverable(randomUUID() as DeliverableId, job.goal, now);
        await s.deliverables.add(deliverable);
      }
      await s.deliverables.addVersion({ deliverableId: deliverable.id, version: deliverable.currentVersion, jobId: job.id, content: content as unknown as Json, createdAt: now });
      await s.events.append(streamOf(deliverable.id), {
        kind: reopening ? "deliverable_revised" : "deliverable_created",
        detail: { version: deliverable.currentVersion, job: job.id, review_hash: review.hash },
      });
      return { deliverable_id: deliverable.id, deliverable_version: deliverable.currentVersion };
    },
  };
}

const summary = (d: Deliverable) => ({
  id: d.id,
  title: d.title,
  status: d.status,
  current_version: d.currentVersion,
  created_at: d.createdAt,
  updated_at: d.updatedAt,
  decided_by: d.decidedBy,
  decision_note: d.decisionNote,
});

export async function listDeliverables(deps: DeliverablesDeps) {
  return { deliverables: (await deps.uow.read.deliverables.list()).map(summary) };
}

async function load(s: DeliverablesStore, id: DeliverableId) {
  const d = await s.deliverables.get(id);
  ensure(d, () => notFound("deliverable_not_found", "Entrega não encontrada"));
  return d;
}

export async function viewDeliverable(deps: DeliverablesDeps, id: DeliverableId) {
  const d = await load(deps.uow.read, id);
  const [versions, reopenings, events] = await Promise.all([
    deps.uow.read.deliverables.versions(id),
    deps.uow.read.deliverables.reopenings(id),
    deps.uow.read.events.list(streamOf(id)),
  ]);
  return {
    ...summary(d),
    versions: versions.map((v) => ({ version: v.version, job_id: v.jobId, created_at: v.createdAt, content: v.content })),
    reopenings: reopenings.map((r) => ({ job_id: r.jobId, from_version: r.fromVersion, feedback: r.feedback, requested_by: r.requestedBy, created_at: r.createdAt })),
    history: events.map((e) => ({ seq: e.seq, kind: e.kind, at: e.occurredAt, detail: e.detail })),
  };
}

/** A entrega gerada por um trabalho, se houver (para o detalhe do trabalho apontar para ela). */
export async function deliverableForJob(deps: DeliverablesDeps, jobId: JobId) {
  const version = await deps.uow.read.deliverables.versionByJob(jobId);
  const reopening = await deps.uow.read.deliverables.reopeningFor(jobId);
  const id = version?.deliverableId ?? reopening?.deliverableId;
  ensure(id, () => notFound("deliverable_not_found", "Este trabalho não gerou entrega"));
  return { id, version: version?.version ?? null, revision_of: reopening ? reopening.fromVersion : null };
}

export async function acceptDeliverable(deps: DeliverablesDeps, actor: ActorId, id: DeliverableId, version: number) {
  await deps.uow.run(async (s) => {
    const accepted = accept(await load(s, id), version, actor, deps.clock.now());
    await s.deliverables.save(accepted);
    await s.events.append(streamOf(id), { kind: "deliverable_accepted", detail: { version, actor } });
  });
  return viewDeliverable(deps, id);
}

export async function requestDeliverableChanges(deps: DeliverablesDeps, actor: ActorId, id: DeliverableId, version: number, feedback: string) {
  const current = await load(deps.uow.read, id);
  // Confere antes de abrir o trabalho; a mesma regra é aplicada de novo dentro da transação.
  requestChanges(current, version, actor, feedback, deps.clock.now());
  const [latest] = await deps.uow.read.deliverables.versions(id);
  const goal = revisionGoal((latest?.content as unknown as DeliverableContent | undefined)?.goal ?? current.title, feedback);
  const jobId = await deps.reopen(goal, async (job, tx) => {
    const s = deps.uow.join(tx);
    const now = deps.clock.now();
    await s.deliverables.save(requestChanges(await load(s, id), version, actor, feedback, now));
    await s.deliverables.addReopening({ jobId: job, deliverableId: id, fromVersion: version, feedback: feedback.trim(), requestedBy: actor, createdAt: now });
    await s.events.append(streamOf(id), { kind: "deliverable_changes_requested", detail: { version, actor, job } });
  });
  return { ...(await viewDeliverable(deps, id)), reopened_job: jobId };
}

export async function deliverableMarkdown(deps: DeliverablesDeps, id: DeliverableId, version: number) {
  const d = await load(deps.uow.read, id);
  const v = (await deps.uow.read.deliverables.versions(id)).find((x) => x.version === version);
  ensure(v, () => notFound("version_not_found", "Versão não encontrada"));
  return { filename: `entrega-${id.slice(0, 8)}-v${version}.md`, text: toMarkdown(d.title, version, v.createdAt, v.content as unknown as DeliverableContent) };
}
