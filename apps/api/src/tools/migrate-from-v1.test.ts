// Migração v1 → v2: um banco da v1 montado com o esquema real dela, migrado para os dois dialetos,
// e os dados usados pelos casos de uso da v2 (aprovar, entregar, buscar, conversar).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { manualClock } from "../shared/clock.ts";
import { ActorId, type ConversationId, type JobId, type SourceId } from "../shared/ids.ts";
import { SqliteDatabase } from "../platform/database/sqlite.ts";
import { UnitOfWork } from "../platform/database/unit-of-work.ts";
import { dialects, fresh, type TestDatabase } from "../../test/support/databases.ts";
import { testPolicy } from "../../test/support/test-policy.ts";
import { approveJob } from "../modules/jobs/application/decide-job.ts";
import type { JobsDeps } from "../modules/jobs/application/deps.ts";
import { viewJob } from "../modules/jobs/application/job-view.ts";
import { queueLimits } from "../modules/jobs/application/queue-limits.ts";
import { claimNextJob } from "../modules/jobs/application/run-lifecycle.ts";
import { recordEffect } from "../modules/jobs/application/worker-reports.ts";
import { jobsStore } from "../modules/jobs/infrastructure/jobs-store.ts";
import { ExtractiveAnswerer } from "../modules/knowledge/application/answerers.ts";
import { askKnowledge } from "../modules/knowledge/application/ask.ts";
import { KnowledgeSearch } from "../modules/knowledge/application/knowledge-search.ts";
import { viewSource } from "../modules/knowledge/application/sources.ts";
import { Bm25Index } from "../modules/knowledge/infrastructure/bm25-index.ts";
import { knowledgeStore } from "../modules/knowledge/infrastructure/sql-knowledge.ts";
import { conversationStore } from "../modules/conversations/infrastructure/sql-conversations.ts";
import { migrateFromV1 } from "./migrate-from-v1.ts";

/** Esquema da v1 (SQLite), como `sqlite-journey-ledger.ts` cria, com as colunas da trilha idempotente. */
const V1_SCHEMA = `
CREATE TABLE jobs(id TEXT PRIMARY KEY,goal TEXT,status TEXT,plan TEXT,review TEXT,approval TEXT,receipt TEXT,error TEXT,created TEXT);
CREATE TABLE events(seq INTEGER PRIMARY KEY AUTOINCREMENT,job TEXT,at TEXT,node TEXT,detail TEXT,event_id TEXT,payload_sha TEXT,recorded_at TEXT);
CREATE TABLE effects(job TEXT PRIMARY KEY,hash TEXT NOT NULL,receipt TEXT NOT NULL);
CREATE TABLE pilot_reference_revocations(reference_version TEXT PRIMARY KEY);
CREATE TABLE job_queue(seq INTEGER PRIMARY KEY AUTOINCREMENT,job TEXT UNIQUE NOT NULL,kind TEXT NOT NULL,crash INTEGER NOT NULL,queued_at TEXT NOT NULL);
CREATE TABLE job_admissions(key TEXT PRIMARY KEY,job TEXT NOT NULL);
CREATE TABLE conversations(id TEXT PRIMARY KEY,actor TEXT NOT NULL,title TEXT NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL);
CREATE TABLE conversation_messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,conversation TEXT NOT NULL,role TEXT NOT NULL,text TEXT NOT NULL,job TEXT,client_id TEXT,reply_to INTEGER,created TEXT NOT NULL,UNIQUE(conversation,client_id));
CREATE TABLE knowledge_sources(id TEXT PRIMARY KEY,title TEXT NOT NULL,owner TEXT NOT NULL,readers TEXT NOT NULL,supersedes TEXT,created TEXT NOT NULL,revoked TEXT,revoked_by TEXT,latest_version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE knowledge_versions(source TEXT NOT NULL,version INTEGER NOT NULL,media_type TEXT NOT NULL,filename TEXT NOT NULL,content_sha TEXT NOT NULL,bytes BLOB NOT NULL,text TEXT NOT NULL,valid_from TEXT NOT NULL,uploaded_by TEXT NOT NULL,created TEXT NOT NULL,PRIMARY KEY(source,version));
CREATE TABLE inference_receipts(job TEXT NOT NULL,slot TEXT NOT NULL,input_sha TEXT NOT NULL,state TEXT NOT NULL,output TEXT,usage TEXT,created TEXT NOT NULL,updated TEXT NOT NULL,PRIMARY KEY(job,slot));
CREATE TABLE recovery_sessions(hash TEXT PRIMARY KEY,actor TEXT,auth_sha TEXT,expires INTEGER);`;

