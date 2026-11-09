import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
export const CATALOG = JSON.parse(
  readFileSync(
    new URL("../../../demo-enterprise/catalog.json", import.meta.url),
    "utf8",
  ),
);
const corpus = JSON.parse(
  readFileSync(
    new URL("../../../demo-enterprise/corpus.json", import.meta.url),
    "utf8",
  ),
);
const currentSources = new Set(
  corpus.documents.filter((d: any) => d.current).map((d: any) => d.source),
);
const agents = new Map<string, any>(CATALOG.agents.map((a: any) => [a.id, a]));
export const GOAL = CATALOG.scenarios[0].goal;
export const QUE_EXECUTION_GOAL = CATALOG.scenarios.find((item: any) => item.id === "engineering_que_run").goal;
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
function demand(ok: any, message: string): asserts ok {
  if (!ok) throw Error(message);
}
export function chooseGoal(body: any) {
  const s = CATALOG.scenarios.find(
    (s: any) => s.id === body.scenario || s.goal === body.goal,
  );
  demand(s, "Selecione um dos cenários fictícios");
  return s.goal;
}
export function validatePlan(p: any) {
  demand(
    p && Array.isArray(p.teams) && p.teams.length >= 1 && p.teams.length <= 4,
    "Equipe deve ter de uma a quatro diretorias",
  );
  demand(
    typeof p.reason === "string" && p.reason.length >= 20,
    "Motivo da estratégia ausente",
  );
  const selected: string[] = [];
  for (const t of p.teams) {
    const lead = agents.get(t.lead);
    demand(lead?.kind === "director", "Diretor fora do catálogo");
    demand(
      Array.isArray(t.specialists) &&
        t.specialists.length >= 1 &&
        t.specialists.length <= 2,
      "Diretor deve ter um ou dois especialistas selecionados",
    );
    demand(
      typeof t.reason === "string" && t.reason.length >= 12,
      "Motivo da delegação ausente",
    );
    selected.push(t.lead);
    for (const id of t.specialists) {
      demand(
        agents.get(id)?.kind === "specialist" &&
          agents.get(id).parent === t.lead,
        "Especialista não pertence à capacidade delegada",
      );
      selected.push(id);
    }
  }
  demand(
    new Set(selected).size === selected.length && selected.length <= 8,
    "Equipe repetida ou maior que oito agentes",
  );
  const ignored = CATALOG.agents
    .filter((a: any) => !selected.includes(a.id))
    .map((a: any) => a.id);
  demand(
    Array.isArray(p.not_selected) && p.not_selected.length === ignored.length,
    "Justifique todos os agentes não selecionados",
  );
  demand(
    new Set(p.not_selected.map((a: any) => a.id)).size === ignored.length &&
      p.not_selected.every(
        (a: any) =>
          ignored.includes(a.id) &&
          typeof a.reason === "string" &&
          a.reason.length >= 8,
      ),
    "Justificativas de exclusão inválidas",
  );
  const strategy = p.teams.length > 1 ? "A3" : "A2";
  demand(
    p.strategy === strategy,
    "Estratégia incompatível com a equipe proposta",
  );
  return {
    strategy,
    reason: p.reason,
    teams: p.teams,
    capabilities: selected,
    not_selected: p.not_selected,
    requires_approval: true,
    max_model_calls: selected.length + 2,
  };
}
// Closed-scenario acceptance checks; these answers are NEVER included in LLM prompts.
const expectations: any = {
  campaign: {
    available_stock_units: 3000,
    combined_demand_units: 11000,
    shortfall_units: 8000,
    discount_margin_pct: 26.24,
    minimum_margin_pct: 28,
    cash_headroom_brl: 130000,
    requested_budget_brl: 180000,
    cash_gap_brl: 50000,
    inbound_confirmed: false,
    carbon_claim_supported: false,
  },
  incident: {
    potential_records: 1200,
    confirmed_exfiltration: false,
    response_sla_minutes: 90,
    minutes_elapsed: 25,
    minutes_remaining: 65,
  },
};
export function validateReport(r: any, goal: string) {
  const scenario = CATALOG.scenarios.find((s: any) => s.goal === goal);
  demand(scenario, "Cenário ausente");
  demand(
    r &&
      typeof r.summary === "string" &&
      r.summary.length > 30 &&
      typeof r.action === "string" &&
      r.action.length > 30 &&
      r.action.length < 5000,
    "Síntese e proposta ausentes",
  );
  demand(
    Array.isArray(r.facts) &&
      r.facts.length > 0 &&
      Array.isArray(r.risks) &&
      Array.isArray(r.conditions),
    "Estrutura da decisão incompleta",
  );
  demand(
    r.risks.every((s: any) => typeof s === "string") &&
      r.conditions.every((s: any) => typeof s === "string"),
    "Riscos ou condições inválidos",
  );
  const facts = new Map();
  for (const f of r.facts) {
    demand(typeof f.key === "string" && !facts.has(f.key), "Fato duplicado");
    demand(
      Array.isArray(f.sources) &&
        f.sources.length > 0 &&
        f.sources.every((s: any) => currentSources.has(s)),
      "Citação desconhecida ou histórica",
    );
    facts.set(f.key, f);
  }
  for (const [key, value] of Object.entries(expectations[scenario.id])) {
    const f: any = facts.get(key);
    demand(f, "Fato obrigatório ausente: " + key);
    demand(
      typeof value === "number"
        ? typeof f.value === "number" && Math.abs(f.value - value) < 0.021
        : f.value === value,
      "Fato inconsistente: " + key,
    );
  }
  demand(
    Array.isArray(r.cited_sources) &&
      r.cited_sources.every((s: any) => currentSources.has(s)),
    "Fontes inválidas",
  );
  for (const f of r.facts)
    for (const source of f.sources)
      demand(
        r.cited_sources.includes(source),
        "Citação não consta na bibliografia",
      );
  return r;
}
export function repositoryReview(job: string, goal: string) {
  const scenario = CATALOG.scenarios.find((item: any) => item.id === "engineering_que_review");
  if (scenario?.goal !== goal) return null;
  const evidence = readFileSync(
    new URL("../../../reports/aurora-engenharia-webhook/que/result.json", import.meta.url),
    "utf8",
  ).replaceAll("\r\n", "\n");
  demand(
    createHash("sha256").update(evidence).digest("hex") ===
      "10563a4e70ddc84c09b4ed3319b23a0b62e4c91263304818ada526ae11a0b689",
    "Evidência da entrega externa alterada",
  );
  const result = JSON.parse(evidence);
  const attempt = result.attempts.at(-1);
  demand(attempt.passed && result.state.decision.action === "human_review", "Entrega externa sem validação");
  const failure = attempt.mutation.tests.find((test: any) => test.status === "failed");
  const report = {
    kind: "engineering",
    repository: { name: "que", revision: result.revision },
    roster: result.state.roster,
    assignments: result.state.assignments,
    tests: {
      passed: true,
      log: [
        `Suíte de origem · ${result.baseline.passed_tests} testes passaram`,
        `Suíte com o diff · ${attempt.suite.passed_tests} testes passaram`,
        `Prova de regressão · ${attempt.mutation.failed_tests} falha esperada`,
        failure.failures[0].split("\n")[0],
        "git apply --check passou na revisão de origem.",
      ].join("\n"),
      evidence: { baseline: result.baseline, suite: attempt.suite, mutation: attempt.mutation },
    },
    attempt: result.state.attempt,
    qa: result.state.qa,
    technical_review: result.state.technical_review,
    decision: result.state.decision,
    diff: attempt.diff,
  };
  const payload = {
    operation: "engineering-repository-review",
    recipient: "registro-local-engenharia",
    content: "Registrar a revisão humana da proposta de teste do repositório que.",
  };
  const bound = { job, report, payload };
  return { ...bound, hash: hash(bound), requires_approval: true };
}

