/**
 * Erros de aplicação. Um único tipo com uma categoria (`kind`) e um código estável (`code`):
 * o domínio diz O QUE aconteceu; a camada HTTP decide o status num só lugar.
 */
export type ErrorKind =
  | "invalid" // entrada mal formada
  | "not_found"
  | "forbidden"
  | "conflict" // estado atual impede a operação
  | "rate_limited" // capacidade esgotada; tentar depois
  | "too_large"
  | "unsupported"
  | "unavailable" // dependência fora do ar
  | "internal";

export class AppError extends Error {
  readonly kind: ErrorKind;
  readonly code: string;
  constructor(kind: ErrorKind, code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AppError";
    this.kind = kind;
    this.code = code;
  }
}

export const invalid = (code: string, message: string) => new AppError("invalid", code, message);
export const notFound = (code: string, message: string) => new AppError("not_found", code, message);
export const forbidden = (code: string, message: string) => new AppError("forbidden", code, message);
export const conflict = (code: string, message: string) => new AppError("conflict", code, message);
export const rateLimited = (code: string, message: string) => new AppError("rate_limited", code, message);
export const unavailable = (code: string, message: string) => new AppError("unavailable", code, message);

/** Garante uma condição de domínio; se falhar, lança o erro informado. */
export function ensure(condition: unknown, error: () => AppError): asserts condition {
  if (!condition) throw error();
}