const T = "2026-02-01T10:00:00.000Z";
/** Hash da v1: `JSON.stringify` simples, sem ordenar as chaves. */
const v1Hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
function v1Review(job: string, summary: string) {
  const bound = { job, report: { summary, citations: [] }, payload: { operation: "deliver-report", recipient: "gestor", content: summary } };
  return { ...bound, hash: v1Hash(bound), requires_approval: true };
}

async function buildV1(dir: string) {
  const db = new SqliteDatabase(join(dir, "journey.sqlite"));
  await db.exec(V1_SCHEMA);
  const run = (sql: string, params: unknown[] = []) => db.sql.run(sql, params as never);
  const waiting = v1Review("job-aguardando", "Três cotações");
  const approved = v1Review("job-aprovado", "Seguir a política");
  const done = v1Review("job-concluido", "Entregue");
  const receipt = { id: "r1", job: "job-concluido", hash: done.hash, simulated: true };
  await run("INSERT INTO jobs VALUES ('job-aguardando','Analisar compras','awaiting_approval','{\"agents\":[\"compras\"]}',$1,NULL,NULL,NULL,$2)", [JSON.stringify(waiting), T]);
  await run("INSERT INTO jobs VALUES ('job-aprovado','Analisar contratos','queued','{\"agents\":[\"compras\"]}',$1,$2,NULL,NULL,$3)", [JSON.stringify(approved), approved.hash, T]);
  await run("INSERT INTO jobs VALUES ('job-concluido','Analisar estoque','completed',NULL,$1,$2,$3,NULL,$4)", [JSON.stringify(done), done.hash, JSON.stringify(receipt), T]);
  await run("INSERT INTO jobs VALUES ('job-criado','Pedido antigo','created',NULL,NULL,NULL,NULL,NULL,$1)", [T]);
  await run("INSERT INTO effects VALUES ('job-concluido',$1,$2)", [done.hash, JSON.stringify(receipt)]);
  await run("INSERT INTO job_queue (job, kind, crash, queued_at) VALUES ('job-aprovado','resume',0,$1)", [T]);
  await run("INSERT INTO job_admissions VALUES ('envio-0123456789abcdef','job-aguardando')");
  await run("INSERT INTO events (job, at, node, detail, event_id, payload_sha, recorded_at) VALUES ('job-aguardando',$1,'admission','{\"goal\":\"Analisar compras\"}','evt-0000000001','x',$1)", [T]);
  await run("INSERT INTO events (job, at, node, detail) VALUES ('knowledge:queries',$1,'knowledge_query','{\"actor\":\"ana\"}')", [T]);
  await run("INSERT INTO inference_receipts VALUES ('job-aguardando','plan','sha','completed','{\"agents\":[\"compras\"]}','{}',$1,$1)", [T]);
  const policy = "# Compras\n\nCompras acima de dez mil reais exigem três cotações.";
  await run("INSERT INTO knowledge_sources VALUES ('fonte-antiga','Compras 2025','ana','[\"*\"]',NULL,$1,NULL,NULL,1)", [T]);
  await run("INSERT INTO knowledge_sources VALUES ('fonte-nova','Compras 2026','ana','[\"*\"]','fonte-antiga',$1,NULL,NULL,1)", [T]);
  for (const id of ["fonte-antiga", "fonte-nova"])
    await run("INSERT INTO knowledge_versions VALUES ($1,1,'text/markdown','c.md','sha',$2,$3,$4,'ana',$4)", [id, new TextEncoder().encode(policy), policy, T]);
  await run("INSERT INTO conversations VALUES ('conv-1','operador-local','Compras',$1,$1)", [T]);
  await run("INSERT INTO conversation_messages (conversation, role, text, job, client_id, reply_to, created) VALUES ('conv-1','user','analise compras',NULL,'envio-000001',NULL,$1)", [T]);
  await run("INSERT INTO conversation_messages (conversation, role, text, job, client_id, reply_to, created) VALUES ('conv-1','chief','Abri.','job-aguardando',NULL,1,$1)", [T]);
  await run("INSERT INTO recovery_sessions VALUES ('h','ana','a',0)");
  return { db, waiting, approved, done };
}

const opened: { close(): Promise<void> }[] = [];
afterEach(async () => {
  for (const d of opened.splice(0)) await d.close();
});

