// Testes da migração SQLite → PostgreSQL. Precisam de AURORA_TEST_POSTGRES_URL; sem ela, são ignorados.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import pg from "pg";
import { PostgresJourneyLedger } from "./postgres-journey-ledger.ts";
import { MigrationError, migrateSqliteToPostgres } from "./sqlite-to-postgres.ts";
import { SqliteJourneyLedger } from "./sqlite-journey-ledger.ts";

const url = process.env.AURORA_TEST_POSTGRES_URL;
const INSTALLATION = "migracao";

describe("migração SQLite → PostgreSQL", { skip: url ? false : "defina AURORA_TEST_POSTGRES_URL" }, () => {
  const dirs: string[] = [];
  const schemas: string[] = [];
  const newDir = () => {
    const d = mkdtempSync(join(tmpdir(), "aurora-migracao-"));
    dirs.push(d);
    return d;
  };
  const newSchema = () => {
    const s = "m_" + randomBytes(6).toString("hex");
    schemas.push(s);
    return s;
  };
  const migrate = (stateDir: string, schema: string, dryRun = false) =>
    migrateSqliteToPostgres({ stateDir, connectionString: url!, schema, installation: INSTALLATION, dryRun });
  const openTarget = (schema: string) =>
    PostgresJourneyLedger.open({ connectionString: url!, schema, installation: INSTALLATION, destinationJournal: true, schedulerLock: false });

  after(async () => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    const admin = new pg.Pool({ connectionString: url, max: 1 });
    for (const s of schemas) await admin.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
    await admin.end();
  });

  /** Uma instalação com dados de todas as áreas, gerada pelo adaptador SQLite real. */
  async function populatedSource() {
    const stateDir = newDir();
    const l = new SqliteJourneyLedger({ stateDir, installation: INSTALLATION, destinationJournal: true, schedulerLock: false });
    const created = "2026-02-01T10:00:00.000Z"; // mesmo instante: testa o desempate por inserção
    for (const id of ["j1", "j2", "j3"]) await l.insertJob({ id, goal: "meta", status: "created", created });
    await l.updateJob("j1", { status: "completed", plan: '{"p":1}', review: '{"hash":"h"}', approval: "h", receipt: '{"r":1}' });
    await l.updateJob("j2", { status: "queued" });
    await l.appendEvent("j1", "plan", { a: 1, telemetry: { occurred_at: "2026-02-01T09:00:00.000Z", span_id: "span-1" } });
    await l.appendEvent("j1", "review_ready", { hash: "h" });
    await l.appendEvent("j2", "admission", { goal: "meta" });
    await l.enqueue({ job: "j2", kind: "new", crash: false, queuedAt: created });
    await l.enqueue({ job: "j3", kind: "resume", crash: true, queuedAt: created });
    await l.recordAdmission("chave-0123456789ab", "j2");
    await l.recordEffect("j1", "h", '{"r":1}');
    await l.revokeReference('["emissor","campo","fonte",1]');
    await l.revokeDestinationScope("escopo-1");
    await l.acknowledgeDestinationRevocation("escopo-1");
    await l.revokeDestinationScope("escopo-2");
    await l.recordDestinationIntent("j1", '{"id":"i"}');
    await l.createRecoverySession({ hash: "h".repeat(64), actor: "rev-1", authSha: "a".repeat(64), expires: 1893456000000 });
    await l.insertRecoveryCommand({
      id: "11111111-1111-1111-1111-111111111111", actor: "rev-1", inputSha: "i".repeat(64), body: '{"x":1}', action: "recovery_propose",
      caseId: "caso-0001", operationId: `${INSTALLATION}:op-1`, evidenceSha: "e".repeat(64), status: "completed", result: '{"ok":1}', updated: created,
    });
    await l.createConversation({ id: "conv-1", actor: "ana", title: "Comercial", created });
    const question = await l.appendConversationMessage({ conversation: "conv-1", role: "user", text: "analise as vendas", clientId: "envio-000001", created });
    await l.appendConversationMessage({ conversation: "conv-1", role: "chief", text: "Abri um trabalho.", job: "j2", replyTo: question.seq, created });
    await l.createKnowledgeSource({ id: "fonte-1", title: "Política", owner: "ana", readers: ["*"], supersedes: null, created });
    const versions: [number, Uint8Array][] = [
      [1, new Uint8Array([0, 255, 10, 13, 128])],
      [2, new TextEncoder().encode("texto v2")],
    ];
    for (const [version, bytes] of versions)
      await l.addKnowledgeVersion({
        source: "fonte-1", version, mediaType: "text/plain", filename: `v${version}.txt`, contentSha: "c".repeat(64),
        bytes, text: `texto v${version}`, validFrom: created, uploadedBy: "ana", created,
      });
    await l.revokeKnowledgeSource("fonte-1", "ana", created);
    await l.close();
    return stateDir;
  }

  test("copia todas as áreas fielmente e a ordem, as sequências e as buscas continuam corretas", async () => {
    const stateDir = await populatedSource();
    const schema = newSchema();
    const report = await migrate(stateDir, schema);
    assert.equal(report.dryRun, false);
    assert.equal(report.jobOrderVerified, true);
    assert.deepEqual(
      Object.fromEntries(report.tables.map((t) => [t.table, t.rows])),
      { jobs: 3, events: 3, effects: 1, pilot_reference_revocations: 1, job_queue: 2, job_admissions: 1, pilot_destination_revocations: 2, pilot_destination_intents: 1, conversations: 1, conversation_messages: 2, knowledge_sources: 1, knowledge_versions: 2, inference_receipts: 0, recovery_sessions: 1, recovery_commands: 1 },
    );

    const source = new SqliteJourneyLedger({ stateDir, installation: INSTALLATION, destinationJournal: true, schedulerLock: false });
    const target = await openTarget(schema);
    try {
      assert.deepEqual(await target.listJobIds(), await source.listJobIds());
      assert.deepEqual(await target.getJob("j1"), await source.getJob("j1"));
      for (const id of ["j1", "j2"]) assert.deepEqual(await target.listEvents(id), await source.listEvents(id));
      assert.deepEqual(await target.trace("j1"), await source.trace("j1"));
      assert.deepEqual(await target.peekQueue(), await source.peekQueue());
      assert.equal(await target.findAdmittedJob("chave-0123456789ab"), "j2");
      assert.deepEqual(await target.getEffect("j1"), await source.getEffect("j1"));
      assert.equal(await target.isReferenceRevoked('["emissor","campo","fonte",1]'), true);
      assert.equal(await target.isDestinationRevocationAcknowledged("escopo-1"), true);
      assert.equal(await target.isDestinationRevocationAcknowledged("escopo-2"), false);
      assert.equal(await target.getDestinationIntent("j1"), '{"id":"i"}');
      assert.deepEqual(await target.findRecoverySession("h".repeat(64)), await source.findRecoverySession("h".repeat(64)));
      assert.deepEqual(
        await target.getRecoveryCommand("11111111-1111-1111-1111-111111111111"),
        await source.getRecoveryCommand("11111111-1111-1111-1111-111111111111"),
      );
      assert.deepEqual(await target.listConversationsForActor("ana"), await source.listConversationsForActor("ana"));
      assert.deepEqual(await target.listConversationMessages("conv-1"), await source.listConversationMessages("conv-1"));
      assert.deepEqual(await target.getKnowledgeSource("fonte-1"), await source.getKnowledgeSource("fonte-1"));
      for (const version of [1, 2])
        assert.deepEqual(
          [...(await target.getKnowledgeVersion("fonte-1", version))!.bytes],
          [...(await source.getKnowledgeVersion("fonte-1", version))!.bytes],
          `bytes da versão ${version} chegam idênticos, inclusive não UTF-8`,
        );
      // As sequências continuam depois do maior valor copiado.
      const next = await target.enqueue({ job: "j1", kind: "new", crash: false, queuedAt: "2026-02-02T00:00:00.000Z" });
      assert.equal(next.seq, 3);
      const appended = await target.appendEvent("j1", "novo", {});
      const events = await target.listEvents("j1");
      assert.equal(events.at(-1)?.seq, 4, `evento novo deve ter seq 4, teve ${events.at(-1)?.seq}`);
      assert.equal(appended.replayed, false);
      const nextMessage = await target.appendConversationMessage({ conversation: "conv-1", role: "user", text: "e agora?", created: "2026-02-02T00:00:00.000Z" });
      assert.equal(nextMessage.seq, 3);
    } finally {
      await source.close();
      await target.close();
    }
  });

  test("a simulação (dry-run) verifica tudo e não grava nada; depois a migração real funciona", async () => {
    const stateDir = await populatedSource();
    const schema = newSchema();
    const dry = await migrate(stateDir, schema, true);
    assert.equal(dry.dryRun, true);
    assert.equal(dry.tables.find((t) => t.table === "jobs")?.rows, 3);
    const check = new pg.Pool({ connectionString: url, max: 1, options: `-c search_path=${schema}` });
    assert.equal(Number((await check.query("SELECT count(*) AS n FROM jobs")).rows[0].n), 0);
    await check.end();
    const real = await migrate(stateDir, schema);
    assert.deepEqual(real.tables.map((t) => t.digest), dry.tables.map((t) => t.digest), "mesmo conteúdo, mesmos hashes");
  });

  test("não sobrescreve: um destino que já tem dados é recusado", async () => {
    const stateDir = await populatedSource();
    const schema = newSchema();
    await migrate(stateDir, schema);
    await assert.rejects(migrate(stateDir, schema), /não está vazio/);
  });

  test("recusa migrar de uma origem em uso por um servidor", async () => {
    const stateDir = newDir();
    const running = new SqliteJourneyLedger({ stateDir, installation: INSTALLATION, destinationJournal: false, schedulerLock: true });
    try {
      await assert.rejects(migrate(stateDir, newSchema()), /origem está em uso/);
    } finally {
      await running.close();
    }
  });

  test("recusa migrar para um destino com servidor ativo", async () => {
    const stateDir = await populatedSource();
    const schema = newSchema();
    const server = await PostgresJourneyLedger.open({ connectionString: url!, schema, installation: INSTALLATION, destinationJournal: true, schedulerLock: true });
    try {
      await assert.rejects(migrate(stateDir, schema), /servidor ativo no destino/);
    } finally {
      await server.close();
    }
  });

  test("origem inexistente é um erro claro", async () => {
    await assert.rejects(migrate(newDir(), newSchema()), (e) => e instanceof MigrationError && /não encontrado/.test(e.message));
  });

  test("banco antigo (sem colunas de identidade, sem tabelas opcionais) recebe as mesmas identidades que o servidor atribui", async () => {
    const stateDir = newDir();
    const old = new DatabaseSync(join(stateDir, "journey.sqlite"));
    old.exec(`
      CREATE TABLE jobs(id TEXT PRIMARY KEY,goal TEXT,status TEXT,plan TEXT,review TEXT,approval TEXT,receipt TEXT,error TEXT,created TEXT);
      CREATE TABLE events(seq INTEGER PRIMARY KEY AUTOINCREMENT,job TEXT,at TEXT,node TEXT,detail TEXT);
      CREATE TABLE effects(job TEXT PRIMARY KEY,hash TEXT NOT NULL,receipt TEXT NOT NULL);
      CREATE TABLE pilot_reference_revocations(reference_version TEXT PRIMARY KEY);
      CREATE TABLE job_queue(seq INTEGER PRIMARY KEY AUTOINCREMENT,job TEXT UNIQUE NOT NULL,kind TEXT NOT NULL,crash INTEGER NOT NULL,queued_at TEXT NOT NULL);
      CREATE TABLE job_admissions(key TEXT PRIMARY KEY,job TEXT NOT NULL);
      INSERT INTO jobs VALUES('a','meta','completed',NULL,NULL,NULL,NULL,NULL,'2026-01-01T00:00:00.000Z');
      INSERT INTO events(job,at,node,detail) VALUES('a','2026-01-01T00:00:01.000Z','admission','{"goal":"meta"}');
      INSERT INTO events(job,at,node,detail) VALUES('a','2026-01-01T00:00:02.000Z','plan','{"b":2,"a":1}');`);
    old.close();
    // O que o próprio servidor faria ao abrir uma cópia do banco antigo:
    const copyDir = newDir();
    copyFileSync(join(stateDir, "journey.sqlite"), join(copyDir, "journey.sqlite"));
    const reference = new SqliteJourneyLedger({ stateDir: copyDir, installation: INSTALLATION, destinationJournal: false, schedulerLock: false });
    const expected = reference.core.db.prepare("SELECT seq,event_id,payload_sha,recorded_at FROM events ORDER BY seq").all();
    await reference.close();

    const schema = newSchema();
    const report = await migrate(stateDir, schema);
    assert.equal(report.legacyEventsBackfilled, 2);
    assert.ok(!report.tables.some((t) => t.table.startsWith("recovery_")), "tabelas opcionais ausentes são ignoradas");
    const check = new pg.Pool({ connectionString: url, max: 1, options: `-c search_path=${schema}` });
    const got = (await check.query("SELECT seq,event_id,payload_sha,recorded_at FROM events ORDER BY seq")).rows;
    await check.end();
    assert.deepEqual(got.map((r) => ({ ...r, seq: Number(r.seq) })), expected.map((r) => ({ ...r, seq: Number(r.seq) })));
  });
});
