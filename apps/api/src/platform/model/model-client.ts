/**
 * Contrato de acesso a um modelo de linguagem. Hoje a implementação invoca a CLI oficial já
 * autenticada no computador da empresa (Claude Code ou Codex); um provedor por API pode
 * implementar a mesma interface depois, sem mudar quem a usa.
 */
export interface ModelRequest {
  system: string;
  prompt: string;
  /** JSON Schema da resposta. */
  schema: object;
  timeoutMs: number;
}

export interface ModelCompletion {
  /** JSON da resposta, como texto. */
  json: string;
  usage: Record<string, number>;
  seconds: number;
}

export type ModelProvider = "claude" | "codex";

export interface ModelClient {
  readonly provider: ModelProvider;
  readonly model: string | undefined;
  complete(request: ModelRequest): Promise<ModelCompletion>;
}

/** Falha da chamada ao modelo; `code` é estável e pode ir para a trilha (sem conteúdo). */
export class ModelCallError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`chamada ao modelo falhou: ${code}`);
    this.name = "ModelCallError";
    this.code = code;
  }
}
