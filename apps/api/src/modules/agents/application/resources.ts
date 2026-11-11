/**
 * Recursos da empresa (N6): o que o CEO já provisionou para o time usar — bancos, filas (Kafka),
 * ambientes, repositórios, nuvem. O Chief planeja com o que existe e pede o que falta; os agentes
 * recebem as descrições no pedido do trabalho. Aqui ficam só descrições, nunca credenciais (essas
 * ficam nos conectores, cifradas).
 */
import { randomUUID } from "node:crypto";
import { ensure, invalid, notFound } from "../../../shared/errors.ts";
import type { ActorId } from "../../../shared/ids.ts";
import { stream } from "../../../platform/events/event-log.ts";
import type { UnitOfWork } from "../../../platform/database/unit-of-work.ts";
import type { AgentsStore, CompanyResource } from "../infrastructure/sql-agents.ts";

export const RESOURCE_KINDS = ["database", "queue", "environment", "repository", "cloud", "other"] as const;
const STREAM = stream.agents("resources");
const SECRETISH = /(senha|password|secret|token|apikey|api_key|-----begin|postgres(ql)?:\/\/[^@\s]+:[^@\s]+@)/i;

export interface ResourcesDeps {
  uow: UnitOfWork<AgentsStore>;
  clock: { now(): string };
}

function clean(input: { kind?: unknown; name?: unknown; description?: unknown }) {
  ensure(typeof input.kind === "string" && (RESOURCE_KINDS as readonly string[]).includes(input.kind), () => invalid("invalid_kind", `Tipo: ${RESOURCE_KINDS.join(", ")}`));
  ensure(typeof input.name === "string" && /^[\p{L}\p{N} ._\-/]{2,80}$/u.test(input.name.trim()), () => invalid("invalid_name", "Nome de 2 a 80 caracteres"));
  ensure(typeof input.description === "string" && input.description.trim().length >= 5 && input.description.length <= 1000, () => invalid("invalid_description", "Descreva em 5 a 1000 caracteres"));
  // Credencial não entra aqui: vai para um conector, cifrada.
  ensure(!SECRETISH.test(input.description as string), () => invalid("looks_like_secret", "A descrição parece ter uma senha ou token; credenciais vão nos conectores, não aqui"));
  return { kind: input.kind as CompanyResource["kind"], name: (input.name as string).trim(), description: (input.description as string).trim() };
}

const view = (r: CompanyResource) => ({ id: r.id, kind: r.kind, name: r.name, description: r.description, updated_at: r.updatedAt });

export async function listResources(deps: ResourcesDeps) {
  return { resources: (await deps.uow.read.resources.list()).map(view), kinds: RESOURCE_KINDS };
}

export async function addResource(deps: ResourcesDeps, actor: ActorId, input: { kind?: unknown; name?: unknown; description?: unknown }) {
  const r = clean(input);
  return deps.uow.run(async (s) => {
    ensure(!(await s.resources.list()).some((x) => x.name.toLowerCase() === r.name.toLowerCase()), () => invalid("resource_exists", "Já existe um recurso com esse nome"));
    const now = deps.clock.now();
    const resource = { id: randomUUID(), ...r, createdBy: actor, createdAt: now, updatedAt: now };
    await s.resources.add(resource);
    await s.events.append(STREAM, { kind: "resource_added", detail: { actor, id: resource.id, kind: r.kind, name: r.name } });
    return view(resource);
  });
}

export async function changeResource(deps: ResourcesDeps, actor: ActorId, id: string, input: { kind?: unknown; name?: unknown; description?: unknown }) {
  const r = clean(input);
  return deps.uow.run(async (s) => {
    const now = deps.clock.now();
    ensure(await s.resources.update(id, r.kind, r.name, r.description, now), () => notFound("resource_not_found", "Recurso não encontrado"));
    await s.events.append(STREAM, { kind: "resource_changed", detail: { actor, id } });
    return { id, ...r, updated_at: now };
  });
}

export async function removeResource(deps: ResourcesDeps, actor: ActorId, id: string) {
  return deps.uow.run(async (s) => {
    const removed = await s.resources.remove(id);
    if (removed) await s.events.append(STREAM, { kind: "resource_removed", detail: { actor, id } });
    return { removed };
  });
}

/** Para o Chief planejar: nome, tipo e descrição. */
export async function resourceBriefs(deps: ResourcesDeps) {
  return (await deps.uow.read.resources.list()).map((r) => ({ name: r.name, kind: r.kind, description: r.description }));
}
