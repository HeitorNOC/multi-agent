// N3 — execução em etapas com revisão em cadeia, sem Python: o gateway avança etapa por etapa
// (entrega do responsável e revisão do diretor ou do Chief), com refação, escalação ao CEO,
// tentativas esgotadas e recibos (repetir não refaz). Nos dois bancos.
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { manualClock } from "../../shared/clock.ts";
import { AppError } from "../../shared/errors.ts";
import { ActorId, type JobId } from "../../shared/ids.ts";
import { UnitOfWork } from "../../platform/database/unit-of-work.ts";
import { CallLimiter } from "../../platform/model/call-limiter.ts";
import type { ModelClient, ModelRequest } from "../../platform/model/model-client.ts";
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
import { staticTeam, type CatalogAgent } from "./domain/catalog.ts";
import { MAX_ATTEMPTS } from "./domain/step-tasks.ts";

const TEAM: CatalogAgent[] = [
  { id: "director_technology", title: "Augusto, Diretor de tecnologia", focus: "arquitetura padrões de engenharia serviços", domain: "technology" },
  { id: "tech_lead", title: "Mateus, Tech Lead", focus: "serviços testes contratos webchat", domain: "technology" },
];
const GOAL = "Implementar o módulo de atendimento por WebChat como microserviço, com testes e contrato da API.";
const STANDARD = "# Padrão de serviços\n\nTodo serviço de webchat e de atendimento expõe health check, logs estruturados e contrato da API documentado, com testes.";
const preset = {
  agents: ["director_technology", "tech_lead"],
  reason: "Plano aprovado pelo CEO na conversa (versão 2), com 2 etapa(s).",
  steps: [
    { title: "Arquitetura do serviço", owner: "director_technology", deliverable: "Proposta de arquitetura", after: [], reviewer: "chief" },
    { title: "Serviço de WebChat com testes", owner: "tech_lead", deliverable: "Código e testes", after: [0], reviewer: "director_technology" },
  ],
};

/** Modelo que responde conforme a tarefa; as decisões das revisões vêm de uma fila. */
class StepModel implements ModelClient {
  readonly provider = "claude" as const;
  readonly model = "simulado";
  calls: { task: string; input: Record<string, unknown> }[] = [];
  reviews: string[] = [];
  async complete(req: ModelRequest) {
    const input = JSON.parse(req.prompt) as Record<string, unknown>;
    const task = "entrega" in input ? "review" : "entrega_esperada" in input ? "step" : "synthesis";
    this.calls.push({ task, input });
    const trechos = (input.trechos as { rotulo: string }[] | undefined) ?? [];
    const out =
      task === "step"
        ? { deliverable: `Entrega de "${input.etapa}"${input.retorno_da_revisao ? " (corrigida)" : ""}`, notes: [], citations: trechos.slice(0, 1).map((t) => t.rotulo) }
        : task === "review"
          ? (() => {
              const decision = this.reviews.shift() ?? "accept";
              return { decision, feedback: decision === "accept" ? "" : decision === "revise" ? "Faltam os testes de carga." : "Precisa de um banco novo: decisão do gestor.", issues: decision === "revise" ? ["testes de carga"] : [] };
            })()
          : { summary: "Arquitetura e serviço entregues.", recommendation: "Aprovar a entrega e seguir para homologação." };
    return { json: JSON.stringify(out), usage: { output_tokens: 5 }, seconds: 0.1 };
  }
}

const opened: TestDatabase[] = [];
afterEach(async () => {
  for (const d of opened.splice(0)) await d.close();
});
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : String(e)));

test("política: etapas com responsável e revisor no plano, ordem válida e orçamento por tentativa", async () => {
  const policy = openWorkPolicy(staticTeam(TEAM));
  const plan = (await policy.plan(preset, {} as never)) as { steps: unknown[]; max_model_calls: number };
  assert.equal(plan.steps.length, 2);
  assert.equal(plan.max_model_calls, 2 * 2 * MAX_ATTEMPTS + 1);
  const bad = (steps: unknown) => code(Promise.resolve().then(() => policy.plan({ ...preset, steps } as never, {} as never)));
  assert.equal(await bad([{ ...preset.steps[0], owner: "copywriter" }]), "step_owner_not_in_plan");
  assert.equal(await bad([{ ...preset.steps[0], reviewer: "copywriter" }]), "step_reviewer_not_in_plan");
  assert.equal(await bad([{ ...preset.steps[0], after: [0] }]), "invalid_steps");
});