export function reviewable(job: string, report: any, goal: string) {
  if (goal === QUE_EXECUTION_GOAL || CATALOG.scenarios.some((s: any) =>
    ["engineering_webhook", "engineering_webhook_team"].includes(s.id) && s.goal === goal
  )) {
    const que = goal === QUE_EXECUTION_GOAL;
    const file = que
      ? "packages/modules/sales/src/application/commands/process-terminal-payment-webhook/process-terminal-payment-webhook.spec.ts"
      : "webhook.cjs";
    demand(
      report?.kind === "engineering" && report.tests?.passed === true &&
        report.tests.exit_code === 0 && typeof report.tests.log === "string" &&
        report.qa?.verdict === "pass" && report.technical_review?.verdict === "pass" &&
        report.decision?.action === "human_review" && typeof report.diff === "string" &&
        report.diff.startsWith(`--- a/${file}\n+++ b/${file}\n`) &&
        (!que || (report.repository?.name === "que" &&
          report.repository.revision === "5cf77950e29c0d203b3ee1d10471b775f6b91af4" &&
          report.tests.diff === report.diff && report.tests.evidence?.suite?.passed_tests === 12 &&
          report.tests.evidence?.mutation?.failed_tests === 1)) &&
        report.diff.length <= 24_000,
      "Entrega de engenharia sem diff ou verificações aprovadas",
    );
    const payload = {
      operation: "engineering-review",
      recipient: "registro-local-engenharia",
      content: "Registrar a revisão humana da entrega de engenharia.",
    };
    const bound = { job, report, payload };
    return { ...bound, hash: hash(bound), requires_approval: true };
  }
  validateReport(report, goal);
  const payload = {
    operation: "simulated-enterprise-decision",
    recipient: "comite-aurora-local",
    content: report.action,
  };
  const bound = { job, report, payload };
  return { ...bound, hash: hash(bound), requires_approval: true };
}
export function authorize(
  review: any,
  approval: string | null,
  digest: string,
) {
  demand(
    review &&
      review.hash === digest &&
      approval === digest &&
      hash({
        job: review.job,
        report: review.report,
        payload: review.payload,
      }) === digest,
    "Aprovação exata ausente ou adulterada",
  );
}
