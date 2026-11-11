/**
 * Chamadas HTTP aos serviços externos (Google, Slack), com tempo limite, novas tentativas com
 * espera crescente em 429 e 5xx (respeitando Retry-After) e limite de tamanho da resposta.
 * Erros viram `AppError` com código estável; nada do conteúdo vai para a mensagem.
 */
import { AppError, rateLimited, unavailable } from "../../../shared/errors.ts";

export type Fetch = typeof fetch;

export interface HttpOptions {
  fetch?: Fetch;
  timeoutMs?: number;
  retries?: number;
  maxBytes?: number;
  /** Espera entre tentativas (testes passam 0). */
  backoffMs?: number;
}

export class ExternalHttp {
  private readonly fetch: Fetch;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly maxBytes: number;
  private readonly backoffMs: number;

  constructor(options: HttpOptions = {}) {
    this.fetch = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.retries = options.retries ?? 3;
    this.maxBytes = options.maxBytes ?? 30_000_000;
    this.backoffMs = options.backoffMs ?? 500;
  }

  /** Faz o pedido; devolve a resposta já lida (bytes) e o status. 4xx (menos 429) não é repetido. */
  async request(url: string, init: RequestInit & { service: string }): Promise<{ status: number; bytes: Uint8Array; headers: Headers }> {
    let attempt = 0;
    for (;;) {
      let response: Response;
      try {
        response = await this.fetch(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
      } catch {
        if (attempt++ < this.retries) {
          await this.wait(attempt);
          continue;
        }
        throw unavailable("external_unreachable", `${init.service} não respondeu. Tente de novo em instantes.`);
      }
      if ((response.status === 429 || response.status >= 500) && attempt++ < this.retries) {
        await this.wait(attempt, response.headers.get("retry-after"));
        continue;
      }
      const length = Number(response.headers.get("content-length") ?? 0);
      if (length > this.maxBytes) throw new AppError("too_large", "external_too_large", `O arquivo de ${init.service} é maior que o limite`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > this.maxBytes) throw new AppError("too_large", "external_too_large", `O arquivo de ${init.service} é maior que o limite`);
      if (response.status === 429) throw rateLimited("external_rate_limited", `${init.service} pediu para esperar. Tente de novo em alguns minutos.`);
      return { status: response.status, bytes, headers: response.headers };
    }
  }

  async json<T>(url: string, init: RequestInit & { service: string }): Promise<{ status: number; body: T }> {
    const { status, bytes } = await this.request(url, init);
    let body: T;
    try {
      body = JSON.parse(new TextDecoder().decode(bytes)) as T;
    } catch {
      throw unavailable("external_invalid_response", `${init.service} devolveu uma resposta inesperada`);
    }
    return { status, body };
  }

  private wait(attempt: number, retryAfter?: string | null) {
    const seconds = Number(retryAfter);
    const ms = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 30_000) : this.backoffMs * 2 ** (attempt - 1);
    return new Promise((r) => setTimeout(r, this.backoffMs === 0 ? 0 : ms));
  }
}