for (const dialect of dialects) {
  describe(`migração v1 → v2 — destino ${dialect}`, () => {
    async function setup() {
      const dir = mkdtempSync(join(tmpdir(), "aurora-v1-"));
      const v1 = await buildV1(dir);
      opened.push({ close: async () => (await v1.db.close(), rmSync(dir, { recursive: true, force: true })) });
      const target: TestDatabase = await fresh(dialect);
      opened.push(target);
      const report = await migrateFromV1(v1.db, target.db, "2026-11-10T00:00:00.000Z");
      const clock = manualClock("2026-11-10T00:00:00.000Z");
      const jobs: JobsDeps = { uow: new UnitOfWork(target.db, jobsStore(clock)), policy: testPolicy, limits: queueLimits({ capacity: 8 }), clock, workers: { isActive: () => false, count: () => 0 } };
      return { v1, target, report, jobs, clock };
    }

    test("copia tudo, informa o que ficou de fora e recusa destino já usado", async () => {
      const { v1, target, report } = await setup();
      assert.deepEqual(report.copied, {
        jobs: 4,
        events: 2,
        effect_receipts: 1,
        job_queue: 1,
        admissions: 1,
        inference_receipts: 1,
        knowledge_sources: 2,
        knowledge_versions: 2,
        conversations: 1,
        conversation_messages: 2,
      });
      assert.equal(report.rehashed, 3);
      assert.deepEqual(report.skipped, { pilot_reference_revocations: 0, recovery_sessions: 1 });
      await assert.rejects(migrateFromV1(v1.db, target.db), /destino vazio/);
    });

    test("parecer aguardando: aprovar com o hash novo funciona; a troca fica na trilha", async () => {
      const { jobs, v1 } = await setup();
      const view = await viewJob(jobs, "job-aguardando" as JobId);
      assert.notEqual(view.review!.hash, v1.waiting.hash);
      const rehash = view.events.find((e) => e.kind === "migrated_review_rehashed")!;
      assert.deepEqual([(rehash.detail as { from: string }).from, (rehash.detail as { to: string }).to], [v1.waiting.hash, view.review!.hash]);
      assert.ok(view.events.some((e) => e.kind === "admission"), "eventos da v1 ficam no stream do trabalho");
      await approveJob(jobs, { jobId: "job-aguardando" as JobId, hash: view.review!.hash, actor: ActorId.parse("ana") });
      assert.equal((await viewJob(jobs, "job-aguardando" as JobId)).status, "queued");
    });

    test("aprovado na v1 e ainda não entregue: o efeito sai uma vez na v2", async () => {
      const { jobs } = await setup();
      const claim = await claimNextJob(jobs);
      assert.equal(claim.kind === "started" && claim.job.id, "job-aprovado");
      const job = (await jobs.uow.read.jobs.get("job-aprovado" as JobId))!;
      assert.equal(job.approval, job.review!.hash, "a aprovação acompanha o hash recalculado");
      const receipt = await recordEffect(jobs, job.id, job.review!.hash);
      assert.deepEqual(await recordEffect(jobs, job.id, job.review!.hash), receipt);
    });

    test("concluído na v1: recibo e efeito apontam para o hash novo; `created` vira interrompido", async () => {
      const { jobs } = await setup();
      const done = (await jobs.uow.read.jobs.get("job-concluido" as JobId))!;
      assert.equal((done.receipt as { hash: string }).hash, done.review!.hash);
      assert.equal((await jobs.uow.read.effects.get(done.id))!.hash, done.review!.hash);
      assert.equal((await jobs.uow.read.jobs.get("job-criado" as JobId))!.status, "interrupted");
    });

    test("Cérebro e conversas seguem utilizáveis; sequências continuam depois dos números copiados", async () => {
      const { target, clock } = await setup();
      const uow = new UnitOfWork(target.db, knowledgeStore(clock));
      const deps = { uow, clock, search: new KnowledgeSearch(uow, clock, (p) => new Bm25Index(p)), answerer: new ExtractiveAnswerer(), maxBytes: 1000 };
      const ana = ActorId.parse("ana");
      assert.equal((await viewSource(deps, ana, "fonte-antiga" as SourceId)).status, "superseded");
      const answer = await askKnowledge(deps, ana, "cotações para compras acima de dez mil");
      assert.deepEqual(answer.citations.map((c) => c.source), ["fonte-nova"]);
      const conversations = new UnitOfWork(target.db, conversationStore(clock));
      const conv = "conv-1" as ConversationId;
      assert.equal((await conversations.read.messages.list(conv)).length, 2);
      const next = await conversations.run((s) =>
        s.messages.add({ conversationId: conv, role: "user", text: "nova", jobId: null, clientId: null, replyTo: null, citations: null, attachments: null, createdAt: clock.now() }),
      );
      assert.equal(next.seq, 3);
    });
  });
}
