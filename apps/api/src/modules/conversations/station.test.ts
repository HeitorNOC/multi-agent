// Estação e acesso do Cérebro por agente, nos dois bancos.
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { manualClock } from "../../shared/clock.ts";
import { AppError } from "../../shared/errors.ts";
import { ActorId, type ConversationId } from "../../shared/ids.ts";
import { UnitOfWork } from "../../platform/database/unit-of-work.ts";
import { stream } from "../../platform/events/event-log.ts";
import type { ModelClient, ModelRequest } from "../../platform/model/model-client.ts";
import { dialects, fresh, type TestDatabase } from "../../../test/support/databases.ts";
import { ExtractiveAnswerer, ModelAnswerer } from "../knowledge/application/answerers.ts";
import { KnowledgeSearch } from "../knowledge/application/knowledge-search.ts";
import { uploadSource } from "../knowledge/application/sources.ts";
import { agentReader } from "../knowledge/domain/source.ts";
import { Bm25Index } from "../knowledge/infrastructure/bm25-index.ts";
import { knowledgeStore } from "../knowledge/infrastructure/sql-knowledge.ts";
import { staticTeam } from "../open-work/domain/catalog.ts";
import { RuleBasedChiefOfStaff } from "./domain/chief-of-staff.ts";
import { createConversation, readConversation, sendMessage, type ConversationDeps } from "./application/conversations.ts";
import { stationResponder } from "./application/station.ts";
import { conversationStore } from "./infrastructure/sql-conversations.ts";

const ana = ActorId.parse("ana");
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : String(e)));
const TEAM = staticTeam([
  { id: "procurement_analyst", title: "Bruno, Analista de compras", focus: "compras fornecedores cotações", domain: "operations", instructions: "Compare sempre três fornecedores." },
  { id: "financial_planning_analyst", title: "Fernanda, Analista financeira", focus: "orçamento finanças", domain: "finance" },
]);
const opened: TestDatabase[] = [];
afterEach(async () => {
  for (const d of opened.splice(0)) await d.close();
});

class Scripted implements ModelClient {
  readonly provider = "claude" as const;
  readonly model = "simulado";
  calls: ModelRequest[] = [];
  async complete(req: ModelRequest) {
    this.calls.push(req);
    return { json: JSON.stringify({ abstain: false, answer: "Exige três cotações [1].", citations: [1] }), usage: { output_tokens: 4 }, seconds: 0.1 };
  }
}

