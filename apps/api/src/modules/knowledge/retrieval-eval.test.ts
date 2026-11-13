// Avaliação do Cérebro (N4): perguntas da empresa com a fonte esperada. Mede acerto nos 3 primeiros,
// posição média (MRR) e abstenção correta, comparando a busca de uma consulta só com a busca usada
// pelos agentes (várias consultas, reordenação e tabelas calculadas). Toda mudança na busca é
// medida aqui; os limites abaixo travam regressões.
import assert from "node:assert/strict";
import { test } from "node:test";
import { manualClock } from "../../shared/clock.ts";
import { ActorId } from "../../shared/ids.ts";
import { UnitOfWork } from "../../platform/database/unit-of-work.ts";
import { fresh } from "../../../test/support/databases.ts";
import { ExtractiveAnswerer } from "./application/answerers.ts";
import { KnowledgeSearch } from "./application/knowledge-search.ts";
import { uploadSource } from "./application/sources.ts";
import { Bm25Index } from "./infrastructure/bm25-index.ts";
import { knowledgeStore } from "./infrastructure/sql-knowledge.ts";

const CORPUS: { title: string; text?: string; csv?: string }[] = [
  { title: "Política de compras", text: "# Compras\n\nCompras acima de dez mil reais exigem três cotações de fornecedores e aprovação do diretor financeiro.\n\n## Fornecedores\n\nFornecedor novo passa por cadastro e análise de crédito antes do primeiro pedido." },
  { title: "Orçamento anual", text: "# Orçamento\n\nO orçamento anual de marketing é revisado em março e em setembro. Remanejamentos acima de 15% precisam do conselho." },
  { title: "Manual de férias", text: "# Férias\n\nFérias podem ser divididas em até três períodos, um deles com pelo menos 14 dias. O pedido é feito com 30 dias de antecedência." },
  { title: "Padrão de arquitetura de serviços", text: "# Serviços\n\nTodo microserviço expõe health check, logs estruturados em JSON e contrato da API em OpenAPI.\n\n## Mensageria\n\nEventos entre serviços passam pela fila Kafka do ambiente; nunca chamada síncrona em cascata." },
  { title: "Política de reembolso de viagens", text: "# Reembolso\n\nDespesas de viagem são reembolsadas em até 10 dias úteis, com nota fiscal. Hospedagem tem teto de 400 reais por noite." },
  { title: "Roteiro de atendimento por WhatsApp", text: "# WhatsApp\n\nResponder em até 15 minutos no horário comercial. Reclamações graves vão para o supervisor no mesmo dia." },
  { title: "Contrato padrão de prestação de serviços", text: "# Contrato\n\nA multa por rescisão antecipada é de 20% do valor restante. O foro é a comarca de São Paulo." },
  {
    title: "Avaliações do atendimento",
    csv: "canal;nota;tempo_resposta_min\nWhatsApp;5;3\nWhatsApp;4;5\nE-mail;3;120\nE-mail;2;240\nChat;5;1\nChat;4;2\n",
  },
];

/** Pergunta → fonte esperada (null: o Cérebro não tem a resposta e deve se abster). */
const QUESTIONS: { q: string; expect: string | string[] | null }[] = [
  { q: "Quantas cotações são necessárias para compras acima de dez mil reais?", expect: "Política de compras" },
  { q: "Quando o orçamento de marketing é revisado?", expect: "Orçamento anual" },
  { q: "Posso dividir minhas férias em quantos períodos?", expect: "Manual de férias" },
  { q: "Qual o padrão de logs e contrato da API dos microserviços?", expect: "Padrão de arquitetura de serviços" },
  { q: "Como os serviços trocam eventos, pela fila Kafka?", expect: "Padrão de arquitetura de serviços" },
  { q: "Em quantos dias as despesas de viagem são reembolsadas?", expect: "Política de reembolso de viagens" },
  { q: "Qual o prazo para responder clientes no WhatsApp?", expect: "Roteiro de atendimento por WhatsApp" },
  { q: "Qual a multa por rescisão antecipada do contrato de serviços?", expect: "Contrato padrão de prestação de serviços" },
  { q: "Qual a nota média do atendimento por canal?", expect: "Avaliações do atendimento" },
  { q: "Qual canal tem o maior tempo de resposta médio nas avaliações?", expect: "Avaliações do atendimento" },
  // Pedido com dois assuntos: a busca do agente precisa trazer as duas fontes.
  { q: "Avalie as compras de fornecedores acima de dez mil reais. Considere também o teto de hospedagem nas viagens.", expect: ["Política de compras", "Política de reembolso de viagens"] },
  { q: "Prepare o plano do novo microserviço de WhatsApp seguindo o padrão de logs, e respeitando o prazo de resposta aos clientes.", expect: ["Padrão de arquitetura de serviços", "Roteiro de atendimento por WhatsApp"] },
  { q: "Revise o orçamento de marketing de setembro e a multa de rescisão dos contratos de serviços.", expect: ["Orçamento anual", "Contrato padrão de prestação de serviços"] },
  { q: "Qual a cor oficial do logotipo da empresa?", expect: null },
  { q: "Quem é o presidente do sindicato dos metalúrgicos?", expect: null },
];

