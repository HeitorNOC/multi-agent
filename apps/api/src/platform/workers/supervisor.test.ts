// Supervisor e agendador com um worker falso (um script Node), sem modelo e sem HTTP.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { manualClock } from "../../shared/clock.ts";
import type { JobId } from "../../shared/ids.ts";
import { UnitOfWork } from "../database/unit-of-work.ts";
import { fresh, type TestDatabase } from "../../../test/support/databases.ts";
import { testPolicy } from "../../../test/support/test-policy.ts";
import { jobsStore } from "../../modules/jobs/infrastructure/jobs-store.ts";
import { admitJob } from "../../modules/jobs/application/admit-job.ts";
import type { JobsDeps } from "../../modules/jobs/application/deps.ts";
import { queueLimits } from "../../modules/jobs/application/queue-limits.ts";
import { finishRun, type RunResult } from "../../modules/jobs/application/run-lifecycle.ts";
import { JobScheduler } from "../../modules/jobs/application/scheduler.ts";
import { WorkerSupervisor } from "./supervisor.ts";

const opened: TestDatabase[] = [];
afterEach(async () => {
  for (const d of opened.splice(0)) await d.close();
});

/** Worker falso: lê a configuração, ecoa o que recebeu e sai com o código pedido no objetivo. */
const FAKE_WORKER = `
let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  const config = JSON.parse(input);
  console.log(JSON.stringify({ received: config }));
  const exit = Number(config.goal.split(" ").at(-1));
  console.log(JSON.stringify({ completed: false }));
  process.exit(exit);
});`;

async function setup(maxWorkers = 1) {
  const d = await fresh("sqlite");
  opened.push(d);
  const clock = manualClock("2026-03-01T10:00:00.000Z");
  const exits: { jobId: JobId; result: RunResult }[] = [];
  const settled: (() => void)[] = [];
  const supervisor = new WorkerSupervisor({
    command: [process.execPath, "-e", FAKE_WORKER],
    apiUrl: () => "http://127.0.0.1:1",
    token: "segredo",
    async onExit(jobId, result) {
      exits.push({ jobId, result });
      await finishRun(deps, jobId, result);
      settled.shift()?.();
    },
  });
  const deps: JobsDeps = {
    uow: new UnitOfWork(d.db, jobsStore(clock)),
    policy: testPolicy,
    limits: queueLimits({ capacity: 8, resumeReserve: 0, maxWorkers }),
    clock,
    workers: supervisor,
  };
  const nextExit = () => new Promise<void>((resolve) => settled.push(resolve));
  return { deps, supervisor, exits, nextExit, scheduler: new JobScheduler(deps, supervisor) };
}

test("agendador inicia o worker; o fim do processo decide o estado sem presumir sucesso", async () => {
  const { deps, supervisor, exits, nextExit, scheduler } = await setup();
  const { job } = await admitJob(deps, { request: { goal: "pedido saida 0" } });
  const exited = nextExit();
  await scheduler.wake();
  assert.equal(supervisor.isActive(job.id), true);
  await exited;
  assert.equal(supervisor.isActive(job.id), false);
  assert.deepEqual(exits[0]!.result, { exitCode: 0, declared: { completed: false }, spawnFailed: false });
  assert.equal((await deps.uow.read.jobs.get(job.id))!.status, "failed", "saída 0 sem parecer não é sucesso");
});

test("respeita o limite de workers e segue a fila quando um termina", async () => {
  const { deps, supervisor, nextExit, scheduler } = await setup(1);
  const a = (await admitJob(deps, { request: { goal: "pedido a 1" } })).job;
  const b = (await admitJob(deps, { request: { goal: "pedido b 1" } })).job;
  const first = nextExit();
  await scheduler.wake();
  assert.deepEqual([supervisor.isActive(a.id), supervisor.isActive(b.id)], [true, false]);
  await first;
  const second = nextExit();
  await scheduler.wake();
  assert.equal(supervisor.isActive(b.id), true);
  await second;
  const statuses = await Promise.all([a, b].map(async (j) => (await deps.uow.read.jobs.get(j.id))!.status));
  assert.deepEqual(statuses, ["failed", "failed"]);
});

test("concessão: só a atual vale, e some quando o processo termina", async () => {
  const { deps, supervisor, nextExit, scheduler } = await setup();
  const { job } = await admitJob(deps, { request: { goal: "pedido saida 0" } });
  const exited = nextExit();
  await scheduler.wake();
  assert.equal(supervisor.holdsLease(job.id, "falsa"), false);
  assert.equal(supervisor.holdsLease(job.id, undefined), false);
  await exited;
  assert.equal(supervisor.holdsLease(job.id, "qualquer"), false);
});

test("falha ao iniciar o processo vira falha do trabalho", async () => {
  const d = await fresh("sqlite");
  opened.push(d);
  const clock = manualClock("2026-03-01T10:00:00.000Z");
  let deps!: JobsDeps;
  let resolveExit!: () => void;
  const exited = new Promise<void>((r) => (resolveExit = r));
  const supervisor = new WorkerSupervisor({
    command: ["executavel-que-nao-existe-aurora"],
    apiUrl: () => "",
    token: "t",
    async onExit(jobId, result) {
      await finishRun(deps, jobId, result);
      resolveExit();
    },
  });
  deps = {
    uow: new UnitOfWork(d.db, jobsStore(clock)),
    policy: testPolicy,
    limits: queueLimits({ capacity: 8, resumeReserve: 0, maxWorkers: 1 }),
    clock,
    workers: supervisor,
  };
  const { job } = await admitJob(deps, { request: { goal: "pedido x" } });
  await new JobScheduler(deps, supervisor).wake();
  await exited;
  const after = (await deps.uow.read.jobs.get(job.id))!;
  assert.equal(after.status, "failed");
});
