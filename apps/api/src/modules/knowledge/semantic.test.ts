// Busca híbrida (palavras + significado), nos dois bancos, com um modelo falso determinístico:
// cada grupo de sinônimos é uma dimensão do vetor. Assim o teste não baixa modelo nenhum.
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { manualClock } from "../../shared/clock.ts";
import { ActorId } from "../../shared/ids.ts";
import { UnitOfWork } from "../../platform/database/unit-of-work.ts";
import { dialects, fresh, type TestDatabase } from "../../../test/support/databases.ts";
import { askKnowledge } from "./application/ask.ts";
import { ExtractiveAnswerer } from "./application/answerers.ts";
import { KnowledgeSearch } from "./application/knowledge-search.ts";
import { SemanticIndex } from "./application/semantic-index.ts";
import { uploadSource, type KnowledgeDeps } from "./application/sources.ts";
import { cosine, normalized, reciprocalRankFusion, type EmbeddingKind, type EmbeddingModel } from "./domain/embeddings.ts";
import { normalize } from "./domain/text.ts";
import { Bm25Index } from "./infrastructure/bm25-index.ts";
import { knowledgeStore } from "./infrastructure/sql-knowledge.ts";

const CONCEPTS = [
  ["gasto", "despesa", "custo"],
  ["viagem", "deslocamento", "transporte"],
  ["devolv", "reembols", "ressarc"],
  ["prazo", "tempo", "dias"],
  ["ferias", "folga", "descanso"],
  ["contrat", "admiss"],
];

class SynonymEmbedder implements EmbeddingModel {
  readonly id = "sinonimos@1";
  passages = 0;
  failing = false;
  async embed(texts: readonly string[], kind: EmbeddingKind) {
    if (this.failing) throw new Error("modelo fora do ar");
    if (kind === "passage") this.passages += texts.length;
    return texts.map((t) => {
      const words = normalize(t).split(/[^a-z]+/);
      const v = new Float32Array(CONCEPTS.length + 1).fill(0);
      CONCEPTS.forEach((group, i) => (v[i] = words.filter((w) => group.some((g) => w.startsWith(g))).length));
      v[CONCEPTS.length] = 0.05; // um pouco de "ruído" comum a todos
      return normalized(v);
    });
  }
}

test("RRF: quem aparece nas duas listas sobe; cosseno de vetores normalizados", () => {
  const fused = reciprocalRankFusion([["a", "b", "c"], ["c", "a"]]);
  assert.deepEqual([...fused].sort((x, y) => y[1] - x[1]).map(([id]) => id), ["a", "c", "b"]);
  const v = normalized(Float32Array.from([3, 4]));
  assert.ok(Math.abs(cosine(v, v) - 1) < 1e-6);
});

const ana = ActorId.parse("ana");
const opened: TestDatabase[] = [];
afterEach(async () => {
  for (const d of opened.splice(0)) await d.close();
});

for (const dialect of dialects) {
  describe(`Busca híbrida — ${dialect}`, () => {
    async function setup(embedder = new SynonymEmbedder(), db?: TestDatabase) {
      const d = db ?? (await fresh(dialect));
      if (!db) opened.push(d);
      const clock = manualClock("2026-03-01T10:00:00.000Z");
      const uow = new UnitOfWork(d.db, knowledgeStore(clock));
      const semantic = new SemanticIndex({ model: embedder, uow, clock });
      const search = new KnowledgeSearch(uow, clock, (p) => new Bm25Index(p), { semantic, minSimilarity: 0.6 });
      const deps: KnowledgeDeps = { uow, clock, search, answerer: new ExtractiveAnswerer(), maxBytes: 100_000 };
      return { deps, search, semantic, embedder, d };
    }

    test("acha pelo sentido o que não tem nenhuma palavra em comum", async () => {
      const { deps, semantic } = await setup();
      await uploadSource(deps, ana, { title: "Política de reembolso", text: "Despesas de deslocamento são reembolsadas em até 15 dias." });
      await uploadSource(deps, ana, { title: "Férias", text: "Pedidos de folga precisam de 30 dias de aviso." });
      await deps.search.semanticStatus();
      await semantic.settle();
      const r = await askKnowledge(deps, ana, "Quando o gasto com viagem é devolvido?");
      assert.equal(r.abstained, false);
      assert.deepEqual(r.citations.map((c) => c.title), ["Política de reembolso"]);
      assert.deepEqual(semantic.status(), { model: "sinonimos@1", indexed: 2, total: 2, running: false, error: null });
    });

    test("sem relação nenhuma, continua se abstendo", async () => {
      const { deps, semantic } = await setup();
      await uploadSource(deps, ana, { title: "Política de reembolso", text: "Despesas de deslocamento são reembolsadas em até 15 dias." });
      await deps.search.semanticStatus();
      await semantic.settle();
      const r = await askKnowledge(deps, ana, "Qual a cor do logotipo da marca?");
      assert.equal(r.abstained, true);
    });

    test("termo exato (nome, número) continua achado pelas palavras", async () => {
      const { deps, semantic } = await setup();
      await uploadSource(deps, ana, { title: "Contrato Alfa", text: "O fornecedor Alfa dá desconto de 12% no pedido mínimo." });
      await uploadSource(deps, ana, { title: "Reembolso", text: "Despesas de viagem são reembolsadas." });
      await deps.search.semanticStatus();
      await semantic.settle();
      const r = await askKnowledge(deps, ana, "desconto do fornecedor Alfa");
      assert.equal(r.citations[0]?.title, "Contrato Alfa");
    });

    test("vetores ficam guardados: reiniciar não recalcula nada", async () => {
      const first = await setup();
      await uploadSource(first.deps, ana, { title: "Reembolso", text: "Despesas de viagem são reembolsadas." });
      await first.search.semanticStatus();
      await first.semantic.settle();
      assert.equal(first.embedder.passages, 1);
      const again = await setup(new SynonymEmbedder(), first.d);
      await again.search.semanticStatus();
      await again.semantic.settle();
      assert.equal(again.embedder.passages, 0, "o vetor veio do banco");
      assert.equal(again.semantic.status().indexed, 1);
    });

    test("modelo fora do ar: a busca segue por palavras e o estado mostra o erro", async () => {
      const embedder = new SynonymEmbedder();
      embedder.failing = true;
      const { deps, semantic } = await setup(embedder);
      await uploadSource(deps, ana, { title: "Reembolso", text: "Despesas de viagem são reembolsadas em 15 dias." });
      await deps.search.semanticStatus();
      await semantic.settle();
      assert.equal(semantic.status().error, "modelo fora do ar");
      const r = await askKnowledge(deps, ana, "despesas de viagem reembolsadas");
      assert.equal(r.citations[0]?.title, "Reembolso");
      embedder.failing = false;
      deps.search.invalidate();
      await deps.search.semanticStatus();
      await new Promise((r) => setTimeout(r, 10));
      await semantic.settle();
      assert.equal(semantic.status().error, null, "a próxima mudança tenta de novo");
      assert.equal(semantic.status().indexed, 1);
    });
  });
}
