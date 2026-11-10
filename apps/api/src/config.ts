/**
 * Configuração da API, lida uma vez do ambiente e validada. O resto do código recebe um
 * `Config` tipado e nunca lê `process.env`.
 */
import { fileURLToPath } from "node:url";
import { z } from "zod";

const integer = (min: number, max: number, fallback: number) => z.coerce.number().int().min(min).max(max).default(fallback);

/** Comando como lista JSON: `["python", "runtime/worker.py"]`. */
const jsonCommand = z.string().transform((text, ctx) => {
  try {
    return z.array(z.string().min(1)).min(1).parse(JSON.parse(text));
  } catch {
    ctx.addIssue({ code: "custom", message: "deve ser uma lista JSON de textos" });
    return z.NEVER;
  }
});

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
    AURORA_WORKER_COMMAND: jsonCommand.optional(),
    AURORA_WORKER_CWD: z.string().optional(),
    /** Conexão PostgreSQL dos checkpoints do LangGraph, entregue ao worker. */
    AURORA_CHECKPOINT_DSN: z.string().startsWith("postgres").optional(),
    /** CLI oficial já autenticada no computador da empresa; `none` desliga o modelo. */
    AURORA_MODEL_PROVIDER: z.enum(["none", "claude", "codex"]).default("none"),
    AURORA_MODEL_NAME: z.string().min(1).max(100).optional(),
    /** Troca o executável da CLI (lista JSON). Configuração local confiável; usada em testes. */
    AURORA_MODEL_COMMAND: jsonCommand.optional(),
    AURORA_MODEL_TIMEOUT_MS: integer(1_000, 600_000, 180_000),
    /** Quem redige as respostas do Cérebro: trechos extraídos ou o modelo (com volta ao extrativo). */
    AURORA_KNOWLEDGE_ANSWERER: z.enum(["extractive", "model"]).default("extractive"),
    /** Como o Chief of Staff decide na conversa: regras ou o modelo (com volta às regras). */
    AURORA_CHIEF_ENGINE: z.enum(["rules", "model"]).default("rules"),
    AURORA_KNOWLEDGE_MAX_BYTES: integer(1, 50_000_000, 5_000_000),
    /** Pasta da interface construída; `none` desliga. Padrão: apps/web/dist. */
    AURORA_WEB_DIR: z.string().min(1).optional(),
    /** Catálogo de personas prontas (padrão: apps/api/data/agent-templates.json). */
    AURORA_AGENT_TEMPLATES: z.string().min(1).optional(),
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
  worker: { command: readonly string[] | undefined; cwd: string | undefined; checkpointDsn: string | undefined };
  model: { provider: "none" | "claude" | "codex"; name: string | undefined; command: string[] | undefined; timeoutMs: number };
  knowledge: { answerer: "extractive" | "model"; maxBytes: number };
  chief: { engine: "rules" | "model" };
  templatesPath: string | undefined;
  webDir: string | undefined;
}

const DEFAULT_WEB_DIR = fileURLToPath(new URL("../../web/dist", import.meta.url));

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
    worker: { command: e.AURORA_WORKER_COMMAND, cwd: e.AURORA_WORKER_CWD, checkpointDsn: e.AURORA_CHECKPOINT_DSN },
    model: { provider: e.AURORA_MODEL_PROVIDER, name: e.AURORA_MODEL_NAME, command: e.AURORA_MODEL_COMMAND, timeoutMs: e.AURORA_MODEL_TIMEOUT_MS },
    knowledge: { answerer: e.AURORA_KNOWLEDGE_ANSWERER, maxBytes: e.AURORA_KNOWLEDGE_MAX_BYTES },
    chief: { engine: e.AURORA_CHIEF_ENGINE },
    templatesPath: e.AURORA_AGENT_TEMPLATES,
    webDir: e.AURORA_WEB_DIR === "none" ? undefined : (e.AURORA_WEB_DIR ?? DEFAULT_WEB_DIR),
  };
}
