// Testes do Cérebro: texto, índice, vigência, acesso, revogação, substituição e respondedores.
// Usam o ledger SQLite real e um relógio controlado; nenhum modelo real é chamado.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { SqliteJourneyLedger } from "../ledger/sqlite-journey-ledger.ts";
import { ModelCallError, type ModelClient, type ModelRequest } from "../conversation/model-cli.ts";
import { ExtractiveAnswerer, ModelAnswerer, type Passage } from "./answerer.ts";
import { Bm25Index } from "./bm25.ts";
import { currentKnowledge, KnowledgeError, KnowledgeService } from "./knowledge-service.ts";
import { chunk, extractText, terms } from "./text.ts";

const enc = (s: string) => new TextEncoder().encode(s);
const b64 = (s: string | Uint8Array) => Buffer.from(typeof s === "string" ? enc(s) : s).toString("base64");
const status = (p: Promise<unknown>) => p.then(() => 0, (e) => (e instanceof KnowledgeError ? e.status : -1));

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function setup(maxBytes?: number) {
  const stateDir = mkdtempSync(join(tmpdir(), "aurora-cerebro-"));
  const ledger = new SqliteJourneyLedger({ stateDir, installation: "t", destinationJournal: false, schedulerLock: false });
  cleanups.push(async () => {
    await ledger.close();
    rmSync(stateDir, { recursive: true, force: true });
  });
  const clock = { now: "2026-03-01T12:00:00.000Z" };
  const service = new KnowledgeService({ ledger, answerer: new ExtractiveAnswerer(), now: () => clock.now, maxBytes });
  return { ledger, service, clock };
}

const REMOTE = "# Política de trabalho remoto\n\nO trabalho remoto é permitido até três dias por semana.\n\nPedidos de equipamento vão ao setor de TI.";
const PURCHASE = "# Política de compras\n\nCompras acima de dez mil reais exigem aprovação do diretor financeiro.\n\nO prazo de pagamento a fornecedores é de 30 dias.";
const upload = (title: string, text: string, extra: Record<string, unknown> = {}) => ({
  title,
  filename: `${title.toLowerCase().replace(/\W+/g, "-")}.md`,
  media_type: "text/markdown",
  content_base64: b64(text),
  ...extra,
});

describe("texto e índice", () => {
  test("extrai os formatos aceitos e recusa os demais", () => {
    assert.equal(extractText(enc("﻿linha 1\r\nlinha 2"), "text/plain"), "linha 1\nlinha 2");
    assert.equal(extractText(enc('{"a":[1,2]}'), "application/json"), '{\n  "a": [\n    1,\n    2\n  ]\n}');
    assert.throws(() => extractText(enc("x"), "application/pdf"), (e) => e instanceof KnowledgeError && e.status === 415);
    assert.throws(() => extractText(new Uint8Array([0xff, 0xfe, 0x00]), "text/plain"), /UTF-8/);
    assert.throws(() => extractText(enc("{ruim"), "application/json"), /JSON inválido/);
    assert.throws(() => extractText(enc("   \n "), "text/plain"), /não tem texto/);
  });

  test("divide em trechos sem passar do limite e sem perder texto", () => {
    const long = Array.from({ length: 40 }, (_, i) => `Frase número ${i} com algum conteúdo.`).join(" ");
    const pieces = chunk(`Título\n\n${long}\n\nFim.`, 200);
    assert.ok(pieces.every((p) => p.text.length <= 200));
    assert.deepEqual(pieces.map((p) => p.ordinal), pieces.map((_, i) => i));
    assert.ok(pieces.map((p) => p.text).join(" ").includes("Frase número 39"));
  });

  test("termos ignoram acentos, maiúsculas, palavras vazias e plural simples", () => {
    assert.deepEqual(terms("As Políticas de COMPRAS da empresa"), ["politica", "compra", "empresa"]);
  });

  test("BM25 ordena pelo trecho mais relevante e respeita o filtro de acesso", () => {
    const index = new Bm25Index([
      { id: "a", text: "trabalho remoto três dias" },
      { id: "b", text: "compras acima de dez mil reais" },
      { id: "c", text: "trabalho remoto e equipamentos de trabalho remoto" },
    ]);
    assert.deepEqual(index.search("trabalho remoto", { limit: 5, allow: () => true }).map((h) => h.id), ["c", "a"]);
    assert.deepEqual(index.search("trabalho remoto", { limit: 5, allow: (id) => id !== "c" }).map((h) => h.id), ["a"]);
  });

  test("vigência: vale a versão mais nova já em vigor; substituídas são marcadas", () => {
    const base = { title: "t", readers: ["*"], owner: "ana", text: "x" };
    const current = currentKnowledge(
      [
        { ...base, source: "a", supersedes: null, version: 1, validFrom: "2026-01-01" },
        { ...base, source: "a", supersedes: null, version: 2, validFrom: "2027-01-01" },
        { ...base, source: "b", supersedes: "a", version: 1, validFrom: "2026-02-01" },
        { ...base, source: "c", supersedes: null, version: 1, validFrom: "2027-01-01" },
      ],
      "2026-06-01",
    );
    assert.deepEqual(
      current.map((c) => [c.source, c.version, c.supersededBy]),
      [["a", 1, "b"], ["b", 1, null]],
    );
  });
});

