/**
 * Agentes da empresa. Um agente é contratado a partir de uma persona do catálogo (o id é o da
 * persona, então cada persona entra no time uma vez) ou criado do zero (`custom_...`). O Chief of
 * Staff é fixo e não é um agente do time: ele escala os agentes.
 *
 * Organograma: cada agente responde ao Chief of Staff (`reportsTo = null`) ou a outro agente ativo,
 * sem ciclos.
 */
import { randomBytes } from "node:crypto";
import { conflict, ensure, invalid } from "../../../shared/errors.ts";
import type { AgentId } from "../../../shared/ids.ts";
import type { Engagement } from "./autonomy.ts";
import type { AgentTemplate } from "./template.ts";

export type AgentStatus = "active" | "removed";

export interface Agent {
  readonly id: AgentId;
  readonly templateId: string | null;
  readonly name: string;
  readonly title: string;
  readonly area: string;
  readonly tagline: string;
  readonly focus: string;
  readonly skills: readonly string[];
  /** Orientações da empresa para este agente. */
  readonly instructions: string;
  /** A quem responde; `null` é o Chief of Staff. */
  readonly reportsTo: AgentId | null;
  readonly status: AgentStatus;
  /** Permanente, ou só para um trabalho (`engagedJob`): sai do time quando ele termina. */
  readonly engagement: Engagement;
  readonly engagedJob: string | null;
  /** Quem trouxe para o time: o CEO (tela de Agentes) ou o Chief of Staff (dentro da alçada). */
  readonly hiredBy: HiredBy;
  readonly hiredAt: string;
  readonly updatedAt: string;
}

export type HiredBy = "ceo" | "chief";

/** Como a contratação acontece: padrão é permanente, pelo CEO. */
export interface HireTerms {
  engagement?: Engagement;
  engagedJob?: string | null;
  hiredBy?: HiredBy;
}

const terms = (t: HireTerms = {}) => ({
  engagement: t.engagement ?? "permanent",
  engagedJob: t.engagement === "job" ? (t.engagedJob ?? null) : null,
  hiredBy: t.hiredBy ?? "ceo",
});

export const LIMITS = { name: 60, title: 100, tagline: 160, focus: 400, instructions: 1500, skill: 60, skills: 8 } as const;
export const AGENT_ID = /^[a-z0-9_]{1,80}$/;

const text = (value: string, max: number, code: string, label: string) => {
  const v = value.trim();
  ensure(v.length >= 1 && v.length <= max, () => invalid(code, `${label} deve ter de 1 a ${max} caracteres`));
  return v;
};

function cleanSkills(skills: readonly string[]) {
  const unique = [...new Set(skills.map((s) => s.trim()).filter(Boolean))];
  ensure(unique.length <= LIMITS.skills && unique.every((s) => s.length <= LIMITS.skill), () =>
    invalid("invalid_skills", `Até ${LIMITS.skills} habilidades de até ${LIMITS.skill} caracteres`),
  );
  return unique;
}

export function hireFromTemplate(template: AgentTemplate, now: string, hire: HireTerms = {}): Agent {
  return {
    id: template.id as AgentId,
    templateId: template.id,
    name: template.name,
    title: template.title,
    area: template.area,
    tagline: template.tagline,
    focus: template.focus,
    skills: template.skills,
    instructions: "",
    reportsTo: null,
    status: "active",
    ...terms(hire),
    hiredAt: now,
    updatedAt: now,
  };
}

export interface CustomAgentInput {
  name: string;
  title: string;
  area: string;
  focus: string;
  tagline?: string;
  skills?: readonly string[];
  instructions?: string;
}

/** Agente criado do zero; o id vem do nome mais um sufixo curto. */
export function createCustom(input: CustomAgentInput, areas: ReadonlySet<string>, now: string): Agent {
  ensure(areas.has(input.area), () => invalid("invalid_area", "Área desconhecida"));
  const name = text(input.name, LIMITS.name, "invalid_name", "Nome");
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
  return {
    id: `custom_${slug || "agente"}_${randomBytes(3).toString("hex")}` as AgentId,
    templateId: null,
    name,
    title: text(input.title, LIMITS.title, "invalid_title", "Cargo"),
    area: input.area,
    tagline: input.tagline?.trim().slice(0, LIMITS.tagline) ?? "",
    focus: text(input.focus, LIMITS.focus, "invalid_focus", "Foco"),
    skills: cleanSkills(input.skills ?? []),
    instructions: (input.instructions ?? "").trim().slice(0, LIMITS.instructions),
    reportsTo: null,
    status: "active",
    ...terms(),
    hiredAt: now,
    updatedAt: now,
  };
}

export interface AgentChanges {
  name?: string;
  title?: string;
  focus?: string;
  tagline?: string;
  skills?: readonly string[];
  instructions?: string;
  reportsTo?: AgentId | null;
}

/**
 * Aplica mudanças. `team` é o time ativo atual, usado para validar a quem o agente responde
 * (precisa estar ativo e não pode criar ciclo).
 */
export function updateAgent(agent: Agent, changes: AgentChanges, team: readonly Agent[], now: string): Agent {
  ensure(agent.status === "active", () => conflict("agent_removed", "Este agente saiu do time"));
  let reportsTo = agent.reportsTo;
  if (changes.reportsTo !== undefined) {
    reportsTo = changes.reportsTo;
    if (reportsTo !== null) {
      const byId = new Map(team.map((a) => [a.id, a]));
      ensure(reportsTo !== agent.id && byId.get(reportsTo)?.status === "active", () => invalid("invalid_manager", "Escolha um agente ativo do time"));
      // Subir a cadeia a partir do novo gestor não pode chegar a este agente.
      for (let at: AgentId | null = reportsTo, steps = 0; at !== null; at = byId.get(at)?.reportsTo ?? null, steps++)
        ensure(at !== agent.id && steps < team.length, () => conflict("org_cycle", "Isso criaria um ciclo no organograma"));
    }
  }
  return {
    ...agent,
    name: changes.name === undefined ? agent.name : text(changes.name, LIMITS.name, "invalid_name", "Nome"),
    title: changes.title === undefined ? agent.title : text(changes.title, LIMITS.title, "invalid_title", "Cargo"),
    focus: changes.focus === undefined ? agent.focus : text(changes.focus, LIMITS.focus, "invalid_focus", "Foco"),
    tagline: changes.tagline === undefined ? agent.tagline : changes.tagline.trim().slice(0, LIMITS.tagline),
    skills: changes.skills === undefined ? agent.skills : cleanSkills(changes.skills),
    instructions: changes.instructions === undefined ? agent.instructions : changes.instructions.trim().slice(0, LIMITS.instructions),
    reportsTo,
    updatedAt: now,
  };
}

export const removeAgent = (agent: Agent, now: string): Agent => ({ ...agent, status: "removed", reportsTo: null, updatedAt: now });

/** Recontratar uma persona que saiu: volta ativa, respondendo ao Chief of Staff. */
export const rehire = (agent: Agent, now: string, hire: HireTerms = {}): Agent => ({ ...agent, status: "active", reportsTo: null, ...terms(hire), updatedAt: now });

/**
 * Quem já está no time e foi trazido só para um trabalho, ao ser contratado de novo de forma
 * permanente (pelo CEO), passa a ficar. O contrário não acontece: o Chief nunca rebaixa alguém.
 */
export const makePermanent = (agent: Agent, now: string): Agent => ({ ...agent, engagement: "permanent", engagedJob: null, updatedAt: now });