test("avaliação da busca do Cérebro: acerto, posição e abstenção (uma consulta × busca dos agentes)", async () => {
  const d = await fresh("sqlite");
  try {
    const clock = manualClock("2026-03-01T10:00:00.000Z");
    const uow = new UnitOfWork(d.db, knowledgeStore(clock));
    const search = new KnowledgeSearch(uow, clock, (p) => new Bm25Index(p));
    const deps = { uow, clock, search, answerer: new ExtractiveAnswerer(), maxBytes: 1_000_000 };
    const ana = ActorId.parse("ana");
    for (const doc of CORPUS)
      await uploadSource(
        deps,
        ana,
        doc.csv
          ? { title: doc.title, filename: "t.csv", mediaType: "text/csv", contentBase64: Buffer.from(doc.csv).toString("base64") }
          : { title: doc.title, text: doc.text! },
      );

    const evaluate = async (find: (q: string) => Promise<{ title: string }[]>) => {
      let hit = 0;
      let rr = 0;
      let abstain = 0;
      const misses: string[] = [];
      const answerable = QUESTIONS.filter((x) => x.expect);
      for (const { q, expect } of QUESTIONS) {
        const titles = (await find(q)).map((p) => p.title);
        if (!expect) {
          if (!titles.length) abstain++;
          else misses.push(`não se absteve: ${q} → ${titles[0]}`);
          continue;
        }
        const wanted = Array.isArray(expect) ? expect : [expect];
        const ranks = wanted.map((w) => titles.indexOf(w));
        // Todas as fontes esperadas entre os 3 primeiros; a posição média usa a pior delas.
        if (ranks.every((r) => r >= 0 && r < 3)) hit++;
        else misses.push(`${q} → ${titles.slice(0, 3).join(" | ") || "(nada)"}`);
        if (ranks.every((r) => r >= 0)) rr += 1 / (Math.max(...ranks) + 1);
      }
      return { recallAt3: hit / answerable.length, mrr: rr / answerable.length, abstention: abstain / (QUESTIONS.length - answerable.length), misses };
    };

    const single = await evaluate(async (q) => (await search.search(q, () => true, 3)).found);
    const agents = await evaluate((q) => search.forAgents(q, 3));

    // Tabela: a resposta é o número calculado (todas as linhas), não um pedaço de linhas.
    const table = await search.forAgents("Qual a nota média do atendimento por canal?", 3);
    assert.equal(table[0]!.title, "Avaliações do atendimento");
    assert.ok(table.some((p) => /canal = WhatsApp: 2 linha\(s\); nota média 4,5/.test(p.text)), table.map((p) => p.text).join("\n---\n"));
    console.log(JSON.stringify({ uma_consulta: { ...single, misses: undefined }, busca_dos_agentes: { ...agents, misses: undefined }, erros_dos_agentes: agents.misses }, null, 1));

    // Limites (sobem quando a busca melhora; nunca descem sem motivo).
    assert.ok(agents.recallAt3 >= 0.95, `acerto nos 3 primeiros: ${agents.recallAt3}\n${agents.misses.join("\n")}`);
    assert.ok(agents.mrr >= 0.85, `MRR: ${agents.mrr}`);
    assert.equal(agents.abstention, 1, `abstenção: ${agents.misses.join("\n")}`);
    assert.ok(agents.recallAt3 >= single.recallAt3, "a busca dos agentes não pode ser pior que a de uma consulta");
  } finally {
    await d.close();
  }
});
