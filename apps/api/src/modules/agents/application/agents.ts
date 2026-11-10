/**
 * Casos de uso do time: catálogo de personas, contratar, criar, ajustar e remover agentes,
 * organograma, dados da empresa e o assistente de primeiro uso.
 */
import type { Clock } from "../../../shared/clock.ts";
import { conflict, ensure, notFound } from "../../../shared/errors.ts";
import type { ActorId, AgentId } from "../../../shared/ids.ts";
import type { Json } from "../../../shared/json.ts";
import type { UnitOfWork } from "../../../platform/database/unit-of-work.ts";
import { stream } from "../../../platform/events/event-log.ts";
import type { CatalogAgent, TeamDirectory } from "../../open-work/domain/catalog.ts";
import { createCustom, hireFromTemplate, rehire, removeAgent, updateAgent, type Agent, type AgentChanges, type CustomAgentInput } from "../domain/agent.ts";
import { describeOrganization } from "../domain/organization.ts";
import type { TemplateCatalog } from "../domain/template.ts";
import type { AgentsStore } from "../infrastructure/sql-agents.ts";

export interface AgentsDeps {
  uow: UnitOfWork<AgentsStore>;
  catalog: TemplateCatalog;
  clock: Clock;
  /** Quantas fontes o Cérebro tem (para o assistente de primeiro uso). */
  countSources(): Promise<number>;
}

const TEAM_STREAM = stream.agents("team");

export interface AgentView {
  id: string;
  template_id: string | null;
  name: string;
  title: string;
  area: string;
  tagline: string;
  focus: string;
  skills: readonly string[];
  instructions: string;
  reports_to: string | null;
  hired_at: string;
}

const view = (a: Agent): AgentView => ({
  id: a.id,
  template_id: a.templateId,
  name: a.name,
  title: a.title,
  area: a.area,
  tagline: a.tagline,
  focus: a.focus,
  skills: a.skills,
  instructions: a.instructions,
  reports_to: a.reportsTo,
  hired_at: a.hiredAt,
});

/** O catálogo por área, com o que já está no time ("✓ No seu time"). */
export async function catalogView(deps: AgentsDeps) {
  const hired = new Set((await deps.uow.read.agents.list("active")).map((a) => a.templateId).filter(Boolean));
  return {
    areas: deps.catalog.areas.map((area) => {
      const templates = deps.catalog.templates.filter((t) => t.area === area.id);
      return {
        id: area.id,
        title: area.title,
        templates: templates.map((t) => ({ ...t, in_team: hired.has(t.id) })),
        in_team: templates.filter((t) => hired.has(t.id)).length,
      };
    }),
  };
}

export async function listTeam(deps: AgentsDeps) {
  return { agents: (await deps.uow.read.agents.list("active")).map(view) };
}

/** Contratar uma persona. Repetir é inofensivo; quem saiu volta ao time. */
export async function hire(deps: AgentsDeps, actor: ActorId, templateId: string) {
  const template = deps.catalog.templates.find((t) => t.id === templateId);
  ensure(template, () => notFound("template_not_found", "Persona não encontrada no catálogo"));
  const now = deps.clock.now();
  return deps.uow.run(async (s) => {
    const existing = await s.agents.get(template.id as AgentId);
    if (existing?.status === "active") return { agent: view(existing), replayed: true };
    const agent = existing ? rehire(existing, now) : hireFromTemplate(template, now);
    if (existing) await s.agents.save(agent);
    else await s.agents.add(agent);
    await s.events.append(TEAM_STREAM, { kind: "agent_hired", detail: { actor, agent: agent.id, template: template.id } });
    return { agent: view(agent), replayed: false };
  });
}

export async function createAgent(deps: AgentsDeps, actor: ActorId, input: CustomAgentInput) {
  const agent = createCustom(input, new Set(deps.catalog.areas.map((a) => a.id)), deps.clock.now());
  await deps.uow.run(async (s) => {
    await s.agents.add(agent);
    await s.events.append(TEAM_STREAM, { kind: "agent_created", detail: { actor, agent: agent.id } });
  });
  return view(agent);
}

export async function changeAgent(deps: AgentsDeps, actor: ActorId, id: AgentId, changes: AgentChanges) {
  return deps.uow.run(async (s) => {
    const agent = await s.agents.get(id);
    ensure(agent, () => notFound("agent_not_found", "Agente não encontrado"));
    const updated = updateAgent(agent, changes, await s.agents.list("active"), deps.clock.now());
    await s.agents.save(updated);
    await s.events.append(TEAM_STREAM, { kind: "agent_updated", detail: { actor, agent: id, fields: Object.keys(changes) } as Json });
    return view(updated);
  });
}

