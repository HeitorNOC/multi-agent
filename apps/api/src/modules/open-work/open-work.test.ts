// Trabalho aberto sem Python: política, gateway com recibos de inferência e Cérebro, nos dois bancos.
// O modelo é simulado por um cliente em memória que responde conforme a tarefa.
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { manualClock } from "../../shared/clock.ts";
import { AppError } from "../../shared/errors.ts";
import { ActorId, type JobId } from "../../shared/ids.ts";
import { UnitOfWork } from "../../platform/database/unit-of-work.ts";
import { CallLimiter } from "../../platform/model/call-limiter.ts";
import { ModelCallError, type ModelClient, type ModelRequest } from "../../platform/model/model-client.ts";
import { dialects, fresh, type TestDatabase } from "../../../test/support/databases.ts";
import { admitJob } from "../jobs/application/admit-job.ts";
import type { JobsDeps } from "../jobs/application/deps.ts";
import { queueLimits } from "../jobs/application/queue-limits.ts";
import { claimNextJob } from "../jobs/application/run-lifecycle.ts";
import { recordPlan, recordReview } from "../jobs/application/worker-reports.ts";
import { jobsStore } from "../jobs/infrastructure/jobs-store.ts";
import { ExtractiveAnswerer } from "../knowledge/application/answerers.ts";
import { KnowledgeSearch } from "../knowledge/application/knowledge-search.ts";
import { uploadSource } from "../knowledge/application/sources.ts";
import { Bm25Index } from "../knowledge/infrastructure/bm25-index.ts";
import { knowledgeStore } from "../knowledge/infrastructure/sql-knowledge.ts";
import { OpenWorkGateway } from "./application/gateway.ts";
import { openWorkPolicy } from "./application/open-policy.ts";
import type { CatalogAgent } from "./domain/catalog.ts";

const CATALOG: CatalogAgent[] = [
  { id: "procurement_analyst", title: "Analista de compras", focus: "compras fornecedores cotações", domain: "compras" },
  { id: "financial_planning_analyst", title: "Analista financeiro", focus: "orçamento aprovação diretor financeiro", domain: "finanças" },
];
const GOAL = "Avalie como devemos conduzir as compras de fornecedores acima de dez mil reais neste trimestre.";
const POLICY = "# Política de compras\n\nCompras acima de dez mil reais exigem três cotações de fornecedores e aprovação do diretor financeiro.";
const SECRET = "# Plano confidencial\n\nCompras com fornecedor exclusivo autorizadas sem cotação para o projeto Netuno.";
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : String(e)));

/** Modelo simulado: plano com os agentes pedidos; especialista e síntese citam o primeiro trecho. */
class FakeModel implements ModelClient {
  readonly provider = "claude" as const;
  readonly model = "simulado";
  calls: string[] = [];
  fail: ((task: string) => Error | undefined) | undefined;
  hang = false;
  async complete(req: ModelRequest) {
    const input = JSON.parse(req.prompt);
    const task = "catalogo" in input ? "plan" : "achados" in input ? "synthesis" : "specialist";
    this.calls.push(task);
    const error = this.fail?.(task);
    if (error) throw error;
    if (this.hang && task === "specialist") return new Promise<never>(() => {});
    const value =
      task === "plan"
        ? { agents: CATALOG.map((a) => a.id), reason: "Os especialistas cobrem as áreas do pedido." }
        : task === "specialist"
          ? { findings: input.trechos.length ? [{ claim: "Exige três cotações.", citations: [input.trechos[0].rotulo] }] : [], unknowns: [] }
          : { abstain: false, summary: "Consolidação.", recommendation: "Seguir a política.", citations: [input.achados[0].rotulos[0]] };
    return { json: JSON.stringify(value), usage: { output_tokens: 5 }, seconds: 0.1 };
  }
}

const opened: TestDatabase[] = [];
afterEach(async () => {
  for (const d of opened.splice(0)) await d.close();
});

