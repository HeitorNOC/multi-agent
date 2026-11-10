/**
 * `Database` sobre PostgreSQL. Leituras fora de transação usam o pool e só veem dados confirmados.
 * Transações tomam um advisory lock da instalação, o que serializa escritores também entre
 * processos; dentro do processo, uma fila FIFO garante a ordem de chegada.
 */
import { createHash } from "node:crypto";
import pg from "pg";
import type { Pool, PoolClient } from "pg";
import type { Database, Row, Sql, SqlValue } from "./database.ts";
import { SerialLock } from "./serial-lock.ts";

export interface PostgresOptions {
  connectionString: string;
  /** Esquema dedicado; útil para isolar instalações ou testes no mesmo servidor. */
  schema?: string;
  /** Nome que identifica a instalação no advisory lock de escrita. */
  lockName: string;
  poolSize?: number;
}

const SCHEMA = /^[a-z_][a-z0-9_]{0,62}$/;
const params = (values: readonly SqlValue[]) =>
  values.map((v) => (v instanceof Uint8Array && !Buffer.isBuffer(v) ? Buffer.from(v) : v));

/** Chave estável de advisory lock a partir de um nome; cabe em 48 bits. */
export const lockKey = (name: string) => parseInt(createHash("sha256").update(name).digest("hex").slice(0, 12), 16);

class PgSql implements Sql {
  private readonly db: Pick<Pool, "query">;
  constructor(db: Pick<Pool, "query">) {
    this.db = db;
  }
  async all<T extends Row = Row>(text: string, values: readonly SqlValue[] = []) {
    return (await this.db.query(text, params(values))).rows as T[];
  }
  async one<T extends Row = Row>(text: string, values: readonly SqlValue[] = []) {
    return (await this.db.query(text, params(values))).rows[0] as T | undefined;
  }
  async run(text: string, values: readonly SqlValue[] = []) {
    return (await this.db.query(text, params(values))).rowCount ?? 0;
  }
}

export class PostgresDatabase implements Database {
  readonly dialect = "postgres" as const;
  readonly sql: Sql;
  readonly pool: Pool;
  private readonly lock = new SerialLock();
  private readonly writeLock: number;

  private constructor(pool: Pool, writeLock: number) {
    this.pool = pool;
    this.writeLock = writeLock;
    const inner = new PgSql(pool);
    const lock = this.lock;
    this.sql = {
      all: (t, p) => (lock.assertOutside(), inner.all(t, p)),
      one: (t, p) => (lock.assertOutside(), inner.one(t, p)),
      run: (t, p) => (lock.assertOutside(), inner.run(t, p)),
    };
  }

  static async connect(options: PostgresOptions): Promise<PostgresDatabase> {
    const { schema } = options;
    if (schema !== undefined) {
      if (!SCHEMA.test(schema)) throw new Error("Nome de esquema inválido");
      const admin = new pg.Pool({ connectionString: options.connectionString, max: 1 });
      try {
        await admin.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
      } finally {
        await admin.end();
      }
    }
    const pool = new pg.Pool({
      connectionString: options.connectionString,
      max: options.poolSize ?? 5,
      ...(schema ? { options: `-c search_path=${schema}` } : {}),
    });
    return new PostgresDatabase(pool, lockKey(`write:${options.lockName}:${schema ?? ""}`));
  }

  transaction<T>(work: (sql: Sql) => Promise<T>): Promise<T> {
    return this.lock.run(async () => {
      const client: PoolClient = await this.pool.connect();
      let broken = false;
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock($1)", [this.writeLock]);
        const value = await work(new PgSql(client));
        await client.query("COMMIT");
        return value;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          broken = true; // conexão em estado desconhecido: não volta para o pool
        }
        throw error;
      } finally {
        client.release(broken ? true : undefined);
      }
    });
  }

  async exec(script: string): Promise<void> {
    await this.lock.run(async () => {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(script);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    });
  }

  async close(): Promise<void> {
    await this.lock.run(async () => undefined);
    await this.pool.end();
  }
}
