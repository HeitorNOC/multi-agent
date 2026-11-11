// N5 — memória na conversa e da empresa, nos dois bancos: decisões afirmadas e aprovadas ficam
// registradas, "o que decidimos?" responde delas (sem modelo), o resumo cobre o que saiu da janela,
// e os fatos da empresa chegam ao Chief.
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { manualClock } from "../../shared/clock.ts";
import { AppError } from "../../shared/errors.ts";
import { ActorId } from "../../shared/ids.ts";
import { UnitOfWork } from "../../platform/database/unit-of-work.ts";
import type { ModelClient, ModelRequest } from "../../platform/model/model-client.ts";
import { dialects, fresh, type TestDatabase } from "../../../test/support/databases.ts";
import { testPolicy } from "../../../test/support/test-policy.ts";
import { addFact, changeFact, factLines, listFacts, removeFact } from "../agents/application/facts.ts";
import { agentsStore } from "../agents/infrastructure/sql-agents.ts";
import type { JobsDeps } from "../jobs/application/deps.ts";
import { queueLimits } from "../jobs/application/queue-limits.ts";
import { jobsStore } from "../jobs/infrastructure/jobs-store.ts";
import { createConversation, readConversation, sendMessage, type ConversationDeps } from "./application/conversations.ts";
import { jobOpener } from "./application/job-opener.ts";
import { ModelChiefOfStaff } from "./application/model-chief-of-staff.ts";
import { RuleBasedChiefOfStaff } from "./domain/chief-of-staff.ts";
import { MEMORY_WINDOW } from "./domain/memory.ts";
import { conversationStore } from "./infrastructure/sql-conversations.ts";

const ceo = ActorId.parse("ceo");
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : String(e)));
const opened: TestDatabase[] = [];
afterEach(async () => {
  for (const d of opened.splice(0)) await d.close();
});

class Echo implements ModelClient {
  readonly provider = "claude" as const;
  readonly model = "simulado";
  calls: ModelRequest[] = [];
  async complete(req: ModelRequest) {
    this.calls.push(req);
    return { json: JSON.stringify({ kind: "reply", offer_id: null, text: "Certo.", hire: [], brief: null, questions: [], plan: null, remember: ["O lançamento é em agosto"] }), usage: {}, seconds: 0.1 };
  }
}

for (const dialect of dialects) {
  describe(`memória — ${dialect}`, () => {
    async function setup(model?: ModelClient) {
      const d = await fresh(dialect);
      opened.push(d);
      const clock = manualClock("2026-03-01T10:00:00.000Z");
      const facts = { uow: new UnitOfWork(d.db, agentsStore(clock)), clock };
      const jobs: JobsDeps = { uow: new UnitOfWork(d.db, jobsStore(clock)), policy: testPolicy, limits: queueLimits({ capacity: 8 }), clock, workers: { isActive: () => false, count: () => 0 } };
      const rules = new RuleBasedChiefOfStaff();
      const deps: ConversationDeps = {
        uow: new UnitOfWork(d.db, conversationStore(clock)),
        chief: model ? new ModelChiefOfStaff({ client: model, fallback: rules, timeoutMs: 1000 }) : rules,
        offers: [{ id: "open", title: "Trabalho", keywords: ["especialistas"] }],
        jobs: jobOpener(jobs),
        clock,
        facts: () => factLines(facts),
      };
      const conversation = (await createConversation(deps, ceo)).id;
      return { deps, facts, conversation, say: (text: string) => sendMessage(deps, ceo, conversation, { text }) };
    }

    test("fatos da empresa: criar, mudar, remover e validar", async () => {
      const { facts } = await setup();
      const f = await addFact(facts, ceo, { text: "Vendemos materiais de construção no varejo.", category: "empresa" });
      await addFact(facts, ceo, { text: "A stack é Node e PostgreSQL.", category: "tecnologia" });
      await changeFact(facts, ceo, f.id, { text: "Vendemos materiais de construção no varejo e no atacado.", category: "empresa" });
      assert.deepEqual(await factLines(facts), ["empresa: Vendemos materiais de construção no varejo e no atacado.", "tecnologia: A stack é Node e PostgreSQL."]);
      assert.equal(await code(addFact(facts, ceo, { text: "x", category: "empresa" })), "invalid_fact");
      assert.equal(await code(addFact(facts, ceo, { text: "Texto válido", category: "qualquer" })), "invalid_category");
      assert.equal(await code(changeFact(facts, ceo, "00000000-0000-4000-8000-000000000000", { text: "Texto válido", category: "empresa" })), "fact_not_found");
      await removeFact(facts, ceo, f.id);
      assert.equal((await listFacts(facts)).facts.length, 1);
    });

    test("decisão afirmada fica registrada e 'o que decidimos?' responde dela, sem modelo", async () => {
      const { deps, conversation, say } = await setup();
      await say("Fica decidido que vamos usar Kafka para os eventos do WebChat.");
      await say("Vamos seguir com o prazo de 30 dias.");
      const answer = (await say("O que decidimos até agora?")).reply.text;
      assert.equal(answer, "Até aqui ficou decidido: 1) Fica decidido que vamos usar Kafka para os eventos do WebChat; 2) Vamos seguir com o prazo de 30 dias.");
      const read = await readConversation(deps, ceo, conversation);
      assert.deepEqual(read.memory.decisions.map((d) => d.kind), ["stated", "stated"]);
    });

    test("resumo das mensagens que saem da janela", async () => {
      const { deps, conversation, say } = await setup();
      await say("Quero acompanhar o projeto de WebChat com fila Kafka.");
      for (let i = 0; i < MEMORY_WINDOW / 2; i++) await say(`Pergunta número ${i} sobre outro assunto.`);
      const memory = (await readConversation(deps, ceo, conversation)).memory;
      assert.match(memory.summary, /^Gestor: Quero acompanhar o projeto de WebChat com fila Kafka\./);
    });

    test("com modelo: fatos e memória vão ao Chief, e o que ele registra entra nas decisões", async () => {
      const model = new Echo();
      const { deps, facts, conversation, say } = await setup(model);
      await addFact(facts, ceo, { text: "O tom da marca é próximo e direto.", category: "marca" });
      await say("O lançamento é em agosto, tá?");
      await say("E agora?");
      const prompt = JSON.parse(model.calls[1]!.prompt);
      assert.deepEqual(prompt.fatos_da_empresa, ["marca: O tom da marca é próximo e direto."]);
      assert.deepEqual(prompt.memoria_da_conversa.decisoes, ["O lançamento é em agosto"]);
      assert.equal((await readConversation(deps, ceo, conversation)).memory.decisions.length, 1, "o mesmo registro não se repete");
    });
  });
}
