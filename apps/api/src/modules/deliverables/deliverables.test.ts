// Entregas com o fluxo real de trabalhos, nos dois bancos: efeito aprovado → entrega; aceitar;
// pedir ajustes → trabalho de revisão → nova versão; tudo ou nada nas transações.
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { manualClock } from "../../shared/clock.ts";
import { AppError } from "../../shared/errors.ts";
import { ActorId, type JobId } from "../../shared/ids.ts";
import { UnitOfWork } from "../../platform/database/unit-of-work.ts";
import { createHttpApp } from "../../platform/http/app.ts";
import { dialects, fresh, type TestDatabase } from "../../../test/support/databases.ts";
import { testPolicy } from "../../../test/support/test-policy.ts";
import { admitJob } from "../jobs/application/admit-job.ts";
import { approveJob } from "../jobs/application/decide-job.ts";
import type { EffectDelivery, JobsDeps } from "../jobs/application/deps.ts";
import { queueLimits } from "../jobs/application/queue-limits.ts";
import { claimNextJob, finishRun } from "../jobs/application/run-lifecycle.ts";
import { recordEffect, recordPlan, recordReview } from "../jobs/application/worker-reports.ts";
import { jobsStore } from "../jobs/infrastructure/jobs-store.ts";
import {
  acceptDeliverable,
  deliverableForJob,
  deliverableMarkdown,
  deliveryFor,
  listDeliverables,
  requestDeliverableChanges,
  viewDeliverable,
  type DeliverablesDeps,
} from "./application/deliverables.ts";
import type { DeliverableId } from "./domain/deliverable.ts";
import { deliverablesHttp } from "./http/routes.ts";
import { deliverablesStore } from "./infrastructure/sql-deliverables.ts";

const ana = ActorId.parse("ana");
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : String(e)));
const opened: { close(): Promise<void> }[] = [];
afterEach(async () => {
  for (const d of opened.splice(0)) await d.close();
});

