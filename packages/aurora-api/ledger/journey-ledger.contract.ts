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
