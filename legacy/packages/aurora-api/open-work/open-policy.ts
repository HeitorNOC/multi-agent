/**
 * Política do trabalho aberto: pedidos livres, especialistas do catálogo e parecer com citações
 * do Cérebro. Carregada pelo servidor via `config.policyModule`, no lugar das políticas da
 * demonstração e da bancada do Aurora (que continuam intactas).
 *
 * O servidor chama estas funções sem acesso a banco; o que depende do ledger (quais trechos o
 * trabalho recebeu) chega em `context`.
 */
import { createHash } from "node:crypto";
import { loadSpecialists } from "./catalog.ts";

/** Marca para o servidor ligar o portão do trabalho aberto e a conversa com pedido livre. */
export const openWork = true;
export const GOAL = "";

const specialists = new Set(loadSpecialists().map((a) => a.id));
const MAX_AGENTS = 3;

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function demand(ok: unknown, message: string): asserts ok {
  if (!ok) throw Error(message);
}
const isText = (v: unknown, min: number, max: number): v is string =>
  typeof v === "string" && v.trim().length >= min && v.length <= max;

/** O pedido é o próprio texto do gestor, dentro de limites de tamanho. */
export function chooseGoal(body: any) {
  demand(isText(body?.goal, 10, 2000), "Descreva o pedido em 10 a 2000 caracteres");
  return body.goal.trim();
}

export function validatePlan(p: any) {
  const agents = Array.isArray(p?.agents) ? [...new Set(p.agents)] : [];
  demand(agents.length >= 1 && agents.length <= MAX_AGENTS, `O plano precisa de 1 a ${MAX_AGENTS} especialistas`);
  demand(agents.every((a) => typeof a === "string" && specialists.has(a)), "Especialista fora do catálogo");
  demand(isText(p.reason, 10, 800), "Motivo do plano ausente");
  return {
    strategy: "open",
    agents,
    capabilities: agents,
    reason: p.reason.trim(),
    requires_approval: true,
    // Plano + um especialista por agente + síntese; o portão recusa chamadas além disso.
    max_model_calls: agents.length + 2,
  };
}

/**
 * Valida o parecer e prende a aprovação ao conteúdo exato. Toda citação precisa ter sido
 * entregue a este trabalho (`context.retrieved`); um parecer sem abstenção precisa citar.
 */
export function reviewable(job: string, report: any, _goal?: string, context?: { retrieved: Set<string> }) {
  demand(report?.kind === "open", "Parecer fora do contrato do trabalho aberto");
  demand(typeof report.abstained === "boolean", "Parecer sem indicação de abstenção");
  demand(isText(report.summary, 1, 2000), "Resumo inválido");
  demand(typeof report.recommendation === "string" && report.recommendation.length <= 2000, "Recomendação inválida");
  demand(Array.isArray(report.citations) && Array.isArray(report.findings), "Parecer sem citações ou achados");
  const labels = new Set<string>();
  for (const c of report.citations) {
    demand(typeof c?.label === "string" && typeof c.source === "string" && Number.isSafeInteger(c.version), "Citação inválida");
    demand(!context || context.retrieved.has(c.label), "Citação de trecho não entregue a este trabalho");
    labels.add(c.label);
  }
  for (const f of report.findings) {
    demand(isText(f?.claim, 1, 1000) && typeof f.agent === "string", "Achado inválido");
    demand(Array.isArray(f.citations) && f.citations.length > 0 && f.citations.every((l: string) => labels.has(l)), "Achado sem citação válida");
  }
  demand(report.abstained || (report.findings.length > 0 && report.recommendation.trim()), "Parecer sem achados citados");
  const payload = {
    operation: "deliver-open-report",
    recipient: "gestor",
    content: report.abstained ? report.summary : report.recommendation,
  };
  const bound = { job, report, payload };
  return { ...bound, hash: digest(bound), requires_approval: true };
}

export function authorize(review: any, approval: string | null, hash: string) {
  demand(
    review &&
      review.hash === hash &&
      review.hash === digest({ job: review.job, report: review.report, payload: review.payload }) &&
      approval === hash,
    "Aprovação do parecer exato ausente ou inválida",
  );
}
