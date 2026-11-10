// Cérebro: texto, índice, vigência, acesso, revogação, substituição e respondedores.
// Casos de uso contra SQLite e (se configurado) PostgreSQL; nenhum modelo real é chamado.
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { manualClock } from "../../shared/clock.ts";
import { AppError } from "../../shared/errors.ts";
import { ActorId, type SourceId } from "../../shared/ids.ts";
import { UnitOfWork } from "../../platform/database/unit-of-work.ts";
import { stream } from "../../platform/events/event-log.ts";
import { ModelCallError, type ModelClient, type ModelRequest } from "../../platform/model/model-client.ts";
import { dialects, fresh, type TestDatabase } from "../../../test/support/databases.ts";
import { ExtractiveAnswerer, ModelAnswerer, type Passage } from "./application/answerers.ts";
import { askKnowledge } from "./application/ask.ts";
import { KnowledgeSearch } from "./application/knowledge-search.ts";
import { addVersion, listSources, originalFile, revokeSource, uploadSource, viewSource, type KnowledgeDeps, type UploadInput } from "./application/sources.ts";
import { currentVersions, type IndexableVersion } from "./domain/source.ts";
import { chunk, extractText, terms } from "./domain/text.ts";
import { Bm25Index } from "./infrastructure/bm25-index.ts";
import { knowledgeStore } from "./infrastructure/sql-knowledge.ts";

const enc = (s: string) => new TextEncoder().encode(s);
const b64 = (s: string) => Buffer.from(enc(s)).toString("base64");
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : String(e)));
const ana = ActorId.parse("ana");
const bia = ActorId.parse("bia");
const caio = ActorId.parse("caio");

const REMOTE = "# Política de trabalho remoto\n\nO trabalho remoto é permitido até três dias por semana.\n\nPedidos de equipamento vão ao setor de TI.";
const PURCHASE = "# Política de compras\n\nCompras acima de dez mil reais exigem aprovação do diretor financeiro.\n\nO prazo de pagamento a fornecedores é de 30 dias.";
const doc = (title: string, text: string, extra: Partial<UploadInput> = {}): UploadInput => ({
  title,
  filename: `${title.toLowerCase().replace(/\W+/g, "-")}.md`,
  mediaType: "text/markdown",
  contentBase64: b64(text),
  ...extra,
});
const file = (text: string, validFrom?: string) => ({ filename: "v.md", mediaType: "text/markdown", contentBase64: b64(text), validFrom });

describe("texto e índice", () => {
  test("extrai os formatos aceitos e recusa os demais", () => {
    assert.equal(extractText(enc("﻿linha 1\r\nlinha 2"), "text/plain"), "linha 1\nlinha 2");
    assert.equal(extractText(enc('{"a":[1,2]}'), "application/json"), '{\n  "a": [\n    1,\n    2\n  ]\n}');
    assert.throws(() => extractText(enc("x"), "application/pdf"), (e) => e instanceof AppError && e.kind === "unsupported");
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
    const base = { title: "t", readers: ["*"], owner: ana, text: "x" };
    const v = (sourceId: string, version: number, validFrom: string, supersedes: string | null = null) =>
      ({ ...base, sourceId, version, validFrom, supersedes }) as unknown as IndexableVersion;
    const current = currentVersions([v("a", 1, "2026-01-01"), v("a", 2, "2027-01-01"), v("b", 1, "2026-02-01", "a"), v("c", 1, "2027-01-01")], "2026-06-01");
    assert.deepEqual(current.map((c) => [c.sourceId, c.version, c.supersededBy]), [["a", 1, "b"], ["b", 1, null]]);
  });
});

const opened: TestDatabase[] = [];
afterEach(async () => {
  for (const d of opened.splice(0)) await d.close();
});

