/**
 * Composição do time: contratar (pelo CEO ou pelo Chief, dentro da alçada), ligar a hierarquia
 * (diretor lidera a área) e liberar quem entrou só para um trabalho quando ele termina.
 *
 * O CEO contrata pela tela de Agentes, sempre de forma permanente. O Chief contrata pela conversa:
 * propõe e o CEO aprova, ou contrata sozinho, conforme as alçadas (`autonomy.ts`).
 */
import { ensure, notFound } from "../../../shared/errors.ts";
import type { ActorId, AgentId } from "../../../shared/ids.ts";
import type { Json } from "../../../shared/json.ts";
import type { Transaction, UnitOfWork } from "../../../platform/database/unit-of-work.ts";
import { stream } from "../../../platform/events/event-log.ts";
import { hireFromTemplate, makePermanent, rehire, removeAgent, type Agent, type HireTerms } from "../domain/agent.ts";
import { applyAutonomy, mayHire, type ChiefAutonomy } from "../domain/autonomy.ts";
import type { AgentTemplate, TemplateCatalog, TemplateRole } from "../domain/template.ts";
import type { AgentsStore } from "../infrastructure/sql-agents.ts";

const TEAM_STREAM = stream.agents("team");

/** Papel de um agente do time: o da persona do catálogo; criados pela empresa são especialistas. */
export const roleOf = (catalog: TemplateCatalog, agent: Pick<Agent, "templateId">): TemplateRole =>
  (agent.templateId ? catalog.templates.find((t) => t.id === agent.templateId)?.role : undefined) ?? "specialist";

/**
 * Contrata (ou recontrata) dentro de uma transação e liga a hierarquia da área:
 * - diretor contratado passa a liderar quem da área responde direto ao Chief;
 * - qualquer outro entra respondendo ao diretor da área, se houver.
 * Contratar de novo, pelo CEO, quem estava só para um trabalho o torna permanente.
 */
export async function hireInStore(s: AgentsStore, catalog: TemplateCatalog, template: AgentTemplate, terms: HireTerms, actor: string, now: string) {
  const existing = await s.agents.get(template.id as AgentId);
  if (existing?.status === "active") {
    if (existing.engagement === "job" && (terms.engagement ?? "permanent") === "permanent") {
      const kept = makePermanent(existing, now);
      await s.agents.save(kept);
      await s.events.append(TEAM_STREAM, { kind: "agent_made_permanent", detail: { actor, agent: kept.id } });
      return { agent: kept, replayed: false };
    }
    return { agent: existing, replayed: true };
  }
  let agent = existing ? rehire(existing, now, terms) : hireFromTemplate(template, now, terms);
  const team = (await s.agents.list("active")).filter((a) => a.id !== agent.id);
  if (template.role !== "director") {
    const director = team.find((x) => x.area === template.area && roleOf(catalog, x) === "director");
    if (director) agent = { ...agent, reportsTo: director.id };
  }
  // O diretor é gravado antes de o time da área passar a responder a ele (chave estrangeira).
  if (existing) await s.agents.save(agent);
  else await s.agents.add(agent);
  const linked: AgentId[] = [];
  if (template.role === "director")
    for (const a of team.filter((x) => x.area === template.area && x.reportsTo === null && roleOf(catalog, x) !== "director")) {
      await s.agents.save({ ...a, reportsTo: agent.id, updatedAt: now });
      linked.push(a.id);
    }
  await s.events.append(TEAM_STREAM, {
    kind: "agent_hired",
    detail: { actor, agent: agent.id, template: template.id, engagement: agent.engagement, job: agent.engagedJob, by: agent.hiredBy, reports_to: agent.reportsTo, leads: linked } as Json,
  });
  return { agent, replayed: false };
}

export interface StaffingDeps {
  uow: UnitOfWork<AgentsStore>;
  catalog: TemplateCatalog;
  clock: { now(): string };
}

export async function getAutonomy(deps: StaffingDeps) {
  return deps.uow.read.autonomy.get();
}