for (const dialect of dialects) {
  describe(`execução em etapas — ${dialect}`, () => {
    async function setup() {
      const d = await fresh(dialect);
      opened.push(d);
      const clock = manualClock("2026-03-01T12:00:00.000Z");
      const jobs: JobsDeps = { uow: new UnitOfWork(d.db, jobsStore(clock)), policy: openWorkPolicy(staticTeam(TEAM)), limits: queueLimits({ capacity: 4 }), clock, workers: { isActive: () => false, count: () => 0 } };
      const kuow = new UnitOfWork(d.db, knowledgeStore(clock));
      const search = new KnowledgeSearch(kuow, clock, (p) => new Bm25Index(p));
      const knowledge = { uow: kuow, clock, search, answerer: new ExtractiveAnswerer(), maxBytes: 100_000 };
      await uploadSource(knowledge, ActorId.parse("ana"), { title: "Padrão de serviços", filename: "p.md", mediaType: "text/markdown", contentBase64: Buffer.from(STANDARD).toString("base64") });
      const model = new StepModel();
      const gateway = new OpenWorkGateway({ jobs, search, client: model, limiter: new CallLimiter(1, 4), team: staticTeam(TEAM), clock });
      const { job } = await admitJob(jobs, { request: { goal: GOAL }, preset });
      await claimNextJob(jobs);
      // O que o worker faz: plano (o preset), etapas até o fim, síntese e parecer.
      await recordPlan(jobs, job.id, (await gateway.run(job.id, "plan")).output);
      const runAll = async () => {
        const steps: unknown[] = [];
        for (let r = await gateway.advance(job.id); !r.done; r = await gateway.advance(job.id)) steps.push(r);
        return steps;
      };
      return { jobs, gateway, model, job: job.id as JobId, runAll };
    }

    test("cada etapa entrega e é revisada; refação recebe o retorno; o parecer consolida e é aceito pela política", async () => {
      const { jobs, gateway, model, job, runAll } = await setup();
      model.reviews.push("accept", "revise", "accept");
      const trail = (await runAll()) as { step: number; attempt: number; decision: string }[];
      assert.deepEqual(trail.map((t) => [t.step, t.attempt, t.decision]), [[0, 0, "accept"], [1, 0, "revise"], [1, 1, "accept"]]);
      const steps = model.calls.filter((c) => c.task === "step");
      assert.equal(steps[1]!.input.entregas_anteriores && (steps[1]!.input.entregas_anteriores as { entrega: string }[])[0]!.entrega, 'Entrega de "Arquitetura do serviço"', "a etapa 2 recebe a entrega da 1");
      assert.deepEqual(steps[2]!.input.retorno_da_revisao, { feedback: "Faltam os testes de carga.", issues: ["testes de carga"] }, "a refação recebe o retorno");
      assert.ok((steps[0]!.input.trechos as unknown[]).length > 0, "o responsável recebe os padrões do Cérebro");

      const outcomes = await gateway.outcomes(job, { steps: preset.steps });
      assert.deepEqual(outcomes.map((o) => [o.status, o.attempts]), [["accepted", 1], ["accepted", 2]]);
      assert.equal(outcomes[1]!.deliverable, 'Entrega de "Serviço de WebChat com testes" (corrigida)');

      await gateway.run(job, "synthesis");
      const { report } = await gateway.stepsReport(job);
      const r = report as { kind: string; steps: unknown[]; escalations: unknown[]; citations: { title: string }[] };
      assert.deepEqual([r.kind, r.steps.length, r.escalations.length], ["steps", 2, 0]);
      assert.equal(r.citations[0]!.title, "Padrão de serviços");
      const review = await recordReview(jobs, job, report);
      assert.ok(review);
      // Repetir depois de "uma queda": nada é chamado de novo.
      const before = model.calls.length;
      assert.deepEqual(await gateway.advance(job), { done: true });
      assert.equal(model.calls.length, before);
    });

    test("escalação sobe ao CEO: a execução para e o parecer diz o que precisa da decisão dele", async () => {
      const { gateway, model, job, runAll } = await setup();
      model.reviews.push("escalate");
      await runAll();
      assert.deepEqual(await gateway.advance(job), { done: true, stopped: "escalated" });
      assert.equal(model.calls.filter((c) => c.task === "step").length, 1, "a etapa 2 não começa");
      await gateway.run(job, "synthesis");
      const r = (await gateway.stepsReport(job)).report as { steps: { status: string }[]; escalations: { title: string; reason: string }[] };
      assert.deepEqual(r.steps.map((s) => s.status), ["escalated", "skipped"]);
      assert.deepEqual(r.escalations, [{ step: 0, title: "Arquitetura do serviço", reason: "Precisa de um banco novo: decisão do gestor." }]);
    });

    test("tentativas esgotadas também sobem; o orçamento do plano limita as chamadas", async () => {
      const { gateway, model, job, runAll } = await setup();
      model.reviews.push("accept", ...Array(MAX_ATTEMPTS).fill("revise"));
      await runAll();
      const outcomes = await gateway.outcomes(job, { steps: preset.steps });
      assert.deepEqual(outcomes.map((o) => [o.status, o.attempts]), [["accepted", 1], ["exhausted", MAX_ATTEMPTS]]);
      assert.equal(await code(gateway.run(job, `review:1:${MAX_ATTEMPTS}`)), "invalid_slot");
    });
  });
}