/** Tira do time. Quem respondia a ele passa a responder ao gestor dele (ou ao Chief of Staff). */
export async function dismiss(deps: AgentsDeps, actor: ActorId, id: AgentId) {
  const now = deps.clock.now();
  return deps.uow.run(async (s) => {
    const agent = await s.agents.get(id);
    ensure(agent, () => notFound("agent_not_found", "Agente não encontrado"));
    if (agent.status === "removed") return { replayed: true };
    for (const report of (await s.agents.list("active")).filter((a) => a.reportsTo === id))
      await s.agents.save({ ...report, reportsTo: agent.reportsTo, updatedAt: now });
    await s.agents.save(removeAgent(agent, now));
    await s.events.append(TEAM_STREAM, { kind: "agent_removed", detail: { actor, agent: id } });
    return { replayed: false };
  });
}

export interface OrgNode {
  id: string;
  name: string;
  title: string;
  area: string;
  reports: OrgNode[];
}

/** Gestor → Chief of Staff → agentes, seguindo a quem cada um responde. */
export async function organogram(deps: AgentsDeps) {
  const team = await deps.uow.read.agents.list("active");
  const org = await deps.uow.read.organization.get();
  const children = (manager: AgentId | null): OrgNode[] =>
    team
      .filter((a) => a.reportsTo === manager)
      .map((a) => ({ id: a.id, name: a.name, title: a.title, area: a.area, reports: children(a.id) }));
  return {
    company: org.name || null,
    top: { id: "manager", name: "Você", title: "Gestor(a) · aprova o que sai da empresa" },
    chief: { id: "chief_of_staff", name: "Chief of Staff", title: "Coordena o time e consolida os pareceres", reports: children(null) },
    areas: deps.catalog.areas,
  };
}

export async function getOrganization(deps: AgentsDeps) {
  const o = await deps.uow.read.organization.get();
  return { name: o.name, sector: o.sector, objectives: o.objectives, policies: o.policies, setup_completed_at: o.setupCompletedAt };
}

export async function saveOrganization(deps: AgentsDeps, actor: ActorId, input: { name: string; sector?: string; objectives?: string; policies?: string }) {
  await deps.uow.run(async (s) => {
    const updated = describeOrganization(await s.organization.get(), input, deps.clock.now());
    await s.organization.save(updated);
    await s.events.append(TEAM_STREAM, { kind: "organization_updated", detail: { actor } });
  });
  return getOrganization(deps);
}

/** Onde está o primeiro uso: empresa descrita, Cérebro com fontes, time montado. */
export async function setupStatus(deps: AgentsDeps) {
  const o = await deps.uow.read.organization.get();
  const team = (await deps.uow.read.agents.list("active")).length;
  const sources = await deps.countSources();
  return {
    steps: { company: o.name.length > 0, knowledge: sources > 0, team: team > 0 },
    sources,
    team,
    completed_at: o.setupCompletedAt,
  };
}

/** Concluir exige empresa descrita e pelo menos um agente; o Cérebro pode ficar para depois. */
export async function completeSetup(deps: AgentsDeps, actor: ActorId) {
  const status = await setupStatus(deps);
  ensure(status.steps.company, () => conflict("setup_company_missing", "Descreva a empresa antes de concluir"));
  ensure(status.steps.team, () => conflict("setup_team_missing", "Escolha pelo menos um agente para o time"));
  if (status.completed_at) return status;
  await deps.uow.run(async (s) => {
    const o = await s.organization.get();
    await s.organization.save({ ...o, setupCompletedAt: deps.clock.now() });
    await s.events.append(TEAM_STREAM, { kind: "setup_completed", detail: { actor } });
  });
  return setupStatus(deps);
}

/** O time como o trabalho aberto o vê. */
export function teamDirectory(uow: UnitOfWork<AgentsStore>): TeamDirectory {
  return {
    async members(): Promise<CatalogAgent[]> {
      return (await uow.read.agents.list("active")).map((a) => ({
        id: a.id,
        title: `${a.name}, ${a.title}`,
        focus: a.focus,
        domain: a.area,
        instructions: a.instructions || undefined,
      }));
    },
  };
}
