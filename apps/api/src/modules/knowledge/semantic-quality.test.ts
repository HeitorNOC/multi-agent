// Qualidade da busca com o modelo real (multilingual-e5-small). Roda quando o modelo já foi
// baixado (apps/api/data/models); sem ele, é ignorado (o CI não baixa 118 MB).
// Protege a calibração: mudanças na busca não podem piorar acertos nem criar falsos positivos.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { ActorId } from "../../shared/ids.ts";
import { migrate } from "../../platform/database/migrate.ts";
import { SqliteDatabase } from "../../platform/database/sqlite.ts";
import { UnitOfWork } from "../../platform/database/unit-of-work.ts";
import { ExtractiveAnswerer } from "./application/answerers.ts";
import { KnowledgeSearch } from "./application/knowledge-search.ts";
import { SemanticIndex } from "./application/semantic-index.ts";
import { uploadSource } from "./application/sources.ts";
import { Bm25Index } from "./infrastructure/bm25-index.ts";
import { DEFAULT_EMBEDDING_MODEL, LocalEmbedder } from "./infrastructure/local-embedder.ts";
import { knowledgeStore } from "./infrastructure/sql-knowledge.ts";

const MODELS = fileURLToPath(new URL("../../../data/models", import.meta.url));
const ready = existsSync(join(MODELS, ...DEFAULT_EMBEDDING_MODEL.split("/")));

const DOCS: [string, string][] = [
  ["Política de reembolso", "Despesas de deslocamento são reembolsadas em até 15 dias após a entrega da nota fiscal."],
  ["Manual de férias", "Pedidos de férias devem ser feitos com 30 dias de antecedência ao gestor."],
  ["Contrato Alfa", "O fornecedor Alfa concede desconto de 12% em compras acima de dez mil reais, com pagamento em 45 dias."],
  ["Política de compras", "Compras acima de dez mil reais exigem três cotações e aprovação do diretor financeiro."],
  ["Tabela de fretes 2026", "Frete para o Nordeste: 8% do valor do pedido, prazo de 5 dias."],
  ["Decisões da reunião", "# Marketing\n\nO orçamento de marketing do trimestre é de 50 mil reais."],
  ["Segurança da informação", "Senhas devem ter no mínimo 12 caracteres e ser trocadas a cada 90 dias."],
  ["Atendimento", "O cliente deve receber resposta em até 24 horas úteis pelo e-mail de suporte."],
];
/** Perguntas com outras palavras (sinônimos) e perguntas que nenhum documento responde. */
const QUESTIONS: [string, string | null][] = [
  ["Em quanto tempo o gasto com viagem é devolvido?", "Política de reembolso"],
  ["Com quanto tempo de aviso preciso pedir descanso?", "Manual de férias"],
  ["Qual o abatimento do fornecedor Alfa?", "Contrato Alfa"],
  ["Quem autoriza aquisições grandes?", "Política de compras"],
  ["Quanto custa entregar na região nordeste?", "Tabela de fretes 2026"],
  ["Quanto vamos investir em propaganda neste trimestre?", "Decisões da reunião"],
  ["Qual o tamanho mínimo de uma senha?", "Segurança da informação"],
  ["Qual o prazo para responder um cliente?", "Atendimento"],
  ["desconto do fornecedor Alfa", "Contrato Alfa"],
  ["Qual a cor do logotipo da empresa?", null],
  ["Quantos funcionários temos em São Paulo?", null],
  ["Qual o horário de almoço?", null],
  ["Como cadastrar um novo produto no site?", null],
  ["Qual o CNPJ da empresa?", null],
];

test("busca híbrida com o modelo real: acha por sinônimo e não inventa", { skip: !ready && "modelo não baixado" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "aurora-quality-"));
  const db = new SqliteDatabase(join(dir, "a.db"));
  try {
    await migrate(db, new Date().toISOString());
    const clock = { now: () => new Date().toISOString() };
    const uow = new UnitOfWork(db, knowledgeStore(clock));
    const semantic = new SemanticIndex({ model: new LocalEmbedder({ cacheDir: MODELS }), uow, clock });
    const search = new KnowledgeSearch(uow, clock, (p) => new Bm25Index(p), { semantic });
    const deps = { uow, clock, search, answerer: new ExtractiveAnswerer(), maxBytes: 1e6 };
    for (const [title, text] of DOCS) await uploadSource(deps, ActorId.parse("ana"), { title, text });
    await search.semanticStatus();
    await semantic.settle();
    let right = 0;
    const problems: string[] = [];
    for (const [q, want] of QUESTIONS) {
      const top = (await search.search(q, () => true, 5)).found[0]?.title ?? null;
      if (top === want) right += want ? 1 : 0;
      else if (top !== null) problems.push(`${q} → ${top}`);
    }
    assert.deepEqual(problems, [], "nenhuma resposta errada nem falso positivo");
    assert.ok(right >= 8, `acertos: ${right}/9`);
  } finally {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
