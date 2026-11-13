/**
 * Aplica as migrations do dialeto (`migrations/<dialeto>/NNN_nome.sql`), em ordem, uma vez cada.
 * Cada arquivo roda numa transação junto com o registro em `schema_migrations`: ou aplica
 * inteiro, ou nada. Um arquivo já aplicado nunca é editado; crie o próximo.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Database } from "./database.ts";

const FILE = /^(\d{3}_[a-z0-9_]+)\.sql$/;

export async function migrate(db: Database, now: string): Promise<string[]> {
  const dir = fileURLToPath(new URL(`./migrations/${db.dialect}/`, import.meta.url));
  await db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const done = new Set((await db.sql.all<{ version: string }>("SELECT version FROM schema_migrations")).map((r) => r.version));
  const applied: string[] = [];
  for (const file of readdirSync(dir).filter((f) => FILE.test(f)).sort()) {
    const version = file.slice(0, -4);
    if (done.has(version)) continue;
    const script = readFileSync(dir + file, "utf8");
    // `version` vem do nome do arquivo (validado acima) e `now` do relógio: seguros em literal.
    await db.exec(`${script}\nINSERT INTO schema_migrations (version, applied_at) VALUES ('${version}', '${now}');`);
    applied.push(version);
  }
  return applied;
}
