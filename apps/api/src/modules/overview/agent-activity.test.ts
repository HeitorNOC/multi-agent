// Lista operacional dos agentes: status, atividade, marcos e tempo, nos dois bancos.
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { manualClock } from "../../shared/clock.ts";
import { UnitOfWork } from "../../platform/database/unit-of-work.ts";
import { dialects, fresh, type TestDatabase } from "../../../test/support/databases.ts";
import { testPolicy } from "../../../test/support/test-policy.ts";
import { admitJob } from "../jobs/application/admit-job.ts";
import type { JobsDeps } from "../jobs/application/deps.ts";
import { queueLimits } from "../jobs/application/queue-limits.ts";
import { jobsStore } from "../jobs/infrastructure/jobs-store.ts";
import type { JobId } from "../../shared/ids.ts";
import { agentActivity } from "./application/agent-activity.ts";
import { companyBriefing } from "./application/briefing.ts";

const opened: TestDatabase[] = [];
afterEach(async () => {
  for (const d of opened.splice(0)) await d.close();
});

const SECOND = 1000;

for (const dialect of dialects) {
  describe(`Lista operacional dos agentes — ${dialect}`, () => {
    test("designado, pesquisando (com estimativa pelo histórico), entregue, travado e disponível", async () => {
      const d = await fresh(dialect);
      opened.push(d);
      const clock = manualClock("2026-03-10T15:00:00.000Z");
      const jobs: JobsDeps = { uow: new UnitOfWork(d.db, jobsStore(clock)), policy: testPolicy, limits: queueLimits({ capacity: 20 }), clock, workers: { isActive: () => false, count: () => 0 } };
      let n = 0;
      for (const id of ["ana", "bia", "caio", "duda", "edu"])
        await d.db.sql.run(
          "INSERT INTO agents (id, template_id, name, title, area, tagline, focus, skills, instructions, reports_to, status, hired_at, updated_at, ordinal) VALUES ($1, NULL, $2, 'Analista', 'financas', '', '', '[]', '', NULL, 'active', $3, $3, $4)",
          [id, id.toUpperCase(), clock.now(), ++n],
        );
      const job = async (goal: string, status: string, agents: string[]) => {
        const j = (await admitJob(jobs, { request: { goal } })).job;
        await jobs.uow.run(async (s) => s.jobs.save({ ...(await s.jobs.get(j.id))!, status: status as never, plan: { agents, reason: "teste", max_model_calls: 9 } as never }));
        return j.id;
      };
      const call = async (jobId: JobId, slot: string, ms?: number) => {
        await jobs.uow.run((s) => s.inferences.reserve({ jobId, slot, inputSha: "x" }));
        if (ms === undefined) return;
        clock.advance(ms);
        await jobs.uow.run((s) => s.inferences.complete({ jobId, slot, output: {}, usage: {} }));
      };

      // Histórico da Ana: três participações de 10, 20 e 30 s em trabalhos já concluídos ontem.
      clock.set("2026-03-09T10:00:00.000Z");
      for (const ms of [10, 20, 30]) await call(await job(`Antigo ${ms}`, "completed", ["ana"]), "specialist:ana", ms * SECOND);

      clock.set("2026-03-10T14:59:00.000Z");
      const running = await job("Analisar compras do trimestre", "running", ["ana", "bia", "caio"]);
      await call(running, "plan", SECOND);
      await call(running, "specialist:ana"); // pesquisando desde 14:59:01
      await call(running, "specialist:bia", 5 * SECOND); // entregou
      const stuck = await job("Revisar contratos", "interrupted", ["duda"]);
      await call(stuck, "specialist:duda");
      clock.set("2026-03-10T15:00:00.000Z");

      const { chief, agents } = await agentActivity({ sql: d.db.sql, clock });
      const by = new Map(agents.map((a) => [a.id, a]));

      const ana = by.get("ana")!;
      assert.equal(ana.status, "running");
      assert.deepEqual(ana.milestones, { done: 2, total: 3 });
      assert.equal(ana.job?.goal, "Analisar compras do trimestre");
      assert.equal(ana.elapsed_ms, 59 * SECOND, "desde a reserva até agora");
      assert.equal(ana.remaining_ms, 0, "mediana de 20 s já passou: não fica negativa");

      assert.equal(by.get("bia")!.status, "done");
      assert.deepEqual(by.get("bia")!.milestones, { done: 3, total: 3 });
      assert.equal(by.get("bia")!.elapsed_ms, 5 * SECOND);
      assert.equal(by.get("bia")!.remaining_ms, null, "sem histórico suficiente");

      assert.equal(by.get("caio")!.status, "assigned", "designado, ainda sem chamada");
      assert.deepEqual(by.get("caio")!.milestones, { done: 1, total: 3 });
      assert.equal(by.get("duda")!.status, "blocked");
      assert.equal(by.get("edu")!.status, "idle");
      assert.equal(by.get("edu")!.job, null);

      assert.equal(chief.status, "running");
      assert.equal(chief.job?.id, running);
      assert.match(chief.activity, /Coordenando 3 especialista\(s\) · 1 entregue/);
      assert.deepEqual(chief.milestones, { done: 1, total: 3 });

      // A mesma situação, resumida para o Chief of Staff (Jarvis).
      const b = await companyBriefing({ sql: d.db.sql, clock });
      assert.deepEqual(b.running.map((r) => [r.goal, r.agents]), [["Analisar compras do trimestre", ["ANA", "BIA", "CAIO"]]]);
      assert.deepEqual(b.team, { working: ["ANA · Analista", "CAIO · Analista"], size: 5 });
      assert.deepEqual([b.approvals, b.reviews, b.recovery, b.routines_gave_up], [[], [], [], 0]);
    });

    test("parecer aguardando aprovação deixa quem entregou como aguardando você", async () => {
      const d = await fresh(dialect);
      opened.push(d);
      const clock = manualClock("2026-03-10T15:00:00.000Z");
      const jobs: JobsDeps = { uow: new UnitOfWork(d.db, jobsStore(clock)), policy: testPolicy, limits: queueLimits({ capacity: 8 }), clock, workers: { isActive: () => false, count: () => 0 } };
      await d.db.sql.run(
        "INSERT INTO agents (id, template_id, name, title, area, tagline, focus, skills, instructions, reports_to, status, hired_at, updated_at, ordinal) VALUES ('ana', NULL, 'Ana', 'Analista', 'financas', '', '', '[]', '', NULL, 'active', $1, $1, 1)",
        [clock.now()],
      );
      const j = (await admitJob(jobs, { request: { goal: "Orçamento de marketing" } })).job;
      await jobs.uow.run(async (s) => s.jobs.save({ ...(await s.jobs.get(j.id))!, status: "awaiting_approval", plan: { agents: ["ana"] } as never }));
      for (const slot of ["plan", "specialist:ana", "synthesis"]) {
        await jobs.uow.run((s) => s.inferences.reserve({ jobId: j.id, slot, inputSha: "x" }));
        await jobs.uow.run((s) => s.inferences.complete({ jobId: j.id, slot, output: {}, usage: {} }));
      }
      const { chief, agents } = await agentActivity({ sql: d.db.sql, clock });
      assert.equal(agents[0]!.status, "waiting");
      assert.equal(chief.status, "waiting");
      assert.deepEqual((await companyBriefing({ sql: d.db.sql, clock })).approvals, [{ id: j.id, goal: "Orçamento de marketing" }]);
      assert.deepEqual(chief.milestones, { done: 3, total: 3 });
    });

    test("trabalho em etapas: quem entrega, quem revisa e etapa aceita", async () => {
      const d = await fresh(dialect);
      opened.push(d);
      const clock = manualClock("2026-03-10T15:00:00.000Z");
      const jobs: JobsDeps = { uow: new UnitOfWork(d.db, jobsStore(clock)), policy: testPolicy, limits: queueLimits({ capacity: 8 }), clock, workers: { isActive: () => false, count: () => 0 } };
      let n = 0;
      for (const id of ["lead", "dir"])
        await d.db.sql.run(
          "INSERT INTO agents (id, template_id, name, title, area, tagline, focus, skills, instructions, reports_to, status, hired_at, updated_at, ordinal) VALUES ($1, NULL, $2, 'Cargo', 'technology', '', '', '[]', '', NULL, 'active', $3, $3, $4)",
          [id, id.toUpperCase(), clock.now(), ++n],
        );
      const j = (await admitJob(jobs, { request: { goal: "Implementar o WebChat" } })).job;
      const steps = [{ title: "Serviço de WebChat", owner: "lead", reviewer: "dir", after: [], deliverable: "Código" }];
      await jobs.uow.run(async (s) => s.jobs.save({ ...(await s.jobs.get(j.id))!, status: "running", plan: { agents: ["lead", "dir"], steps } as never }));
      await jobs.uow.run((s) => s.inferences.reserve({ jobId: j.id, slot: "step:0:0", inputSha: "x" }));
      let by = new Map((await agentActivity({ sql: d.db.sql, clock })).agents.map((a) => [a.id, a]));
      assert.deepEqual([by.get("lead")!.status, by.get("lead")!.activity], ["running", "Trabalhando na etapa 1: Serviço de WebChat"]);
      assert.deepEqual([by.get("dir")!.status, by.get("dir")!.activity], ["assigned", "Na fila: etapa 1 — Serviço de WebChat"]);
      await jobs.uow.run((s) => s.inferences.complete({ jobId: j.id, slot: "step:0:0", output: {}, usage: {} }));
      await jobs.uow.run((s) => s.inferences.reserve({ jobId: j.id, slot: "review:0:0", inputSha: "x" }));
      by = new Map((await agentActivity({ sql: d.db.sql, clock })).agents.map((a) => [a.id, a]));
      assert.equal(by.get("dir")!.activity, "Revisando a etapa 1: Serviço de WebChat");
      await jobs.uow.run((s) => s.inferences.complete({ jobId: j.id, slot: "review:0:0", output: { decision: "accept", feedback: "", issues: [] }, usage: {} }));
      by = new Map((await agentActivity({ sql: d.db.sql, clock })).agents.map((a) => [a.id, a]));
      assert.deepEqual([by.get("lead")!.status, by.get("lead")!.milestones.done], ["done", 3]);
    });
  });
}
