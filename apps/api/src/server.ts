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
import { staticWeb } from "./platform/http/static-web.ts";
import { CallLimiter } from "./platform/model/call-limiter.ts";
import type { ModelClient } from "./platform/model/model-client.ts";
import { WorkerSupervisor } from "./platform/workers/supervisor.ts";
import { conversationsHttp } from "./modules/conversations/http/routes.ts";
import { jobOpener } from "./modules/conversations/application/job-opener.ts";
import { ModelChiefOfStaff } from "./modules/conversations/application/model-chief-of-staff.ts";
import { RuleBasedChiefOfStaff } from "./modules/conversations/domain/chief-of-staff.ts";
import { conversationStore } from "./modules/conversations/infrastructure/sql-conversations.ts";
import type { JobsDeps } from "./modules/jobs/application/deps.ts";
import type { WorkPolicy } from "./modules/jobs/application/policy.ts";
import { queueLimits } from "./modules/jobs/application/queue-limits.ts";
import { finishRun, reconcileOnRestart } from "./modules/jobs/application/run-lifecycle.ts";
import { JobScheduler } from "./modules/jobs/application/scheduler.ts";
import { jobsHttp } from "./modules/jobs/http/routes.ts";
import { jobsStore } from "./modules/jobs/infrastructure/jobs-store.ts";
import { ExtractiveAnswerer, ModelAnswerer } from "./modules/knowledge/application/answerers.ts";
import { KnowledgeSearch } from "./modules/knowledge/application/knowledge-search.ts";
import type { KnowledgeDeps } from "./modules/knowledge/application/sources.ts";
import { knowledgeHttp } from "./modules/knowledge/http/routes.ts";
import { Bm25Index } from "./modules/knowledge/infrastructure/bm25-index.ts";
import { knowledgeStore } from "./modules/knowledge/infrastructure/sql-knowledge.ts";
import { recoveryHttp } from "./modules/recovery/http/routes.ts";
import { OpenWorkGateway } from "./modules/open-work/application/gateway.ts";
import { openWorkPolicy } from "./modules/open-work/application/open-policy.ts";
import type { CatalogAgent } from "./modules/open-work/domain/catalog.ts";
import { openWorkHttp } from "./modules/open-work/http/routes.ts";

export interface ServerParts {
  /** Especialistas do trabalho aberto. */
  catalog: readonly CatalogAgent[];
  /** Cliente do modelo; `null` sem modelo configurado. */
  model: ModelClient | null;
  /** Troca a política de trabalho (testes); padrão: trabalho aberto. */
  policy?: WorkPolicy;
  clock?: Clock;
}

export interface RunningServer {
  url: string;
  close(): Promise<void>;
}

const LOCAL_OPERATOR = ActorId.parse("operador-local");
/** No trabalho aberto, a conversa abre um único tipo de trabalho: o pedido é o texto do gestor. */
const OPEN_WORK_OFFER = { id: "open", title: "Trabalho com os especialistas", keywords: [] };
/** Corpo das rotas de envio do Cérebro: o arquivo em base64 (≈ 4/3 do tamanho) e os campos. */
const uploadLimit = (maxBytes: number) => Math.ceil(maxBytes * 1.4) + 10_000;

export async function startServer(config: Config, parts: ServerParts): Promise<RunningServer> {
  const clock = parts.clock ?? systemClock;
  const db = await openDatabase(config.database);
  await migrate(db, clock.now());
  // Uma chamada ao modelo por vez: a cota é da conta do usuário.
  const limiter = new CallLimiter(1, 4);

  // Cérebro
  const knowledgeUow = new UnitOfWork(db, knowledgeStore(clock));
  const search = new KnowledgeSearch(knowledgeUow, clock, (passages) => new Bm25Index(passages));
  const extractive = new ExtractiveAnswerer();
  const knowledge: KnowledgeDeps = {
    uow: knowledgeUow,
    clock,
    search,
    answerer:
      config.knowledge.answerer === "model" && parts.model
        ? new ModelAnswerer({ client: parts.model, fallback: extractive, limiter, now: () => clock.now() })
        : extractive,
    maxBytes: config.knowledge.maxBytes,
  };

  // Trabalhos
  let url = "";
  let jobs!: JobsDeps;
  const supervisor = new WorkerSupervisor({
    command: config.worker.command ?? [],
    cwd: config.worker.cwd,
    workerConfig: config.worker.checkpointDsn ? { dsn: config.worker.checkpointDsn } : undefined,
    apiUrl: () => url,
    token: randomBytes(32).toString("hex"),
    async onExit(jobId, result) {
      await finishRun(jobs, jobId, result).catch((error) => console.error("finishRun", jobId, error));
      void scheduler.wake();
    },
  });
  jobs = {
    uow: new UnitOfWork(db, jobsStore(clock)),
    policy: parts.policy ?? openWorkPolicy(parts.catalog),
    limits: queueLimits(config.queue),
    clock,
    workers: supervisor,
  };
  const scheduler = new JobScheduler(jobs, supervisor);
  await reconcileOnRestart(jobs);

  // Trabalho aberto
  const gateway = new OpenWorkGateway({ jobs, search, client: parts.model, limiter, catalog: parts.catalog, clock, timeoutMs: config.model.timeoutMs });

  // Conversa
  const rules = new RuleBasedChiefOfStaff();
  const conversations = {
    uow: new UnitOfWork(db, conversationStore(clock)),
    chief: config.chief.engine === "model" && parts.model ? new ModelChiefOfStaff({ client: parts.model, fallback: rules, limiter }) : rules,
    offers: [OPEN_WORK_OFFER],
    jobs: jobOpener(jobs),
    clock,
  };

  const app = await createHttpApp({
    origin: () => url,
    actor: () => LOCAL_OPERATOR,
    modules: [
      jobsHttp({ jobs, wake: () => void scheduler.wake(), workerAccess: supervisor }),
      knowledgeHttp(knowledge, { uploadLimit: uploadLimit(config.knowledge.maxBytes) }),
      openWorkHttp(gateway, supervisor),
      conversationsHttp(conversations, { onJobOpened: () => void scheduler.wake() }),
      recoveryHttp(jobs, { wake: () => void scheduler.wake() }),
      ...(config.webDir ? [staticWeb(config.webDir)] : []),
    ],
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
