// N2 — planejamento na conversa: o Chief (com modelo) pergunta o que falta, escreve o brief, propõe o
// plano; o CEO aprova a versão que viu, e o trabalho nasce com o time do plano. Nos dois bancos.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { afterEach, describe, test } from "node:test";
import { manualClock } from "../../shared/clock.ts";
import { AppError } from "../../shared/errors.ts";
import { ActorId } from "../../shared/ids.ts";
import { UnitOfWork } from "../../platform/database/unit-of-work.ts";
import type { ModelClient, ModelRequest } from "../../platform/model/model-client.ts";
import { dialects, fresh, type TestDatabase } from "../../../test/support/databases.ts";
import { testPolicy } from "../../../test/support/test-policy.ts";
import { hire, listTeam, type AgentsDeps } from "../agents/application/agents.ts";
import { staffingPort } from "../agents/application/staffing.ts";
import { loadTemplates } from "../agents/domain/template.ts";
import { agentsStore } from "../agents/infrastructure/sql-agents.ts";
import type { JobsDeps } from "../jobs/application/deps.ts";
import { queueLimits } from "../jobs/application/queue-limits.ts";
import { jobsStore } from "../jobs/infrastructure/jobs-store.ts";
import { approvePlan, cancelPlan, createConversation, readConversation, sendMessage, type ConversationDeps } from "./application/conversations.ts";
import { jobOpener } from "./application/job-opener.ts";
import { ModelChiefOfStaff } from "./application/model-chief-of-staff.ts";
import { RuleBasedChiefOfStaff } from "./domain/chief-of-staff.ts";
import { composeGoal, PlanningError, presetOf, validatePlanning } from "./domain/planning.ts";
import { conversationStore } from "./infrastructure/sql-conversations.ts";
import { SpecificationRunner, type Specifier } from "./application/specification.ts";
import { overview } from "../overview/application/overview.ts";

const templates = loadTemplates(fileURLToPath(new URL("../../../data/agent-templates.json", import.meta.url)));
const ceo = ActorId.parse("ceo");
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : String(e)));
const OFFERS = [{ id: "open", title: "Trabalho com os especialistas", keywords: ["especialistas"] }];

const BRIEF = {
  objective: "Implementar o módulo de atendimento por WebChat como microserviço.",
  context: ["Já existe o serviço de autenticação."],
  constraints: ["Seguir o padrão de logs da empresa"],
  deadline: "30 dias",
  done: ["Serviço com testes", "Documentação da API"],
};
const PLAN = {
  steps: [
    { title: "Arquitetura e integração com o serviço existente", owner: "director_technology", deliverable: "Proposta de arquitetura" },
    { title: "Serviço de WebChat com testes", owner: "tech_lead", deliverable: "Código e testes" },
  ],
  team: ["director_technology"],
  hire: ["tech_lead"],
  risks: ["Volume de mensagens desconhecido"],
  references: ["k1", "k9"],
};

test("validação do plano: responsáveis, time, catálogo, limite e trechos citados", () => {
  const ctx = { team: new Set(["director_technology"]), candidates: new Set(["tech_lead"]), maxAgents: 3, labels: new Set(["k1"]) };
  const ok = validatePlanning({ brief: BRIEF, questions: [], plan: PLAN }, ctx);
  assert.deepEqual(ok.plan!.references, ["k1"], "rótulo que o modelo não recebeu é descartado");
  assert.equal(ok.brief.deadline, "30 dias");
  const fail = (raw: object, c = ctx) => {
    try {
      validatePlanning(raw as never, c);
      return "ok";
    } catch (e) {
      return (e as PlanningError).code;
    }
  };
  assert.equal(fail({ brief: BRIEF, questions: [], plan: { ...PLAN, team: ["inventado"] } }), "plan_agent_not_in_team");
  assert.equal(fail({ brief: BRIEF, questions: [], plan: { ...PLAN, hire: ["seo_specialist"] } }), "plan_hire_not_offered");
  assert.equal(fail({ brief: BRIEF, questions: [], plan: { ...PLAN, steps: [{ title: "x", owner: "copywriter", deliverable: "y" }] } }), "step_owner_not_in_plan");
  assert.equal(fail({ brief: BRIEF, questions: [], plan: PLAN }, { ...ctx, maxAgents: 1 }), "plan_agent_count");
  assert.equal(fail({ brief: { ...BRIEF, objective: "" }, questions: [], plan: null }), "invalid_brief");
  assert.equal(fail({ brief: BRIEF, questions: ["a", "b", "c", "d"], plan: null }), "invalid_questions");
  assert.equal(fail({ brief: BRIEF, questions: ["Qual o volume?"], plan: null }), "ok", "com perguntas, o plano pode faltar");
});

