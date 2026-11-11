/**
 * Memória da empresa (N5): fatos estáveis que o CEO vê e edita — produtos, tom de voz, stack,
 * clientes, regras do negócio. O Chief e todos os agentes recebem esses fatos em cada tarefa.
 * Ficam na trilha (quem criou, mudou ou removeu).
 */
import { randomUUID } from "node:crypto";
import { ensure, invalid, notFound } from "../../../shared/errors.ts";
import type { ActorId } from "../../../shared/ids.ts";
import { stream } from "../../../platform/events/event-log.ts";
import type { UnitOfWork } from "../../../platform/database/unit-of-work.ts";
import type { AgentsStore } from "../infrastructure/sql-agents.ts";

export const FACT_CATEGORIES = ["empresa", "produtos", "clientes", "marca", "tecnologia", "regras"] as const;
export type FactCategory = (typeof FACT_CATEGORIES)[number];
export const MAX_FACTS = 60;
const STREAM = stream.agents("facts");

export interface FactsDeps {
  uow: UnitOfWork<AgentsStore>;
  clock: { now(): string };
}

const clean = (text: unknown, category: unknown) => {
  ensure(typeof text === "string" && text.trim().length >= 3 && text.trim().length <= 500, () => invalid("invalid_fact", "O fato precisa ter de 3 a 500 caracteres"));
  ensure(typeof category === "string" && (FACT_CATEGORIES as readonly string[]).includes(category), () => invalid("invalid_category", `Categoria: ${FACT_CATEGORIES.join(", ")}`));
  return { text: (text as string).trim(), category: category as FactCategory };
};

const view = (f: { id: string; text: string; category: string; updatedAt: string }) => ({ id: f.id, text: f.text, category: f.category, updated_at: f.updatedAt });

export async function listFacts(deps: FactsDeps) {
  return { facts: (await deps.uow.read.facts.list()).map(view), categories: FACT_CATEGORIES };
}

export async function addFact(deps: FactsDeps, actor: ActorId, input: { text: unknown; category: unknown }) {
  const { text, category } = clean(input.text, input.category);
  return deps.uow.run(async (s) => {
    ensure((await s.facts.list()).length < MAX_FACTS, () => invalid("too_many_facts", `No máximo ${MAX_FACTS} fatos`));
    const now = deps.clock.now();
    const fact = { id: randomUUID(), text, category, createdBy: actor, createdAt: now, updatedAt: now };
    await s.facts.add(fact);
    await s.events.append(STREAM, { kind: "fact_added", detail: { actor, id: fact.id, category } });
    return view(fact);
  });
}

export async function changeFact(deps: FactsDeps, actor: ActorId, id: string, input: { text: unknown; category: unknown }) {
  const { text, category } = clean(input.text, input.category);
  return deps.uow.run(async (s) => {
    const now = deps.clock.now();
    ensure(await s.facts.update(id, text, category, now), () => notFound("fact_not_found", "Fato não encontrado"));
    await s.events.append(STREAM, { kind: "fact_changed", detail: { actor, id, category } });
    return { id, text, category, updated_at: now };
  });
}

export async function removeFact(deps: FactsDeps, actor: ActorId, id: string) {
  return deps.uow.run(async (s) => {
    const removed = await s.facts.remove(id);
    if (removed) await s.events.append(STREAM, { kind: "fact_removed", detail: { actor, id } });
    return { removed };
  });
}

/** O que vai aos prompts: "categoria: fato", na ordem em que o CEO escreveu. */
export async function factLines(deps: FactsDeps) {
  return (await deps.uow.read.facts.list()).map((f) => `${f.category}: ${f.text}`);
}
