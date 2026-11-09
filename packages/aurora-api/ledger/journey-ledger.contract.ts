/**
 * Contrato executável da porta `JourneyLedger`.
 *
 * Qualquer implementação (SQLite, PostgreSQL, ...) deve passar por esta suíte sem
 * alterações. Ela descreve o comportamento exigido pelo servidor, não detalhes de
 * armazenamento.
 */
import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { LedgerUsageError, type JourneyLedger, type NewJob, type RecoveryCommand } from "./journey-ledger.ts";

export interface LedgerHarness {
  ledger: JourneyLedger;
  /** Abre outro ledger sobre o MESMO armazenamento, como faria um segundo processo. */
  reopen(opts: { schedulerLock: boolean }): Promise<JourneyLedger>;
  /** Fecha tudo o que foi aberto e apaga o armazenamento. */
  cleanup(): Promise<void>;
}

export interface ContractOptions {
  /** Abre um ledger novo e vazio, com o diário de destino habilitado ou não. */
  create(opts: { destinationJournal: boolean; schedulerLock?: boolean }): Promise<LedgerHarness>;
}

const job = (id: string, over: Partial<NewJob> = {}): NewJob => ({
  id,
  goal: "meta",
  status: "created",
  created: new Date().toISOString(),
  ...over,
});
const command = (id: string, over: Partial<RecoveryCommand> = {}): RecoveryCommand => ({
  id,
  actor: "rev-1",
  inputSha: "i".repeat(64),
  body: '{"case_id":"caso-0001"}',
  action: "recovery_propose",
  caseId: "caso-0001",
  operationId: "inst:op-1",
  evidenceSha: "e".repeat(64),
  status: "dispatching",
  result: null,
  updated: "2026-01-01T00:00:00.000Z",
  ...over,
});
const at = (n: number) => `2026-01-01T00:00:${String(n).padStart(2, "0")}.000Z`;