test("pedido do trabalho montado do brief e das etapas, dentro do limite", () => {
  const plan = validatePlanning({ brief: BRIEF, questions: [], plan: PLAN }, { team: new Set(["director_technology"]), candidates: new Set(["tech_lead"]), maxAgents: 3, labels: new Set() }).plan!;
  const goal = composeGoal(BRIEF, plan, new Map([["tech_lead", "Mateus (Tech Lead)"]]));
  assert.match(goal, /^Implementar o módulo de atendimento por WebChat/);
  assert.match(goal, /Restrições: Seguir o padrão de logs da empresa\./);
  assert.match(goal, /Pronto quando: Serviço com testes; Documentação da API\./);
  assert.match(goal, /2\. Serviço de WebChat com testes — Mateus \(Tech Lead\): Código e testes/);
  assert.deepEqual(presetOf(plan, 3).agents, ["director_technology", "tech_lead"]);
  const long = composeGoal(BRIEF, { ...plan, steps: Array.from({ length: 12 }, () => ({ title: "x".repeat(250), owner: "tech_lead", deliverable: "y".repeat(250), after: [] })) }, new Map());
  assert.ok(long.length <= 2000);
});

/** Modelo roteirizado: devolve as respostas na ordem e guarda os pedidos. */
class Script implements ModelClient {
  readonly provider = "claude" as const;
  readonly model = "simulado";
  calls: ModelRequest[] = [];
  queue: object[] = [];
  async complete(req: ModelRequest) {
    this.calls.push(req);
    const next = this.queue.shift();
    if (!next) throw new Error("sem resposta roteirizada");
    return { json: JSON.stringify({ hire: [], brief: null, questions: [], plan: null, offer_id: null, ...next }), usage: { output_tokens: 5 }, seconds: 0.1 };
  }
}

const opened: TestDatabase[] = [];
afterEach(async () => {
  for (const d of opened.splice(0)) await d.close();
});

