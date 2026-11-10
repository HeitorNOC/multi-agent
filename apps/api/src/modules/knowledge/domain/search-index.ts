/**
 * Índice de busca dos trechos vigentes. A implementação inicial é BM25 (lexical, determinística,
 * fácil de auditar); um índice semântico pode substituí-la com a mesma interface.
 */
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

export type IndexBuilder = (passages: IndexedPassage[]) => KnowledgeIndex;

/** Um trecho de uma versão vigente, como chega a quem responde. */
export interface Passage {
  /** Número da citação mostrado ao usuário: [1], [2]... */
  n: number;
  id: string;
  sourceId: string;
  title: string;
  version: number;
  validFrom: string;
  text: string;
  matched: string[];
  score: number;
}

export const originalUrl = (sourceId: string, version: number) => `/api/knowledge/sources/${sourceId}/versions/${version}/original`;
