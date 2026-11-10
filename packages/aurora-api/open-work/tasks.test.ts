// Testes das tarefas do trabalho aberto: prompts e validação de cada saída do modelo.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { localDate } from "../knowledge/dates.ts";
import { planTask, specialistTask, synthesisTask, TaskOutputError, type Fragment } from "./tasks.ts";

const catalog = [
  { id: "controller", title: "Controller", focus: "Margem e caixa", domain: "finance" },
  { id: "procurement_analyst", title: "Analista de compras", focus: "Fornecedores", domain: "operations" },
];
const fragments: Fragment[] = [
  { label: "f-aaaaaaaa", source: "s1", title: "Compras", version: 2, validFrom: "2026-11-10T00:30:00.000Z", text: "Três cotações." },
  { label: "f-bbbbbbbb", source: "s2", title: "Orçamento", version: 1, validFrom: "2026-01-01T12:00:00.000Z", text: "1,2 milhão." },
];
const code = (fn: () => unknown) => {
  try {
    fn();
    return "ok";
  } catch (e) {
    return e instanceof TaskOutputError ? e.code : String(e);
  }
};

describe("tarefas do trabalho aberto", () => {
  test("datas vão ao modelo como data local, com 'hoje' no mesmo fuso", () => {
    const now = "2026-11-10T00:45:00.000Z";
    const data = JSON.parse(specialistTask("pedido", catalog[0], fragments, now).prompt);
    assert.equal(data.hoje, localDate(now));
    assert.equal(data.trechos[0].vigente_desde, localDate(fragments[0].validFrom));
    assert.ok(!data.trechos[0].vigente_desde.includes("T"), "sem instante UTC");
    assert.equal(data.trechos[0].vigente_desde <= data.hoje, true, "fonte já vigente não parece futura");
  });

  test("plano: só agentes do catálogo, de 1 a 3, com motivo", () => {
    const t = planTask("pedido", catalog);
    assert.deepEqual(t.validate(JSON.stringify({ agents: ["controller", "controller"], reason: "Cobre margem e caixa." })), {
      agents: ["controller"],
      reason: "Cobre margem e caixa.",
    });
    assert.equal(code(() => t.validate(JSON.stringify({ agents: ["inventado"], reason: "Motivo suficiente." }))), "agent_not_in_catalog");
    assert.equal(code(() => t.validate(JSON.stringify({ agents: [], reason: "Motivo suficiente." }))), "agent_count");
    assert.equal(code(() => t.validate(JSON.stringify({ agents: ["controller"], reason: "" }))), "invalid_reason");
    assert.equal(code(() => t.validate("não é json")), "invalid_json");
  });

  test("especialista: cada achado cita só rótulos recebidos; sem base, nenhum achado é aceito", () => {
    const t = specialistTask("pedido", catalog[1], fragments, "2026-11-10T00:45:00.000Z");
    const ok = t.validate(JSON.stringify({ findings: [{ claim: "Exige três cotações.", citations: ["f-aaaaaaaa"] }], unknowns: ["prazo"] }));
    assert.deepEqual(ok.findings[0].citations, ["f-aaaaaaaa"]);
    assert.equal(code(() => t.validate(JSON.stringify({ findings: [{ claim: "x", citations: ["f-cccccccc"] }], unknowns: [] }))), "unknown_citation");
    assert.equal(code(() => t.validate(JSON.stringify({ findings: [{ claim: "x", citations: [] }], unknowns: [] }))), "missing_citation");
    assert.deepEqual(t.validate(JSON.stringify({ findings: [], unknowns: ["nada"] })).findings, []);
  });

  test("síntese: cita só o que os achados citaram; recomendar exige citação", () => {
    const findings = [{ agent: "controller", claim: "Três cotações.", citations: ["f-aaaaaaaa"] }];
    const t = synthesisTask("pedido", findings, fragments, "2026-11-10T00:45:00.000Z");
    assert.deepEqual(JSON.parse(t.prompt).trechos.map((f: any) => f.rotulo), ["f-aaaaaaaa"], "só trechos citados vão ao prompt");
    assert.equal(t.validate(JSON.stringify({ abstain: false, summary: "s", recommendation: "r", citations: ["f-aaaaaaaa"] })).abstain, false);
    assert.equal(code(() => t.validate(JSON.stringify({ abstain: false, summary: "s", recommendation: "r", citations: ["f-bbbbbbbb"] }))), "unknown_citation");
    assert.equal(code(() => t.validate(JSON.stringify({ abstain: false, summary: "s", recommendation: "r", citations: [] }))), "missing_citation");
    assert.equal(t.validate(JSON.stringify({ abstain: true, summary: "Falta dado.", recommendation: "", citations: [] })).abstain, true);
  });
});
