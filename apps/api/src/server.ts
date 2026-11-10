/**
 * Raiz de composição: monta banco, módulos, supervisor, agendador e HTTP a partir da `Config`.
 * É o único lugar que conhece as implementações concretas; o resto depende de interfaces.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Config, DatabaseConfig } from "./config.ts";
import { systemClock, type Clock } from "./shared/clock.ts";
import { ActorId } from "./shared/ids.ts";
import type { Database } from "./platform/database/database.ts";
import { migrate } from "./platform/database/migrate.ts";
import { PostgresDatabase } from "./platform/database/postgres.ts";
import { SqliteDatabase } from "./platform/database/sqlite.ts";
import { UnitOfWork } from "./platform/database/unit-of-work.ts";
import { createHttpApp } from "./platform/http/app.ts";
import { WorkerSupervisor } from "./platform/workers/supervisor.ts";
import type { JobsDeps } from "./modules/jobs/application/deps.ts";
import type { WorkPolicy } from "./modules/jobs/application/policy.ts";
import { queueLimits } from "./modules/jobs/application/queue-limits.ts";
import { finishRun, reconcileOnRestart } from "./modules/jobs/application/run-lifecycle.ts";
import { JobScheduler } from "./modules/jobs/application/scheduler.ts";
import { jobsHttp } from "./modules/jobs/http/routes.ts";
import { jobsStore } from "./modules/jobs/infrastructure/jobs-store.ts";

export interface ServerParts {
  policy: WorkPolicy;
  clock?: Clock;
  /** Configuração extra entregue a cada worker. */
  workerConfig?: ConstructorParameters<typeof WorkerSupervisor>[0]["workerConfig"];
}

export interface RunningServer {
  url: string;
  close(): Promise<void>;
}

const LOCAL_OPERATOR = ActorId.parse("operador-local");

export async function startServer(config: Config, parts: ServerParts): Promise<RunningServer> {
  const clock = parts.clock ?? systemClock;
  const db = await openDatabase(config.database);
  await migrate(db, clock.now());

  let url = "";
  let jobs!: JobsDeps;
  const supervisor = new WorkerSupervisor({
    command: config.worker.command ?? [],
    cwd: config.worker.cwd,
    workerConfig: parts.workerConfig,
    apiUrl: () => url,
    token: randomBytes(32).toString("hex"),
    async onExit(jobId, result) {
      await finishRun(jobs, jobId, result).catch((error) => console.error("finishRun", jobId, error));
      void scheduler.wake();
    },
  });
  jobs = {
    uow: new UnitOfWork(db, jobsStore(clock)),
    policy: parts.policy,
    limits: queueLimits(config.queue),
    clock,
    workers: supervisor,
  };
  const scheduler = new JobScheduler(jobs, supervisor);
  await reconcileOnRestart(jobs);

  const app = await createHttpApp({
    origin: () => url,
    actor: () => LOCAL_OPERATOR,
    modules: [jobsHttp({ jobs, wake: () => void scheduler.wake(), workerAccess: supervisor })],
  });
  await app.listen({ host: "127.0.0.1", port: config.port });
  const address = app.server.address();
  url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : config.port}`;

  // Sem comando de worker, os pedidos ficam na fila até a API ser iniciada com um.
  if (config.worker.command) scheduler.start();
  else console.warn("AURORA_WORKER_COMMAND não definido: trabalhos ficarão na fila.");

  return {
    url,
    async close() {
      scheduler.stop();
      supervisor.stopAll();
      await app.close();
      await db.close();
    },
  };
}

async function openDatabase(config: DatabaseConfig): Promise<Database> {
  if (config.dialect === "postgres")
    return PostgresDatabase.connect({ connectionString: config.url, schema: config.schema, lockName: "aurora" });
  mkdirSync(dirname(config.path), { recursive: true });
  return new SqliteDatabase(config.path);
}