for (const dialect of dialects) {
  describe(`Estação e acesso por agente — ${dialect}`, () => {
    async function setup(model?: ModelClient) {
      const d = await fresh(dialect);
      opened.push(d);
      const clock = manualClock("2026-03-01T10:00:00.000Z");
      const kuow = new UnitOfWork(d.db, knowledgeStore(clock));
      const search = new KnowledgeSearch(kuow, clock, (p) => new Bm25Index(p));
      const knowledge = { uow: kuow, clock, search, answerer: new ExtractiveAnswerer(), maxBytes: 10_000 };
      const md = (title: string, text: string, readers?: string[]) =>
        uploadSource(knowledge, ana, { title, filename: "f.md", mediaType: "text/markdown", contentBase64: Buffer.from(text).toString("base64"), readers });
      const answerer = model ? new ModelAnswerer({ client: model, fallback: new ExtractiveAnswerer() }) : new ExtractiveAnswerer();
      const deps: ConversationDeps = {
        uow: new UnitOfWork(d.db, conversationStore(clock)),
        chief: new RuleBasedChiefOfStaff(),
        offers: [],
        jobs: { open: async () => ({ opened: false, reason: "-" }), describe: async () => undefined },
        clock,
        station: stationResponder({ team: TEAM, search, answerer }),
      };
      return { deps, md, search };
    }

    test("fonte restrita a um agente: só ele lê; pessoas sem acesso e outros agentes não", async () => {
      const { md, search } = await setup();
      await md("Contrato confidencial", "Fornecedor Alfa tem desconto de 12% em compras acima de dez mil reais.", ["ana", agentReader("procurement_analyst")]);
      const q = "desconto do fornecedor Alfa em compras";
      assert.equal((await search.forAgents(q, 5, ["procurement_analyst"])).length, 1);
      assert.deepEqual(await search.forAgents(q, 5, ["financial_planning_analyst"]), []);
      assert.deepEqual(await search.forAgents(q, 5), [], "sem agente, só fontes abertas");
    });

    test("conversa na Estação: o agente responde com as fontes que pode ler, citando", async () => {
      const { deps, md } = await setup();
      await md("Política de compras", "Compras acima de dez mil reais exigem três cotações de fornecedores.");
      await md("Contrato confidencial", "Fornecedor Alfa tem desconto de 12% em compras acima de dez mil reais.", ["ana", agentReader("procurement_analyst")]);
      const conv = await createConversation(deps, ana, undefined, "procurement_analyst");
      assert.deepEqual([conv.title, conv.agent_id], ["Estação de Bruno, Analista de compras", "procurement_analyst"]);
      const r = await sendMessage(deps, ana, conv.id as ConversationId, { text: "Qual o desconto do fornecedor Alfa em compras?" });
      assert.ok(r.reply.citations!.some((c) => c.title === "Contrato confidencial"), "a fonte restrita a ele aparece");
      assert.match(r.reply.text, /desconto de 12%/, "a resposta traz a frase com o dado, não o título");
      const events = await deps.uow.read.events.list(stream.conversation(conv.id));
      assert.deepEqual(events.map((e) => [e.kind, (e.detail as { agent?: string }).agent]), [["agent_reply", "procurement_analyst"]]);
      const read = await readConversation(deps, ana, conv.id as ConversationId);
      assert.equal(read.conversation.agent_id, "procurement_analyst");
      assert.ok(read.messages[1]!.citations!.length >= 1, "as citações ficam gravadas na mensagem");
    });

    test("outro agente não vê a fonte restrita e se abstém sem evidência", async () => {
      const { deps, md } = await setup();
      await md("Contrato confidencial", "Fornecedor Alfa tem desconto de 12% em compras acima de dez mil reais.", ["ana", agentReader("procurement_analyst")]);
      const conv = await createConversation(deps, ana, undefined, "financial_planning_analyst");
      const r = await sendMessage(deps, ana, conv.id as ConversationId, { text: "Qual o desconto do fornecedor Alfa?" });
      assert.deepEqual(r.reply.citations, []);
      assert.match(r.reply.text, /Não encontrei/);
    });

    test("pessoa sem acesso à fonte não a vê pela Estação, mesmo que o agente possa ler", async () => {
      const { deps, md } = await setup();
      await md("Contrato confidencial", "Fornecedor Alfa tem desconto de 12% em compras acima de dez mil reais.", ["ana", agentReader("procurement_analyst")]);
      const caio = ActorId.parse("caio");
      const conv = await createConversation(deps, caio, undefined, "procurement_analyst");
      const r = await sendMessage(deps, caio, conv.id as ConversationId, { text: "Qual o desconto do fornecedor Alfa em compras?" });
      assert.deepEqual(r.reply.citations, []);
      assert.doesNotMatch(r.reply.text, /12%/);
    });

    test("com modelo: a persona e as orientações vão no sistema, abaixo das regras não", async () => {
      const model = new Scripted();
      const { deps, md } = await setup(model);
      await md("Política de compras", "Compras acima de dez mil reais exigem três cotações de fornecedores.");
      const conv = await createConversation(deps, ana, undefined, "procurement_analyst");
      const r = await sendMessage(deps, ana, conv.id as ConversationId, { text: "Quantas cotações para compras acima de dez mil?" });
      assert.equal(r.reply.text, "Exige três cotações [1].");
      assert.equal(r.reply.decision?.engine, "model");
      const system = model.calls[0]!.system;
      assert.ok(system.startsWith("Você é Bruno, Analista de compras"));
      assert.match(system, /Compare sempre três fornecedores/);
      assert.ok(system.indexOf("SOMENTE os trechos") > system.indexOf("Bruno"), "as regras de evidência vêm depois e prevalecem");
    });

    test("Estação de quem não está no time é recusada", async () => {
      const { deps } = await setup();
      assert.equal(await code(createConversation(deps, ana, undefined, "controller")), "agent_not_in_team");
    });
  });
}
