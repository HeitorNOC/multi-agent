/** Política mínima para testes dos casos de uso: regras simples e previsíveis. */
import { invalid } from "../../src/shared/errors.ts";
import type { Json } from "../../src/shared/json.ts";
import type { WorkPolicy } from "../../src/modules/jobs/application/policy.ts";

export const testPolicy: WorkPolicy = {
  id: "teste",
  goal(request) {
    const goal = (request as { goal?: unknown })?.goal;
    if (typeof goal !== "string" || goal.trim().length < 3) throw invalid("invalid_goal", "Pedido inválido");
    return goal.trim();
  },
  plan(proposal) {
    const agents = (proposal as { agents?: unknown })?.agents;
    if (!Array.isArray(agents) || !agents.length) throw invalid("invalid_plan", "Plano sem agentes");
    return { agents: agents as Json[], max_model_calls: agents.length + 2 };
  },
  review(_job, report, context) {
    const r = report as { summary?: unknown; citations?: unknown };
    if (typeof r?.summary !== "string") throw invalid("invalid_report", "Relatório sem resumo");
    const citations = Array.isArray(r.citations) ? (r.citations as string[]) : [];
    if (!citations.every((c) => context.retrievedLabels.has(c))) throw invalid("unknown_citation", "Citação não entregue a este trabalho");
    return { report: { summary: r.summary, citations }, payload: { operation: "deliver-report", recipient: "gestor", content: r.summary } };
  },
  modelCallLimit(plan) {
    return Number((plan as { max_model_calls?: number }).max_model_calls ?? 0);
  },
};
