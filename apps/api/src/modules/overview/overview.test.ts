// Command Center: agregação de pendências, andamento, consumo do modelo e atividade, nos dois bancos.
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { manualClock } from "../../shared/clock.ts";
import { UnitOfWork } from "../../platform/database/unit-of-work.ts";
import { SqlEventLog, stream } from "../../platform/events/event-log.ts";
import { dialects, fresh, type TestDatabase } from "../../../test/support/databases.ts";
import { testPolicy } from "../../../test/support/test-policy.ts";
import { admitJob } from "../jobs/application/admit-job.ts";
import type { JobsDeps } from "../jobs/application/deps.ts";
import { queueLimits } from "../jobs/application/queue-limits.ts";
import { jobsStore } from "../jobs/infrastructure/jobs-store.ts";
import { overview } from "./application/overview.ts";

const opened: TestDatabase[] = [];
afterEach(async () => {
  for (const d of opened.splice(0)) await d.close();
});

for (const dialect of dialects) {
  describe(`Command Center — ${dialect}`, () => {
    test("pendências, andamento, consumo por dia e por uso, problemas do provedor e atividade", async () => {
      const d = await fresh(dialect);
      opened.push(d);
      // 10/03/2026 12:00 em São Paulo.
      const clock = manualClock("2026-03-10T15:00:00.000Z");
      const jobs: JobsDeps = { uow: new UnitOfWork(d.db, jobsStore(clock)), policy: testPolicy, limits: queueLimits({ capacity: 8 }), clock, workers: { isActive: () => false, count: () => 0 } };
      const a = (await admitJob(jobs, { request: { goal: "Analisar compras" } })).job;
      const b = (await admitJob(jobs, { request: { goal: "Analisar contratos" } })).job;
      await jobs.uow.run(async (s) => {
        await s.jobs.save({ ...(await s.jobs.get(a.id))!, status: "awaiting_approval" });
        await s.jobs.save({ ...(await s.jobs.get(b.id))!, status: "recovery_required", error: "sem recibo" });
      });
      const events = new SqlEventLog(d.db.sql, clock);
      const at = (iso: string) => ({ occurredAt: iso });
      // Hoje (dia local 10): duas chamadas de trabalho; ontem à noite em SP (01:30Z do dia 10 = 22:30 do dia 9).
      await events.append(stream.job(a.id), { kind: "inference_completed", detail: { slot: "plan", provider: "claude", usage: { input_tokens: 100, output_tokens: 20 } }, ...at("2026-03-10T14:00:00.000Z") });
      await events.append(stream.job(a.id), { kind: "inference_completed", detail: { slot: "synthesis", provider: "claude", usage: { input_tokens: 50, output_tokens: 10 } }, ...at("2026-03-10T14:05:00.000Z") });
      await events.append(stream.job(b.id), { kind: "inference_completed", detail: { slot: "plan", provider: "claude", usage: { output_tokens: 7 } }, ...at("2026-03-10T01:30:00.000Z") });
      await events.append(stream.job(b.id), { kind: "inference_failed", detail: { slot: "plan", code: "quota_exhausted" }, ...at("2026-03-10T14:10:00.000Z") });
      await events.append(stream.conversation("c1"), { kind: "chief_decision", detail: { engine: "model", provider: "claude", usage: { output_tokens: 3 } }, ...at("2026-03-10T14:20:00.000Z") });
      await events.append(stream.conversation("c1"), { kind: "chief_decision", detail: { engine: "rules", fallback: "timeout" }, ...at("2026-03-10T14:21:00.000Z") });
      await events.append(stream.knowledge("queries"), { kind: "knowledge_query", detail: { engine: "extractive" }, ...at("2026-03-10T14:22:00.000Z") });
      // Fora da janela de 7 dias: não conta.
      await events.append(stream.job(a.id), { kind: "inference_completed", detail: { usage: { output_tokens: 999 } }, ...at("2026-02-20T10:00:00.000Z") });

      const o = await overview({ sql: d.db.sql, clock, timeZone: "America/Sao_Paulo" });
      assert.deepEqual(o.kpis, { waiting_you: 2, in_progress: 0, attention: 1, delivered: 0 });
      assert.deepEqual([o.decide.approvals.map((x) => x.title), o.decide.recovery.map((x) => x.title)], [["Analisar compras"], ["Analisar contratos"]]);
      assert.equal(o.usage.days.length, 7);
      assert.deepEqual(o.usage.days.map((x) => x.date).slice(-2), ["2026-03-09", "2026-03-10"]);
      assert.deepEqual(o.usage.days.at(-1), { date: "2026-03-10", calls: 3, input_tokens: 150, output_tokens: 33 });
      assert.deepEqual(o.usage.days.at(-2), { date: "2026-03-09", calls: 1, input_tokens: 0, output_tokens: 7 }, "a noite de ontem em SP fica em ontem");
      assert.deepEqual(o.usage.by_area, { work: { calls: 3, tokens: 187, fallbacks: 0 }, chief: { calls: 1, tokens: 3, fallbacks: 1 }, knowledge: { calls: 0, tokens: 0, fallbacks: 0 }, station: { calls: 0, tokens: 0, fallbacks: 0 } });
      assert.deepEqual(o.usage.problems.map((p) => [p.code, p.count]).sort(), [["quota_exhausted", 1], ["timeout", 1]]);
      assert.deepEqual(o.usage.providers, ["claude"]);
      assert.ok(o.activity.some((e) => e.kind === "admission"));
    });
  });
}
