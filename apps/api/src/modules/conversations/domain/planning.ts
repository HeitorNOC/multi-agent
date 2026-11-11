/**
 * Planejamento na conversa (N2). Para pedidos com várias etapas ou áreas, o Chief of Staff não abre
 * o trabalho direto: entende o pedido (pergunta só o que falta), escreve os requisitos (o "brief"),
 * consulta o Cérebro e propõe o plano — etapas, responsáveis, quem trazer do catálogo, riscos. O CEO
 * aprova, ajusta conversando ou cancela. Aprovado, o trabalho nasce com o time do plano.
 *
 * O planejamento exige o modelo; sem ele, o Chief por regras segue abrindo o trabalho direto.
 * Aqui ficam os tipos, a validação do que o modelo propõe e o texto do pedido que o trabalho recebe.
 */
import { invalid } from "../../../shared/errors.ts";

export interface Brief {
  /** O que o CEO quer, numa frase. */
  readonly objective: string;
  /** O que já se sabe (do pedido, das respostas e do Cérebro). */
  readonly context: readonly string[];
  readonly constraints: readonly string[];
  readonly deadline: string | null;
  /** O que conta como pronto. */
  readonly done: readonly string[];
}

export interface PlanStep {
  readonly title: string;
  /** Id de um agente do time ou de uma persona do catálogo listada em `hire`. */
  readonly owner: string;
  readonly deliverable: string;
  /** Etapas (índices) que precisam estar prontas antes; sem indicação, a anterior. */
  readonly after: readonly number[];
}

export interface WorkPlan {
  readonly steps: readonly PlanStep[];
  /** Do time atual. */
  readonly team: readonly string[];
  /** Do catálogo (entram com a aprovação do plano). */
  readonly hire: readonly string[];
  readonly risks: readonly string[];
  /** Fontes do Cérebro em que o plano se apoiou ("Título (vN)"; o modelo cita por rótulo). */
  readonly references: readonly string[];
  /** Diretores e líderes do plano que detalham a sua parte antes de o plano ir ao CEO. */
  readonly specify: readonly string[];
  /** Recursos da empresa que o plano usa (nomes do cadastro). */
  readonly resources: readonly string[];
  /** O que falta provisionar (o CEO decide antes de aprovar). */
  readonly needs: readonly string[];
}

/** O que um diretor devolve ao detalhar a sua parte do plano. */
export interface SpecSection {
  readonly summary: string;
  readonly requirements: readonly string[];
  readonly components: readonly string[];
  readonly risks: readonly string[];
  readonly questions: readonly string[];
}

export type SpecStatus = "pending" | "done" | "failed";

export interface PlanSpec {
  readonly planId: string;
  readonly version: number;
  readonly agentId: string;
  readonly status: SpecStatus;
  readonly output: SpecSection | null;
  readonly error: string | null;
  readonly updatedAt: string;
}

export function validateSpec(raw: unknown): SpecSection {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    summary: str(r.summary, 800, "invalid_spec"),
    requirements: list(r.requirements ?? [], "invalid_spec"),
    components: list(r.components ?? [], "invalid_spec"),
    risks: list(r.risks ?? [], "invalid_spec"),
    questions: list(r.questions ?? [], "invalid_spec", PLAN_LIMITS.questions),
  };
}

export type PlanStatus = "drafting" | "specifying" | "proposed" | "approved" | "cancelled";

