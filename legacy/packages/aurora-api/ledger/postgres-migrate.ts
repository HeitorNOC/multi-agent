/**
 * Aplica as migrations `NNN_nome.sql` de um diretório, em ordem, uma única vez cada.
 *
 * - Cada migration roda dentro de uma transação: ou aplica inteira, ou nada.
 * - Um advisory lock impede dois processos de migrarem ao mesmo tempo.
 * - A versão aplicada fica em `schema_migrations`; migrations já aplicadas nunca são
 *   reexecutadas. Por isso um arquivo publicado não deve ser editado: crie o próximo.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pool } from "pg";

const MIGRATION_LOCK = 7413000001;
const MIGRATION_FILE = /^(\d{3}_[a-z0-9_]+)\.sql$/;

export async function applyMigrations(pool: Pool, directory: string): Promise<string[]> {
  const files = readdirSync(directory)
    .filter((name) => MIGRATION_FILE.test(name))
    .sort();
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
    const done = new Set(
      (await client.query("SELECT version FROM schema_migrations")).rows.map((r) => String(r.version)),
    );
    for (const file of files) {
      const version = file.replace(/\.sql$/, "");
      if (done.has(version)) continue;
      try {
        await client.query("BEGIN");
        await client.query(readFileSync(join(directory, file), "utf8"));
        await client.query(
          "INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING",
          [version],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw new Error(`Falha na migration ${version}: ${error instanceof Error ? error.message : error}`);
      }
      applied.push(version);
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => {});
    client.release();
  }
  return applied;
}