for (const dialect of dialects) {
  describe(`planejamento na conversa — ${dialect}`, () => {
    async function setup() {
      const d = await fresh(dialect);
      opened.push(d);
      const clock = manualClock("2026-03-01T10:00:00.000Z");
      const agents: AgentsDeps = { uow: new UnitOfWork(d.db, agentsStore(clock)), catalog: templates, clock, countSources: async () => 0 };
      const jobs: JobsDeps = { uow: new UnitOfWork(d.db, jobsStore(clock)), policy: testPolicy, limits: queueLimits({ capacity: 8 }), clock, workers: { isActive: () => false, count: () => 0 } };
      const model = new Script();
      const queries: string[] = [];
      const deps: ConversationDeps = {
        resources: async () => [{ name: "Kafka de produção", kind: "queue", description: "Cluster kafka.interno:9092" }],
        uow: new UnitOfWork(d.db, conversationStore(clock)),
        chief: new ModelChiefOfStaff({ client: model, fallback: new RuleBasedChiefOfStaff(), timeoutMs: 1000 }),
        offers: OFFERS,
        jobs: jobOpener(jobs),
        clock,
        staffing: staffingPort(agents),
        knowledge: async (text) => {
          queries.push(text);
          return [{ label: "k1", title: "Padrão de arquitetura de serviços", version: 2, text: "Todo serviço expõe health check e logs estruturados." }];
        },
      };
      const specCalls: string[] = [];
      const specifier: Specifier & { fail: boolean } = {
        fail: false,
        async detail(r) {
          specCalls.push(r.agent.id);
          if (this.fail) throw new Error("caiu");
          return { summary: `Arquitetura em dois serviços, seguindo ${r.knowledge[0]?.title ?? "o padrão"}.`, requirements: ["Fila para mensagens"], components: ["Gateway de WebChat"], risks: ["Latência"], questions: [] };
        },
      };
      const runner = new SpecificationRunner(deps, specifier);
      deps.specRunner = runner;
      await hire(agents, ceo, "director_technology");
      const conversation = (await createConversation(deps, ceo)).id;
      const say = (text: string) => sendMessage(deps, ceo, conversation, { text });
      const pending = async () => (await overview({ sql: d.db.sql, clock, timeZone: "America/Sao_Paulo" })).decide.plans.map((p) => p.title);
      return { deps, jobs, agents, model, queries, conversation, say, pending, runner, specifier, specCalls };
    }

    test("pergunta o que falta, propõe, recusa aprovar versão antiga e abre com o time do plano", async () => {
      const { deps, jobs, agents, model, queries, conversation, say, pending } = await setup();
      model.queue.push({ kind: "plan", offer_id: "open", text: "Antes de planejar, preciso saber o volume.", brief: BRIEF, questions: ["Quantas conversas por dia?"], plan: null });
      const first = (await say("Quero implementar o módulo de atendimento por WebChat como um microserviço.")).reply;
      assert.equal(first.job, null);
      assert.deepEqual([first.planning?.status, first.planning?.version, first.planning?.questions], ["drafting", 1, ["Quantas conversas por dia?"]]);
      const prompt = JSON.parse(model.calls[0]!.prompt);
      assert.deepEqual(prompt.contexto_do_cerebro.map((k: { rotulo: string }) => k.rotulo), ["k1"], "o Chief planeja com o Cérebro");
      assert.ok(prompt.catalogo_para_contratar.some((c: { id: string }) => c.id === "tech_lead"));

      model.queue.push({ kind: "plan", offer_id: "open", text: "Plano pronto para sua aprovação.", brief: BRIEF, questions: [], plan: PLAN });
      const second = (await say("Umas 2 mil por dia.")).reply;
      assert.deepEqual([second.planning?.status, second.planning?.version], ["proposed", 2]);
      assert.deepEqual(second.planning!.plan!.references, ["Padrão de arquitetura de serviços (v2)"], "guarda a fonte, não o rótulo");
      assert.equal(second.planning!.plan!.steps[1]!.owner_name, "Mateus · Tech Lead");
      assert.equal(JSON.parse(model.calls[1]!.prompt).planejamento_atual.versao, 1, "a revisão parte da versão atual");
      assert.match(queries[1]!, /^Implementar o módulo de atendimento por WebChat/);
      const read = await readConversation(deps, ceo, conversation);
      assert.equal(read.messages.filter((m) => m.planning).length, 1, "o cartão fica só na versão atual");

      assert.deepEqual(await pending(), [BRIEF.objective], "o plano proposto aparece em Para decidir");
      const planId = second.planning!.id;
      assert.equal(await code(approvePlan(deps, ceo, conversation, planId, 1)), "plan_changed");
      const after = await approvePlan(deps, ceo, conversation, planId, 2);
      const confirmation = after.messages.at(-1)!;
      assert.ok(confirmation.job);
      assert.match(confirmation.text, /^Plano aprovado\. Trouxe Mateus \(Tech Lead\) só para este trabalho\. Abri o trabalho com 2 etapa\(s\)/);
      assert.equal(after.messages.find((m) => m.planning)!.planning!.status, "approved");
      assert.deepEqual(await pending(), [], "aprovado, sai de Para decidir");

      const job = (await jobs.uow.read.jobs.get(confirmation.job!.id as never))!;
      assert.deepEqual((job.preset as { agents: string[] }).agents, ["director_technology", "tech_lead"]);
      assert.match(job.goal, /Etapas do plano aprovado:/);
      const lead = (await listTeam(agents)).agents.find((a) => a.id === "tech_lead")!;
      assert.deepEqual([lead.engagement, lead.engaged_job, lead.reports_to], ["job", job.id, "director_technology"], "entra no time do diretor da área");

      // Aprovar de novo é inofensivo; durante nada mais o Chief abre outro trabalho por este plano.
      await approvePlan(deps, ceo, conversation, planId, 2);
      assert.equal((await jobs.uow.read.jobs.listRecent()).length, 1);
    });

    test("cancelar pelo botão ou pela conversa; sem modelo, o plano não é revisado nem vira trabalho", async () => {
      const { deps, jobs, model, conversation, say } = await setup();
      model.queue.push({ kind: "plan", offer_id: "open", text: "Plano pronto.", brief: BRIEF, questions: [], plan: { ...PLAN, hire: [], steps: [PLAN.steps[0]] } });
      const proposed = (await say("Quero implementar o módulo de WebChat.")).reply;
      // Modelo falha na revisão: a resposta explica, sem abrir trabalho.
      model.queue.push({ kind: "open_job", offer_id: "open", text: "Abri." });
      const blocked = (await say("Abre logo.")).reply;
      assert.equal(blocked.job, null);
      assert.match(blocked.text, /preciso do modelo|Aprove, ajuste ou cancele/);
      assert.equal((await jobs.uow.read.jobs.listRecent()).length, 0);

      const cancelled = await cancelPlan(deps, ceo, conversation, proposed.planning!.id);
      assert.equal(cancelled.messages.find((m) => m.planning)!.planning!.status, "cancelled");
      assert.match(cancelled.messages.at(-1)!.text, /cancelei o planejamento/);
      assert.equal(await code(approvePlan(deps, ceo, conversation, proposed.planning!.id, 1)), "plan_cancelled");

      model.queue.push({ kind: "plan", offer_id: "open", text: "Começando outro.", brief: BRIEF, questions: ["Qual canal?"], plan: null });
      await say("Quero um módulo de WhatsApp.");
      model.queue.push({ kind: "cancel_plan", text: "Cancelado." });
      await say("Deixa pra lá, cancela.");
      assert.equal((await deps.uow.read.planning.active(conversation)) ?? null, null);
      assert.equal(await code(approvePlan(deps, ActorId.parse("outra"), conversation, proposed.planning!.id, 1)), "conversation_not_found");
    });

    test("pedido simples continua abrindo trabalho direto; plano com perguntas não pode ser aprovado", async () => {
      const { deps, model, conversation, say } = await setup();
      model.queue.push({ kind: "open_job", offer_id: "open", text: "Abri a análise." });
      assert.ok((await say("Analise as vendas do mês.")).reply.job);
      model.queue.push({ kind: "plan", offer_id: "open", text: "Preciso saber o prazo.", brief: BRIEF, questions: ["Qual o prazo?"], plan: null });
      const draft = (await say("Quero implementar o módulo de WebChat.")).reply;
      assert.equal(await code(approvePlan(deps, ceo, conversation, draft.planning!.id, 1)), "plan_not_ready");
    });

    test("o Chief delega aos diretores: detalhando não pode ser aprovado; consolidado, volta como versão nova", async () => {
      const { deps, jobs, model, conversation, say, runner, specCalls } = await setup();
      // O teste decide quando os diretores começam (o runner é chamado à mão abaixo).
      deps.specRunner = { kick: () => undefined };
      model.queue.push({ kind: "plan", offer_id: "open", text: "Plano montado.", brief: BRIEF, questions: [], plan: { ...PLAN, specify: ["director_technology", "copywriter"] } });
      // A consolidação: o Chief devolve o plano revisado (e um "specify" que deve ser ignorado).
      model.queue.push({ kind: "plan", offer_id: "open", text: "Incluí a fila de mensagens.", brief: { ...BRIEF, constraints: [...BRIEF.constraints, "Fila para mensagens"] }, questions: [], plan: { ...PLAN, specify: ["director_technology"] } });
      const reply = (await say("Quero implementar o módulo de WebChat.")).reply;
      assert.equal(reply.planning?.status, "specifying");
      assert.match(reply.text, /Pedi para Augusto detalhar a parte dele; o plano volta para você em seguida\./);
      assert.deepEqual(reply.planning!.specs.map((x) => [x.agent, x.status]), [["director_technology", "pending"]], "só quem lidera e está no plano");
      assert.equal(await code(approvePlan(deps, ceo, conversation, reply.planning!.id, 1)), "plan_specifying");

      runner.kick(reply.planning!.id);
      await runner.idle();
      assert.deepEqual(specCalls, ["director_technology"]);
      const after = await readConversation(deps, ceo, conversation);
      const current = after.messages.find((m) => m.planning)!;
      assert.equal(after.messages.at(-1), current, "a versão nova chega como mensagem do Chief");
      assert.match(current.text, /^Augusto detalhou a parte dele\. Incluí a fila de mensagens\./);
      assert.deepEqual([current.planning!.status, current.planning!.version, current.planning!.plan!.specify], ["proposed", 2, []]);
      assert.deepEqual(current.planning!.specs.map((x) => [x.status, x.summary]), [["done", "Arquitetura em dois serviços, seguindo Padrão de arquitetura de serviços."]]);
      assert.ok(current.planning!.brief.constraints.includes("Fila para mensagens"));
      const prompt = JSON.parse(model.calls[1]!.prompt);
      assert.equal(prompt.especificacoes_dos_diretores[0].resumo, "Arquitetura em dois serviços, seguindo Padrão de arquitetura de serviços.");
      await approvePlan(deps, ceo, conversation, current.planning!.id, 2);
      assert.equal((await jobs.uow.read.jobs.listRecent()).length, 1);
    });

    test("diretor falha: o plano volta ao CEO como estava; reiniciar retoma o que ficou pendente", async () => {
      const { deps, model, conversation, say, specifier } = await setup();
      // O servidor "cai" logo depois de o Chief delegar: ninguém começa a detalhar.
      deps.specRunner = { kick: () => undefined };
      model.queue.push({ kind: "plan", offer_id: "open", text: "Plano montado.", brief: BRIEF, questions: [], plan: { ...PLAN, specify: ["director_technology"] } });
      const reply = (await say("Quero implementar o módulo de WebChat.")).reply;
      // "Reinício": um runner novo encontra o plano detalhando e retoma; o diretor falha.
      specifier.fail = true;
      const restarted = new SpecificationRunner(deps, specifier);
      await restarted.resumeAll();
      await restarted.idle();
      const current = (await readConversation(deps, ceo, conversation)).messages.find((m) => m.planning)!;
      assert.deepEqual([current.planning!.status, current.planning!.version], ["proposed", 2]);
      assert.match(current.text, /não conseguiram detalhar agora\. O plano segue como estava/);
      assert.equal(current.planning!.specs[0]!.status, "failed");
      assert.equal(reply.planning!.id, current.planning!.id);
    });

    test("o plano usa recursos cadastrados (os inventados saem), diz o que falta e o pedido do trabalho os descreve", async () => {
      const { deps, jobs, model, conversation, say } = await setup();
      model.queue.push({ kind: "plan", offer_id: "open", text: "Plano.", brief: BRIEF, questions: [], plan: { ...PLAN, resources: ["Kafka de produção", "Banco inventado"], needs: ["Tópico atendimento.webchat"] } });
      const r = (await say("Quero implementar o módulo de WebChat.")).reply;
      assert.deepEqual([r.planning!.plan!.resources, r.planning!.plan!.needs], [["Kafka de produção"], ["Tópico atendimento.webchat"]]);
      assert.equal(JSON.parse(model.calls[0]!.prompt).recursos_da_empresa[0].nome, "Kafka de produção");
      const after = await approvePlan(deps, ceo, conversation, r.planning!.id, 1);
      const job = (await jobs.uow.read.jobs.get(after.messages.at(-1)!.job!.id as never))!;
      assert.match(job.goal, /Recursos da empresa a usar: Kafka de produção \(Cluster kafka\.interno:9092\)\./);
      assert.match(job.goal, /A provisionar \(aprovado pelo CEO\): Tópico atendimento\.webchat\./);
    });
  });
}