for (const dialect of dialects) {
  describe(`casos de uso do Cérebro — ${dialect}`, () => {
    async function setup(maxBytes = 5_000_000) {
      const d = await fresh(dialect);
      opened.push(d);
      const clock = manualClock("2026-03-01T12:00:00.000Z");
      const uow = new UnitOfWork(d.db, knowledgeStore(clock));
      const deps: KnowledgeDeps = { uow, clock, search: new KnowledgeSearch(uow, clock, (p) => new Bm25Index(p)), answerer: new ExtractiveAnswerer(), maxBytes };
      return { deps, clock };
    }

    test("enviar, listar, ler e baixar o original exatamente como foi enviado", async () => {
      const { deps } = await setup();
      const created = await uploadSource(deps, ana, doc("Trabalho remoto", REMOTE));
      assert.deepEqual([created.status, created.current_version, created.latest_version, created.owner], ["current", 1, 1, "ana"]);
      assert.equal(created.versions[0]!.url, `/api/knowledge/sources/${created.id}/versions/1/original`);
      assert.equal((await listSources(deps, ana)).sources.length, 1);
      const original = await originalFile(deps, ana, created.id, 1);
      assert.equal(new TextDecoder().decode(original.bytes), REMOTE);
      assert.deepEqual([original.mediaType, original.filename], ["text/markdown", "trabalho-remoto.md"]);
    });

    test("consulta responde com citação da fonte e versão certas", async () => {
      const { deps } = await setup();
      const remote = await uploadSource(deps, ana, doc("Trabalho remoto", REMOTE));
      await uploadSource(deps, ana, doc("Compras", PURCHASE));
      const r = await askKnowledge(deps, ana, "Quantos dias de trabalho remoto são permitidos?");
      assert.equal(r.abstained, false);
      assert.deepEqual([r.citations[0]!.source, r.citations[0]!.version], [remote.id, 1]);
      assert.match(r.answer, /três dias por semana.*\[1\]/s);
      assert.doesNotMatch(r.answer, /#/, "marcas de título do Markdown não aparecem na resposta");
      assert.deepEqual(r.decision, { engine: "extractive" });
    });

    test("trecho que só compartilha termos genéricos com a pergunta não vira citação", async () => {
      const { deps } = await setup();
      const purchases = await uploadSource(deps, ana, doc("Compras", PURCHASE));
      await uploadSource(deps, ana, doc("Hospedagem", "# Hospedagem\n\nHospedagem acima de 400 reais por noite exige aprovação prévia."));
      const r = await askKnowledge(deps, ana, "Quem aprova compras acima de dez mil reais?");
      assert.deepEqual(r.citations.map((c) => c.source), [purchases.id]);
    });

    test("sem evidência suficiente, abstém-se em vez de responder", async () => {
      const { deps } = await setup();
      await uploadSource(deps, ana, doc("Trabalho remoto", REMOTE));
      const unrelated = await askKnowledge(deps, ana, "Qual a meta de vendas do trimestre?");
      assert.deepEqual([unrelated.abstained, unrelated.citations.length], [true, 0]);
      assert.match(unrelated.answer, /evidência suficiente/);
      assert.equal((await askKnowledge(deps, ana, "o que é isso?")).abstained, true);
    });

    test("acesso: quem não é leitor não vê a fonte, o original nem os trechos", async () => {
      const { deps } = await setup();
      const secret = await uploadSource(deps, ana, doc("Compras", PURCHASE, { readers: ["ana", "caio"] }));
      assert.equal((await listSources(deps, bia)).sources.length, 0);
      assert.equal(await code(viewSource(deps, bia, secret.id)), "source_not_found");
      assert.equal(await code(originalFile(deps, bia, secret.id, 1)), "source_not_found");
      assert.equal((await askKnowledge(deps, bia, "aprovação do diretor financeiro para compras")).abstained, true);
      assert.equal((await askKnowledge(deps, caio, "aprovação do diretor financeiro para compras")).abstained, false);
      assert.deepEqual(await deps.search.forAgents("aprovação do diretor financeiro para compras", 5), [], "agentes só leem fontes abertas a todos");
    });

    test("revogar tira a fonte das respostas na hora; só o dono revoga; repetir é inofensivo", async () => {
      const { deps } = await setup();
      const s = await uploadSource(deps, ana, doc("Trabalho remoto", REMOTE));
      const privateSource = await uploadSource(deps, ana, doc("Privada", "Assunto reservado.", { readers: ["ana"] }));
      assert.equal(await code(revokeSource(deps, bia, privateSource.id)), "source_not_found", "quem não lê nem sabe que existe");
      const shared = await uploadSource(deps, ana, doc("Compras", PURCHASE));
      assert.equal(await code(revokeSource(deps, bia, shared.id)), "not_owner");
      const revoked = await revokeSource(deps, ana, s.id);
      assert.deepEqual([revoked.status, revoked.repeated, revoked.current_version], ["revoked", false, null]);
      assert.equal((await revokeSource(deps, ana, s.id)).repeated, true);
      assert.equal((await askKnowledge(deps, ana, "dias de trabalho remoto")).abstained, true);
      assert.equal(new TextDecoder().decode((await originalFile(deps, ana, s.id, 1)).bytes), REMOTE, "o histórico continua guardado");
      assert.equal(await code(addVersion(deps, ana, s.id, file("novo"))), "source_revoked");
    });

    test("versão nova substitui a anterior nas respostas; versão futura só vale na data", async () => {
      const { deps, clock } = await setup();
      const s = await uploadSource(deps, ana, doc("Compras", PURCHASE));
      const v2 = PURCHASE.replace("30 dias", "45 dias");
      await addVersion(deps, ana, s.id, file(v2, "2026-04-01T00:00:00Z"));
      const before = await askKnowledge(deps, ana, "prazo de pagamento a fornecedores");
      assert.deepEqual([before.citations[0]!.version, /30 dias/.test(before.answer)], [1, true], "antes da data, vale a v1");
      clock.set("2026-04-02T00:00:00.000Z");
      const after = await askKnowledge(deps, ana, "prazo de pagamento a fornecedores");
      assert.deepEqual([after.citations[0]!.version, /45 dias/.test(after.answer), /30 dias/.test(after.answer)], [2, true, false]);
      assert.equal(await code(addVersion(deps, ana, s.id, file(v2))), "same_content");
    });

    test("fonte que substitui outra: só a nova responde; revogar a nova devolve a antiga", async () => {
      const { deps } = await setup();
      const old = await uploadSource(deps, ana, doc("Compras 2025", PURCHASE));
      const replacement = await uploadSource(deps, ana, doc("Compras 2026", PURCHASE.replace("30 dias", "60 dias"), { supersedes: old.id }));
      const oldView = await viewSource(deps, ana, old.id);
      assert.deepEqual([oldView.status, oldView.superseded_by], ["superseded", replacement.id]);
      const now = await askKnowledge(deps, ana, "prazo de pagamento a fornecedores");
      assert.deepEqual(new Set(now.citations.map((c) => c.source)), new Set([replacement.id]));
      await revokeSource(deps, ana, replacement.id);
      assert.equal((await askKnowledge(deps, ana, "prazo de pagamento a fornecedores")).citations[0]!.source, old.id);
    });

    test("só o dono substitui; regras do arquivo; nada inválido é gravado", async () => {
      const { deps } = await setup(64);
      const owned = await uploadSource(deps, ana, doc("Compras", "Compras acima de dez mil."));
      assert.equal(await code(uploadSource(deps, bia, doc("Minha versão", "ok", { supersedes: owned.id }))), "not_owner");
      assert.equal(await code(uploadSource(deps, ana, doc("T", "ok", { supersedes: "nao-existe" as SourceId }))), "source_not_found");
      assert.equal(await code(uploadSource(deps, ana, { ...doc("T", "ok"), contentBase64: "@@@" })), "invalid_base64");
      assert.equal(await code(uploadSource(deps, ana, doc("T", "x".repeat(100)))), "file_too_large");
      assert.equal(await code(uploadSource(deps, ana, { ...doc("T", "ok"), mediaType: "application/pdf" })), "unsupported_media_type");
      assert.equal(await code(uploadSource(deps, ana, { ...doc("T", "ok"), filename: "../x.md" })), "invalid_filename");
      assert.equal((await listSources(deps, ana)).sources.length, 1);
    });

    test("versões enviadas ao mesmo tempo entram em sequência, sem número repetido", async () => {
      const { deps } = await setup();
      const s = await uploadSource(deps, ana, doc("Compras", PURCHASE));
      await Promise.all([addVersion(deps, ana, s.id, file("versão A")), addVersion(deps, ana, s.id, file("versão B"))]);
      const view = await viewSource(deps, ana, s.id);
      assert.deepEqual([view.versions.map((v) => v.version), view.latest_version], [[3, 2, 1], 3]);
    });

    test("cada consulta fica na trilha sem o texto da pergunta", async () => {
      const { deps } = await setup();
      await uploadSource(deps, ana, doc("Trabalho remoto", REMOTE));
      await askKnowledge(deps, ana, "dias de trabalho remoto do cliente SIGILOSO");
      const [event] = await deps.uow.read.events.list(stream.knowledge("queries"));
      const detail = event!.detail as { actor: string; abstained: boolean; engine: string; cited: string[] };
      assert.deepEqual([detail.actor, detail.abstained, detail.engine, detail.cited.length], ["ana", false, "extractive", 1]);
      assert.ok(!JSON.stringify(event!.detail).includes("SIGILOSO"));
    });
  });
}

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
  { n: 1, id: "a@1#0", sourceId: "a", title: "Remoto", version: 1, validFrom: "2026-01-01", text: "Remoto até três dias por semana.", matched: ["remoto"], score: 2 },
  { n: 2, id: "b@1#0", sourceId: "b", title: "Compras", version: 1, validFrom: "2026-01-01", text: "Compras acima de dez mil.", matched: ["compra"], score: 1 },
];