export interface PlanningDraft {
  readonly id: string;
  readonly conversationId: string;
  readonly originSeq: number;
  /** Resposta do Chief que mostra a versão atual (o cartão do plano fica nela). */
  readonly replySeq: number;
  readonly offerId: string;
  readonly version: number;
  readonly status: PlanStatus;
  readonly brief: Brief;
  /** Perguntas em aberto; com elas, o plano ainda não pode ser aprovado. */
  readonly questions: readonly string[];
  readonly plan: WorkPlan | null;
  readonly jobId: string | null;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** O que o modelo pode usar ao planejar (para validar a proposta). */
export interface PlanningContext {
  team: ReadonlySet<string>;
  /** Persona do catálogo que pode ser trazida (vazio se a alçada é "nunca"). */
  candidates: ReadonlySet<string>;
  maxAgents: number;
  /** Rótulos dos trechos do Cérebro entregues ao modelo. */
  labels: ReadonlySet<string>;
  /** Diretores e líderes (do time ou do catálogo) que podem detalhar a sua parte. */
  leaders?: ReadonlySet<string>;
  /** Consolidando especificações: não pede outra rodada. */
  noSpecify?: boolean;
  /** Nomes dos recursos cadastrados (o plano só pode citar estes como existentes). */
  resources?: ReadonlySet<string>;
}

export const PLAN_LIMITS = { steps: 12, questions: 3, list: 8, item: 300, objective: 400, deadline: 120 } as const;

/** Erro de proposta inválida: o caso de uso volta às regras com o motivo. */
export class PlanningError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

const str = (v: unknown, max: number, code: string): string => {
  if (typeof v !== "string" || !v.trim() || v.length > max) throw new PlanningError(code);
  return v.trim();
};
const list = (v: unknown, code: string, max: number = PLAN_LIMITS.list): string[] => {
  if (!Array.isArray(v) || v.length > max) throw new PlanningError(code);
  return v.map((x) => str(x, PLAN_LIMITS.item, code));
};

/** Valida o brief, as perguntas e o plano propostos pelo modelo. */
export function validatePlanning(raw: { brief?: unknown; questions?: unknown; plan?: unknown }, ctx: PlanningContext): { brief: Brief; questions: string[]; plan: WorkPlan | null } {
  const b = (raw.brief ?? {}) as Record<string, unknown>;
  const brief: Brief = {
    objective: str(b.objective, PLAN_LIMITS.objective, "invalid_brief"),
    context: list(b.context ?? [], "invalid_brief"),
    constraints: list(b.constraints ?? [], "invalid_brief"),
    deadline: b.deadline === null || b.deadline === undefined || b.deadline === "" ? null : str(b.deadline, PLAN_LIMITS.deadline, "invalid_brief"),
    done: list(b.done ?? [], "invalid_brief"),
  };
  const questions = list(raw.questions ?? [], "invalid_questions", PLAN_LIMITS.questions);
  if (raw.plan === null || raw.plan === undefined) return { brief, questions, plan: null };

  const p = raw.plan as Record<string, unknown>;
  const team = [...new Set(list(p.team ?? [], "invalid_plan", 12))];
  const hire = [...new Set(list(p.hire ?? [], "invalid_plan", 4))];
  if (team.some((t) => !ctx.team.has(t))) throw new PlanningError("plan_agent_not_in_team");
  if (hire.some((h) => !ctx.candidates.has(h))) throw new PlanningError("plan_hire_not_offered");
  if (team.length + hire.length < 1 || team.length + hire.length > ctx.maxAgents) throw new PlanningError("plan_agent_count");
  const people = new Set([...team, ...hire]);
  if (!Array.isArray(p.steps) || p.steps.length < 1 || p.steps.length > PLAN_LIMITS.steps) throw new PlanningError("invalid_steps");
  const steps = (p.steps as Record<string, unknown>[]).map((s, i) => {
    const owner = str(s?.owner, 80, "invalid_steps");
    if (!people.has(owner)) throw new PlanningError("step_owner_not_in_plan");
    const after = s.after === undefined || s.after === null ? (i > 0 ? [i - 1] : []) : s.after;
    if (!Array.isArray(after) || !after.every((a) => Number.isInteger(a) && a >= 0 && a < i)) throw new PlanningError("invalid_step_order");
    return { title: str(s.title, PLAN_LIMITS.item, "invalid_steps"), owner, deliverable: str(s.deliverable, PLAN_LIMITS.item, "invalid_steps"), after: [...new Set(after as number[])] };
  });
  const references = [...new Set(list(p.references ?? [], "invalid_plan", 12))].filter((r) => ctx.labels.has(r));
  // Só quem está no plano e lidera (diretor ou líder) detalha; o resto é descartado.
  const specify = ctx.noSpecify ? [] : [...new Set(list(p.specify ?? [], "invalid_plan", 4))].filter((x) => people.has(x) && (ctx.leaders?.has(x) ?? false));
  const resources = [...new Set(list(p.resources ?? [], "invalid_plan", 12))].filter((r) => ctx.resources?.has(r) ?? false);
  const needs = list(p.needs ?? [], "invalid_plan", 8);
  return { brief, questions, plan: { steps, team, hire, risks: list(p.risks ?? [], "invalid_plan"), references, specify, resources, needs } };
}

/** Pronto para aprovar: com plano e sem perguntas em aberto. */
export const isProposal = (d: { questions: readonly string[]; plan: WorkPlan | null }) => !!d.plan && d.questions.length === 0;

const MAX_GOAL = 2000;

/**
 * O pedido que o trabalho recebe: objetivo, restrições, critério de pronto e as etapas com os
 * responsáveis (os especialistas leem isto). Cabe no limite do pedido (2000 caracteres).
 */
const resourceText = (name: string, resources: ReadonlyMap<string, string>) => (resources.get(name) ? `${name} (${resources.get(name)})` : name);

export function composeGoal(brief: Brief, plan: WorkPlan, names: ReadonlyMap<string, string>, resources: ReadonlyMap<string, string> = new Map()): string {
  const lines = [
    brief.objective,
    ...(brief.constraints.length ? [`Restrições: ${brief.constraints.join("; ")}.`] : []),
    ...(brief.deadline ? [`Prazo: ${brief.deadline}.`] : []),
    ...(brief.done.length ? [`Pronto quando: ${brief.done.join("; ")}.`] : []),
    ...(plan.resources?.length ? [`Recursos da empresa a usar: ${plan.resources.map((r) => resourceText(r, resources)).join("; ")}.`] : []),
    ...(plan.needs?.length ? [`A provisionar (aprovado pelo CEO): ${plan.needs.join("; ")}.`] : []),
    "Etapas do plano aprovado:",
    ...plan.steps.map((s, i) => `${i + 1}. ${s.title} — ${names.get(s.owner) ?? s.owner}: ${s.deliverable}`),
  ];
  let goal = "";
  for (const line of lines) {
    const next = goal ? `${goal}\n${line}` : line;
    if (next.length > MAX_GOAL) break;
    goal = next;
  }
  if (goal.length < 10) throw invalid("invalid_goal", "Pedido do plano curto demais");
  return goal;
}

/** O plano que o trabalho recebe pronto (validado pela política do trabalho no passo de plano). */
export const presetOf = (plan: WorkPlan, version: number, people: ReadonlyMap<string, { area: string; role?: string }> = new Map()) => ({
  agents: [...plan.team, ...plan.hire],
  reason: `Plano aprovado pelo CEO na conversa (versão ${version}), com ${plan.steps.length} etapa(s).`,
  steps: plan.steps.map((s) => ({ title: s.title, owner: s.owner, deliverable: s.deliverable, after: [...s.after], reviewer: reviewerOf(s.owner, plan, people) })),
});

/**
 * Quem revisa a etapa: o diretor da área do responsável que está no plano; sem ele, o líder da
 * área; sem ninguém (ou se o responsável é quem lidera), o Chief of Staff.
 */
export function reviewerOf(owner: string, plan: WorkPlan, people: ReadonlyMap<string, { area: string; role?: string }>): string {
  const area = people.get(owner)?.area;
  const inPlan = [...plan.team, ...plan.hire].filter((id) => id !== owner && people.get(id)?.area === area);
  return inPlan.find((id) => people.get(id)?.role === "director") ?? inPlan.find((id) => people.get(id)?.role === "lead") ?? "chief";
}
