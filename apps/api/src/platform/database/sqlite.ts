/**
 * `Database` sobre `node:sqlite`. Uma única conexão: todo acesso passa por uma fila FIFO, porque
 * uma conexão não suporta transações concorrentes (sem a fila, uma leitura de outro pedido cairia
 * dentro da transação aberta).
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { DatabaseUsageError, type Database, type Row, type Sql, type SqlValue } from "./database.ts";
import { SerialLock } from "./serial-lock.ts";

/** `$1` → `?1`: o SQLite aceita parâmetros numerados nesse formato. */
const translate = (text: string) => text.replace(/\$(\d+)/g, "?$1");
const bind = (params: readonly SqlValue[]): SQLInputValue[] =>
  params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p));
/** `node:sqlite` devolve objetos sem protótipo; copiar mantém o formato igual ao do PostgreSQL. */
const plain = <T extends Row>(row: unknown) => ({ ...(row as object) }) as T;

class SqliteSql implements Sql {
  private readonly db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
  }
  async all<T extends Row = Row>(text: string, params: readonly SqlValue[] = []) {
    return this.db.prepare(translate(text)).all(...bind(params)).map((r) => plain<T>(r));
  }
  async one<T extends Row = Row>(text: string, params: readonly SqlValue[] = []) {
    const row = this.db.prepare(translate(text)).get(...bind(params));
    return row === undefined ? undefined : plain<T>(row);
  }
  async run(text: string, params: readonly SqlValue[] = []) {
    return Number(this.db.prepare(translate(text)).run(...bind(params)).changes);
  }
}

export class SqliteDatabase implements Database {
  readonly dialect = "sqlite" as const;
  readonly sql: Sql;
  private readonly db: DatabaseSync;
  private readonly inner: SqliteSql;
  private readonly lock = new SerialLock();

  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    this.inner = new SqliteSql(this.db);
    const inner = this.inner;
    const lock = this.lock;
    // Fora de transação, cada comando também passa pela fila.
    this.sql = {
      all: (t, p) => lock.run(() => inner.all(t, p)),
      one: (t, p) => lock.run(() => inner.one(t, p)),
      run: (t, p) => lock.run(() => inner.run(t, p)),
    };
  }

  transaction<T>(work: (sql: Sql) => Promise<T>): Promise<T> {
    return this.lock.run(async () => {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const value = await work(this.inner);
        this.db.exec("COMMIT");
        return value;
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  exec(script: string): Promise<void> {
    return this.lock.run(async () => {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec(script);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  async close(): Promise<void> {
    await this.lock.run(async () => this.db.close());
  }
}

export { DatabaseUsageError };
