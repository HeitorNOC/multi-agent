// Central de recuperação: nada desconhecido é repetido sem uma pessoa autorizar, nos dois bancos.
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { manualClock } from "../../shared/clock.ts";
import { AppError } from "../../shared/errors.ts";
import { ActorId } from "../../shared/ids.ts";
import { UnitOfWork } from "../../platform/database/unit-of-work.ts";
import { dialects, fresh, type TestDatabase } from "../../../test/support/databases.ts";
import { testPolicy } from "../../../test/support/test-policy.ts";
import { admitJob } from "../jobs/application/admit-job.ts";
import { resumeJob } from "../jobs/application/decide-job.ts";
import type { JobsDeps } from "../jobs/application/deps.ts";
import { viewJob } from "../jobs/application/job-view.ts";
import { queueLimits } from "../jobs/application/queue-limits.ts";
import { claimNextJob } from "../jobs/application/run-lifecycle.ts";
import * as transitions from "../jobs/domain/transitions.ts";
import { jobsStore } from "../jobs/infrastructure/jobs-store.ts";
import { authorizeRetry, closeAsUnknown, listRecoveryCases } from "./application/recovery.ts";

const opened: TestDatabase[] = [];
afterEach(async () => {
  for (const d of opened.splice(0)) await d.close();
});
const actor = ActorId.parse("revisora");
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : String(e)));
const REASON = "Conferi no provedor que a chamada não foi cobrada nem concluída.";

for (const dialect of dialects) {
  describe(`central de recuperação — ${dialect}`, () => {
    /** Um trabalho que caiu com uma chamada ao modelo reservada e sem recibo. */
    async function setup() {
      const d = await fresh(dialect);
      opened.push(d);
      const clock = manualClock("2026-03-01T10:00:00.000Z");
      const active = new Set<string>();
      const deps: JobsDeps = {
        uow: new UnitOfWork(d.db, jobsStore(clock)),
        policy: testPolicy,
        limits: queueLimits({ capacity: 4 }),
        clock,
        workers: { isActive: (id) => active.has(id), count: () => active.size },
      };
      const { job } = await admitJob(deps, { request: { goal: "Analisar compras" } });
      await claimNextJob(deps);
      await deps.uow.run(async (s) => {
        await s.inferences.reserve({ jobId: job.id, slot: "plan", inputSha: "a" });
        await s.inferences.complete({ jobId: job.id, slot: "plan", output: {}, usage: {} });
        await s.inferences.reserve({ jobId: job.id, slot: "specialist:compras", inputSha: "b" });
        const current = (await s.jobs.get(job.id))!;
        await s.jobs.save(transitions.requireRecovery(current, "Uma chamada ao modelo ficou sem recibo"));
        await s.events.append(`job:${job.id}` as never, { kind: "inference_unknown", detail: { slot: "specialist:compras" } });
      });
      return { deps, id: job.id, active };
    }

    test("lista o caso com o passo pendente e a evidência", async () => {
      const { deps, id } = await setup();
      const { cases } = await listRecoveryCases(deps);
      assert.equal(cases.length, 1);
      assert.equal(cases[0]!.job.id, id);
      assert.deepEqual(cases[0]!.pending_steps.map((s) => s.slot), ["specialist:compras"]);
      assert.ok(cases[0]!.evidence.some((e) => e.kind === "inference_unknown"));
    });

    test("retomada comum é recusada: só a central devolve o trabalho à fila", async () => {
      const { deps, id } = await setup();
      assert.equal(await code(resumeJob(deps, { jobId: id, actor })), "recovery_review_required");
    });

    test("autorizar repetir exige justificativa e o conjunto exato de passos conferidos", async () => {
      const { deps, id, active } = await setup();
      assert.equal(await code(authorizeRetry(deps, { jobId: id, actor, reason: "curta", steps: ["specialist:compras"] })), "invalid_reason");
      assert.equal(await code(authorizeRetry(deps, { jobId: id, actor, reason: REASON, steps: [] })), "steps_changed");
      active.add(id);
      assert.equal(await code(authorizeRetry(deps, { jobId: id, actor, reason: REASON, steps: ["specialist:compras"] })), "worker_active");
      active.clear();
      const { job } = await authorizeRetry(deps, { jobId: id, actor, reason: REASON, steps: ["specialist:compras"] });
      assert.equal(job.status, "queued");
      const receipts = await deps.uow.read.inferences.list(id);
      assert.deepEqual(receipts.map((r) => [r.slot, r.state]), [["plan", "completed"]], "só a reserva pendente foi liberada; o recibo do plano fica");
      const events = (await viewJob(deps, id)).events.filter((e) => e.kind === "recovery_retry_authorized");
      assert.deepEqual(events.map((e) => e.detail), [{ actor: "revisora", reason: REASON, steps: ["specialist:compras"] }]);
      assert.deepEqual((await listRecoveryCases(deps)).cases, []);
    });

    test("encerrar sem resultado confirmado; repetir é inofensivo; não volta mais à fila", async () => {
      const { deps, id } = await setup();
      const closed = await closeAsUnknown(deps, { jobId: id, actor, reason: REASON });
      assert.deepEqual([closed.job.status, closed.replayed], ["closed_unknown", false]);
      assert.equal((await closeAsUnknown(deps, { jobId: id, actor, reason: REASON })).replayed, true);
      assert.equal(await code(authorizeRetry(deps, { jobId: id, actor, reason: REASON, steps: ["specialist:compras"] })), "not_in_recovery");
      assert.equal(await code(resumeJob(deps, { jobId: id, actor })), "invalid_transition");
    });
  });
}
