/**
 * Modelo de embeddings que roda no próprio computador (Transformers.js + ONNX Runtime, CPU).
 *
 * Padrão: `Xenova/multilingual-e5-small` (multilíngue, bom em português, 384 dimensões). O modelo
 * é baixado do Hugging Face uma única vez para `cacheDir` e depois funciona sem internet. Nenhum
 * texto da empresa sai do computador: só o arquivo do modelo é baixado.
 *
 * A família E5 pede prefixos: "query: " na pergunta e "passage: " no trecho.
 */
import type { EmbeddingKind, EmbeddingModel } from "../domain/embeddings.ts";
import { normalized } from "../domain/embeddings.ts";

export const DEFAULT_EMBEDDING_MODEL = "Xenova/multilingual-e5-small";

type Extractor = (texts: string[], options: { pooling: "mean"; normalize: boolean }) => Promise<{ tolist(): number[][] }>;

export class LocalEmbedder implements EmbeddingModel {
  readonly id: string;
  private readonly model: string;
  private readonly cacheDir: string;
  private extractor: Promise<Extractor> | undefined;

  constructor(options: { model?: string; cacheDir: string }) {
    this.model = options.model ?? DEFAULT_EMBEDDING_MODEL;
    this.cacheDir = options.cacheDir;
    this.id = `${this.model}@q8`;
  }

  async embed(texts: readonly string[], kind: EmbeddingKind): Promise<Float32Array[]> {
    if (!texts.length) return [];
    const extract = await this.load();
    const prefix = kind === "query" ? "query: " : "passage: ";
    const output = await extract(
      texts.map((t) => prefix + t),
      { pooling: "mean", normalize: true },
    );
    return output.tolist().map((v) => normalized(Float32Array.from(v)));
  }

  private load(): Promise<Extractor> {
    this.extractor ??= (async () => {
      // Os tipos da biblioteca não compilam no modo estrito; usamos só estas duas funções.
      const LIBRARY: string = "@huggingface/transformers";
      const { pipeline, env } = (await import(LIBRARY)) as {
        pipeline(task: string, model: string, options: { dtype: string }): Promise<unknown>;
        env: { cacheDir: string; allowLocalModels: boolean; allowRemoteModels: boolean };
      };
      env.cacheDir = this.cacheDir;
      env.allowLocalModels = true;
      env.allowRemoteModels = true;
      return (await pipeline("feature-extraction", this.model, { dtype: "q8" })) as unknown as Extractor;
    })();
    // Falha ao carregar (sem internet na primeira vez, por exemplo): tenta de novo na próxima.
    this.extractor.catch(() => (this.extractor = undefined));
    return this.extractor;
  }
}