export function describeJourneyLedgerContract(name: string, options: ContractOptions) {
  describe(`contrato JourneyLedger — ${name}`, () => {
    const open: LedgerHarness[] = [];
    afterEach(async () => {
      for (const h of open.splice(0)) await h.cleanup();
    });
    async function harness(opts: { destinationJournal?: boolean; schedulerLock?: boolean } = {}) {
      const h = await options.create({ destinationJournal: opts.destinationJournal ?? false, schedulerLock: opts.schedulerLock });
      open.push(h);
      return h;
    }
    async function ledger(destinationJournal = false) {
      const h = await options.create({ destinationJournal });
      open.push(h);
      return h.ledger;
    }

    describe("trabalhos", () => {
      test("insere, lê e lista do mais recente para o mais antigo", async () => {
        const l = await ledger();
        await l.insertJob(job("a", { created: at(1) }));
        await l.insertJob(job("b", { created: at(2) }));
        const a = await l.getJob("a");
        assert.deepEqual(
          { id: a?.id, status: a?.status, plan: a?.plan, error: a?.error },
          { id: "a", status: "created", plan: null, error: null },
        );
        assert.equal(await l.getJob("inexistente"), undefined);
        assert.deepEqual(await l.listJobIds(), ["b", "a"]);
      });

      test("updateJob altera só os campos informados e aceita null para limpar", async () => {
        const l = await ledger();
        await l.insertJob(job("a"));
        await l.updateJob("a", { status: "running", approval: "h", error: "x" });
        await l.updateJob("a", { plan: "{}" });
        await l.updateJob("a", { approval: null, error: null });
        const r = await l.getJob("a");
        assert.deepEqual(
          [r?.status, r?.plan, r?.approval, r?.error],
          ["running", "{}", null, null],
        );
      });

      test("updateJob com guarda só altera se o status atual estiver no conjunto", async () => {
        const l = await ledger();
        await l.insertJob(job("a", { status: "running" }));
        assert.equal(await l.updateJob("a", { status: "failed" }, { statusIn: ["queued"] }), false);
        assert.equal((await l.getJob("a"))?.status, "running");
        assert.equal(await l.updateJob("a", { status: "failed" }, { statusIn: ["running", "queued"] }), true);
        assert.equal((await l.getJob("a"))?.status, "failed");
        assert.equal(await l.updateJob("inexistente", { status: "failed" }), false);
      });

      test("trabalhos criados no mesmo instante saem do último inserido para o primeiro", async () => {
        const l = await ledger();
        const created = at(5);
        for (const id of ["x", "y", "z"]) await l.insertJob(job(id, { created, goal: "mesma" }));
        assert.deepEqual(await l.listJobIds(), ["z", "y", "x"]);
        assert.equal((await l.latestJobForGoal("mesma"))?.id, "z");
      });

      test("updateJob sem campos é erro de uso", async () => {
        const l = await ledger();
        await l.insertJob(job("a"));
        await assert.rejects(l.updateJob("a", {}), LedgerUsageError);
      });

      test("consulta por status e pelo último trabalho de uma meta", async () => {
        const l = await ledger();
        await l.insertJob(job("a", { status: "running", goal: "g1" }));
        await l.insertJob(job("b", { status: "created", goal: "g1" }));
        await l.insertJob(job("c", { status: "running", goal: "g2" }));
        assert.deepEqual((await l.listJobIdsByStatus("running")).sort(), ["a", "c"]);
        assert.deepEqual(await l.latestJobForGoal("g1"), { id: "b", status: "created" });
        assert.equal(await l.latestJobForGoal("nenhuma"), undefined);
      });

      test("insertJob aceita um parecer já vinculado", async () => {
        const l = await ledger();
        await l.insertJob(job("a", { review: '{"hash":"x"}' }));
        assert.equal((await l.getJob("a"))?.review, '{"hash":"x"}');
      });
    });

    describe("regra de um trabalho ativo", () => {
      test("ligada, recusa um segundo trabalho created/running; desligada, aceita", async () => {
        const l = await ledger();
        await l.setSingleActiveJob(true);
        await l.insertJob(job("a", { status: "running" }));
        await assert.rejects(l.insertJob(job("b", { status: "created" })));
        await l.insertJob(job("c", { status: "queued" }));
        await l.setSingleActiveJob(false);
        await l.insertJob(job("d", { status: "running" }));
        assert.ok(await l.getJob("d"));
      });

      test("ligar falha se já houver mais de um trabalho ativo", async () => {
        const l = await ledger();
        await l.insertJob(job("a", { status: "running" }));
        await l.insertJob(job("b", { status: "created" }));
        await assert.rejects(l.setSingleActiveJob(true));
      });
    });

    describe("eventos", () => {
      test("mantém a ordem e é idempotente por event_id e conteúdo", async () => {
        const l = await ledger();
        const first = await l.appendEvent("j", "no1", { a: 1 }, "evento-0001");
        const again = await l.appendEvent("j", "no1", { a: 1 }, "evento-0001");
        await l.appendEvent("j", "no2", { b: 2 });
        assert.deepEqual([first.replayed, again.replayed], [false, true]);
        const events = await l.listEvents("j");
        assert.deepEqual(events.map((e) => e.node), ["no1", "no2"]);
        assert.ok(events[0].seq < events[1].seq);
        assert.deepEqual(JSON.parse(events[0].detail), { a: 1 });
      });

      test("recusa reutilizar um event_id com outro conteúdo", async () => {
        const l = await ledger();
        await l.appendEvent("j", "no", { a: 1 }, "evento-0002");
        await assert.rejects(l.appendEvent("j", "no", { a: 2 }, "evento-0002"), /outro conteúdo/);
      });

      test("recusa identidade de evento inválida", async () => {
        const l = await ledger();
        await assert.rejects(l.appendEvent("j", "no", {}, "x"), /inválida/);
      });

      test("trace é uma projeção somente leitura da trilha", async () => {
        const l = await ledger();
        await l.appendEvent("j", "no", { capability: "vendas" });
        const trace = (await l.trace("j")) as { read_only: boolean; job_id: string; events: { kind: string }[] };
        assert.equal(trace.read_only, true);
        assert.equal(trace.job_id, "j");
        assert.deepEqual(trace.events.map((e) => e.kind), ["no"]);
      });
    });

    describe("fila", () => {
      test("preserva a ordem de entrada, remove só a entrada correta e conta por tipo", async () => {
        const l = await ledger();
        const a = await l.enqueue({ job: "a", kind: "new", crash: false, queuedAt: at(1) });
        const b = await l.enqueue({ job: "b", kind: "resume", crash: true, queuedAt: at(2) });
        assert.ok(a.seq < b.seq);
        assert.deepEqual(await l.queueDepth(), { total: 2, newRequests: 1 });
        assert.deepEqual(await l.peekQueue(), a);
        assert.equal(await l.dequeue(a.seq, "outro"), false, "job diferente não remove");
        assert.equal(await l.dequeue(a.seq, "a"), true);
        assert.equal(await l.dequeue(a.seq, "a"), false, "remoção repetida");
        const head = await l.peekQueue();
        assert.deepEqual([head?.job, head?.kind, head?.crash], ["b", "resume", true]);
      });

      test("um trabalho só entra uma vez na fila", async () => {
        const l = await ledger();
        await l.enqueue({ job: "a", kind: "new", crash: false, queuedAt: at(1) });
        await assert.rejects(l.enqueue({ job: "a", kind: "new", crash: false, queuedAt: at(2) }));
      });

      test("fila vazia", async () => {
        const l = await ledger();
        assert.equal(await l.peekQueue(), undefined);
        assert.deepEqual(await l.queueDepth(), { total: 0, newRequests: 0 });
      });
    });

    describe("admissão, efeitos e revogações", () => {
      test("admissão idempotente: a chave aponta para o primeiro trabalho", async () => {
        const l = await ledger();
        assert.equal(await l.findAdmittedJob("k"), undefined);
        await l.recordAdmission("k", "a");
        assert.equal(await l.findAdmittedJob("k"), "a");
        await assert.rejects(l.recordAdmission("k", "b"));
      });

      test("um trabalho tem no máximo um efeito", async () => {
        const l = await ledger();
        assert.equal(await l.getEffect("a"), undefined);
        await l.recordEffect("a", "h", "{}");
        assert.deepEqual(await l.getEffect("a"), { hash: "h", receipt: "{}" });
        await assert.rejects(l.recordEffect("a", "h2", "{}"));
      });

      test("revogar uma referência é idempotente e informa se foi novo", async () => {
        const l = await ledger();
        assert.equal(await l.isReferenceRevoked("v"), false);
        assert.equal(await l.revokeReference("v"), true);
        assert.equal(await l.revokeReference("v"), false);
        assert.equal(await l.isReferenceRevoked("v"), true);
      });
    });

    describe("diário de destino", () => {
      test("desabilitado: operações falham e não há pendência", async () => {
        const l = await ledger(false);
        assert.equal(await l.hasPendingDestinationWork(), false);
        await assert.rejects(l.revokeDestinationScope("s"), LedgerUsageError);
        await assert.rejects(l.getDestinationIntent("a"), LedgerUsageError);
      });

      test("revogação fica pendente até ser confirmada, uma única vez", async () => {
        const l = await ledger(true);
        assert.equal(await l.revokeDestinationScope("s"), true);
        assert.equal(await l.revokeDestinationScope("s"), false);
        assert.equal(await l.isDestinationRevocationAcknowledged("s"), false);
        assert.equal(await l.hasPendingDestinationWork(), true);
        assert.equal(await l.acknowledgeDestinationRevocation("s"), true);
        assert.equal(await l.acknowledgeDestinationRevocation("s"), false);
        assert.equal(await l.isDestinationRevocationAcknowledged("s"), true);
        assert.equal(await l.hasPendingDestinationWork(), false);
      });

      test("intenção sem efeito é pendência; com efeito deixa de ser", async () => {
        const l = await ledger(true);
        assert.equal(await l.getDestinationIntent("a"), undefined);
        await l.recordDestinationIntent("a", '{"id":"i"}');
        assert.equal(await l.getDestinationIntent("a"), '{"id":"i"}');
        assert.equal(await l.hasPendingDestinationWork(), true);
        await l.recordEffect("a", "h", "{}");
        assert.equal(await l.hasPendingDestinationWork(), false);
      });
    });

    describe("conversa com o Chief of Staff", () => {
      const conv = (id: string, over: { actor?: string; created?: string; title?: string } = {}) => ({
        id,
        actor: over.actor ?? "ana",
        title: over.title ?? "Vendas",
        created: over.created ?? at(1),
      });
      const msg = (conversation: string, over: Partial<{ role: "user" | "chief"; text: string; clientId: string; replyTo: number; job: string; created: string }> = {}) => ({
        conversation,
        role: over.role ?? ("user" as const),
        text: over.text ?? "olá",
        clientId: over.clientId,
        replyTo: over.replyTo,
        job: over.job,
        created: over.created ?? at(2),
      });

      test("cria, lê e só lista as conversas do próprio usuário, da mais recente para a mais antiga", async () => {
        const l = await ledger();
        await l.createConversation(conv("c1", { created: at(1) }));
        await l.createConversation(conv("c2", { created: at(2) }));
        await l.createConversation(conv("c3", { actor: "bia", created: at(3) }));
        assert.deepEqual(await l.getConversation("c1"), { id: "c1", actor: "ana", title: "Vendas", created: at(1), updated: at(1) });
        assert.equal(await l.getConversation("nada"), undefined);
        assert.deepEqual((await l.listConversationsForActor("ana")).map((c) => c.id), ["c2", "c1"]);
        assert.deepEqual((await l.listConversationsForActor("bia")).map((c) => c.id), ["c3"]);
        assert.equal((await l.listConversationsForActor("ninguem")).length, 0);
      });

      test("mensagens mantêm a ordem, atualizam a conversa e a contagem", async () => {
        const l = await ledger();
        await l.createConversation(conv("c1", { created: at(1) }));
        await l.createConversation(conv("c2", { created: at(2) }));
        const first = await l.appendConversationMessage(msg("c1", { text: "primeira", created: at(5) }));
        const second = await l.appendConversationMessage(msg("c1", { role: "chief", text: "segunda", replyTo: first.seq, job: "j1", created: at(6) }));
        assert.ok(first.seq < second.seq);
        assert.deepEqual([second.role, second.replyTo, second.job], ["chief", first.seq, "j1"]);
        assert.deepEqual((await l.listConversationMessages("c1")).map((m) => m.text), ["primeira", "segunda"]);
        const list = await l.listConversationsForActor("ana");
        assert.deepEqual(list.map((c) => [c.id, c.messageCount, c.updated]), [["c1", 2, at(6)], ["c2", 0, at(2)]], "a conversa com mensagem nova sobe");
      });

      test("paginação por afterSeq e limit", async () => {
        const l = await ledger();
        await l.createConversation(conv("c1"));
        const seqs: number[] = [];
        for (const t of ["a", "b", "c", "d"]) seqs.push((await l.appendConversationMessage(msg("c1", { text: t }))).seq);
        assert.deepEqual((await l.listConversationMessages("c1", { afterSeq: seqs[1] })).map((m) => m.text), ["c", "d"]);
        assert.deepEqual((await l.listConversationMessages("c1", { limit: 2 })).map((m) => m.text), ["a", "b"]);
      });

      test("clientId repetido na mesma conversa é recusado; em outra conversa é aceito", async () => {
        const l = await ledger();
        await l.createConversation(conv("c1"));
        await l.createConversation(conv("c2"));
        await l.appendConversationMessage(msg("c1", { clientId: "cli-0001" }));
        assert.equal((await l.findConversationMessageByClientId("c1", "cli-0001"))?.clientId, "cli-0001");
        assert.equal(await l.findConversationMessageByClientId("c2", "cli-0001"), undefined);
        await assert.rejects(l.appendConversationMessage(msg("c1", { clientId: "cli-0001" })));
        await l.appendConversationMessage(msg("c2", { clientId: "cli-0001" }));
        await l.appendConversationMessage(msg("c1"));
        await l.appendConversationMessage(msg("c1"));
      });

      test("encontra a resposta do Chief of Staff a uma mensagem", async () => {
        const l = await ledger();
        await l.createConversation(conv("c1"));
        const question = await l.appendConversationMessage(msg("c1"));
        assert.equal(await l.findConversationReply("c1", question.seq), undefined);
        const answer = await l.appendConversationMessage(msg("c1", { role: "chief", replyTo: question.seq, text: "feito" }));
        assert.equal((await l.findConversationReply("c1", question.seq))?.seq, answer.seq);
      });

      test("mensagem em conversa inexistente é erro de uso e nada é gravado", async () => {
        const l = await ledger();
        await assert.rejects(l.appendConversationMessage(msg("nada")), LedgerUsageError);
        assert.deepEqual(await l.listConversationMessages("nada"), []);
      });

      test("na mesma transação, a conversa e o trabalho ficam ou somem juntos", async () => {
        const l = await ledger();
        await assert.rejects(
          l.transaction(async (tx) => {
            await tx.createConversation(conv("c1"));
            await tx.appendConversationMessage(msg("c1"));
            throw new Error("falha");
          }),
        );
        assert.equal(await l.getConversation("c1"), undefined);
        assert.deepEqual(await l.listConversationMessages("c1"), []);
      });
    });

    describe("Cérebro: fontes e versões", () => {
      const source = (id: string, over: Partial<{ owner: string; readers: string[]; supersedes: string | null; created: string; title: string }> = {}) => ({
        id,
        title: over.title ?? `Fonte ${id}`,
        owner: over.owner ?? "ana",
        readers: over.readers ?? ["*"],
        supersedes: over.supersedes ?? null,
        created: over.created ?? at(1),
      });
      const bytesOf = (text: string) => new TextEncoder().encode(text);
      const version = (sourceId: string, n: number, text: string, over: Partial<{ validFrom: string }> = {}) => ({
        source: sourceId,
        version: n,
        mediaType: "text/markdown",
        filename: `${sourceId}-v${n}.md`,
        contentSha: "s".repeat(64),
        bytes: bytesOf(text),
        text,
        validFrom: over.validFrom ?? at(2),
        uploadedBy: "ana",
        created: at(3),
      });

      test("cria a fonte, grava versões em sequência e devolve o original byte a byte", async () => {
        const l = await ledger();
        await l.createKnowledgeSource(source("politica", { readers: ["ana", "bia"] }));
        const fresh = await l.getKnowledgeSource("politica");
        assert.deepEqual(
          [fresh?.owner, fresh?.readers, fresh?.latestVersion, fresh?.revoked, fresh?.supersedes],
          ["ana", ["ana", "bia"], 0, null, null],
        );
        await l.addKnowledgeVersion(version("politica", 1, "primeira"));
        await l.addKnowledgeVersion(version("politica", 2, "segunda"));
        assert.equal((await l.getKnowledgeSource("politica"))?.latestVersion, 2);
        const v1 = await l.getKnowledgeVersion("politica", 1);
        assert.equal(new TextDecoder().decode(v1!.bytes), "primeira");
        assert.equal(v1?.text, "primeira");
        assert.equal(v1?.sizeBytes, 8);
        assert.deepEqual((await l.listKnowledgeVersions("politica")).map((v) => [v.version, v.sizeBytes]), [[2, 7], [1, 8]]);
        assert.equal(await l.getKnowledgeVersion("politica", 9), undefined);
      });

      test("bytes arbitrários (não UTF-8) são preservados", async () => {
        const l = await ledger();
        await l.createKnowledgeSource(source("bin"));
        const raw = new Uint8Array([0, 255, 128, 10, 13, 0, 1]);
        await l.addKnowledgeVersion({ ...version("bin", 1, ""), bytes: raw });
        assert.deepEqual([...(await l.getKnowledgeVersion("bin", 1))!.bytes], [...raw]);
      });

      test("versão fora de sequência ou de fonte inexistente é recusada sem gravar nada", async () => {
        const l = await ledger();
        await l.createKnowledgeSource(source("p"));
        await assert.rejects(l.addKnowledgeVersion(version("p", 2, "pulou a 1")), LedgerUsageError);
        await assert.rejects(l.addKnowledgeVersion(version("nada", 1, "x")), LedgerUsageError);
        await l.addKnowledgeVersion(version("p", 1, "ok"));
        await assert.rejects(l.addKnowledgeVersion(version("p", 1, "repetida")), LedgerUsageError);
        assert.deepEqual((await l.listKnowledgeVersions("p")).map((v) => v.version), [1]);
      });

      test("lista as fontes da mais recente para a mais antiga", async () => {
        const l = await ledger();
        await l.createKnowledgeSource(source("a", { created: at(1) }));
        await l.createKnowledgeSource(source("b", { created: at(2) }));
        assert.deepEqual((await l.listKnowledgeSources()).map((s) => s.id), ["b", "a"]);
      });

      test("revogar é idempotente e tira a fonte do que é indexável", async () => {
        const l = await ledger();
        await l.createKnowledgeSource(source("a"));
        await l.createKnowledgeSource(source("b", { supersedes: "a" }));
        await l.addKnowledgeVersion(version("a", 1, "texto a"));
        await l.addKnowledgeVersion(version("b", 1, "texto b"));
        assert.deepEqual((await l.listIndexableKnowledge()).map((k) => [k.source, k.version, k.supersedes]), [["a", 1, null], ["b", 1, "a"]]);
        assert.equal(await l.revokeKnowledgeSource("a", "ana", at(9)), true);
        assert.equal(await l.revokeKnowledgeSource("a", "ana", at(10)), false);
        assert.equal(await l.revokeKnowledgeSource("nada", "ana", at(10)), false);
        const revoked = await l.getKnowledgeSource("a");
        assert.deepEqual([revoked?.revoked, revoked?.revokedBy], [at(9), "ana"]);
        assert.deepEqual((await l.listIndexableKnowledge()).map((k) => k.source), ["b"]);
      });
    });

    describe("central de recuperação", () => {
      test("sessão: cria, encontra pelo hash do token e apaga", async () => {
        const l = await ledger();
        const session = { hash: "h".repeat(64), actor: "rev-1", authSha: "a".repeat(64), expires: Date.now() + 3600000 };
        assert.equal(await l.findRecoverySession(session.hash), undefined);
        await l.createRecoverySession(session);
        assert.deepEqual(await l.findRecoverySession(session.hash), session);
        await l.deleteRecoverySession(session.hash);
        assert.equal(await l.findRecoverySession(session.hash), undefined);
      });

      test("comando: grava, lê, só entrega ao revisor dono e atualiza o estado", async () => {
        const l = await ledger();
        await l.insertRecoveryCommand(command("c1"));
        assert.equal((await l.getRecoveryCommand("c1"))?.status, "dispatching");
        assert.equal(await l.getRecoveryCommandForActor("c1", "outro"), undefined);
        assert.equal((await l.getRecoveryCommandForActor("c1", "rev-1"))?.caseId, "caso-0001");
        await l.updateRecoveryCommandStatus("c1", "completed", "2026-01-01T00:00:05.000Z", '{"ok":true}');
        const done = await l.getRecoveryCommand("c1");
        assert.deepEqual([done?.status, done?.result, done?.updated], ["completed", '{"ok":true}', "2026-01-01T00:00:05.000Z"]);
        await l.updateRecoveryCommandStatus("c1", "unknown", "2026-01-01T00:00:09.000Z");
        assert.equal((await l.getRecoveryCommand("c1"))?.result, '{"ok":true}', "sem result, o resultado anterior fica");
      });

      test("id de comando é único", async () => {
        const l = await ledger();
        await l.insertRecoveryCommand(command("c1"));
        await assert.rejects(l.insertRecoveryCommand(command("c1")));
      });

      test("lista os comandos em envio e os do revisor, do mais recente ao mais antigo", async () => {
        const l = await ledger();
        await l.insertRecoveryCommand(command("c1", { updated: "2026-01-01T00:00:01.000Z" }));
        await l.insertRecoveryCommand(command("c2", { updated: "2026-01-01T00:00:03.000Z", status: "completed" }));
        await l.insertRecoveryCommand(command("c3", { updated: "2026-01-01T00:00:02.000Z", actor: "rev-2" }));
        assert.deepEqual(await l.listDispatchingRecoveryCommands(), [{ id: "c1", caseId: "caso-0001" }, { id: "c3", caseId: "caso-0001" }]);
        assert.deepEqual((await l.listRecoveryCommandsForActor("rev-1")).map((c) => c.id), ["c2", "c1"]);
        assert.equal((await l.listRecoveryCommandsForActor("ninguem")).length, 0);
      });

      test("comando e evento na mesma transação ficam ou somem juntos", async () => {
        const l = await ledger();
        await assert.rejects(
          l.transaction(async (tx) => {
            await tx.insertRecoveryCommand(command("c1"));
            await tx.appendEvent("recovery:caso-0001", "recovery_command_started", {});
            throw new Error("falha");
          }),
        );
        assert.equal(await l.getRecoveryCommand("c1"), undefined);
        assert.equal((await l.listEvents("recovery:caso-0001")).length, 0);
      });
    });

    describe("agendador único", () => {
      test("só um ledger por instalação toma a trava; ao fechar, outro pode tomá-la", async () => {
        const h = await harness({ schedulerLock: true });
        await assert.rejects(h.reopen({ schedulerLock: true }), LedgerUsageError);
        const reader = await h.reopen({ schedulerLock: false });
        assert.deepEqual(await reader.listJobIds(), [], "quem não pede a trava continua podendo ler");
        await h.ledger.close();
        const next = await h.reopen({ schedulerLock: true });
        assert.ok(next, "a trava foi liberada");
      });
    });

    describe("transações", () => {
      test("confirmam todas as escritas juntas e devolvem o resultado", async () => {
        const l = await ledger();
        const out = await l.transaction(async (tx) => {
          await tx.insertJob(job("a"));
          await tx.appendEvent("a", "criado", {});
          return "ok";
        });
        assert.equal(out, "ok");
        assert.ok(await l.getJob("a"));
        assert.equal((await l.listEvents("a")).length, 1);
      });

      test("se o callback falhar, nada é gravado e o erro original chega ao chamador", async () => {
        const l = await ledger();
        await assert.rejects(
          l.transaction(async (tx) => {
            await tx.insertJob(job("a"));
            await tx.enqueue({ job: "a", kind: "new", crash: false, queuedAt: at(1) });
            throw new Error("falha de negócio");
          }),
          /falha de negócio/,
        );
        assert.equal(await l.getJob("a"), undefined);
        assert.equal(await l.peekQueue(), undefined);
        await l.insertJob(job("a"));
        assert.ok(await l.getJob("a"), "o ledger continua utilizável após o rollback");
      });

      test("dentro da transação a leitura enxerga as próprias escritas", async () => {
        const l = await ledger();
        await l.transaction(async (tx) => {
          await tx.insertJob(job("a"));
          assert.equal((await tx.getJob("a"))?.id, "a");
        });
      });

      test("leituras de fora nunca veem estado parcial de uma transação em andamento", async () => {
        const l = await ledger();
        let release!: () => void;
        const gate = new Promise<void>((r) => (release = r));
        const writing = l.transaction(async (tx) => {
          await tx.insertJob(job("a"));
          await gate;
          await tx.updateJob("a", { status: "running" });
        });
        const during = l.getJob("a"); // pedida enquanto a transação está aberta
        await new Promise((r) => setTimeout(r, 30));
        release();
        await writing;
        // Cada adaptador pode esperar a transação ou devolver o estado já confirmado, mas
        // nunca o estado intermediário ("created") nem uma escrita ainda não confirmada.
        const seen = await during;
        assert.ok(seen === undefined || seen.status === "running", `estado parcial visto: ${seen?.status}`);
        assert.equal((await l.getJob("a"))?.status, "running", "depois do commit tudo é visível");
      });

      test("transações concorrentes são serializadas, sem intercalar", async () => {
        const l = await ledger();
        await l.insertJob(job("c", { status: "created" }));
        const order: string[] = [];
        const run = (label: string, ms: number) =>
          l.transaction(async (tx) => {
            order.push(`${label}:início`);
            await new Promise((r) => setTimeout(r, ms));
            await tx.appendEvent("c", label, {});
            order.push(`${label}:fim`);
          });
        await Promise.all([run("A", 40), run("B", 5), run("C", 5)]);
        assert.deepEqual(order, ["A:início", "A:fim", "B:início", "B:fim", "C:início", "C:fim"]);
        assert.deepEqual((await l.listEvents("c")).map((e) => e.node), ["A", "B", "C"]);
      });

      test("usar o ledger externo dentro da transação é um erro claro, não um deadlock", async () => {
        const l = await ledger();
        await assert.rejects(
          l.transaction(async () => {
            await l.getJob("a");
          }),
          LedgerUsageError,
        );
        assert.deepEqual(await l.listJobIds(), [], "e o ledger não fica travado");
      });

      test("uma falha numa transação não afeta a seguinte", async () => {
        const l = await ledger();
        await assert.rejects(l.transaction(async () => { throw new Error("x"); }));
        await l.transaction(async (tx) => tx.insertJob(job("a")));
        assert.ok(await l.getJob("a"));
      });
    });
  });
}
