// Imagens no Cérebro e anexos na conversa: a imagem é lida uma vez pelo modelo com visão, vira
// fonte citável e vai junto com o pedido. Modelo falso: nenhuma cota é usada.
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { manualClock } from "../../shared/clock.ts";
import { AppError } from "../../shared/errors.ts";
import { ActorId, type ConversationId, type JobId } from "../../shared/ids.ts";
import { UnitOfWork } from "../../platform/database/unit-of-work.ts";
import { CallLimiter } from "../../platform/model/call-limiter.ts";
import { ModelCallError, type ModelClient, type ModelRequest } from "../../platform/model/model-client.ts";
import { dialects, fresh, type TestDatabase } from "../../../test/support/databases.ts";
import { pdfWith } from "../../../test/support/office-files.ts";
import { RuleBasedChiefOfStaff } from "../conversations/domain/chief-of-staff.ts";
import { createConversation, readConversation, sendMessage, type ConversationDeps } from "../conversations/application/conversations.ts";
import { conversationStore } from "../conversations/infrastructure/sql-conversations.ts";
import { askKnowledge } from "./application/ask.ts";
import { ExtractiveAnswerer } from "./application/answerers.ts";
import { KnowledgeSearch } from "./application/knowledge-search.ts";
import { originalFile, uploadSource, type KnowledgeDeps } from "./application/sources.ts";
import { Bm25Index } from "./infrastructure/bm25-index.ts";
import { fileTextExtractor } from "./infrastructure/document-text.ts";
import { ImageReader } from "./infrastructure/image-reader.ts";
import { knowledgeStore } from "./infrastructure/sql-knowledge.ts";

const ana = ActorId.parse("ana");
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : String(e)));
/** PNG mínimo válido o bastante para a assinatura (o modelo falso não decodifica). */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

class VisionModel implements ModelClient {
  readonly provider = "claude" as const;
  readonly model = "simulado";
  calls: ModelRequest[] = [];
  fail: string | null = null;
  async complete(req: ModelRequest) {
    this.calls.push(req);
    if (this.fail) throw new ModelCallError(this.fail);
    const text = "| Item | Valor |\n| --- | --- |\n| Cimento | 42 reais o saco |";
    return { json: JSON.stringify({ text, description: "Foto de uma tabela de preços escrita num quadro branco." }), usage: {}, seconds: 0.1 };
  }
}

const opened: TestDatabase[] = [];
afterEach(async () => {
  for (const d of opened.splice(0)) await d.close();
});

