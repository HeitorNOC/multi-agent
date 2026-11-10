// Casos de uso de trabalhos, sem HTTP, contra SQLite e (se configurado) PostgreSQL.
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { manualClock } from "../../../shared/clock.ts";
import { AppError } from "../../../shared/errors.ts";
import { ActorId, AdmissionKey, JobId } from "../../../shared/ids.ts";
import { UnitOfWork } from "../../../platform/database/unit-of-work.ts";
import { stream } from "../../../platform/events/event-log.ts";
import { dialects, fresh, type TestDatabase } from "../../../../test/support/databases.ts";
import { testPolicy } from "../../../../test/support/test-policy.ts";
import { jobsStore } from "../infrastructure/jobs-store.ts";
import { admitJob } from "./admit-job.ts";
import { approveJob, rejectJob, resumeJob } from "./decide-job.ts";
import type { JobsDeps } from "./deps.ts";
import { viewJob } from "./job-view.ts";
import { queueLimits } from "./queue-limits.ts";
import { claimNextJob, finishRun, reconcileOnRestart } from "./run-lifecycle.ts";
import { recordEffect, recordPlan, recordReview, recordWorkerEvent } from "./worker-reports.ts";

const opened: TestDatabase[] = [];
afterEach(async () => {
  for (const d of opened.splice(0)) await d.close();
});
const actor = ActorId.parse("gestor");
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : String(e)));

