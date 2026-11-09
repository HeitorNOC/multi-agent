/**
 * Índice lexical BM25 em memória. É a implementação inicial de `KnowledgeIndex`: determinística,
 * sem modelo e fácil de auditar. Um índice semântico (LightRAG, pgvector) pode substituí-la com a
 * mesma interface quando o volume ou a qualidade exigirem.
 */
import { terms } from "./text.ts";

export interface IndexedPassage {
  /** Identificador estável do trecho: `fonte@versão#ordem`. */
  id: string;
  text: string;
}

export interface SearchHit {
  id: string;
  score: number;
  /** Termos da pergunta presentes no trecho. */
  matched: string[];
}

export interface KnowledgeIndex {
  search(query: string, options: { limit: number; allow: (id: string) => boolean }): SearchHit[];
  /** Termos distintos da pergunta, após normalização. */
  queryTerms(query: string): string[];
}

const K1 = 1.2;
const B = 0.75;

export class Bm25Index implements KnowledgeIndex {
  private readonly docs: { id: string; length: number; tf: Map<string, number> }[] = [];
  private readonly df = new Map<string, number>();
  private readonly averageLength: number;

  constructor(passages: IndexedPassage[]) {
    for (const p of passages) {
      const tf = new Map<string, number>();
      const words = terms(p.text);
      for (const w of words) tf.set(w, (tf.get(w) ?? 0) + 1);
      for (const w of tf.keys()) this.df.set(w, (this.df.get(w) ?? 0) + 1);
      this.docs.push({ id: p.id, length: words.length, tf });
    }
    this.averageLength = this.docs.reduce((sum, d) => sum + d.length, 0) / Math.max(1, this.docs.length);
  }

  queryTerms(query: string): string[] {
    return [...new Set(terms(query))];
  }

  search(query: string, { limit, allow }: { limit: number; allow: (id: string) => boolean }): SearchHit[] {
    const wanted = this.queryTerms(query);
    const n = this.docs.length;
    const hits: SearchHit[] = [];
    for (const doc of this.docs) {
      if (!allow(doc.id)) continue;
      let score = 0;
      const matched: string[] = [];
      for (const term of wanted) {
        const f = doc.tf.get(term);
        if (!f) continue;
        matched.push(term);
        const df = this.df.get(term) ?? 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        score += (idf * f * (K1 + 1)) / (f + K1 * (1 - B + (B * doc.length) / (this.averageLength || 1)));
      }
      if (score > 0) hits.push({ id: doc.id, score, matched });
    }
    return hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
  }
}