for (const dialect of dialects) {
  describe(`Imagens e anexos — ${dialect}`, () => {
    async function setup(model: VisionModel | null = new VisionModel()) {
      const d = await fresh(dialect);
      opened.push(d);
      const clock = manualClock("2026-03-01T10:00:00.000Z");
      const kuow = new UnitOfWork(d.db, knowledgeStore(clock));
      const search = new KnowledgeSearch(kuow, clock, (p) => new Bm25Index(p));
      const reader = model ? new ImageReader({ client: model, limiter: new CallLimiter(1, 4), timeoutMs: 5000 }) : null;
      const knowledge: KnowledgeDeps = { uow: kuow, clock, search, answerer: new ExtractiveAnswerer(), maxBytes: 100_000, extract: fileTextExtractor(reader) };
      const opens: { text: string; attachments?: readonly string[] }[] = [];
      const deps: ConversationDeps = {
        uow: new UnitOfWork(d.db, conversationStore(clock)),
        chief: new RuleBasedChiefOfStaff(),
        offers: [{ id: "open", title: "Trabalho", keywords: [] }],
        jobs: {
          open: async (_o, text, onAdmitted, attachments) => {
            opens.push({ text, attachments });
            await deps.uow.run((_s, tx) => onAdmitted("job-1" as JobId, tx));
            return { opened: true };
          },
          describe: async () => undefined,
        },
        clock,
        attach: async (actor, file) => {
          const s = await uploadSource(knowledge, actor, { ...file, title: file.filename.replace(/\.[^.]+$/, "") });
          return { source: s.id, title: s.title };
        },
      };
      return { knowledge, deps, model, opens };
    }

    test("imagem vira fonte: o modelo lê uma vez, a pergunta acha e cita, o original abre", async () => {
      const { knowledge, model } = await setup();
      const s = await uploadSource(knowledge, ana, { title: "Preços no quadro", filename: "quadro.png", mediaType: "image/png", contentBase64: b64(PNG) });
      assert.equal(model!.calls.length, 1);
      assert.equal(model!.calls[0]!.images![0]!.mediaType, "image/png");
      assert.equal(s.format?.label, "PNG");
      const r = await askKnowledge(knowledge, ana, "Quanto custa o saco de cimento?");
      assert.equal(r.citations[0]?.title, "Preços no quadro");
      assert.match(r.answer, /42 reais/);
      assert.equal(model!.calls.length, 1, "perguntar não lê a imagem de novo");
      const original = await originalFile(knowledge, ana, s.id as never, 1);
      assert.deepEqual([...original.bytes], [...PNG], "a citação abre a imagem original");
    });

    test("sem modelo, imagem é recusada com orientação; formato trocado e falha do modelo também", async () => {
      const none = await setup(null);
      assert.equal(await code(uploadSource(none.knowledge, ana, { title: "X", filename: "x.png", mediaType: "image/png", contentBase64: b64(PNG) })), "image_needs_model");
      const { knowledge, model } = await setup();
      assert.equal(await code(uploadSource(knowledge, ana, { title: "X", filename: "x.png", mediaType: "image/png", contentBase64: b64(new TextEncoder().encode("não sou png")) })), "format_mismatch");
      assert.equal(await code(uploadSource(knowledge, ana, { title: "X", filename: "x.pdf", mediaType: "application/pdf", contentBase64: b64(PNG) })), "format_mismatch");
      assert.equal(await code(uploadSource(knowledge, ana, { title: "X", filename: "x.pdf", mediaType: "application/pdf", contentBase64: b64(pdfWith(["ok pdf"])) })), "ok");
      model!.fail = "quota_exhausted";
      assert.equal(await code(uploadSource(knowledge, ana, { title: "X", filename: "x.png", mediaType: "image/png", contentBase64: b64(PNG) })), "quota_exhausted");
      model!.fail = "timeout";
      assert.equal(await code(uploadSource(knowledge, ana, { title: "X", filename: "x.png", mediaType: "image/png", contentBase64: b64(PNG) })), "image_model_failed");
    });

    test("anexo na conversa: vai ao Cérebro, fica na mensagem e segue com o pedido; repetir não lê de novo", async () => {
      const { deps, model, opens } = await setup();
      const conv = await createConversation(deps, ana);
      const send = () =>
        sendMessage(deps, ana, conv.id as ConversationId, {
          text: "Analise os preços desta foto e diga se estão bons para a obra",
          clientId: "envio-0001",
          attachments: [{ filename: "quadro.png", mediaType: "image/png", contentBase64: b64(PNG) }],
        });
      const first = await send();
      assert.deepEqual(first.user.attachments!.map((a) => a.title), ["quadro"]);
      assert.equal(opens.length, 1);
      assert.deepEqual(opens[0]!.attachments, [first.user.attachments![0]!.source], "o pedido leva a fonte anexada");
      const again = await send();
      assert.equal(again.replayed, true);
      assert.equal(model!.calls.length, 1, "o mesmo envio não lê a imagem de novo");
      const read = await readConversation(deps, ana, conv.id as ConversationId);
      assert.equal(read.messages[0]!.attachments![0]!.title, "quadro");
    });

    test("anexo que falha não grava a mensagem; mais de 4 anexos é recusado", async () => {
      const { deps, model } = await setup();
      const conv = await createConversation(deps, ana);
      model!.fail = "timeout";
      const img = { filename: "a.png", mediaType: "image/png", contentBase64: b64(PNG) };
      assert.equal(await code(sendMessage(deps, ana, conv.id as ConversationId, { text: "veja a foto por favor", attachments: [img] })), "image_model_failed");
      assert.equal((await readConversation(deps, ana, conv.id as ConversationId)).messages.length, 0);
      assert.equal(await code(sendMessage(deps, ana, conv.id as ConversationId, { text: "muitas fotos aqui", attachments: [img, img, img, img, img] })), "too_many_attachments");
    });
  });
}