describe("política do trabalho aberto", () => {
  const policy = openWorkPolicy(CATALOG);
  const c = (fn: () => unknown) => {
    try {
      fn();
      return "ok";
    } catch (e) {
      return e instanceof AppError ? e.code : String(e);
    }
  };
  test("pedido, plano e parecer seguem o contrato", () => {
    assert.equal(c(() => policy.goal({ goal: "curto" })), "invalid_goal");
    assert.equal(policy.goal({ goal: `  ${GOAL}  ` }), GOAL);
    assert.equal(c(() => policy.plan({ agents: ["intruso"], reason: "motivo suficiente" }, null as never)), "agent_not_in_catalog");
    assert.equal(c(() => policy.plan({ agents: [], reason: "motivo suficiente" }, null as never)), "invalid_plan");
    const plan = policy.plan({ agents: ["procurement_analyst", "procurement_analyst"], reason: "motivo suficiente" }, null as never);
    assert.deepEqual([(plan as { agents: string[] }).agents, policy.modelCallLimit(plan)], [["procurement_analyst"], 3]);
    const report = {
      kind: "open",
      abstained: false,
      summary: "s",
      recommendation: "r",
      citations: [{ label: "f-aaaaaaaa", source: "x", version: 1 }],
      findings: [{ claim: "c", agent: "procurement_analyst", citations: ["f-aaaaaaaa"] }],
    };
    assert.equal(c(() => policy.review(null as never, report, { retrievedLabels: new Set() })), "unknown_citation");
    const ok = policy.review(null as never, report, { retrievedLabels: new Set(["f-aaaaaaaa"]) });
    assert.deepEqual(ok.payload, { operation: "deliver-open-report", recipient: "gestor", content: "r" });
    assert.equal(c(() => policy.review(null as never, { ...report, findings: [] }, { retrievedLabels: new Set(["f-aaaaaaaa"]) })), "invalid_report");
  });
});

