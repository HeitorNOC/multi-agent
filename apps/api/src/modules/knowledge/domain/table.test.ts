import assert from "node:assert/strict";
import { test } from "node:test";
import { documentSummary, parseCsv, profileTable, tableSummaries, toNumber } from "./table.ts";

const CSV = `canal;nota;tempo_resposta_min;cliente
WhatsApp;5;3,5;Ana
WhatsApp;4;4,5;"Bruno; filho"
E-mail;3;120;Carla
E-mail;2;240;Davi
Chat;5;1;Eva
`;

test("CSV: ponto e vírgula, aspas e decimal com vírgula", () => {
  const t = parseCsv(CSV);
  assert.deepEqual(t.columns, ["canal", "nota", "tempo_resposta_min", "cliente"]);
  assert.equal(t.rows.length, 5);
  assert.equal(t.rows[1]![3], "Bruno; filho");
  assert.deepEqual(parseCsv('a,b\n"x ""y""",2\n').rows, [['x "y"', "2"]]);
  for (const [raw, n] of [["3,5", 3.5], ["1.234,50", 1234.5], ["1,234.5", 1234.5], ["R$ 10", 10], ["87%", 87], ["abc", null], ["", null]] as const)
    assert.equal(toNumber(raw), n, raw);
});

test("perfil e resumos calculados: total e por categoria", () => {
  const t = parseCsv(CSV);
  const p = profileTable(t);
  assert.deepEqual(p.map((c) => c.kind), ["category", "number", "number", "text"]);
  assert.equal(p[1]!.stats!.avg, 3.8);
  const s = tableSummaries("Avaliações do atendimento", t);
  assert.equal(s[0]!.section, "Resumo calculado");
  assert.match(s[0]!.text, /5 linhas e 4 colunas/);
  assert.match(s[0]!.text, /nota: média 3,8, soma 19, mínimo 2, máximo 5/);
  const byChannel = s.find((x) => x.section === "Por canal")!.text;
  assert.match(byChannel, /canal = WhatsApp: 2 linha\(s\); nota média 4,5 e soma 9; tempo_resposta_min média 4 e soma 8\./);
  assert.match(byChannel, /canal = E-mail: 2 linha\(s\); nota média 2,5/);
  assert.deepEqual(tableSummaries("vazia", parseCsv("a,b\n")), []);
});

test("resumo extrativo: seções e a primeira frase de cada uma", () => {
  const s = documentSummary("Política de compras", "# Compras\n\nCompras acima de dez mil exigem três cotações. Outra frase.\n\n## Fornecedores\n\nFornecedor novo passa por cadastro antes do primeiro pedido.\nMais texto.");
  assert.equal(s, 'Resumo de "Política de compras": Compras: Compras acima de dez mil exigem três cotações. Fornecedores: Fornecedor novo passa por cadastro antes do primeiro pedido.');
  assert.equal(documentSummary("curto", "Uma linha só."), null);
});
