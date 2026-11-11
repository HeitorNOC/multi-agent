/**
 * Índice semântico dos trechos vigentes: guarda o vetor de cada trecho e compara com o da
 * pergunta.
 *
 * - Os vetores ficam no banco (`knowledge_embeddings`) e em memória. A chave é o hash do texto
 *   vetorizado, então reiniciar a API não recalcula nada e trechos iguais são feitos uma vez só.
 * - Vetorizar é feito em segundo plano, em lotes, depois de cada mudança no Cérebro: enviar um
 *   arquivo continua rápido. Enquanto um trecho não tem vetor, ele é achado só por palavras.
 * - Se o modelo falhar (sem internet na primeira vez, por exemplo), a busca segue só por palavras
 *   e o estado mostra o erro; a próxima mudança tenta de novo.
 */
import { createHash } from "node:crypto";
import type { Clock } from "../../../shared/clock.ts";
import type { UnitOfWork } from "../../../platform/database/unit-of-work.ts";
import { cosine, type EmbeddingModel } from "../domain/embeddings.ts";
import type { KnowledgeStore } from "../infrastructure/sql-knowledge.ts";

const BATCH = 16;

export interface SemanticStatus {
  model: string;
  /** Trechos vigentes com vetor / total. */
  indexed: number;
  total: number;
  running: boolean;
  error: string | null;
}

export interface SemanticHit {
  id: string;
  similarity: number;
}

export class SemanticIndex {
  private readonly model: EmbeddingModel;
  private readonly uow: UnitOfWork<KnowledgeStore>;
  private readonly clock: Clock;
  private vectors: Map<string, Float32Array> | undefined;
  /** Texto vetorizável de cada trecho vigente, por id do trecho. */
  private wanted = new Map<string, { key: string; text: string }>();
  private running: Promise<void> | undefined;
  private error: string | null = null;

  constructor(deps: { model: EmbeddingModel; uow: UnitOfWork<KnowledgeStore>; clock: Clock }) {
    this.model = deps.model;
    this.uow = deps.uow;
    this.clock = deps.clock;
  }

  /** Os trechos vigentes mudaram: guarda o conjunto e vetoriza o que faltar, em segundo plano. */
  sync(passages: Iterable<{ id: string; text: string }>) {
    this.wanted = new Map([...passages].map((p) => [p.id, { key: keyOf(this.model.id, p.text), text: p.text }]));
    void this.fill();
  }

  /** Vetoriza de novo o que estiver faltando (depois de uma falha). */
  retry() {
    void this.fill();
  }

  /** Espera a vetorização em andamento (testes e ferramentas). */
  async settle() {
    while (this.running) await this.running;
  }

  status(): SemanticStatus {
    const vectors = this.vectors;
    const indexed = vectors ? [...this.wanted.values()].filter((w) => vectors.has(w.key)).length : 0;
    return { model: this.model.id, indexed, total: this.wanted.size, running: !!this.running, error: this.error };
  }

  /** Trechos mais parecidos com a pergunta, entre os permitidos; vazio se o modelo não responder. */
  async search(question: string, allow: (id: string) => boolean, limit: number): Promise<SemanticHit[]> {
    const vectors = await this.loaded();
    let query: Float32Array;
    try {
      [query] = (await this.model.embed([question], "query")) as [Float32Array];
    } catch (e) {
      this.error = message(e);
      return [];
    }
    const hits: SemanticHit[] = [];
    for (const [id, w] of this.wanted) {
      const v = vectors.get(w.key);
      if (v && allow(id)) hits.push({ id, similarity: cosine(query, v) });
    }
    return hits.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  }

  private async loaded() {
    this.vectors ??= await this.uow.read.embeddings.list(this.model.id);
    return this.vectors;
  }

  private fill(): Promise<void> {
    if (this.running) return this.running;
    this.running = (async () => {
      try {
        const vectors = await this.loaded();
        for (;;) {
          const missing = [...new Map([...this.wanted.values()].filter((w) => !vectors.has(w.key)).map((w) => [w.key, w])).values()].slice(0, BATCH);
          if (!missing.length) break;
          const made = await this.model.embed(
            missing.map((m) => m.text),
            "passage",
          );
          const at = this.clock.now();
          await this.uow.run(async (s) => {
            for (const [i, m] of missing.entries()) await s.embeddings.put(this.model.id, m.key, made[i]!, at);
          });
          missing.forEach((m, i) => vectors.set(m.key, made[i]!));
        }
        this.error = null;
      } catch (e) {
        this.error = message(e);
      } finally {
        this.running = undefined;
      }
    })();
    return this.running;
  }
}

const keyOf = (model: string, text: string) => createHash("sha256").update(model).update("\0").update(text).digest("hex");
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