for (const dialect of dialects) {
  describe(`gateway do trabalho aberto — ${dialect}`, () => {
    async function setup() {
      const d = await fresh(dialect);
      opened.push(d);
      const clock = manualClock("2026-03-01T12:00:00.000Z");
      const jobs: JobsDeps = {
        uow: new UnitOfWork(d.db, jobsStore(clock)),
        policy: openWorkPolicy(CATALOG),
        limits: queueLimits({ capacity: 4 }),
        clock,
        workers: { isActive: () => false, count: () => 0 },
      };
      const kuow = new UnitOfWork(d.db, knowledgeStore(clock));
      const search = new KnowledgeSearch(kuow, clock, (p) => new Bm25Index(p));
      const knowledge = { uow: kuow, clock, search, answerer: new ExtractiveAnswerer(), maxBytes: 100_000 };
      const model = new FakeModel();
      const gateway = new OpenWorkGateway({ jobs, search, client: model, limiter: new CallLimiter(1, 4), catalog: CATALOG, clock });
      const md = (title: string, text: string, readers?: string[]) =>
        uploadSource(knowledge, ActorId.parse("ana"), { title, filename: "f.md", mediaType: "text/markdown", contentBase64: Buffer.from(text).toString("base64"), readers });
      async function started() {
        const { job } = await admitJob(jobs, { request: { goal: GOAL } });
        await claimNextJob(jobs);
        return job.id;
      }
      /** Faz o que o worker faz: plano, trechos e especialistas. */
      async function analyze(id: JobId) {
        const plan = (await gateway.run(id, "plan")).output as { agents: string[]; reason: string };
        await recordPlan(jobs, id, plan);
        const labels: string[][] = [];
        for (const agent of plan.agents) {
          const { fragments } = await gateway.retrieve(id, agent);
          labels.push(fragments.map((f) => f.label));
          await gateway.run(id, `specialist:${agent}`, { labels: labels.at(-1) });
        }
        return { plan, labels };
      }
      return { jobs, gateway, model, md, started, analyze, clock };
    }

    test("caminho completo: só fontes abertas chegam aos agentes; o parecer cita o que foi entregue", async () => {
      const { jobs, gateway, model, md, started, analyze } = await setup();
      const open = await md("Compras", POLICY);
      await md("Confidencial", SECRET, ["diretoria"]);
      const id = await started();
      const { labels } = await analyze(id);
      assert.ok(labels.every((l) => l.length > 0));
      const synthesis = (await gateway.run(id, "synthesis")).output as { summary: string; recommendation: string; citations: string[] };
      const review = await recordReview(jobs, id, {
        kind: "open",
        abstained: false,
        summary: synthesis.summary,
        recommendation: synthesis.recommendation,
        citations: synthesis.citations.map((label) => ({ label, source: open.id, version: 1 })),
        findings: [{ claim: "Exige três cotações.", agent: "procurement_analyst", citations: synthesis.citations }],
      });
      assert.ok(review!.hash);
      assert.deepEqual(model.calls, ["plan", "specialist", "specialist", "synthesis"]);
      const events = await jobs.uow.read.events.list(`job:${id}` as never);
      assert.ok(!JSON.stringify(events).includes("Netuno"), "a fonte restrita nunca chegou ao trabalho");
    });

    test("repetir um passo devolve o recibo sem chamar o modelo; outra entrada no mesmo passo é recusada", async () => {
      const { gateway, model, md, started, analyze } = await setup();
      await md("Compras", POLICY);
      const id = await started();
      const { plan, labels } = await analyze(id);
      const again = await gateway.run(id, "plan");
      assert.deepEqual([again.replayed, again.output], [true, plan]);
      assert.equal((await gateway.run(id, `specialist:${plan.agents[0]}`, { labels: labels[0] })).replayed, true);
      assert.equal(await code(gateway.run(id, `specialist:${plan.agents[0]}`, { labels: [] })), "input_changed");
      assert.equal(model.calls.length, 3);
    });

    test("limite do plano: chamadas além de max_model_calls são recusadas e não ficam reservadas", async () => {
      const { jobs, gateway, md, started } = await setup();
      await md("Compras", POLICY);
      const id = await started();
      await recordPlan(jobs, id, { agents: ["procurement_analyst"], reason: "Só compras importa aqui." });
      // max_model_calls = 3. Dois recibos já existem (por exemplo, de um plano anterior com mais agentes).
      await jobs.uow.run(async (s) => {
        for (const slot of ["specialist:antigo_a", "specialist:antigo_b"]) {
          await s.inferences.reserve({ jobId: id, slot, inputSha: "x" });
          await s.inferences.complete({ jobId: id, slot, output: { findings: [], unknowns: [] }, usage: {} });
        }
      });
      const { fragments } = await gateway.retrieve(id, "procurement_analyst");
      await gateway.run(id, "specialist:procurement_analyst", { labels: fragments.map((f) => f.label) });
      assert.equal(await code(gateway.run(id, "synthesis")), "plan_call_limit");
      assert.equal(await jobs.uow.read.inferences.get(id, "synthesis"), undefined, "a reserva recusada foi desfeita");
      assert.equal((await gateway.run(id, "plan")).replayed, false, "o plano não conta no limite");
    });

    test("falha sabida libera o passo para nova tentativa; reserva sem recibo pede revisão e nunca repete", async () => {
      const { jobs, gateway, model, started } = await setup();
      const id = await started();
      model.fail = (task) => (task === "plan" ? new ModelCallError("quota_exhausted") : undefined);
      assert.equal(await code(gateway.run(id, "plan")), "quota_exhausted");
      const failed = (await jobs.uow.read.events.list(`job:${id}` as never)).filter((e) => e.kind === "inference_failed");
      assert.deepEqual(failed.map((e) => (e.detail as { code: string }).code), ["quota_exhausted"]);
      model.fail = undefined;
      assert.equal((await gateway.run(id, "plan")).replayed, false, "liberado depois da falha sabida");
      // Simula uma queda no meio da chamada: o recibo volta a ser só uma reserva.
      await jobs.uow.run((s) => s.inferences.release({ jobId: id, slot: "plan" }));
      const d = opened.at(-1)!;
      await d.db.sql.run("UPDATE inference_receipts SET state = 'reserved', output = NULL WHERE job_id = $1 AND slot = 'plan'", [id]);
      const calls = model.calls.length;
      assert.equal(await code(gateway.run(id, "plan")), "inference_unknown");
      assert.equal(model.calls.length, calls, "a reserva sem recibo não chamou o modelo de novo");
      const job = (await jobs.uow.read.jobs.get(id))!;
      assert.equal(job.status, "recovery_required");
      assert.ok((await jobs.uow.read.events.list(`job:${id}` as never)).some((e) => e.kind === "inference_unknown"));
    });

    test("rótulo não entregue, trecho que deixou de valer e passo inválido são recusados", async () => {
      const { jobs, gateway, md, started } = await setup();
      await md("Compras", POLICY);
      const id = await started();
      await gateway.run(id, "plan");
      await recordPlan(jobs, id, { agents: ["procurement_analyst"], reason: "Só compras importa aqui." });
      assert.equal(await code(gateway.run(id, "specialist:procurement_analyst", { labels: ["f-00000000"] })), "label_not_served");
      assert.equal(await code(gateway.run(id, "specialist:procurement_analyst", { labels: ["nao-e-rotulo"] })), "invalid_labels");
      assert.equal(await code(gateway.run(id, "outro")), "invalid_slot");
      assert.equal(await code(gateway.retrieve(id, "financial_planning_analyst")), "agent_not_in_plan");
    });
  });
}
