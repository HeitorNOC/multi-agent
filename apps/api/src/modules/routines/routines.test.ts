// Rotinas com admissão real, nos dois bancos: disparo, sem duplicar após reinício ou queda,
// recuperação de parada, tentativas com espera, pausa e "rodar agora".
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { manualClock } from "../../shared/clock.ts";
import { AppError } from "../../shared/errors.ts";
import { ActorId } from "../../shared/ids.ts";
import { UnitOfWork } from "../../platform/database/unit-of-work.ts";
import { createHttpApp } from "../../platform/http/app.ts";
import { dialects, fresh, type TestDatabase } from "../../../test/support/databases.ts";
import { testPolicy } from "../../../test/support/test-policy.ts";
import { admitJob } from "../jobs/application/admit-job.ts";
import type { JobsDeps } from "../jobs/application/deps.ts";
import { queueLimits } from "../jobs/application/queue-limits.ts";
import { jobsStore } from "../jobs/infrastructure/jobs-store.ts";
import { changeRoutine, createRoutine, listRoutines, runNow, tick, viewRoutine, type RoutinesDeps } from "./application/routines.ts";
import type { RoutineId } from "./domain/routine.ts";
import { routinesHttp } from "./http/routes.ts";
import { routinesStore } from "./infrastructure/sql-routines.ts";

const SP = "America/Sao_Paulo";
const ana = ActorId.parse("ana");
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : String(e)));
const opened: { close(): Promise<void> }[] = [];
afterEach(async () => {
  for (const d of opened.splice(0)) await d.close();
});
const DAILY = { name: "Resumo de compras", goal: "Resuma as compras de fornecedores do dia anterior", schedule: { kind: "daily" as const, time: "08:00" } };

