/**
 * Política do trabalho aberto: pedido livre do gestor, plano com especialistas do catálogo e
 * parecer com citações do Cérebro. Toda citação precisa ter sido entregue a este trabalho.
 */
import { ensure, invalid } from "../../../shared/errors.ts";
import type { Json } from "../../../shared/json.ts";
import type { WorkPolicy } from "../../jobs/application/policy.ts";
import type { CatalogAgent } from "../domain/catalog.ts";

export const MAX_AGENTS = 3;

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

export function openWorkPolicy(catalog: readonly CatalogAgent[]): WorkPolicy {
  const specialists = new Set(catalog.map((a) => a.id));
  return {
    id: "open-work",

    goal(request) {
      const goal = (request as { goal?: unknown } | null)?.goal;
      demand(isText(goal, 10, 2000), "invalid_goal", "Descreva o pedido em 10 a 2000 caracteres");
      return (goal as string).trim();
    },

    plan(proposal) {
      const p = (proposal ?? {}) as { agents?: unknown; reason?: unknown };
      const agents = Array.isArray(p.agents) ? [...new Set(p.agents)] : [];
      demand(agents.length >= 1 && agents.length <= MAX_AGENTS, "invalid_plan", `O plano precisa de 1 a ${MAX_AGENTS} especialistas`);
      demand(agents.every((a) => typeof a === "string" && specialists.has(a)), "agent_not_in_catalog", "Especialista fora do catálogo");
      demand(isText(p.reason, 10, 800), "invalid_plan", "Motivo do plano ausente");
      return {
        strategy: "open",
        agents: agents as string[],
        reason: (p.reason as string).trim(),
        requires_approval: true,
        // Plano + um especialista por agente + síntese; o gateway recusa chamadas além disso.
        max_model_calls: agents.length + 2,
      };
    },

    review(_job, report, context) {
      const r = (report ?? {}) as Record<string, unknown>;
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
