// Testes do serviço de conversas e do Chief of Staff por regras, sobre o ledger SQLite real.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { SqliteJourneyLedger } from "../ledger/sqlite-journey-ledger.ts";
import type { JourneyStore } from "../ledger/journey-ledger.ts";
import { RuleBasedChiefOfStaff } from "./chief-of-staff.ts";
import { ConversationError, ConversationService, type Admission } from "./conversation-service.ts";

const OFFERS = [{ id: "vendas", title: "Análise de vendas e estoque", keywords: ["vendas", "estoque", "acao comercial"] }];
type Mode = "open" | "refuse" | "fail-after-admission" | "fail-before-admission";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function setup(initial: Mode = "open") {
  const stateDir = mkdtempSync(join(tmpdir(), "aurora-conversa-"));
  const ledger = new SqliteJourneyLedger({ stateDir, installation: "t", destinationJournal: false, schedulerLock: false });
  cleanups.push(async () => {
    await ledger.close();
    rmSync(stateDir, { recursive: true, force: true });
  });
  const state = { mode: initial, opened: 0 };
  const openJob = async (_offer: string, onAdmitted: (tx: JourneyStore, id: string) => Promise<void>): Promise<Admission> => {
    if (state.mode === "refuse") return { opened: false, reason: "a fila está cheia" };
    if (state.mode === "fail-before-admission") throw new Error("runtime indisponível");
    await ledger.transaction(async (tx) => {
      const id = randomUUID();
      await tx.insertJob({ id, goal: "meta", status: "queued", created: new Date().toISOString() });
      await onAdmitted(tx, id);
    });
    state.opened++;
    if (state.mode === "fail-after-admission") throw new Error("worker não iniciou");
    return { opened: true };
  };
  const service = new ConversationService({ ledger, chief: new RuleBasedChiefOfStaff(), offers: OFFERS, openJob });
  return { ledger, service, state };
}

const jobCount = async (ledger: SqliteJourneyLedger) => (await ledger.listJobIds()).length;

describe("Chief of Staff por regras", () => {
  const chief = new RuleBasedChiefOfStaff();
  const turn = (text: string, lastJob: { id: string; status: "queued" } | null = null, offers = OFFERS) => ({ text, history: [], lastJob, offers });
  const catalog = [
    { id: "campaign", title: "Campanha Horizonte", keywords: ["campanha", "horizonte", "marketing", "juridico"] },
    { id: "incident", title: "Incidente no CRM", keywords: ["incidente", "crm", "tecnologia", "juridico"] },
  ];

  test("com vários trabalhos, escolhe o que mais combina com o pedido", async () => {
    assert.deepEqual(await chief.decide(turn("avalie a campanha Horizonte", null, catalog)), {
      kind: "open_job",
      offerId: "campaign",
      text: 'Entendido. Abri um trabalho de "Campanha Horizonte". Vou planejar com os especialistas e aviso aqui quando houver um parecer para você aprovar.',
    });
    assert.equal(((await chief.decide(turn("priorize o incidente no CRM", null, catalog))) as any).offerId, "incident");
  });

  test("empate pergunta qual; pedido vago lista o que está disponível", async () => {
    assert.match((await chief.decide(turn("o jurídico precisa avaliar", null, catalog))).text, /mais de um trabalho: "Campanha Horizonte" ou "Incidente no CRM"/);
    assert.match((await chief.decide(turn("faça uma análise", null, catalog))).text, /consigo abrir: "Campanha Horizonte" ou "Incidente no CRM"/);
  });

  test("sem trabalhos oferecidos, não abre nada e diz por quê", async () => {
    const d = await chief.decide(turn("analise as vendas", null, []));
    assert.equal(d.kind, "reply");
    assert.match(d.text, /não abro trabalhos pela conversa/);
  });

  test("pedido de trabalho dentro do escopo abre trabalho", async () => {
    for (const text of ["Analise as VENDAS de fevereiro", "quero um relatório de estoque", "proponha uma ação comercial", "faça uma análise"])
      assert.equal((await chief.decide(turn(text))).kind, "open_job", text);
  });

  test("pergunta de status responde com o último trabalho, sem abrir outro", async () => {
    const withJob = await chief.decide(turn("Qual o status?", { id: "abcdef123456", status: "queued" }));
    assert.deepEqual(withJob, { kind: "reply", text: "O trabalho abcdef12 está na fila." });
    assert.match((await chief.decide(turn("como está o andamento"))).text, /Ainda não abri/);
  });

  test("fora do escopo explica o que está disponível em vez de inventar", async () => {
    const d = await chief.decide(turn("marque uma reunião com o fornecedor"));
    assert.equal(d.kind, "reply");
    assert.match(d.text, /Nesta instalação eu consigo abrir: Análise de vendas e estoque/);
  });
});

