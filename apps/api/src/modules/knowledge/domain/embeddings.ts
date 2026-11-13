/**
 * Busca por significado (embeddings). Um modelo transforma texto em vetor; textos com sentido
 * parecido ficam com vetores próximos (cosseno alto), mesmo sem palavras em comum:
 * "gasto com viagem" acha "despesas de deslocamento".
 *
 * O domínio só conhece a interface; o modelo local fica em `infrastructure/local-embedder.ts`.
 */
export type EmbeddingKind = "query" | "passage";

export interface EmbeddingModel {
  /** Identifica o modelo e a versão; vetores de modelos diferentes nunca se misturam. */
  readonly id: string;
  embed(texts: readonly string[], kind: EmbeddingKind): Promise<Float32Array[]>;
}

/** Cosseno entre vetores já normalizados (comprimento 1): o produto escalar. */
export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot;
}

export function normalized(v: Float32Array): Float32Array {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum) || 1;
  return v.map((x) => x / norm);
}

/**
 * Fusão por posição (Reciprocal Rank Fusion): cada lista dá `1 / (k + posição)` a cada item.
 * Usa só a ordem, então junta pontuações de escalas diferentes (BM25 e cosseno) sem calibrar.
 */
export function reciprocalRankFusion(lists: readonly (readonly string[])[], k = 60): Map<string, number> {
  const fused = new Map<string, number>();
  for (const list of lists) list.forEach((id, rank) => fused.set(id, (fused.get(id) ?? 0) + 1 / (k + rank + 1)));
  return fused;
}

export const toBytes = (v: Float32Array) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);

export function fromBytes(bytes: Uint8Array): Float32Array {
  // Copia para um buffer alinhado: o do banco pode começar em qualquer posição.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Float32Array(copy.buffer);
}