export async function saveAutonomy(deps: StaffingDeps, actor: ActorId, input: Partial<Record<keyof ChiefAutonomy, unknown>>) {
  return deps.uow.run(async (s) => {
    const next = applyAutonomy(await s.autonomy.get(), input, new Set(deps.catalog.areas.map((a) => a.id)));
    const now = deps.clock.now();
    await s.autonomy.save(next, actor, now);
    await s.events.append(TEAM_STREAM, { kind: "chief_autonomy_updated", detail: { actor, ...next } as unknown as Json });
    return next;
  });
}

/** Persona do catálogo que o Chief poderia trazer (fora do time e dentro das áreas permitidas). */
export interface StaffingCandidate {
  id: string;
  name: string;
  title: string;
  area: string;
  role: TemplateRole;
  focus: string;
  skills: readonly string[];
}

export interface TeamMemberBrief {
  id: string;
  name: string;
  title: string;
  area: string;
  focus: string;
  skills: readonly string[];
}

/**
 * O que a conversa precisa saber e fazer com o time: as alçadas, quem está, quem poderia vir e
 * contratar dentro de uma transação já aberta (a do trabalho que está sendo aberto).
 */
export interface StaffingPort {
  snapshot(): Promise<{ autonomy: ChiefAutonomy; team: TeamMemberBrief[]; candidates: StaffingCandidate[] }>;
  hire(tx: Transaction, templateIds: readonly string[], terms: HireTerms & { actor: string }): Promise<{ id: string; name: string; title: string }[]>;
}

export function staffingPort(deps: StaffingDeps): StaffingPort {
  return {
    async snapshot() {
      const autonomy = await deps.uow.read.autonomy.get();
      const team = await deps.uow.read.agents.list("active");
      const inTeam = new Set(team.map((a) => a.templateId).filter(Boolean));
      return {
        autonomy,
        team: team.map((a) => ({ id: a.id, name: a.name, title: a.title, area: a.area, focus: a.focus, skills: a.skills })),
        candidates: deps.catalog.templates
          .filter((t) => !inTeam.has(t.id) && mayHire(autonomy, t.area))
          .map((t) => ({ id: t.id, name: t.name, title: t.title, area: t.area, role: t.role, focus: t.focus, skills: t.skills })),
      };
    },
    async hire(tx, templateIds, terms) {
      const s = deps.uow.join(tx);
      const now = deps.clock.now();
      const out = [];
      for (const id of templateIds) {
        const template = deps.catalog.templates.find((t) => t.id === id);
        ensure(template, () => notFound("template_not_found", "Persona não encontrada no catálogo"));
        const { agent } = await hireInStore(s, deps.catalog, template, terms, terms.actor, now);
        out.push({ id: agent.id, name: agent.name, title: agent.title });
      }
      return out;
    },
  };
}

/**
 * Quem entrou só para um trabalho sai do time quando o trabalho termina (concluído, rejeitado ou
 * encerrado). Quem respondia a ele passa a responder a quem ele respondia. Idempotente.
 */
export async function releaseJobHires(deps: StaffingDeps, finished: (jobIds: string[]) => Promise<Set<string>>) {
  const temporary = (await deps.uow.read.agents.list("active")).filter((a) => a.engagement === "job" && a.engagedJob);
  if (!temporary.length) return [];
  const done = await finished([...new Set(temporary.map((a) => a.engagedJob!))]);
  const released: string[] = [];
  for (const agent of temporary.filter((a) => done.has(a.engagedJob!)))
    await deps.uow.run(async (s) => {
      const current = await s.agents.get(agent.id);
      if (current?.status !== "active" || current.engagement !== "job") return;
      const now = deps.clock.now();
      for (const report of (await s.agents.list("active")).filter((a) => a.reportsTo === agent.id))
        await s.agents.save({ ...report, reportsTo: current.reportsTo, updatedAt: now });
      await s.agents.save(removeAgent(current, now));
      await s.events.append(TEAM_STREAM, { kind: "agent_released", detail: { agent: agent.id, job: agent.engagedJob } });
      released.push(agent.id);
    });
  return released;
}
