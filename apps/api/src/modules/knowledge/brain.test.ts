// Cérebro organizado: áreas, formatos (PDF e Word), texto escrito, trechos com contexto e busca
// com preferência de área. Os casos de uso rodam nos dois bancos.
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { manualClock } from "../../shared/clock.ts";
import { AppError } from "../../shared/errors.ts";
import { ActorId } from "../../shared/ids.ts";
import { UnitOfWork } from "../../platform/database/unit-of-work.ts";
import { dialects, fresh, type TestDatabase } from "../../../test/support/databases.ts";
import { docxWith, pdfWith } from "../../../test/support/office-files.ts";
import { askKnowledge } from "./application/ask.ts";
import { ExtractiveAnswerer } from "./application/answerers.ts";
import { KnowledgeSearch } from "./application/knowledge-search.ts";
import { listSources, moveSource, uploadSource, viewSource, type KnowledgeDeps } from "./application/sources.ts";
import { chunk, terms } from "./domain/text.ts";
import { Bm25Index } from "./infrastructure/bm25-index.ts";
import { extractDocumentText } from "./infrastructure/document-text.ts";
import { knowledgeStore } from "./infrastructure/sql-knowledge.ts";

const ana = ActorId.parse("ana");
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : String(e)));
const b64 = (bytes: Uint8Array | string) => Buffer.from(bytes).toString("base64");
const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const AREAS = [
  { id: "operations", title: "Operações & Suprimentos" },
  { id: "finance", title: "Finanças" },
];

test("termos: plural em português vira singular", () => {
  assert.deepEqual(terms("fornecedores ações papéis jornais itens livres contratos"), ["fornecedor", "acao", "papel", "jornal", "item", "livre", "contrato"]);
  assert.deepEqual(terms("fornecedor ação papel"), ["fornecedor", "acao", "papel"]);
});

test("trechos: seção do documento e CSV sempre com cabeçalho", () => {
  const md = "# Política de compras\n\n## Aprovação\n\nAcima de dez mil, o diretor aprova.\n\n## Pagamento\n\nPrazo de 30 dias.";
  // Seções curtas não se misturam: cada título abre um trecho, com o rótulo certo.
  const short = chunk("# Decisões\n\n## Marketing\n\nOrçamento de 50 mil.\n\n## Contratações\n\nDuas vagas.");
  assert.deepEqual(short.map((p) => [p.section, p.text.includes("50 mil")]), [["Marketing", true], ["Contratações", false]]);
  const pieces = chunk(md, 40);
  assert.equal(pieces.find((p) => /diretor/.test(p.text))?.section, "Aprovação");
  assert.equal(pieces.find((p) => /30 dias/.test(p.text))?.section, "Pagamento");
  const csv = ["item,preço,fornecedor", ...Array.from({ length: 40 }, (_, i) => `produto ${i},${i * 10},Alfa`)].join("\n");
  const rows = chunk(csv, 200, "text/csv");
  assert.ok(rows.length > 1);
  assert.ok(rows.every((r) => r.text.startsWith("item,preço,fornecedor\n")), "cada trecho da tabela se explica sozinho");
});

test("PDF e Word: texto extraído; PDF escaneado é recusado com orientação", async () => {
  assert.match(await extractDocumentText(pdfWith(["Contrato de fornecimento", "Desconto de 12% acima de dez mil"]), PDF), /Desconto de 12% acima de dez mil/);
  assert.equal(await extractDocumentText(docxWith(["Política de férias", "Pedidos com 30 dias de antecedência."]), DOCX), "Política de férias\n\nPedidos com 30 dias de antecedência.");
  assert.equal(await code(extractDocumentText(pdfWith([]), PDF)), "pdf_without_text");
  assert.equal(await code(extractDocumentText(new TextEncoder().encode("não é pdf"), PDF)), "invalid_pdf");
  assert.equal(await code(extractDocumentText(new TextEncoder().encode("não é zip"), DOCX)), "invalid_docx");
});

const opened: TestDatabase[] = [];
afterEach(async () => {
  for (const d of opened.splice(0)) await d.close();
});

