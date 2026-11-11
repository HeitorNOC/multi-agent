/**
 * Raiz de composição: monta banco, módulos, supervisor, agendador e HTTP a partir da `Config`.
 * É o único lugar que conhece as implementações concretas; o resto depende de interfaces.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Config, DatabaseConfig } from "./config.ts";
import type { ActorId } from "./shared/ids.ts";
import { systemClock, type Clock } from "./shared/clock.ts";
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
import { stationResponder } from "./modules/conversations/application/station.ts";
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
import { fileTextExtractor } from "./modules/knowledge/infrastructure/document-text.ts";
import { ImageReader } from "./modules/knowledge/infrastructure/image-reader.ts";
import { LocalEmbedder } from "./modules/knowledge/infrastructure/local-embedder.ts";
import { SemanticIndex } from "./modules/knowledge/application/semantic-index.ts";
import type { EmbeddingModel } from "./modules/knowledge/domain/embeddings.ts";
import { recoveryHttp } from "./modules/recovery/http/routes.ts";
import { acceptedMarkdown, deliveryFor, type DeliverablesDeps } from "./modules/deliverables/application/deliverables.ts";
import type { DeliverableId } from "./modules/deliverables/domain/deliverable.ts";
import type { IntegrationsDeps } from "./modules/integrations/application/integrations.ts";
import { integrationsHttp } from "./modules/integrations/http/routes.ts";
import { overviewHttp } from "./modules/overview/http/routes.ts";
import { LocalFolder } from "./modules/integrations/infrastructure/local-folder.ts";
import { integrationsStore } from "./modules/integrations/infrastructure/sql-connections.ts";
import { uploadSource } from "./modules/knowledge/application/sources.ts";
import { deliverablesHttp } from "./modules/deliverables/http/routes.ts";
import { deliverablesStore } from "./modules/deliverables/infrastructure/sql-deliverables.ts";
import { admitJob } from "./modules/jobs/application/admit-job.ts";
import { RoutineTicker } from "./modules/routines/application/routine-ticker.ts";
import type { RoutinesDeps } from "./modules/routines/application/routines.ts";
import { routinesHttp } from "./modules/routines/http/routes.ts";
import { routinesStore } from "./modules/routines/infrastructure/sql-routines.ts";
import { OpenWorkGateway } from "./modules/open-work/application/gateway.ts";
import { openWorkPolicy } from "./modules/open-work/application/open-policy.ts";
import { agentsHttp } from "./modules/agents/http/routes.ts";
import { teamDirectory, type AgentsDeps } from "./modules/agents/application/agents.ts";
import type { TemplateCatalog } from "./modules/agents/domain/template.ts";
import { agentsStore } from "./modules/agents/infrastructure/sql-agents.ts";
import type { HttpModule } from "./platform/http/app.ts";
import { openWorkHttp } from "./modules/open-work/http/routes.ts";
import type { AccountsDeps } from "./modules/accounts/application/accounts.ts";
import { LOCAL_OPERATOR } from "./modules/accounts/domain/account.ts";
import { accountsHttp, localAccessHttp, sessionIdentity } from "./modules/accounts/http/routes.ts";
import { GoogleOidc, MicrosoftOidc } from "./modules/accounts/infrastructure/oidc.ts";
import { accountsStore } from "./modules/accounts/infrastructure/sql-accounts.ts";

export interface ServerParts {
  /** Especialistas do trabalho aberto. */
  /** Personas prontas do catálogo de agentes. */
  templates: TemplateCatalog;
  /** Cliente do modelo; `null` sem modelo configurado. */
  model: ModelClient | null;
  /** Troca a política de trabalho (testes); padrão: trabalho aberto. */
  policy?: WorkPolicy;
  /** Troca o modelo de embeddings (testes); `null` desliga a busca por significado. */
  embedder?: EmbeddingModel | null;
  /** Troca o `fetch` dos logins Google/Microsoft (testes). */
  oauthFetch?: typeof fetch;
  clock?: Clock;
}