describe("serviço de conversas", () => {
  test("cria, lista e lê somente as conversas do próprio usuário", async () => {
    const { service } = setup();
    const mine = await service.create("ana", {});
    await service.create("bia", { title: "Da Bia" });
    assert.equal(mine.title, "Nova conversa");
    assert.deepEqual((await service.list("ana")).conversations.map((c) => c.id), [mine.id]);
    assert.equal((await service.read("ana", mine.id)).messages.length, 0);
    await assert.rejects(service.read("bia", mine.id), (e) => e instanceof ConversationError && e.status === 404);
    await assert.rejects(service.send("bia", mine.id, { text: "oi" }), (e) => e instanceof ConversationError && e.status === 404);
  });

  test("valida título, texto, client_message_id e campos extras", async () => {
    const { service } = setup();
    const { id } = await service.create("ana", {});
    const status = (p: Promise<unknown>) => p.then(() => 0, (e) => (e as ConversationError).status);
    assert.equal(await status(service.create("ana", { title: "" })), 400);
    assert.equal(await status(service.create("ana", { title: "x".repeat(121) })), 400);
    assert.equal(await status(service.create("ana", { title: "ok", extra: 1 })), 400);
    assert.equal(await status(service.send("ana", id, { text: "   " })), 400);
    assert.equal(await status(service.send("ana", id, { text: "x".repeat(2001) })), 400);
    assert.equal(await status(service.send("ana", id, { text: "oi", client_message_id: "curto" })), 400);
    assert.equal(await status(service.send("ana", id, { text: "oi", outro: true })), 400);
  });

  test("resposta simples: grava a pergunta e a resposta, sem trabalho", async () => {
    const { service, ledger } = setup();
    const { id } = await service.create("ana", {});
    const r = await service.send("ana", id, { text: "olá" });
    assert.equal(r.status, 201);
    assert.deepEqual([r.body.user.role, r.body.reply.role, r.body.reply.job], ["user", "chief", null]);
    assert.equal(r.body.reply.reply_to, r.body.user.seq);
    assert.equal(await jobCount(ledger), 0);
    assert.equal((await service.read("ana", id)).messages.length, 2);
  });

  test("pedido de trabalho abre um trabalho e a resposta mostra o trabalho e o estado", async () => {
    const { service, ledger } = setup();
    const { id } = await service.create("ana", {});
    const r = await service.send("ana", id, { text: "analise as vendas" });
    assert.equal(await jobCount(ledger), 1);
    assert.equal(r.body.reply.job?.status, "queued");
    assert.equal(r.body.reply.job?.id, (await ledger.listJobIds())[0]);
    const status = await service.send("ana", id, { text: "qual o status?" });
    assert.match(status.body.reply.text, /está na fila/);
    assert.equal(await jobCount(ledger), 1, "perguntar o status não abre outro trabalho");
  });

  test("repetir o envio com o mesmo client_message_id devolve a mesma resposta e não duplica o trabalho", async () => {
    const { service, ledger } = setup();
    const { id } = await service.create("ana", {});
    const body = { text: "analise as vendas", client_message_id: "envio-000001" };
    const first = await service.send("ana", id, body);
    const again = await service.send("ana", id, body);
    assert.equal(again.status, 200);
    assert.equal(again.body.replayed, true);
    assert.equal(again.body.reply.seq, first.body.reply.seq);
    assert.equal(await jobCount(ledger), 1);
    await assert.rejects(
      service.send("ana", id, { text: "outro texto", client_message_id: "envio-000001" }),
      (e) => e instanceof ConversationError && e.status === 409,
    );
  });

  test("envios simultâneos com o mesmo client_message_id abrem um único trabalho", async () => {
    const { service, ledger } = setup();
    const { id } = await service.create("ana", {});
    const body = { text: "analise o estoque", client_message_id: "envio-000002" };
    const results = await Promise.all([service.send("ana", id, body), service.send("ana", id, body), service.send("ana", id, body)]);
    assert.equal(new Set(results.map((r) => r.body.reply.seq)).size, 1);
    assert.equal(await jobCount(ledger), 1);
    assert.equal((await service.read("ana", id)).messages.length, 2);
  });

  test("admissão recusada: a resposta explica o motivo e nenhum trabalho é criado", async () => {
    const { service, ledger } = setup("refuse");
    const { id } = await service.create("ana", {});
    const r = await service.send("ana", id, { text: "analise as vendas" });
    assert.match(r.body.reply.text, /Não consegui abrir o trabalho agora: a fila está cheia/);
    assert.equal(r.body.reply.job, null);
    assert.equal(await jobCount(ledger), 0);
  });

  test("falha depois da admissão: a resposta já gravada vale e aponta o trabalho criado", async () => {
    const { service, ledger } = setup("fail-after-admission");
    const { id } = await service.create("ana", {});
    const r = await service.send("ana", id, { text: "analise as vendas" });
    assert.equal(await jobCount(ledger), 1);
    assert.ok(r.body.reply.job, "a resposta referencia o trabalho");
  });

  test("falha inesperada antes da admissão propaga o erro e pode ser repetida depois", async () => {
    const { service, ledger, state } = setup("fail-before-admission");
    const { id } = await service.create("ana", {});
    const body = { text: "analise as vendas", client_message_id: "envio-000003" };
    await assert.rejects(service.send("ana", id, body), /runtime indisponível/);
    assert.equal(await jobCount(ledger), 0);
    state.mode = "open";
    const retry = await service.send("ana", id, body);
    assert.equal(retry.status, 201, "a pergunta sem resposta é respondida na repetição");
    assert.equal(await jobCount(ledger), 1);
    assert.equal((await service.read("ana", id)).messages.length, 2, "a pergunta não foi duplicada");
  });

  test("cada resposta registra na trilha quem decidiu, sem copiar o texto da conversa", async () => {
    const { service, ledger } = setup();
    const { id } = await service.create("ana", {});
    const sent = await service.send("ana", id, { text: "analise as vendas, cliente sigiloso ACME" });
    assert.deepEqual(sent.body.reply.decision, { engine: "rules" });
    assert.equal(sent.body.user.decision, null);
    const [event] = await ledger.listEvents(`conversation:${id}`);
    assert.equal(event.node, "chief_decision");
    const detail = JSON.parse(event.detail);
    assert.deepEqual(
      { engine: detail.engine, offer_id: detail.offer_id, reply_seq: detail.reply_seq, job: detail.job },
      { engine: "rules", offer_id: "vendas", reply_seq: sent.body.reply.seq, job: sent.body.reply.job?.id },
    );
    assert.ok(!event.detail.includes("ACME"), "o texto do gestor não vai para a trilha");
    assert.deepEqual((await service.read("ana", id)).messages[1].decision, { engine: "rules" });
  });

  test("a conversa com mensagem nova sobe na lista", async () => {
    const { ledger } = setup();
    let t = 0;
    const clock = () => `2026-03-01T00:00:${String(++t).padStart(2, "0")}.000Z`;
    const svc = new ConversationService({
      ledger,
      chief: new RuleBasedChiefOfStaff(),
      offers: OFFERS,
      openJob: async () => ({ opened: false, reason: "-" }),
      now: clock,
    });
    const a = await svc.create("ana", { title: "A" });
    await svc.create("ana", { title: "B" });
    assert.deepEqual((await svc.list("ana")).conversations.map((c) => c.title), ["B", "A"]);
    await svc.send("ana", a.id, { text: "olá" });
    const list = (await svc.list("ana")).conversations;
    assert.deepEqual(list.map((c) => [c.title, c.message_count]), [["A", 2], ["B", 0]]);
  });
});
