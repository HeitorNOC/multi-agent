/**
 * Política do trabalho aberto: pedido livre do gestor, plano com especialistas do catálogo e
 * parecer com citações do Cérebro. Toda citação precisa ter sido entregue a este trabalho.
 */
import { ensure, invalid } from "../../../shared/errors.ts";
import type { Json } from "../../../shared/json.ts";
import type { WorkPolicy } from "../../jobs/application/policy.ts";
import { maxAgentsOf, type TeamDirectory } from "../domain/catalog.ts";
import { CHIEF, MAX_ATTEMPTS, type PlanStep } from "../domain/step-tasks.ts";


const isText = (v: unknown, min: number, max: number): v is string => typeof v === "string" && v.trim().length >= min && v.length <= max;
const demand = (ok: unknown, code: string, message: string) => ensure(ok, () => invalid(code, message));

interface Citation {
  label: string;
  source: string;
  version: number;
}
interface Finding {
  claim: string;
  agent: string;
  citations: string[];
}

/** Etapas do plano aprovado: responsável e revisor no plano, dependências só de etapas anteriores. */
function planSteps(raw: unknown, agents: ReadonlySet<string>): PlanStep[] {
  demand(Array.isArray(raw) && raw.length >= 1 && raw.length <= 12, "invalid_steps", "O plano precisa de 1 a 12 etapas");
  return (raw as Record<string, unknown>[]).map((s, i) => {
    demand(isText(s?.title, 1, 300) && isText(s.deliverable, 1, 300), "invalid_steps", "Etapa sem título ou entrega");
    demand(typeof s.owner === "string" && agents.has(s.owner), "step_owner_not_in_plan", "Responsável da etapa fora do plano");
    const reviewer = s.reviewer ?? CHIEF;
    demand(typeof reviewer === "string" && (reviewer === CHIEF || agents.has(reviewer)), "step_reviewer_not_in_plan", "Revisor da etapa fora do plano");
    const after = s.after ?? [];
    demand(Array.isArray(after) && after.every((a) => Number.isInteger(a) && a >= 0 && a < i), "invalid_steps", "Dependência de etapa inválida");
    return { title: (s.title as string).trim(), owner: s.owner as string, deliverable: (s.deliverable as string).trim(), after: [...new Set(after as number[])], reviewer: reviewer as string };
  });
}

export function openWorkPolicy(team: TeamDirectory): WorkPolicy {
  return {
    id: "open-work",

    async goal(request) {
      const goal = (request as { goal?: unknown } | null)?.goal;
      demand(isText(goal, 10, 2000), "invalid_goal", "Descreva o pedido em 10 a 2000 caracteres");
      demand((await team.members()).length > 0, "team_empty", "Monte seu time em Agentes antes de pedir um trabalho");
      return (goal as string).trim();
    },

    async plan(proposal) {
      const specialists = new Set((await team.members()).map((a) => a.id));
      const max = await maxAgentsOf(team);
      const p = (proposal ?? {}) as { agents?: unknown; reason?: unknown; steps?: unknown };
      const agents = Array.isArray(p.agents) ? [...new Set(p.agents)] : [];
      demand(agents.length >= 1 && agents.length <= max, "invalid_plan", `O plano precisa de 1 a ${max} especialistas`);
      demand(agents.every((a) => typeof a === "string" && specialists.has(a)), "agent_not_in_team", "Especialista fora do time da empresa");
      demand(isText(p.reason, 10, 800), "invalid_plan", "Motivo do plano ausente");
      const steps = p.steps === undefined ? undefined : planSteps(p.steps, new Set(agents as string[]));
      return {
        strategy: "open",
        agents: agents as string[],
        reason: (p.reason as string).trim(),
        requires_approval: true,
        ...(steps ? { steps: steps as unknown as Json } : {}),
        // Sem etapas: plano + um especialista por agente + síntese. Com etapas (plano aprovado pelo
        // CEO): entrega e revisão por tentativa, mais a síntese. O gateway recusa além disso.
        max_model_calls: steps ? steps.length * 2 * MAX_ATTEMPTS + 1 : agents.length + 2,
      };
    },

    review(_job, report, context) {
      const r = (report ?? {}) as Record<string, unknown>;
      if (r.kind === "steps") return stepsReview(report, r, context.retrievedLabels);
      demand(r.kind === "open", "invalid_report", "Parecer fora do contrato do trabalho aberto");
      demand(typeof r.abstained === "boolean", "invalid_report", "Parecer sem indicação de abstenção");
      demand(isText(r.summary, 1, 2000), "invalid_report", "Resumo inválido");
      demand(typeof r.recommendation === "string" && r.recommendation.length <= 2000, "invalid_report", "Recomendação inválida");
      demand(Array.isArray(r.citations) && Array.isArray(r.findings), "invalid_report", "Parecer sem citações ou achados");
      const labels = new Set<string>();
      for (const c of r.citations as Partial<Citation>[]) {
        demand(typeof c?.label === "string" && typeof c.source === "string" && Number.isSafeInteger(c.version), "invalid_citation", "Citação inválida");
        demand(context.retrievedLabels.has(c.label!), "unknown_citation", "Citação de trecho não entregue a este trabalho");
        labels.add(c.label!);
      }
      for (const f of r.findings as Partial<Finding>[]) {
        demand(isText(f?.claim, 1, 1000) && typeof f!.agent === "string", "invalid_finding", "Achado inválido");
        demand(Array.isArray(f!.citations) && f!.citations.length > 0 && f!.citations.every((l) => labels.has(l)), "invalid_finding", "Achado sem citação válida");
      }
      const abstained = r.abstained as boolean;
      demand(abstained || ((r.findings as unknown[]).length > 0 && (r.recommendation as string).trim()), "invalid_report", "Parecer sem achados citados");
      return {
        report: report as Json,
        payload: {
          operation: "deliver-open-report",
          recipient: "gestor",
          content: abstained ? (r.summary as string) : (r.recommendation as string),
        },
      };
    },

    modelCallLimit(plan) {
      return Number((plan as { max_model_calls?: unknown } | null)?.max_model_calls ?? 0);
    },
  };
}

/** Parecer de um trabalho em etapas: o que cada etapa entregou, as revisões e o que sobe ao CEO. */
function stepsReview(report: unknown, r: Record<string, unknown>, served: ReadonlySet<string>) {
  demand(isText(r.summary, 1, 2000), "invalid_report", "Resumo inválido");
  demand(typeof r.recommendation === "string" && r.recommendation.length <= 2000, "invalid_report", "Recomendação inválida");
  demand(Array.isArray(r.steps) && r.steps.length > 0, "invalid_report", "Parecer sem etapas");
  for (const s of r.steps as Record<string, unknown>[])
    demand(["accepted", "escalated", "exhausted", "skipped"].includes(s?.status as string) && isText(s.title, 1, 300), "invalid_report", "Etapa do parecer inválida");
  for (const c of (Array.isArray(r.citations) ? r.citations : []) as { label?: unknown }[])
    demand(typeof c?.label === "string" && served.has(c.label), "unknown_citation", "Citação de trecho não entregue a este trabalho");
  return {
    report: report as Json,
    payload: { operation: "deliver-open-report", recipient: "gestor", content: ((r.recommendation as string).trim() || (r.summary as string)) as string },
  };
}
