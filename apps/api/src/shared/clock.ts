/** Relógio injetável: o domínio nunca chama `new Date()` direto, para os testes controlarem o tempo. */
export interface Clock {
  /** Instante atual em ISO 8601 (UTC). */
  now(): string;
}

export const systemClock: Clock = { now: () => new Date().toISOString() };

/** Relógio de teste: começa em `start` e só anda quando o teste mandar. */
export function manualClock(start = "2026-01-01T00:00:00.000Z") {
  let current = new Date(start).getTime();
  return {
    now: () => new Date(current).toISOString(),
    set(iso: string) {
      current = new Date(iso).getTime();
    },
    advance(ms: number) {
      current += ms;
    },
  };
}