for (const dialect of dialects) {
  describe(`entregas — ${dialect}`, () => {
    async function setup(capacity = 4, delivery?: (real: EffectDelivery) => EffectDelivery) {
      const d: TestDatabase = await fresh(dialect);
      opened.push(d);
      const clock = manualClock("2026-03-01T10:00:00.000Z");
      const uow = new UnitOfWork(d.db, deliverablesStore(clock));
      const real = deliveryFor(uow, clock);
      const jobs: JobsDeps = {
        uow: new UnitOfWork(d.db, jobsStore(clock)),
        policy: testPolicy,
        limits: queueLimits({ capacity }),
        clock,
        workers: { isActive: () => false, count: () => 0 },
        delivery: delivery ? delivery(real) : real,
      };
      const deps: DeliverablesDeps = {
        uow,
        clock,
        reopen: async (goal, onAdmitted) => (await admitJob(jobs, { request: { goal }, onAdmitted: (job, tx) => onAdmitted(job.id, tx) })).job.id,
      };
      /** Leva o próximo trabalho da fila até o efeito aprovado, como fariam o worker e o gestor. */
      async function runToEffect(summary: string) {
        const claim = await claimNextJob(jobs);
        assert.equal(claim.kind, "started");
        const id = (claim as { job: { id: JobId } }).job.id;
        await recordPlan(jobs, id, { agents: ["compras"] });
        const review = (await recordReview(jobs, id, { summary }))!;
        await finishRun(jobs, id, { exitCode: 0, declared: { completed: false } });
        await approveJob(jobs, { jobId: id, hash: review.hash, actor: ana });
        await claimNextJob(jobs);
        const receipt = (await recordEffect(jobs, id, review.hash)) as { deliverable_id: DeliverableId; deliverable_version: number; simulated: boolean };
        await finishRun(jobs, id, { exitCode: 0, declared: { completed: true } });
        return { id, receipt, hash: review.hash };
      }
      return { deps, jobs, runToEffect, clock };
    }

    test("o efeito aprovado gera a entrega em revisão; repetir o efeito não duplica", async () => {
      const { deps, jobs, runToEffect } = await setup();
      await admitJob(jobs, { request: { goal: "Analisar compras do trimestre" } });
      const { id, receipt, hash } = await runToEffect("Três cotações");
      assert.deepEqual([receipt.deliverable_version, receipt.simulated], [1, false]);
      assert.deepEqual(await recordEffect(jobs, id, hash), receipt, "repetir devolve o mesmo recibo");
      const { deliverables } = await listDeliverables(deps);
      assert.equal(deliverables.length, 1);
      const view = await viewDeliverable(deps, receipt.deliverable_id);
      assert.deepEqual([view.title, view.status, view.current_version, view.versions.length], ["Analisar compras do trimestre", "in_review", 1, 1]);
      assert.deepEqual(view.history.map((h) => h.kind), ["deliverable_created"]);
      assert.deepEqual(await deliverableForJob(deps, id), { id: receipt.deliverable_id, version: 1, revision_of: null });
    });

    test("se gravar a entrega falhar, o efeito também não acontece (sem recibo)", async () => {
      let fail = true;
      const { deps, jobs, runToEffect } = await setup(4, (real) => ({
        deliver: async (input, tx) => {
          const out = await real.deliver(input, tx);
          if (fail) throw new Error("disco cheio");
          return out;
        },
      }));
      await admitJob(jobs, { request: { goal: "Analisar compras" } });
      await assert.rejects(runToEffect("Três cotações"), /disco cheio/);
      assert.deepEqual((await listDeliverables(deps)).deliverables, []);
      const [job] = await jobs.uow.read.jobs.listRecent();
      assert.equal(job!.receipt, null);
      assert.equal(await jobs.uow.read.effects.get(job!.id), undefined);
      fail = false;
      const receipt = await recordEffect(jobs, job!.id, job!.approval!);
      assert.equal((receipt as { deliverable_version: number }).deliverable_version, 1, "a repetição entrega uma vez");
    });

    test("aceitar a versão atual; versão errada ou decisão repetida são recusadas", async () => {
      const { deps, jobs, runToEffect } = await setup();
      await admitJob(jobs, { request: { goal: "Analisar compras" } });
      const { receipt } = await runToEffect("Três cotações");
      const id = receipt.deliverable_id;
      assert.equal(await code(acceptDeliverable(deps, ana, id, 2)), "version_outdated");
      const accepted = await acceptDeliverable(deps, ana, id, 1);
      assert.deepEqual([accepted.status, accepted.decided_by], ["accepted", "ana"]);
      assert.equal(await code(acceptDeliverable(deps, ana, id, 1)), "not_in_review");
      assert.equal(await code(requestDeliverableChanges(deps, ana, id, 1, "Inclua os prazos de pagamento.")), "not_in_review");
    });

    test("pedir ajustes reabre o trabalho; a revisão aprovada vira a versão 2 em revisão", async () => {
      const { deps, jobs, runToEffect } = await setup();
      await admitJob(jobs, { request: { goal: "Analisar compras" } });
      const { receipt } = await runToEffect("Três cotações");
      const id = receipt.deliverable_id;
      assert.equal(await code(requestDeliverableChanges(deps, ana, id, 1, "curto")), "invalid_feedback");
      const reopened = await requestDeliverableChanges(deps, ana, id, 1, "Inclua os prazos de pagamento a fornecedores.");
      assert.deepEqual([reopened.status, reopened.decision_note], ["changes_requested", "Inclua os prazos de pagamento a fornecedores."]);
      const revisionJob = (await jobs.uow.read.jobs.get(reopened.reopened_job))!;
      assert.equal(revisionJob.status, "queued");
      assert.match(revisionJob.goal, /^Analisar compras\n\nAjustes pedidos pelo gestor na versão anterior: Inclua os prazos/);
      assert.deepEqual(await deliverableForJob(deps, revisionJob.id), { id, version: null, revision_of: 1 });

      const second = await runToEffect("Três cotações e prazo de 30 dias");
      assert.deepEqual([second.receipt.deliverable_id, second.receipt.deliverable_version], [id, 2]);
      const view = await viewDeliverable(deps, id);
      assert.deepEqual([view.status, view.current_version, view.versions.map((v) => v.version), view.decision_note], ["in_review", 2, [2, 1], null]);
      assert.deepEqual(view.history.map((h) => h.kind), ["deliverable_created", "deliverable_changes_requested", "deliverable_revised"]);
      assert.equal(view.reopenings[0]!.feedback, "Inclua os prazos de pagamento a fornecedores.");
      assert.equal(await code(acceptDeliverable(deps, ana, id, 1)), "version_outdated", "decidir sobre a versão antiga é recusado");
      const md = await deliverableMarkdown(deps, id, 2);
      assert.match(md.text, /^# Analisar compras\n\nVersão 2/);
      assert.match(md.text, /## Resumo\n\nTrês cotações e prazo de 30 dias/);
      assert.match((await deliverableMarkdown(deps, id, 1)).text, /## Resumo\n\nTrês cotações\n/);
    });

    test("ajuste recusado pela fila cheia: nada muda na entrega", async () => {
      const { deps, jobs, runToEffect } = await setup(1);
      await admitJob(jobs, { request: { goal: "Analisar compras" } });
      const { receipt } = await runToEffect("Três cotações");
      await admitJob(jobs, { request: { goal: "Outro pedido ocupando a fila" } });
      assert.equal(await code(requestDeliverableChanges(deps, ana, receipt.deliverable_id, 1, "Inclua os prazos de pagamento.")), "queue_full");
      const view = await viewDeliverable(deps, receipt.deliverable_id);
      assert.deepEqual([view.status, view.reopenings.length, view.history.length], ["in_review", 0, 1]);
    });

    test("HTTP: aceitar, pedir ajustes e baixar o Markdown", async () => {
      const { deps, jobs, runToEffect } = await setup();
      await admitJob(jobs, { request: { goal: "Analisar compras" } });
      const { receipt, id: jobId } = await runToEffect("Três cotações");
      let woke = 0;
      const app = await createHttpApp({ origin: () => "http://127.0.0.1:1", identify: () => ana, modules: [deliverablesHttp(deps, { onJobOpened: () => void woke++ })] });
      opened.push({ close: () => app.close() });
      const call = (method: "GET" | "POST", url: string, payload?: object) => app.inject({ method, url, payload, headers: { host: "127.0.0.1:1" } });
      const id = receipt.deliverable_id;
      assert.equal((await call("GET", `/api/deliverables/by-job/${jobId}`)).json().id, id);
      assert.equal((await call("GET", "/api/deliverables/nao-e-uuid")).json().code, "invalid_id");
      const md = await call("GET", `/api/deliverables/${id}/versions/1/markdown`);
      assert.deepEqual([md.statusCode, md.headers["content-type"], String(md.headers["content-disposition"]).startsWith("attachment")], [200, "text/markdown; charset=utf-8", true]);
      const changes = await call("POST", `/api/deliverables/${id}/request-changes`, { version: 1, feedback: "Inclua os prazos de pagamento." });
      assert.deepEqual([changes.statusCode, changes.json().status, woke], [202, "changes_requested", 1]);
      assert.equal((await call("POST", `/api/deliverables/${id}/accept`, { version: 1 })).json().code, "not_in_review");
    });
  });
}
