/**
 * Entregas: o artefato que um trabalho aprovado produz (hoje, o parecer com achados e fontes).
 *
 * Ciclo: a entrega nasce **em revisão**. O gestor **aceita** a versão atual, ou **pede ajustes**
 * com um retorno; pedir ajustes reabre o trabalho, e quando a revisão é aprovada ela vira a versão
 * seguinte da mesma entrega, de novo em revisão. Toda decisão vale para uma versão exata: decidir
 * sobre uma versão que já foi substituída é recusado.
 */
import { conflict, ensure, invalid } from "../../../shared/errors.ts";
import type { ActorId, Id } from "../../../shared/ids.ts";

export type DeliverableId = Id<"Deliverable">;
export type DeliverableStatus = "in_review" | "accepted" | "changes_requested";

export interface Deliverable {
  readonly id: DeliverableId;
  readonly title: string;
  readonly status: DeliverableStatus;
  readonly currentVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Última decisão do gestor sobre a versão atual. */
  readonly decidedBy: ActorId | null;
  readonly decisionNote: string | null;
}

export const FEEDBACK = { min: 10, max: 1000 } as const;

export function newDeliverable(id: DeliverableId, goal: string, now: string): Deliverable {
  const title = goal.replace(/\s+/g, " ").trim();
  return {
    id,
    title: title.length > 120 ? `${title.slice(0, 117)}…` : title,
    status: "in_review",
    currentVersion: 1,
    createdAt: now,
    updatedAt: now,
    decidedBy: null,
    decisionNote: null,
  };
}

function requireCurrent(d: Deliverable, version: number) {
  ensure(d.status === "in_review", () => conflict("not_in_review", "Esta entrega não está aguardando revisão"));
  ensure(version === d.currentVersion, () => conflict("version_outdated", "Há uma versão mais nova; revise a versão atual"));
}

export function accept(d: Deliverable, version: number, actor: ActorId, now: string): Deliverable {
  requireCurrent(d, version);
  return { ...d, status: "accepted", decidedBy: actor, decisionNote: null, updatedAt: now };
}

export function requestChanges(d: Deliverable, version: number, actor: ActorId, feedback: string, now: string): Deliverable {
  requireCurrent(d, version);
  const note = feedback.trim();
  ensure(note.length >= FEEDBACK.min && note.length <= FEEDBACK.max, () =>
    invalid("invalid_feedback", `Descreva os ajustes em ${FEEDBACK.min} a ${FEEDBACK.max} caracteres`),
  );
  return { ...d, status: "changes_requested", decidedBy: actor, decisionNote: note, updatedAt: now };
}

/** A revisão pedida chegou aprovada: nova versão, de volta para revisão. */
export function addRevision(d: Deliverable, now: string): Deliverable {
  ensure(d.status === "changes_requested", () => conflict("revision_not_requested", "Nenhum ajuste foi pedido nesta entrega"));
  return { ...d, status: "in_review", currentVersion: d.currentVersion + 1, decidedBy: null, decisionNote: null, updatedAt: now };
}

/** Pedido do trabalho de revisão: o pedido original com o retorno do gestor, dentro do limite da política. */
export function revisionGoal(originalGoal: string, feedback: string, max = 2000) {
  const suffix = `\n\nAjustes pedidos pelo gestor na versão anterior: ${feedback.trim()}`;
  const room = Math.max(50, max - suffix.length);
  const base = originalGoal.length > room ? `${originalGoal.slice(0, room - 1)}…` : originalGoal;
  return `${base}${suffix}`.slice(0, max);
}
