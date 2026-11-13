/**
 * Contrato do banco usado pelos repositórios.
 *
 * Os repositórios escrevem SQL uma única vez, com parâmetros `$1, $2…`, sobre `Sql`. Cada
 * banco (SQLite, PostgreSQL) implementa `Database`; as diferenças de dialeto ficam nas
 * migrations e no executor, não espalhadas pelo código.
 *
 * Garantias exigidas de toda implementação:
 *  - `transaction` é atômica e serializada com as demais transações da instalação;
 *  - leituras fora de transação nunca veem escritas ainda não confirmadas;
 *  - usar o banco externo dentro de uma transação é erro imediato (não um travamento).
 */
export type SqlValue = string | number | boolean | null | Uint8Array;
export type Row = Record<string, unknown>;

export interface Sql {
  all<T extends Row = Row>(text: string, params?: readonly SqlValue[]): Promise<T[]>;
  one<T extends Row = Row>(text: string, params?: readonly SqlValue[]): Promise<T | undefined>;
  /** Executa e devolve quantas linhas foram afetadas. */
  run(text: string, params?: readonly SqlValue[]): Promise<number>;
}

export type Dialect = "sqlite" | "postgres";

export interface Database {
  readonly dialect: Dialect;
  /** Acesso fora de transação (cada comando confirma sozinho). */
  readonly sql: Sql;
  transaction<T>(work: (sql: Sql) => Promise<T>): Promise<T>;
  /** Executa um script com vários comandos de forma atômica (migrations): tudo ou nada. */
  exec(script: string): Promise<void>;
  close(): Promise<void>;
}

export class DatabaseUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseUsageError";
  }
}