describe("serviço do Cérebro", () => {
  test("enviar, listar, ler e baixar o original exatamente como foi enviado", async () => {
    const { service } = setup();
    const created = await service.upload("ana", upload("Trabalho remoto", REMOTE));
    assert.deepEqual([created.status, created.current_version, created.latest_version, created.owner], ["current", 1, 1, "ana"]);
    assert.equal(created.versions[0].url, `/api/knowledge/sources/${created.id}/versions/1/original`);
    assert.equal((await service.list("ana")).sources.length, 1);
    const original = await service.original("ana", created.id, 1);
    assert.equal(new TextDecoder().decode(original.bytes), REMOTE);
    assert.deepEqual([original.mediaType, original.filename], ["text/markdown", "trabalho-remoto.md"]);
  });

  test("consulta responde com citação da fonte e versão certas", async () => {
    const { service } = setup();
    const remote = await service.upload("ana", upload("Trabalho remoto", REMOTE));
    await service.upload("ana", upload("Compras", PURCHASE));
    const r = await service.query("ana", { question: "Quantos dias de trabalho remoto são permitidos?" });
    assert.equal(r.abstained, false);
    assert.equal(r.citations[0].source, remote.id);
    assert.equal(r.citations[0].version, 1);
    assert.match(r.answer, /três dias por semana.*\[1\]/s);
    assert.doesNotMatch(r.answer, /#/, "marcas de título do Markdown não aparecem na resposta");
    assert.equal(r.citations[0].url, `/api/knowledge/sources/${remote.id}/versions/1/original`);
    assert.deepEqual(r.decision, { engine: "extractive" });
  });

  test("trecho que só compartilha termos genéricos com a pergunta não vira citação", async () => {
    const { service } = setup();
    const purchases = await service.upload("ana", upload("Compras", PURCHASE));
    await service.upload("ana", upload("Hospedagem", "# Hospedagem\n\nHospedagem acima de 400 reais por noite exige aprovação prévia."));
    const r = await service.query("ana", { question: "Quem aprova compras acima de dez mil reais?" });
    assert.deepEqual(r.citations.map((c) => c.source), [purchases.id]);
  });

  test("sem evidência suficiente, abstém-se em vez de responder", async () => {
    const { service } = setup();
    await service.upload("ana", upload("Trabalho remoto", REMOTE));
    const unrelated = await service.query("ana", { question: "Qual a meta de vendas do trimestre?" });
    assert.deepEqual([unrelated.abstained, unrelated.citations.length], [true, 0]);
    assert.match(unrelated.answer, /evidência suficiente/);
    const empty = await service.query("ana", { question: "o que é isso?" });
    assert.equal(empty.abstained, true);
  });

  test("acesso: quem não é leitor não vê a fonte, o original nem os trechos", async () => {
    const { service } = setup();
    const secret = await service.upload("ana", upload("Compras", PURCHASE, { readers: ["ana", "caio"] }));
    assert.equal((await service.list("bia")).sources.length, 0);
    assert.equal(await status(service.get("bia", secret.id)), 404);
    assert.equal(await status(service.original("bia", secret.id, 1)), 404);
    assert.equal((await service.query("bia", { question: "aprovação do diretor financeiro para compras" })).abstained, true);
    assert.equal((await service.query("caio", { question: "aprovação do diretor financeiro para compras" })).abstained, false);
  });

  test("revogar tira a fonte das respostas na hora; só o dono revoga; repetir é inofensivo", async () => {
    const { service } = setup();
    const s = await service.upload("ana", upload("Trabalho remoto", REMOTE));
    const privateSource = await service.upload("ana", upload("Privada", "Assunto reservado.", { readers: ["ana"] }));
    assert.equal(await status(service.revoke("bia", privateSource.id)), 404, "quem não lê nem sabe que existe");
    const shared = await service.upload("ana", upload("Compras", PURCHASE));
    assert.equal(await status(service.revoke("bia", shared.id)), 403);
    const revoked = await service.revoke("ana", s.id);
    assert.deepEqual([revoked.status, revoked.repeated], ["revoked", false]);
    assert.equal((await service.revoke("ana", s.id)).repeated, true);
    assert.equal((await service.query("ana", { question: "dias de trabalho remoto" })).abstained, true);
    assert.equal(new TextDecoder().decode((await service.original("ana", s.id, 1)).bytes), REMOTE, "o histórico continua guardado");
    assert.equal(await status(service.addVersion("ana", s.id, { filename: "v2.md", media_type: "text/markdown", content_base64: b64("novo") })), 409);
  });

  test("versão nova substitui a anterior nas respostas; versão futura só vale na data", async () => {
    const { service, clock } = setup();
    const s = await service.upload("ana", upload("Compras", PURCHASE));
    const v2 = PURCHASE.replace("30 dias", "45 dias");
    await service.addVersion("ana", s.id, { filename: "compras-v2.md", media_type: "text/markdown", content_base64: b64(v2), valid_from: "2026-04-01T00:00:00Z" });
    const before = await service.query("ana", { question: "prazo de pagamento a fornecedores" });
    assert.deepEqual([before.citations[0].version, /30 dias/.test(before.answer)], [1, true], "antes da data, vale a v1");
    clock.now = "2026-04-02T00:00:00.000Z";
    const after = await service.query("ana", { question: "prazo de pagamento a fornecedores" });
    assert.deepEqual([after.citations[0].version, /45 dias/.test(after.answer), /30 dias/.test(after.answer)], [2, true, false]);
    assert.equal(
      await status(service.addVersion("ana", s.id, { filename: "igual.md", media_type: "text/markdown", content_base64: b64(v2) })),
      409,
      "conteúdo idêntico à última versão",
    );
  });

  test("fonte que substitui outra: só a nova responde; revogar a nova devolve a antiga", async () => {
    const { service } = setup();
    const old = await service.upload("ana", upload("Compras 2025", PURCHASE));
    const replacement = await service.upload("ana", upload("Compras 2026", PURCHASE.replace("30 dias", "60 dias"), { supersedes: old.id }));
    assert.deepEqual([(await service.get("ana", old.id)).status, (await service.get("ana", old.id)).superseded_by], ["superseded", replacement.id]);
    const q = { question: "prazo de pagamento a fornecedores" };
    const now = await service.query("ana", q);
    assert.deepEqual(new Set(now.citations.map((c) => c.source)), new Set([replacement.id]));
    await service.revoke("ana", replacement.id);
    assert.equal((await service.query("ana", q)).citations[0].source, old.id);
  });

  test("só o dono substitui uma fonte", async () => {
    const { service } = setup();
    const owned = await service.upload("ana", upload("Compras", PURCHASE));
    assert.equal(await status(service.upload("bia", upload("Minha versão", PURCHASE, { supersedes: owned.id }))), 403);
  });

  test("validações de envio", async () => {
    const { service } = setup(64);
    assert.equal(await status(service.upload("ana", upload("", REMOTE))), 400);
    assert.equal(await status(service.upload("ana", { ...upload("T", REMOTE), content_base64: "@@@" })), 400);
    assert.equal(await status(service.upload("ana", upload("T", "x".repeat(100)))), 413);
    assert.equal(await status(service.upload("ana", { ...upload("T", "ok"), media_type: "application/pdf" })), 415);
    assert.equal(await status(service.upload("ana", { ...upload("T", "ok"), filename: "../x.md" })), 400);
    assert.equal(await status(service.upload("ana", upload("T", "ok", { readers: [] }))), 400);
    assert.equal(await status(service.upload("ana", upload("T", "ok", { valid_from: "ontem" }))), 400);
    assert.equal(await status(service.upload("ana", { ...upload("T", "ok"), extra: 1 })), 400);
    assert.equal((await service.list("ana")).sources.length, 0, "nada inválido foi gravado");
  });

  test("duas versões enviadas ao mesmo tempo: uma entra, a outra é recusada sem corromper", async () => {
    const { service } = setup();
    const s = await service.upload("ana", upload("Compras", PURCHASE));
    const send = (text: string) =>
      service.addVersion("ana", s.id, { filename: "v.md", media_type: "text/markdown", content_base64: b64(text) });
    const results = await Promise.allSettled([send("versão A"), send("versão B")]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    assert.equal(rejected.reason.status, 409);
    assert.deepEqual((await service.get("ana", s.id)).versions.map((v) => v.version), [2, 1]);
  });

  test("cada consulta fica na trilha sem o texto da pergunta", async () => {
    const { service, ledger } = setup();
    await service.upload("ana", upload("Trabalho remoto", REMOTE));
    await service.query("ana", { question: "dias de trabalho remoto do cliente SIGILOSO" });
    const [event] = await ledger.listEvents("knowledge:queries");
    const detail = JSON.parse(event.detail);
    assert.deepEqual([detail.actor, detail.abstained, detail.engine, detail.cited.length], ["ana", false, "extractive", 1]);
    assert.ok(!event.detail.includes("SIGILOSO"));
  });
});

class ScriptedClient implements ModelClient {
  readonly provider = "claude" as const;
  readonly model = "simulado";
  calls: ModelRequest[] = [];
  reply: () => Promise<string> = async () => "{}";
  async complete(req: ModelRequest) {
    this.calls.push(req);
    return { json: await this.reply(), usage: { output_tokens: 5 }, seconds: 1 };
  }
}

const passages: Passage[] = [
  { n: 1, id: "a@1#0", source: "a", title: "Remoto", version: 1, validFrom: "2026-01-01", text: "Remoto até três dias por semana.", matched: ["remoto"], score: 2 },
  { n: 2, id: "b@1#0", source: "b", title: "Compras", version: 1, validFrom: "2026-01-01", text: "Compras acima de dez mil.", matched: ["compra"], score: 1 },
];

describe("respondedor por modelo", () => {
  const answerer = (c: ModelClient) => new ModelAnswerer({ client: c, fallback: new ExtractiveAnswerer() });

  test("resposta com citações válidas é usada; os trechos vão como dados", async () => {
    const c = new ScriptedClient();
    c.reply = async () => JSON.stringify({ abstain: false, answer: "Até três dias por semana [1].", citations: [1] });
    const a = await answerer(c).answer({ question: "dias remotos?", passages });
    assert.deepEqual([a.kind, a.text, a.kind === "answer" && a.cited, a.trace.engine], ["answer", "Até três dias por semana [1].", [1], "model"]);
    const prompt = JSON.parse(c.calls[0].prompt);
    assert.deepEqual(prompt.trechos.map((t: any) => t.n), [1, 2]);
    assert.match(c.calls[0].system, /SOMENTE os trechos/);
  });

  test("abstenção do modelo é respeitada", async () => {
    const c = new ScriptedClient();
    c.reply = async () => JSON.stringify({ abstain: true, answer: "Os trechos não tratam disso.", citations: [] });
    assert.equal((await answerer(c).answer({ question: "x", passages })).kind, "abstain");
  });

  test("citação inexistente, resposta sem citação ou falha da CLI voltam para o extrativo", async () => {
    const cases: [() => Promise<string>, string][] = [
      [async () => JSON.stringify({ abstain: false, answer: "Algo [7].", citations: [7] }), "unknown_citation"],
      [async () => JSON.stringify({ abstain: false, answer: "Algo sem citar.", citations: [] }), "missing_citation"],
      [async () => "não é json", "invalid_json"],
      [async () => { throw new ModelCallError("quota_exhausted"); }, "quota_exhausted"],
    ];
    for (const [reply, reason] of cases) {
      const c = new ScriptedClient();
      c.reply = reply;
      const a = await answerer(c).answer({ question: "x", passages });
      assert.deepEqual([a.trace.engine, a.trace.fallback, a.kind], ["extractive", reason, "answer"], reason);
    }
  });
});