for (const dialect of dialects) {
  describe(`rotinas — ${dialect}`, () => {
    async function setup(capacity = 8) {
      const d: TestDatabase = await fresh(dialect);
      opened.push(d);
      // Segunda, 02/03/2026, 07:00 em São Paulo.
      const clock = manualClock("2026-03-02T10:00:00.000Z");
      const jobs: JobsDeps = { uow: new UnitOfWork(d.db, jobsStore(clock)), policy: testPolicy, limits: queueLimits({ capacity }), clock, workers: { isActive: () => false, count: () => 0 } };
      /** Um "processo" novo sobre o mesmo banco (como depois de reiniciar a API). */
      const process = (): RoutinesDeps => ({
        uow: new UnitOfWork(d.db, routinesStore(clock)),
        clock,
        timeZone: SP,
        admit: async (goal, onAdmitted) => (await admitJob(jobs, { request: { goal }, onAdmitted: (job, tx) => onAdmitted(job.id, tx) })).job.id,
        jobStatus: async (id) => (await jobs.uow.read.jobs.get(id))?.status,
      });
      const jobCount = async () => (await jobs.uow.read.jobs.listRecent()).length;
      return { d, clock, jobs, deps: process(), process, jobCount };
    }

    test("cria com o próximo horário no fuso; dispara uma vez quando vence", async () => {
      const { deps, clock, jobCount } = await setup();
      const r = await createRoutine(deps, ana, DAILY);
      assert.equal(r.next_run_at, "2026-03-02T11:00:00.000Z");
      assert.deepEqual(r.upcoming.slice(0, 2), ["2026-03-02T11:00:00.000Z", "2026-03-03T11:00:00.000Z"]);
      assert.deepEqual(await tick(deps), { admitted: 0, retried: 0 }, "ainda não venceu");
      clock.set("2026-03-02T11:00:30.000Z");
      assert.deepEqual(await tick(deps), { admitted: 1, retried: 0 });
      assert.deepEqual(await tick(deps), { admitted: 0, retried: 0 }, "a mesma rodada de novo não duplica");
      const view = await viewRoutine(deps, r.id as RoutineId);
      assert.deepEqual([view.next_run_at, view.runs.length, view.runs[0]!.status, view.runs[0]!.job_status], ["2026-03-03T11:00:00.000Z", 1, "admitted", "queued"]);
      assert.equal(await jobCount(), 1);
    });

    test("reinício depois de três dias parado: um trabalho só, com os horários perdidos registrados", async () => {
      const { deps, process, clock, jobCount } = await setup();
      await createRoutine(deps, ana, DAILY);
      clock.set("2026-03-05T12:00:00.000Z"); // 02, 03, 04 e 05 às 08:00 venceram
      const restarted = process();
      assert.equal((await tick(restarted)).admitted, 1);
      const { routines } = await listRoutines(restarted);
      assert.deepEqual([routines[0]!.last_run!.slot, routines[0]!.last_run!.missed, routines[0]!.next_run_at], ["2026-03-05T11:00:00.000Z", 3, "2026-03-06T11:00:00.000Z"]);
      assert.equal((await tick(process())).admitted, 0, "outro reinício logo depois não repete");
      assert.equal(await jobCount(), 1);
    });

    test("queda entre disparar e avançar a agenda: a próxima rodada não duplica", async () => {
      const { d, deps, clock, jobCount } = await setup();
      const r = await createRoutine(deps, ana, DAILY);
      clock.set("2026-03-02T11:05:00.000Z");
      await tick(deps);
      // Simula que a agenda não chegou a avançar (a API caiu logo depois do disparo).
      await d.db.sql.run("UPDATE routines SET next_run_at = $1 WHERE id = $2", ["2026-03-02T11:00:00.000Z", r.id]);
      assert.equal((await tick(deps)).admitted, 0);
      assert.equal(await jobCount(), 1);
      assert.equal((await viewRoutine(deps, r.id as RoutineId)).next_run_at, "2026-03-03T11:00:00.000Z");
    });

    test("duas rodadas ao mesmo tempo disparam um trabalho só", async () => {
      const { deps, process, clock, jobCount } = await setup();
      await createRoutine(deps, ana, DAILY);
      clock.set("2026-03-02T11:01:00.000Z");
      await Promise.all([tick(deps), tick(process()), tick(process())]);
      assert.equal(await jobCount(), 1);
    });

    test("fila cheia: tenta de novo com espera e desiste na terceira recusa", async () => {
      const { deps, jobs, clock, jobCount } = await setup(1);
      const r = await createRoutine(deps, ana, DAILY);
      await admitJob(jobs, { request: { goal: "ocupando a única vaga" } });
      clock.set("2026-03-02T11:00:00.000Z");
      await tick(deps);
      let run = (await viewRoutine(deps, r.id as RoutineId)).runs[0]!;
      assert.deepEqual([run.status, run.attempts, run.next_attempt_at, run.job_id], ["retrying", 1, "2026-03-02T11:05:00.000Z", null]);
      clock.set("2026-03-02T11:05:00.000Z");
      await tick(deps);
      run = (await viewRoutine(deps, r.id as RoutineId)).runs[0]!;
      assert.deepEqual([run.status, run.attempts, run.next_attempt_at], ["retrying", 2, "2026-03-02T11:20:00.000Z"]);
      clock.set("2026-03-02T11:20:00.000Z");
      await tick(deps);
      run = (await viewRoutine(deps, r.id as RoutineId)).runs[0]!;
      assert.deepEqual([run.status, run.attempts, run.next_attempt_at], ["gave_up", 3, null]);
      assert.match(run.last_error!, /Fila cheia/);
      assert.equal(await jobCount(), 1, "só o trabalho que ocupava a fila");
    });

    test("recusa e depois vaga: a nova tentativa admite o trabalho do mesmo horário", async () => {
      const { deps, jobs, clock, jobCount } = await setup(1);
      const r = await createRoutine(deps, ana, DAILY);
      const blocker = (await admitJob(jobs, { request: { goal: "ocupando a única vaga" } })).job;
      clock.set("2026-03-02T11:00:00.000Z");
      await tick(deps);
      await jobs.uow.run(async (s) => {
        const entry = (await s.queue.next())!;
        await s.queue.remove(entry);
        await s.jobs.save({ ...(await s.jobs.get(blocker.id))!, status: "rejected" });
      });
      clock.set("2026-03-02T11:05:00.000Z");
      assert.deepEqual(await tick(deps), { admitted: 0, retried: 1 });
      const run = (await viewRoutine(deps, r.id as RoutineId)).runs[0]!;
      assert.deepEqual([run.status, run.attempts, run.slot, run.job_status], ["admitted", 2, "2026-03-02T11:00:00.000Z", "queued"]);
      assert.equal(await jobCount(), 2);
    });

    test("pausar não dispara; reativar conta a partir de agora, sem atrasados", async () => {
      const { deps, clock, jobCount } = await setup();
      const r = await createRoutine(deps, ana, DAILY);
      await changeRoutine(deps, ana, r.id as RoutineId, { enabled: false });
      clock.set("2026-03-04T12:00:00.000Z");
      assert.equal((await tick(deps)).admitted, 0);
      const back = await changeRoutine(deps, ana, r.id as RoutineId, { enabled: true });
      assert.equal(back.next_run_at, "2026-03-05T11:00:00.000Z");
      assert.equal((await tick(deps)).admitted, 0);
      assert.equal(await jobCount(), 0);
    });

    test("rodar agora fora da agenda; validações", async () => {
      const { deps, jobCount } = await setup();
      const r = await createRoutine(deps, ana, { ...DAILY, schedule: { kind: "interval", minutes: 60 } });
      const run = await runNow(deps, ana, r.id as RoutineId);
      assert.deepEqual([run.trigger, run.status], ["manual", "admitted"]);
      assert.equal(await jobCount(), 1);
      assert.equal(await code(createRoutine(deps, ana, { ...DAILY, name: "x" })), "invalid_name");
      assert.equal(await code(createRoutine(deps, ana, { ...DAILY, schedule: { kind: "interval", minutes: 1 } })), "invalid_schedule");
      assert.equal(await code(viewRoutine(deps, "00000000-0000-0000-0000-000000000000" as RoutineId)), "routine_not_found");
    });

    test("HTTP: criar, listar, rodar agora e arquivar", async () => {
      const { deps } = await setup();
      let woke = 0;
      const app = await createHttpApp({ origin: () => "http://127.0.0.1:1", actor: () => ana, modules: [routinesHttp(deps, { onJobOpened: () => void woke++ })] });
      opened.push({ close: () => app.close() });
      const call = (method: "GET" | "POST", url: string, payload?: object) => app.inject({ method, url, payload, headers: { host: "127.0.0.1:1" } });
      const created = await call("POST", "/api/routines", { ...DAILY, schedule: { kind: "daily", time: "08:00", weekdays: [1, 2, 3, 4, 5] } });
      assert.deepEqual([created.statusCode, created.json().schedule_label], [201, "Dias úteis às 08:00"]);
      const id = created.json().id;
      assert.equal((await call("POST", "/api/routines", { ...DAILY, schedule: { kind: "weekly" } })).json().code, "invalid_request");
      assert.equal((await call("POST", `/api/routines/${id}/run-now`)).statusCode, 202);
      assert.equal(woke, 1);
      assert.equal((await call("GET", "/api/routines")).json().time_zone, SP);
      assert.equal((await call("POST", `/api/routines/${id}/archive`)).statusCode, 200);
      assert.deepEqual((await call("GET", "/api/routines")).json().routines, []);
      assert.equal((await call("GET", `/api/routines/${id}`)).json().code, "routine_not_found");
    });
  });
}