export interface RunningServer {
  url: string;
  close(): Promise<void>;
}

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
  // Busca por palavras sempre; por significado quando há modelo de embeddings.
  const embedder = parts.embedder !== undefined ? parts.embedder : config.embeddings.mode === "local" ? new LocalEmbedder({ model: config.embeddings.model, cacheDir: config.embeddings.modelsDir }) : null;
  const semantic = embedder ? new SemanticIndex({ model: embedder, uow: knowledgeUow, clock }) : undefined;
  const search = new KnowledgeSearch(knowledgeUow, clock, (passages) => new Bm25Index(passages), {
    semantic,
    minSimilarity: config.embeddings.minSimilarity,
    minGap: config.embeddings.minGap,
  });
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
    // As áreas do Cérebro são as mesmas do catálogo de agentes (mais "Geral").
    areas: parts.templates.areas,
    // Imagens são lidas pelo modelo com visão (uma vez, no envio); sem modelo, são recusadas.
    extract: fileTextExtractor(parts.model ? new ImageReader({ client: parts.model, limiter, timeoutMs: config.model.timeoutMs }) : null),
  };

  // Empresa e time: o Chief of Staff só escala quem foi contratado.
  const agentsUow = new UnitOfWork(db, agentsStore(clock));
  const agents: AgentsDeps = {
    uow: agentsUow,
    catalog: parts.templates,
    clock,
    countSources: async () => (await knowledgeUow.read.sources.list()).filter((s) => !s.revokedAt).length,
  };
  const team = teamDirectory(agentsUow, parts.templates);

  // Entregas: o efeito aprovado de cada trabalho vira uma entrega (ou a próxima versão dela).
  const deliverablesUow = new UnitOfWork(db, deliverablesStore(clock));

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
    policy: parts.policy ?? openWorkPolicy(team),
    limits: queueLimits(config.queue),
    clock,
    workers: supervisor,
    delivery: deliveryFor(deliverablesUow, clock),
  };
  const deliverables: DeliverablesDeps = {
    uow: deliverablesUow,
    clock,
    reopen: async (goal, onAdmitted) => (await admitJob(jobs, { request: { goal }, onAdmitted: (job, tx) => onAdmitted(job.id, tx) })).job.id,
  };
  const scheduler = new JobScheduler(jobs, supervisor);

  // Rotinas: pedidos recorrentes; cada horário vira no máximo um trabalho, mesmo após reiniciar.
  const routines: RoutinesDeps = {
    uow: new UnitOfWork(db, routinesStore(clock)),
    clock,
    timeZone: config.timeZone,
    admit: async (goal, onAdmitted) => (await admitJob(jobs, { request: { goal }, onAdmitted: (job, tx) => onAdmitted(job.id, tx) })).job.id,
    jobStatus: async (jobId) => (await jobs.uow.read.jobs.get(jobId))?.status,
  };
  const ticker = new RoutineTicker(routines, () => void scheduler.wake());

  // Integrações: o conector de pasta local lê para o Cérebro e grava entregas aceitas.
  const integrations: IntegrationsDeps = {
    uow: new UnitOfWork(db, integrationsStore(clock)),
    clock,
    folder: new LocalFolder({
      forbidden: config.database.dialect === "sqlite" ? [dirname(config.database.path)] : [],
      maxBytes: config.knowledge.maxBytes,
    }),
    importToKnowledge: async (actor, file) => {
      const source = await uploadSource(knowledge, actor, file);
      return { id: source.id, title: source.title };
    },
    acceptedDeliverable: (id, version) => acceptedMarkdown(deliverables, id as DeliverableId, version),
  };
  await reconcileOnRestart(jobs);

  // Trabalho aberto
  const gateway = new OpenWorkGateway({ jobs, search, client: parts.model, limiter, team, clock, timeoutMs: config.model.timeoutMs });

  // Conversa
  const rules = new RuleBasedChiefOfStaff();
  const conversations = {
    uow: new UnitOfWork(db, conversationStore(clock)),
    chief: config.chief.engine === "model" && parts.model ? new ModelChiefOfStaff({ client: parts.model, fallback: rules, limiter }) : rules,
    offers: [OPEN_WORK_OFFER],
    jobs: jobOpener(jobs),
    clock,
    station: stationResponder({ team, search, answerer: knowledge.answerer }),
    // Anexo da conversa vira fonte do Cérebro (imagem lida pelo modelo, documento extraído).
    attach: async (actor: ActorId, file: { filename: string; mediaType: string; contentBase64: string }) => {
      const source = await uploadSource(knowledge, actor, { ...file, title: file.filename.replace(/\.[^.]+$/, "") || file.filename });
      return { source: source.id, title: source.title };
    },
  };

  // Acesso: contas (senha, Google, Microsoft) ou, no uso individual, o operador local.
  const accounts: AccountsDeps = {
    uow: new UnitOfWork(db, accountsStore(clock)),
    clock,
    providers: {
      google: config.auth.google && new GoogleOidc(config.auth.google, { fetch: parts.oauthFetch }),
      microsoft: config.auth.microsoft && new MicrosoftOidc(config.auth.microsoft, { fetch: parts.oauthFetch }),
    },
    async adoptLocalOperator(to, tx) {
      await knowledgeUow.join(tx).sources.transferActor(LOCAL_OPERATOR, to);
      await conversations.uow.join(tx).conversations.transferActor(LOCAL_OPERATOR, to);
    },
    afterAdoption: () => search.invalidate(),
  };
  const local = config.auth.mode === "local";

  const app = await createHttpApp({
    origin: () => url,
    identify: local ? () => LOCAL_OPERATOR : sessionIdentity(accounts),
    modules: [
      local ? localAccessHttp() : accountsHttp(accounts),
      jobsHttp({ jobs, wake: () => void scheduler.wake(), workerAccess: supervisor }),
      knowledgeHttp(knowledge, { uploadLimit: uploadLimit(config.knowledge.maxBytes) }),
      openWorkHttp(gateway, supervisor),
      conversationsHttp(conversations, { onJobOpened: () => void scheduler.wake(), messageLimit: uploadLimit(config.knowledge.maxBytes) * 4 }),
      recoveryHttp(jobs, { wake: () => void scheduler.wake() }),
      agentsHttp(agents),
      deliverablesHttp(deliverables, { onJobOpened: () => void scheduler.wake() }),
      routinesHttp(routines, { onJobOpened: () => void scheduler.wake() }),
      integrationsHttp(integrations),
      overviewHttp({ sql: db.sql, clock, timeZone: config.timeZone }),
      settingsHttp(config, parts.model !== null, embedder?.id ?? null),
      ...(config.webDir ? [staticWeb(config.webDir)] : []),
    ],
  });
  await app.listen({ host: "127.0.0.1", port: config.port });
  const address = app.server.address();
  url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : config.port}`;

  // Prepara o índice (e vetoriza o que faltar) sem atrasar a subida.
  if (semantic) {
    semantic.warm();
    void search.semanticStatus().catch(() => undefined);
  }

  // Sem comando de worker, os pedidos ficam na fila até a API ser iniciada com um.
  ticker.start();
  if (config.worker.command) scheduler.start();
  else console.warn("AURORA_WORKER_COMMAND não definido: trabalhos ficarão na fila.");

  return {
    url,
    async close() {
      scheduler.stop();
      await ticker.stop();
      supervisor.stopAll();
      await app.close();
      await db.close();
    },
  };
}

/** Configuração em vigor, só leitura e sem segredos (a tela de Configurações mostra). */
function settingsHttp(config: Config, modelReady: boolean, embeddingModel: string | null): HttpModule {
  return (app) => {
    app.get("/api/settings", async () => ({
      model: { provider: config.model.provider, name: config.model.name ?? null, ready: modelReady },
      chief_engine: config.chief.engine,
      knowledge_answerer: config.knowledge.answerer,
      knowledge_max_bytes: config.knowledge.maxBytes,
      embeddings: { mode: config.embeddings.mode, model: embeddingModel },
      database: config.database.dialect,
      worker: { configured: !!config.worker.command, checkpoints: !!config.worker.checkpointDsn },
      queue: config.queue,
      time_zone: config.timeZone,
      auth: { mode: config.auth.mode, google: !!config.auth.google, microsoft: !!config.auth.microsoft },
    }));
  };
}

async function openDatabase(config: DatabaseConfig): Promise<Database> {
  if (config.dialect === "postgres")
    return PostgresDatabase.connect({ connectionString: config.url, schema: config.schema, lockName: "aurora" });
  mkdirSync(dirname(config.path), { recursive: true });
  return new SqliteDatabase(config.path);
}
