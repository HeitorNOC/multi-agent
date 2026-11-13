/**
 * Bancos para testes de contrato: um SQLite novo em diretório temporário e, se
 * AURORA_TEST_POSTGRES_URL estiver definida, um esquema PostgreSQL novo. Cada chamada de
 * `fresh` cria um banco vazio com as migrations aplicadas.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import type { Database, Dialect } from "../../src/platform/database/database.ts";
import { migrate } from "../../src/platform/database/migrate.ts";
import { PostgresDatabase } from "../../src/platform/database/postgres.ts";
import { SqliteDatabase } from "../../src/platform/database/sqlite.ts";

const postgresUrl = process.env.AURORA_TEST_POSTGRES_URL;
export const dialects: Dialect[] = postgresUrl ? ["sqlite", "postgres"] : ["sqlite"];

export interface TestDatabase {
  db: Database;
  close(): Promise<void>;
}

export async function fresh(dialect: Dialect): Promise<TestDatabase> {
  if (dialect === "sqlite") {
    const dir = mkdtempSync(join(tmpdir(), "aurora-v2-"));
    const db = new SqliteDatabase(join(dir, "aurora.sqlite"));
    await migrate(db, "2026-01-01T00:00:00.000Z");
    return {
      db,
      async close() {
        await db.close();
        rmSync(dir, { recursive: true, force: true });
      },
    };
  }
  const schema = "t_" + randomBytes(6).toString("hex");
  const db = await PostgresDatabase.connect({ connectionString: postgresUrl!, schema, lockName: "teste" });
  await migrate(db, "2026-01-01T00:00:00.000Z");
  return {
    db,
    async close() {
      await db.close();
      const admin = new pg.Pool({ connectionString: postgresUrl, max: 1 });
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    },
  };
}
