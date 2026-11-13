// Contrato dos repositórios de trabalhos e da unidade de trabalho, rodando em SQLite e PostgreSQL.
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { manualClock } from "../../../shared/clock.ts";
import { AppError } from "../../../shared/errors.ts";
import { AdmissionKey, JobId } from "../../../shared/ids.ts";
import { DatabaseUsageError } from "../../../platform/database/database.ts";
import { UnitOfWork } from "../../../platform/database/unit-of-work.ts";
import { stream } from "../../../platform/events/event-log.ts";
import { dialects, fresh, type TestDatabase } from "../../../../test/support/databases.ts";
import { newJob } from "../domain/job.ts";
import * as t from "../domain/transitions.ts";
import { jobsStore } from "./jobs-store.ts";

const opened: TestDatabase[] = [];
afterEach(async () => {
  for (const d of opened.splice(0)) await d.close();
});

for (const dialect of dialects) {
  describe(`repositórios de trabalhos — ${dialect}`, () => {
    async function setup() {
      const d = await fresh(dialect);
      opened.push(d);
      const clock = manualClock("2026-03-01T10:00:00.000Z");
      return { uow: new UnitOfWork(d.db, jobsStore(clock)), clock, db: d.db };
    }
    const job = (goal = "Analisar compras") => newJob({ id: JobId.create(), goal, createdAt: "2026-03-01T10:00:00.000Z" });
    const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : e?.name ?? String(e)));

    test("trabalho: adicionar, ler, gravar nova versão e listar", async () => {
      const { uow } = await setup();
      const added = await uow.read.jobs.add(job());
      assert.equal(added.version, 1);
      const loaded = (await uow.read.jobs.get(added.id))!;
      assert.deepEqual(loaded, added);
      const saved = await uow.read.jobs.save(t.attachPlan(t.start(loaded), { agents: ["a"] }));
      assert.deepEqual([saved.version, saved.status], [2, "running"]);
      assert.deepEqual((await uow.read.jobs.get(added.id))?.plan, { agents: ["a"] });
      assert.equal(await uow.read.jobs.get(JobId.create()), undefined);
    });

    test("gravação concorrente com versão antiga é recusada", async () => {
      const { uow } = await setup();
      const added = await uow.read.jobs.add(job());
      await uow.read.jobs.save(t.start(added));
      assert.equal(await code(uow.read.jobs.save(t.start(added))), "concurrent_update");
    });

    test("listagens por estado e recentes, com contagem", async () => {
      const { uow } = await setup();
      const a = await uow.read.jobs.add(job("a"));
      const b = await uow.read.jobs.add(job("b"));
      await uow.read.jobs.save(t.start(a));
      assert.deepEqual((await uow.read.jobs.listByStatus("queued")).map((j) => j.goal), ["b"]);
      assert.deepEqual((await uow.read.jobs.listRecent()).map((j) => j.id), [b.id, a.id]);
      assert.equal(await uow.read.jobs.countByStatus("running"), 1);
    });

    test("fila: ordem de chegada, remoção exata e profundidade por tipo", async () => {
      const { uow } = await setup();
      const [a, b] = [JobId.create(), JobId.create()];
      const first = await uow.read.queue.add({ jobId: a, kind: "new", crashAfterEffect: false, queuedAt: "t1" });
      await uow.read.queue.add({ jobId: b, kind: "resume", crashAfterEffect: true, queuedAt: "t2" });
      assert.deepEqual(await uow.read.queue.depth(), { total: 2, newRequests: 1 });
      assert.deepEqual(await uow.read.queue.next(), first);
      assert.equal(await uow.read.queue.remove({ seq: first.seq, jobId: b }), false, "seq de outro trabalho não remove");
      assert.equal(await uow.read.queue.remove(first), true);
      const head = await uow.read.queue.next();
      assert.deepEqual([head?.jobId, head?.kind, head?.crashAfterEffect], [b, "resume", true]);
      await assert.rejects(uow.read.queue.add({ jobId: b, kind: "new", crashAfterEffect: false, queuedAt: "t3" }));
    });

    test("admissão e efeito: chave e efeito únicos", async () => {
      const { uow } = await setup();
      const key = AdmissionKey.parse("chave-0123456789abcd");
      const id = JobId.create();
      assert.equal(await uow.read.admissions.get(key), undefined);
      await uow.read.admissions.add(key, id);
      assert.equal(await uow.read.admissions.get(key), id);
      await assert.rejects(uow.read.admissions.add(key, JobId.create()));
      await uow.read.effects.add({ jobId: id, hash: "h", receipt: { id: "r" } });
      assert.deepEqual(await uow.read.effects.get(id), { jobId: id, hash: "h", receipt: { id: "r" } });
      await assert.rejects(uow.read.effects.add({ jobId: id, hash: "h2", receipt: {} }));
    });

    test("recibos de inferência: reservar, completar, liberar e listar", async () => {
      const { uow } = await setup();
      const jobId = JobId.create();
      const first = await uow.read.inferences.reserve({ jobId, slot: "plan", inputSha: "a".repeat(64) });
      const again = await uow.read.inferences.reserve({ jobId, slot: "plan", inputSha: "b".repeat(64) });
      assert.deepEqual([first.created, again.created, again.receipt.inputSha], [true, false, "a".repeat(64)]);
      assert.equal(await uow.read.inferences.complete({ jobId, slot: "plan", output: { ok: 1 }, usage: { t: 3 } }), true);
      assert.equal(await uow.read.inferences.complete({ jobId, slot: "plan", output: { ok: 2 }, usage: {} }), false);
      assert.equal(await uow.read.inferences.release({ jobId, slot: "plan" }), false, "recibo completo não é apagado");
      await uow.read.inferences.reserve({ jobId, slot: "specialist:b", inputSha: "c".repeat(64) });
      assert.equal(await uow.read.inferences.release({ jobId, slot: "specialist:b" }), true);
      await uow.read.inferences.reserve({ jobId, slot: "specialist:a", inputSha: "c".repeat(64) });
      assert.deepEqual((await uow.read.inferences.list(jobId)).map((r) => [r.slot, r.state]), [["plan", "completed"], ["specialist:a", "reserved"]]);
      assert.deepEqual((await uow.read.inferences.get(jobId, "plan"))?.output, { ok: 1 });
    });

    test("trilha: ordem, idempotência por id e recusa de id reaproveitado", async () => {
      const { uow } = await setup();
      const s = stream.job("j1");
      const a = await uow.read.events.append(s, { kind: "plan", detail: { a: 1 }, eventId: "evento-0001" });
      const again = await uow.read.events.append(s, { kind: "plan", detail: { a: 1 }, eventId: "evento-0001" });
      await uow.read.events.append(s, { kind: "review_ready", detail: { h: "x" }, occurredAt: "2026-02-01T00:00:00.000Z" });
      await uow.read.events.append(stream.job("outro"), { kind: "plan", detail: {} });
      assert.deepEqual([a.replayed, again.replayed], [false, true]);
      const list = await uow.read.events.list(s);
      assert.deepEqual(list.map((e) => e.kind), ["plan", "review_ready"]);
      assert.equal(list[1]?.occurredAt, "2026-02-01T00:00:00.000Z");
      assert.equal(await code(uow.read.events.append(s, { kind: "plan", detail: { a: 2 }, eventId: "evento-0001" })), "event_id_reused");
      assert.equal(await code(uow.read.events.append(s, { kind: "Tipo Inválido", detail: {} })), "invalid_event");
    });

    test("transação: tudo ou nada", async () => {
      const { uow } = await setup();
      const j = job();
      await assert.rejects(
        uow.run(async ({ jobs, queue }) => {
          await jobs.add(j);
          await queue.add({ jobId: j.id, kind: "new", crashAfterEffect: false, queuedAt: "t" });
          throw new Error("falha de negócio");
        }),
        /falha de negócio/,
      );
      assert.equal(await uow.read.jobs.get(j.id), undefined);
      assert.equal(await uow.read.queue.next(), undefined);
    });

    test("transações concorrentes são serializadas na ordem de chegada", async () => {
      const { uow } = await setup();
      const order: string[] = [];
      const run = (label: string, ms: number) =>
        uow.run(async ({ events }) => {
          order.push(`${label}+`);
          await new Promise((r) => setTimeout(r, ms));
          await events.append(stream.job("c"), { kind: "step", detail: { label } });
          order.push(`${label}-`);
        });
      await Promise.all([run("A", 40), run("B", 5), run("C", 5)]);
      assert.deepEqual(order, ["A+", "A-", "B+", "B-", "C+", "C-"]);
    });

    test("leitura de fora nunca vê estado parcial de uma transação aberta", async () => {
      const { uow } = await setup();
      const j = job();
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const writing = uow.run(async ({ jobs }) => {
        const added = await jobs.add(j);
        await gate;
        await jobs.save(t.start(added));
      });
      const during = uow.read.jobs.get(j.id);
      await new Promise((r) => setTimeout(r, 30));
      release();
      await writing;
      const seen = await during;
      assert.ok(seen === undefined || seen.status === "running", `estado parcial visto: ${seen?.status}`);
    });

    test("usar o banco externo dentro da transação é erro imediato, não travamento", async () => {
      const { uow } = await setup();
      await assert.rejects(
        uow.run(async () => {
          await uow.read.jobs.listRecent();
        }),
        DatabaseUsageError,
      );
      assert.deepEqual(await uow.read.jobs.listRecent(), [], "e o banco continua utilizável");
    });
  });
}