describe("respondedor por modelo", () => {
  const answerer = (c: ModelClient) => new ModelAnswerer({ client: c, fallback: new ExtractiveAnswerer(), now: () => "2026-03-01T12:00:00.000Z" });

  test("resposta com citações válidas é usada; os trechos vão como dados", async () => {
    const c = new ScriptedClient();
    c.reply = async () => JSON.stringify({ abstain: false, answer: "Até três dias por semana [1].", citations: [1] });
    const a = await answerer(c).answer({ question: "dias remotos?", passages });
    assert.deepEqual([a.kind, a.text, a.kind === "answer" && a.cited, a.trace.engine], ["answer", "Até três dias por semana [1].", [1], "model"]);
    const prompt = JSON.parse(c.calls[0]!.prompt);
    assert.deepEqual(prompt.trechos.map((t: { n: number }) => t.n), [1, 2]);
    assert.equal(prompt.hoje, "2026-03-01");
    assert.match(c.calls[0]!.system, /SOMENTE os trechos/);
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
      [
        async () => {
          throw new ModelCallError("quota_exhausted");
        },
        "quota_exhausted",
      ],
    ];
    for (const [reply, reason] of cases) {
      const c = new ScriptedClient();
      c.reply = reply;
      const a = await answerer(c).answer({ question: "x", passages });
      assert.deepEqual([a.trace.engine, a.trace.fallback, a.kind], ["extractive", reason, "answer"], reason);
    }
  });
});
