/**
 * Configuração da API, lida uma vez do ambiente e validada. O resto do código recebe um
 * `Config` tipado e nunca lê `process.env`.
 */
import { z } from "zod";

const integer = (min: number, max: number, fallback: number) => z.coerce.number().int().min(min).max(max).default(fallback);

const schema = z
  .object({
    AURORA_PORT: integer(0, 65_535, 0),
    /** PostgreSQL (`postgres://...`). Sem ele, usa SQLite em `AURORA_SQLITE_PATH`. */
    AURORA_DATABASE_URL: z.string().startsWith("postgres").optional(),
    AURORA_DATABASE_SCHEMA: z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/).optional(),
    AURORA_SQLITE_PATH: z.string().min(1).default("data/aurora.db"),
    AURORA_QUEUE_CAPACITY: integer(1, 1000, 20),
    AURORA_RESUME_RESERVE: integer(0, 999, 2),
    AURORA_MAX_WORKERS: integer(1, 8, 1),
    /** Comando do worker como lista JSON: `["python", "runtime/worker.py"]`. */
    AURORA_WORKER_COMMAND: z
      .string()
      .transform((text, ctx) => {
        try {
          return z.array(z.string().min(1)).min(1).parse(JSON.parse(text));
        } catch {
          ctx.addIssue({ code: "custom", message: "deve ser uma lista JSON de textos" });
          return z.NEVER;
        }
      })
      .optional(),
    AURORA_WORKER_CWD: z.string().optional(),
  })
  .refine((env) => env.AURORA_RESUME_RESERVE < env.AURORA_QUEUE_CAPACITY, {
    message: "AURORA_RESUME_RESERVE deve ser menor que AURORA_QUEUE_CAPACITY",
    path: ["AURORA_RESUME_RESERVE"],
  });

export type DatabaseConfig = { dialect: "postgres"; url: string; schema?: string } | { dialect: "sqlite"; path: string };

export interface Config {
  port: number;
  database: DatabaseConfig;
  queue: { capacity: number; resumeReserve: number; maxWorkers: number };
  worker: { command: readonly string[] | undefined; cwd: string | undefined };
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`);
    throw new ConfigError(`Configuração inválida:\n${lines.join("\n")}`);
  }
  const e = parsed.data;
  return {
    port: e.AURORA_PORT,
    database: e.AURORA_DATABASE_URL
      ? { dialect: "postgres", url: e.AURORA_DATABASE_URL, schema: e.AURORA_DATABASE_SCHEMA }
      : { dialect: "sqlite", path: e.AURORA_SQLITE_PATH },
    queue: { capacity: e.AURORA_QUEUE_CAPACITY, resumeReserve: e.AURORA_RESUME_RESERVE, maxWorkers: e.AURORA_MAX_WORKERS },
    worker: { command: e.AURORA_WORKER_COMMAND, cwd: e.AURORA_WORKER_CWD },
  };
}