for (const dialect of dialects) {
  describe(`Cérebro por área e formato — ${dialect}`, () => {
    async function setup() {
      const d = await fresh(dialect);
      opened.push(d);
      const clock = manualClock("2026-03-01T10:00:00.000Z");
      const uow = new UnitOfWork(d.db, knowledgeStore(clock));
      const search = new KnowledgeSearch(uow, clock, (p) => new Bm25Index(p));
      const deps: KnowledgeDeps = { uow, clock, search, answerer: new ExtractiveAnswerer(), maxBytes: 1_000_000, areas: AREAS, extract: extractDocumentText };
      return { deps, search };
    }

    test("envio por área, PDF, Word e texto escrito: formato e origem aparecem na lista", async () => {
      const { deps } = await setup();
      await uploadSource(deps, ana, { title: "Contrato Alfa", filename: "alfa.pdf", mediaType: PDF, contentBase64: b64(pdfWith(["Desconto de 12% acima de dez mil reais."])), area: "operations" });
      await uploadSource(deps, ana, { title: "Férias", filename: "ferias.docx", mediaType: DOCX, contentBase64: b64(docxWith(["Férias com 30 dias de aviso."])) });
      const note = await uploadSource(deps, ana, { title: "Reunião de orçamento", text: "# Decisões\n\nO orçamento de marketing é de 50 mil.", area: "finance" });
      assert.equal(note.versions[0]!.filename, "reuniao-de-orcamento.md");
      assert.equal(note.versions[0]!.origin, "text");
      const list = await listSources(deps, ana);
      assert.deepEqual(
        list.sources.map((s) => [s.title, s.area, s.format?.label, s.format?.origin]),
        [["Contrato Alfa", "operations", "PDF", "file"], ["Férias", "general", "Word", "file"], ["Reunião de orçamento", "finance", "MD", "text"]],
      );
      assert.deepEqual(list.areas.map((a) => [a.id, a.sources]), [["general", 1], ["operations", 1], ["finance", 1]]);
      assert.equal(await code(uploadSource(deps, ana, { title: "X", text: "algo", area: "marte" })), "unknown_area");
      assert.equal(await code(uploadSource(deps, ana, { title: "X", text: "   " })), "empty_text");
      assert.equal(await code(uploadSource(deps, ana, { title: "X" })), "missing_content");
    });

    test("mudar de área e perguntar só numa área", async () => {
      const { deps } = await setup();
      const a = await uploadSource(deps, ana, { title: "Prazo de pagamento", text: "O prazo de pagamento a fornecedores é de 30 dias." });
      await uploadSource(deps, ana, { title: "Prazo de entrega", text: "O prazo de pagamento da transportadora é de 15 dias.", area: "operations" });
      const before = await askKnowledge(deps, ana, "prazo de pagamento", { area: "operations" });
      assert.deepEqual(before.citations.map((c) => c.title), ["Prazo de entrega"]);
      await moveSource(deps, ana, a.id as never, "finance");
      assert.equal((await viewSource(deps, ana, a.id as never)).area, "finance");
      const finance = await askKnowledge(deps, ana, "prazo de pagamento", { area: "finance" });
      assert.deepEqual(finance.citations.map((c) => c.title), ["Prazo de pagamento"], "a busca vê a mudança de área na hora");
      assert.equal(await code(moveSource(deps, ActorId.parse("bia"), a.id as never, "operations")), "not_owner", "quem só lê não muda a área");
    });

    test("agentes preferem fontes da própria área, sem perder uma fonte Geral", async () => {
      const { search, deps } = await setup();
      await uploadSource(deps, ana, { title: "Política geral", text: "Pagamento a fornecedores em 30 dias." });
      await uploadSource(deps, ana, { title: "Manual de compras", text: "Pagamento a fornecedores em 45 dias, conforme contrato.", area: "operations" });
      const ops = await search.forAgents("pagamento fornecedores", 5, [], { preferArea: "operations" });
      assert.equal(ops[0]!.title, "Manual de compras");
      assert.ok(ops.some((p) => p.title === "Política geral"), "a fonte Geral continua disponível");
      const fin = await search.forAgents("pagamento fornecedores", 5, [], { preferArea: "finance" });
      assert.equal(fin.length, 2);
    });
  });
}
