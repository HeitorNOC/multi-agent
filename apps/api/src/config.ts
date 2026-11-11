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
    /** Fuso dos horários das rotinas (IANA). Padrão: o do computador. */
    AURORA_TIMEZONE: z
      .string()
      .refine((tz) => {
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      }, "fuso desconhecido (use um nome IANA, como America/Sao_Paulo)")
      .default(Intl.DateTimeFormat().resolvedOptions().timeZone),
    /** Pasta da interface construída; `none` desliga. Padrão: apps/web/dist. */
    AURORA_WEB_DIR: z.string().min(1).optional(),
    /** Catálogo de personas prontas (padrão: apps/api/data/agent-templates.json). */
    AURORA_AGENT_TEMPLATES: z.string().min(1).optional(),
    /**
     * `local` (padrão): uso individual no próprio computador, sem login. `accounts`: cada pessoa
     * entra com a própria conta (senha, Google ou Microsoft).
     */
    AURORA_AUTH: z.enum(["accounts", "local"]).default("local"),
    /**
     * Busca por significado no Cérebro. `local` (padrão): modelo de embeddings no próprio
     * computador, baixado uma vez do Hugging Face. `none`: só busca por palavras.
     */
    AURORA_EMBEDDINGS: z.enum(["local", "none"]).default("local"),
    AURORA_EMBEDDING_MODEL: z.string().min(1).max(200).optional(),
    /** Pasta dos modelos baixados. Padrão: apps/api/data/models. */
    AURORA_MODELS_DIR: z.string().min(1).optional(),
    /**
     * Quando um trecho achado só pelo significado conta como evidência: similaridade de pelo menos
     * AURORA_SEMANTIC_MIN, ou destaque de AURORA_SEMANTIC_GAP sobre a média dos trechos.
     */
    AURORA_SEMANTIC_MIN: z.coerce.number().min(0).max(1).default(0.86),
    AURORA_SEMANTIC_GAP: z.coerce.number().min(0).max(1).default(0.025),
    /** Entrar com Google: aplicativo OAuth "Web" criado no Google Cloud da empresa. */
    AURORA_GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    AURORA_GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    /** Entrar com Microsoft: aplicativo registrado no Entra ID (Azure). */
    AURORA_MICROSOFT_CLIENT_ID: z.string().min(1).optional(),
    AURORA_MICROSOFT_CLIENT_SECRET: z.string().min(1).optional(),
    /** `common` (qualquer conta Microsoft), `organizations` ou o id do diretório da empresa. */
    AURORA_MICROSOFT_TENANT: z.string().regex(/^[A-Za-z0-9.-]{1,100}$/).default("common"),
  })
  .refine((env) => env.AURORA_RESUME_RESERVE < env.AURORA_QUEUE_CAPACITY, {
    message: "AURORA_RESUME_RESERVE deve ser menor que AURORA_QUEUE_CAPACITY",
    path: ["AURORA_RESUME_RESERVE"],
  })
  .refine((env) => !env.AURORA_GOOGLE_CLIENT_ID === !env.AURORA_GOOGLE_CLIENT_SECRET, {
    message: "defina AURORA_GOOGLE_CLIENT_ID e AURORA_GOOGLE_CLIENT_SECRET juntos",
    path: ["AURORA_GOOGLE_CLIENT_ID"],
  })
  .refine((env) => !env.AURORA_MICROSOFT_CLIENT_ID === !env.AURORA_MICROSOFT_CLIENT_SECRET, {
    message: "defina AURORA_MICROSOFT_CLIENT_ID e AURORA_MICROSOFT_CLIENT_SECRET juntos",
    path: ["AURORA_MICROSOFT_CLIENT_ID"],
  });

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

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
  embeddings: { mode: "local" | "none"; model: string | undefined; modelsDir: string; minSimilarity: number; minGap: number };
  auth: {
    mode: "accounts" | "local";
    google: OAuthClient | undefined;
    microsoft: (OAuthClient & { tenant: string }) | undefined;
  };
  webDir: string | undefined;
  timeZone: string;
}

const DEFAULT_WEB_DIR = fileURLToPath(new URL("../../web/dist", import.meta.url));
const DEFAULT_MODELS_DIR = fileURLToPath(new URL("../data/models", import.meta.url));

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
    embeddings: {
      mode: e.AURORA_EMBEDDINGS,
      model: e.AURORA_EMBEDDING_MODEL,
      modelsDir: e.AURORA_MODELS_DIR ?? DEFAULT_MODELS_DIR,
      minSimilarity: e.AURORA_SEMANTIC_MIN,
      minGap: e.AURORA_SEMANTIC_GAP,
    },
    auth: {
      mode: e.AURORA_AUTH,
      google: e.AURORA_GOOGLE_CLIENT_ID && e.AURORA_GOOGLE_CLIENT_SECRET ? { clientId: e.AURORA_GOOGLE_CLIENT_ID, clientSecret: e.AURORA_GOOGLE_CLIENT_SECRET } : undefined,
      microsoft:
        e.AURORA_MICROSOFT_CLIENT_ID && e.AURORA_MICROSOFT_CLIENT_SECRET
          ? { clientId: e.AURORA_MICROSOFT_CLIENT_ID, clientSecret: e.AURORA_MICROSOFT_CLIENT_SECRET, tenant: e.AURORA_MICROSOFT_TENANT }
          : undefined,
    },
    timeZone: e.AURORA_TIMEZONE,
    webDir: e.AURORA_WEB_DIR === "none" ? undefined : (e.AURORA_WEB_DIR ?? DEFAULT_WEB_DIR),
  };
}