for (const dialect of dialects) {
  describe(`casos de uso de trabalhos — ${dialect}`, () => {
    async function setup(limits = { capacity: 4, resumeReserve: 0, maxWorkers: 1 }) {
      const d = await fresh(dialect);
      opened.push(d);
      const clock = manualClock("2026-03-01T10:00:00.000Z");
      const active = new Set<string>();
      const deps: JobsDeps = {
        uow: new UnitOfWork(d.db, jobsStore(clock)),
        policy: testPolicy,
        limits: queueLimits(limits),
        clock,
        workers: { isActive: (id) => active.has(id), count: () => active.size },
      };
      return { deps, active, clock };
    }
    /** Leva um trabalho até "aguardando aprovação", como faria o worker. */
    async function untilReview(deps: JobsDeps) {
      const { job } = await admitJob(deps, { request: { goal: "Analisar compras" } });
      const claim = await claimNextJob(deps);
      assert.equal(claim.kind, "started");
      await recordPlan(deps, job.id, { agents: ["compras"] });
      const review = (await recordReview(deps, job.id, { summary: "Três cotações" }))!;
      await finishRun(deps, job.id, { exitCode: 0, declared: { completed: false } });
      return { id: job.id, hash: review.hash };
    }

    test("admitir: entra na fila com eventos; a mesma chave devolve o mesmo trabalho", async () => {
      const { deps } = await setup();
      const key = AdmissionKey.parse("envio-0123456789abc");
      const first = await admitJob(deps, { request: { goal: "Analisar compras" }, key });
      const again = await admitJob(deps, { request: { goal: "Analisar compras" }, key });
      assert.deepEqual([first.job.status, first.replayed, again.replayed, again.job.id], ["queued", false, true, first.job.id]);
      assert.equal(await code(admitJob(deps, { request: { goal: "Outro pedido" }, key })), "admission_key_reused");
      const view = await viewJob(deps, first.job.id);
      assert.deepEqual(view.events.map((e) => e.kind), ["admission", "job_queued"]);
      assert.equal(await code(admitJob(deps, { request: { goal: "" } })), "invalid_goal");
    });

    test("capacidade: fila cheia recusa; vagas reservadas ficam para retomadas", async () => {
      const { deps } = await setup({ capacity: 2, resumeReserve: 1, maxWorkers: 1 });
      await admitJob(deps, { request: { goal: "primeiro" } });
      assert.equal(await code(admitJob(deps, { request: { goal: "segundo" } })), "queue_full_for_new");
    });

    test("o que roda na mesma transação da admissão fica ou some junto", async () => {
      const { deps } = await setup();
      await assert.rejects(
        admitJob(deps, {
          request: { goal: "Analisar compras" },
          onAdmitted: async () => {
            throw new Error("resposta falhou");
          },
        }),
      );
      assert.deepEqual(await deps.uow.read.jobs.listRecent(), []);
      assert.equal(await deps.uow.read.queue.next(), undefined);
    });

    test("tirar da fila respeita a ordem e o limite de workers; entrada obsoleta é descartada", async () => {
      const { deps, active } = await setup();
      const a = (await admitJob(deps, { request: { goal: "pedido a" } })).job;
      const b = (await admitJob(deps, { request: { goal: "pedido b" } })).job;
      const first = await claimNextJob(deps);
      assert.equal(first.kind === "started" && first.job.id, a.id);
      active.add(a.id);
      assert.equal((await claimNextJob(deps)).kind, "empty", "sem worker livre");
      active.clear();
      await deps.uow.run(async (s) => s.jobs.save({ ...(await s.jobs.get(b.id))!, status: "rejected" }));
      assert.equal((await claimNextJob(deps)).kind, "skipped");
      assert.equal((await claimNextJob(deps)).kind, "empty");
    });

    test("plano e parecer: repetição aceita, troca recusada, recusa registrada na trilha", async () => {
      const { deps } = await setup();
      const { job } = await admitJob(deps, { request: { goal: "Analisar compras" } });
      await claimNextJob(deps);
      await recordPlan(deps, job.id, { agents: ["compras"] });
      await recordPlan(deps, job.id, { agents: ["compras"] });
      assert.equal(await code(recordPlan(deps, job.id, { agents: ["outro"] })), "plan_already_bound");
      assert.equal(await code(recordPlan(deps, job.id, {})), "invalid_plan");
      assert.equal(await code(recordReview(deps, job.id, { summary: "s", citations: ["f-00000000"] })), "unknown_citation");
      await recordWorkerEvent(deps, job.id, {
        kind: "knowledge_retrieved",
        detail: { fragments: [{ label: "f-aaaaaaaa", id: "x", source: "s", version: 1 }] },
      });
      await recordReview(deps, job.id, { summary: "s", citations: ["f-aaaaaaaa"] });
      const kinds = (await viewJob(deps, job.id)).events.map((e) => e.kind);
      assert.deepEqual(
        kinds.filter((k) => k !== "admission" && k !== "job_queued"),
        ["job_dequeued", "plan", "plan_rejected", "review_rejected", "knowledge_retrieved", "review_ready"],
      );
    });

    test("aprovar o parecer exato devolve à fila; efeito único com recibo repetível", async () => {
      const { deps } = await setup();
      const { id, hash } = await untilReview(deps);
      assert.equal(await code(approveJob(deps, { jobId: id, hash: "outro", actor })), "approval_mismatch");
      const approved = await approveJob(deps, { jobId: id, hash, actor });
      assert.deepEqual([approved.job.status, approved.replayed], ["queued", false]);
      assert.equal((await approveJob(deps, { jobId: id, hash, actor })).replayed, true);
      await claimNextJob(deps);
      const receipt = await recordEffect(deps, id, hash);
      const again = await recordEffect(deps, id, hash);
      assert.deepEqual(again, receipt, "pedir o efeito de novo devolve o mesmo recibo");
      assert.equal(await code(recordEffect(deps, id, "outro")), "approval_invalid");
      const done = await finishRun(deps, id, { exitCode: 0, declared: { completed: true } });
      assert.equal(done.status, "completed");
      const effects = (await viewJob(deps, id)).events.filter((e) => e.kind === "effect_receipt");
      assert.deepEqual(effects.map((e) => (e.detail as { replayed: boolean }).replayed), [false, true]);
    });

    test("efeito sem aprovação é recusado", async () => {
      const { deps } = await setup();
      const { id, hash } = await untilReview(deps);
      assert.equal(await code(recordEffect(deps, id, hash)), "approval_invalid");
    });

    test("rejeitar encerra; não dá para aprovar ou retomar depois", async () => {
      const { deps } = await setup();
      const { id, hash } = await untilReview(deps);
      assert.equal((await rejectJob(deps, { jobId: id, hash, actor })).job.status, "rejected");
      assert.equal(await code(approveJob(deps, { jobId: id, hash, actor })), "approval_mismatch");
      assert.equal(await code(resumeJob(deps, { jobId: id, actor })), "invalid_transition");
    });

    test("decidir com worker ativo é recusado", async () => {
      const { deps, active } = await setup();
      const { id, hash } = await untilReview(deps);
      active.add(id);
      assert.equal(await code(approveJob(deps, { jobId: id, hash, actor })), "worker_active");
    });

    test("fim da execução: nenhum sucesso presumido", async () => {
      const { deps } = await setup();
      const cases: [Parameters<typeof finishRun>[2], string][] = [
        [{ exitCode: 1 }, "failed"],
        [{ exitCode: 88 }, "interrupted"],
        [{ exitCode: null, spawnFailed: true }, "failed"],
        [{ exitCode: 0 }, "failed"],
        [{ exitCode: 0, declared: { completed: false } }, "failed"],
        [{ exitCode: 0, declared: { completed: true } }, "failed"],
      ];
      for (const [result, expected] of cases) {
        const { job } = await admitJob(deps, { request: { goal: `caso ${expected} ${cases.indexOf([result, expected])}` } });
        await claimNextJob(deps);
        assert.equal((await finishRun(deps, job.id, result)).status, expected, JSON.stringify(result));
      }
    });

    test("decisão tomada durante a execução prevalece sobre o código de saída", async () => {
      const { deps } = await setup();
      const { job } = await admitJob(deps, { request: { goal: "Analisar compras" } });
      await claimNextJob(deps);
      await deps.uow.run(async (s) => s.jobs.save({ ...(await s.jobs.get(job.id))!, status: "recovery_required", error: "sem recibo" }));
      assert.equal((await finishRun(deps, job.id, { exitCode: 1 })).status, "recovery_required");
    });

    test("reinício: o que rodava vira interrompido e pode ser retomado", async () => {
      const { deps } = await setup();
      const { job } = await admitJob(deps, { request: { goal: "Analisar compras" } });
      await claimNextJob(deps);
      assert.equal(await reconcileOnRestart(deps), 1);
      const view = await viewJob(deps, job.id);
      assert.equal(view.status, "interrupted");
      assert.ok(view.events.some((e) => e.kind === "server_restart_reconciled"));
      assert.equal((await resumeJob(deps, { jobId: job.id, actor })).job.status, "queued");
      assert.equal((await resumeJob(deps, { jobId: job.id, actor })).replayed, true);
    });

    test("trabalho inexistente é not_found", async () => {
      const { deps } = await setup();
      assert.equal(await code(viewJob(deps, JobId.create())), "job_not_found");
      assert.equal(await code(recordWorkerEvent(deps, JobId.create(), { kind: "x", detail: {} })), "job_not_found");
      void stream;
    });
  });
}
