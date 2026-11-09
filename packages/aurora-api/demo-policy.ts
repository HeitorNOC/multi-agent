import { createHash } from "node:crypto";
export const GOAL =
  "Analise as vendas e o estoque da ACME de janeiro e fevereiro e proponha uma ação comercial revisável.";
export const CAPABILITIES = ["sales_analysis", "inventory_analysis"];
export function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function validatePlan(p: any) {
  if (
    p?.strategy !== "A3" ||
    !Array.isArray(p.capabilities) ||
    p.capabilities.length !== 2 ||
    new Set(p.capabilities).size !== 2 ||
    !p.capabilities.every((c: string) => CAPABILITIES.includes(c)) ||
    typeof p.reason !== "string" ||
    p.reason.length < 15
  )
    throw Error("Plano fora do catálogo delimitado da demonstração");
  return {
    strategy: "A3",
    capabilities: p.capabilities,
    reason: p.reason,
    requires_approval: true,
    max_model_calls: 4,
  };
}
export function validateReport(r: any) {
  if (
    r?.january_revenue !== 10000 ||
    r.february_revenue !== 8000 ||
    r.revenue_drop_pct !== 20 ||
    r.january_stockouts !== 0 ||
    r.february_stockouts !== 0 ||
    r.causal_proof !== false
  )
    throw Error("Síntese diverge dos fatos ou afirma causa não comprovada");
  if (
    typeof r.summary !== "string" ||
    typeof r.action !== "string" ||
    !r.action.trim() ||
    r.action.length > 2500 ||
    !Array.isArray(r.hypotheses) ||
    !r.hypotheses.every((h: any) => typeof h === "string") ||
    !Array.isArray(r.cited_sources) ||
    !["sales-january", "sales-february", "inventory"].every((s) =>
      r.cited_sources.includes(s),
    ) ||
    r.cited_sources.some(
      (s: string) =>
        !["sales-january", "sales-february", "inventory"].includes(s),
    )
  )
    throw Error("Síntese/citações incompletas ou fonte não fornecida");
  return r;
}
export function reviewable(job: string, report: any) {
  validateReport(report);
  const payload = {
    operation: "simulated-commercial-proposal",
    recipient: "quadro-comercial-local",
    content: report.action,
  };
  const bound = { job, report, payload };
  return { ...bound, hash: digest(bound), requires_approval: true };
}
export function authorize(review: any, approval: string | null, hash: string) {
  if (
    !review ||
    review.hash !== hash ||
    review.hash !==
      digest({
        job: review.job,
        report: review.report,
        payload: review.payload,
      }) ||
    approval !== hash
  )
    throw Error("Aprovação do plano e conteúdo exatos ausente ou inválida");
}
