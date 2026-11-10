/**
 * Cliente de modelo que invoca a CLI oficial já autenticada no computador do usuário
 * (Claude Code ou Codex). O Aurora nunca lê, copia ou guarda credenciais: a CLI usa a
 * sessão que o próprio usuário abriu.
 *
 * Proteções, iguais às do adaptador Python (`model_provider.py`):
 *  - sem ferramentas, sem rede de ferramentas, sem sessão persistida;
 *  - ambiente filtrado: só as variáveis que a CLI precisa para achar a conta;
 *  - saída obrigatoriamente em JSON validado por schema;
 *  - tempo limite e teto de saída; o processo é encerrado se passar.
 *
 * Um provedor remoto (API) pode implementar `ModelClient` depois, sem mudar quem o usa.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ModelRequest {
  system: string;
  prompt: string;
  /** JSON Schema da resposta. */
  schema: object;
  timeoutMs: number;
}

export interface ModelCompletion {
  /** JSON da resposta, como texto. */
  json: string;
  usage: Record<string, unknown>;
  seconds: number;
}

export interface ModelClient {
  readonly provider: "claude" | "codex";
  readonly model: string | undefined;
  complete(request: ModelRequest): Promise<ModelCompletion>;
}

/** Falha da chamada ao modelo; `code` é estável e pode ir para a trilha (sem conteúdo). */
export class ModelCallError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`chamada ao modelo falhou: ${code}`);
    this.name = "ModelCallError";
    this.code = code;
  }
}

const ENV_ALLOW = new Set([
  "PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
  "LOCALAPPDATA", "APPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "COMSPEC",
  "PROCESSOR_ARCHITECTURE", "HOME", "CODEX_HOME", "CLAUDE_CONFIG_DIR", "LANG",
]);

/** Só o necessário para a CLI encontrar a conta; segredos do Aurora nunca passam. */
export function filteredEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) if (ENV_ALLOW.has(key.toUpperCase())) env[key] = value;
  return env;
}

const MAX_OUTPUT = 1_000_000;
/** Mensagens das CLIs quando a assinatura atingiu o limite de uso. */
const QUOTA = /usage limit|rate limit|quota|limite de uso/i;

/**
 * Só os contadores numéricos de primeiro nível (tokens de entrada, saída, cache). O objeto
 * bruto das CLIs traz estruturas aninhadas que não servem à trilha nem ao custo.
 */
export function compactUsage(usage: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (usage && typeof usage === "object")
    for (const [key, value] of Object.entries(usage)) if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  return out;
}

export interface CliOptions {
  /** Executável e argumentos iniciais; por padrão o nome da CLI no PATH. Testes trocam por um script. */
  command?: string[];
  model?: string;
}

/** Executa um processo com entrada por stdin, tempo limite e teto de saída. */
function run(command: string[], args: string[], input: string, timeoutMs: number, cwd?: string) {
  return new Promise<{ stdout: string; code: number | null }>((resolve, reject) => {
    const child = spawn(command[0], [...command.slice(1), ...args], {
      env: filteredEnv(),
      cwd,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let failed: ModelCallError | undefined;
    const timer = setTimeout(() => {
      failed = new ModelCallError("timeout");
      child.kill();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > MAX_OUTPUT) {
        failed = new ModelCallError("output_too_large");
        child.kill();
      }
    });
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.on("error", () => {
      clearTimeout(timer);
      reject(new ModelCallError("executable_unavailable"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failed) reject(failed);
      else resolve({ stdout, code });
    });
    child.stdin.end(input);
  });
}

/** Extrai o JSON da saída de `claude -p --output-format json`. */
export function parseClaudeOutput(stdout: string): { json: string; usage: Record<string, unknown> } {
  let payload: any;
  try {
    payload = JSON.parse(stdout);
  } catch {
    throw new ModelCallError("invalid_output");
  }
  if (Array.isArray(payload)) payload = [...payload].reverse().find((e) => e?.type === "result") ?? {};
  if (payload?.is_error)
    throw new ModelCallError(QUOTA.test(String(payload?.result ?? "")) ? "quota_exhausted" : "provider_reported_error");
  const usage = compactUsage(payload?.usage);
  if (payload?.structured_output && typeof payload.structured_output === "object")
    return { json: JSON.stringify(payload.structured_output), usage };
  if (typeof payload?.result === "string" && payload.result.trim()) return { json: payload.result, usage };
  throw new ModelCallError("empty_output");
}

/** Extrai a única mensagem final e o uso dos eventos JSONL de `codex exec --json`. */
export function parseCodexOutput(stdout: string): { json: string; usage: Record<string, unknown> } {
  const events = codexEvents(stdout);
  const items = events.filter((e: any) => String(e.type).startsWith("item."));
  if (items.some((e: any) => !["agent_message", "reasoning"].includes(e.item?.type)))
    throw new ModelCallError("unexpected_tool_use");
  const messages = events.filter((e: any) => e.type === "item.completed" && e.item?.type === "agent_message");
  if (messages.length !== 1) throw new ModelCallError("message_count");
  const usage = compactUsage(events.find((e: any) => e.type === "turn.completed")?.usage);
  return { json: String(messages[0].item.text), usage };
}

/** Classifica a falha do Codex pelos eventos: cota esgotada tem motivo próprio. */
export function codexFailure(stdout: string): ModelCallError {
  const failed = codexEvents(stdout).some(
    (e: any) => (e.type === "error" || e.type === "turn.failed") && QUOTA.test(String(e.message ?? e.error?.message ?? "")),
  );
  return new ModelCallError(failed ? "quota_exhausted" : "nonzero_exit");
}

function codexEvents(stdout: string): any[] {
  return stdout
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export class ClaudeCliClient implements ModelClient {
  readonly provider = "claude" as const;
  readonly model: string | undefined;
  private readonly command: string[];

  constructor(options: CliOptions = {}) {
    this.command = options.command ?? ["claude"];
    this.model = options.model;
  }

  async complete({ system, prompt, schema, timeoutMs }: ModelRequest): Promise<ModelCompletion> {
    const started = performance.now();
    const args = [
      "-p",
      "--output-format", "json",
      "--json-schema", JSON.stringify(schema),
      "--system-prompt", system,
      "--tools", "",
      "--no-session-persistence",
      "--strict-mcp-config",
      ...(this.model ? ["--model", this.model] : []),
    ];
    const sandbox = mkdtempSync(join(tmpdir(), "aurora-chief-"));
    try {
      const { stdout, code } = await run(this.command, args, prompt, timeoutMs, sandbox);
      // O Claude também informa limite de uso no JSON de saída, mesmo com código de erro.
      if (code !== 0) {
        try {
          parseClaudeOutput(stdout);
        } catch (error) {
          if (error instanceof ModelCallError && error.code === "quota_exhausted") throw error;
        }
        throw new ModelCallError("nonzero_exit");
      }
      const { json, usage } = parseClaudeOutput(stdout);
      return { json, usage, seconds: (performance.now() - started) / 1000 };
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  }
}

export class CodexCliClient implements ModelClient {
  readonly provider = "codex" as const;
  readonly model: string | undefined;
  private readonly command: string[];

  constructor(options: CliOptions = {}) {
    this.command = options.command ?? ["codex"];
    this.model = options.model;
  }

  async complete({ system, prompt, schema, timeoutMs }: ModelRequest): Promise<ModelCompletion> {
    const started = performance.now();
    // Diretório vazio e descartável: o Codex roda em sandbox somente leitura sem acesso ao projeto.
    const sandbox = mkdtempSync(join(tmpdir(), "aurora-chief-"));
    const schemaFile = join(sandbox, "schema.json");
    writeFileSync(schemaFile, JSON.stringify(schema));
    const args = [
      "exec",
      "--ignore-user-config",
      "--ephemeral",
      "--skip-git-repo-check",
      "--sandbox", "read-only",
      "-c", "features.shell_tool=false",
      "-c", 'web_search="disabled"',
      "--cd", sandbox,
      "--output-schema", schemaFile,
      "--json",
      ...(this.model ? ["--model", this.model] : []),
      "-",
    ];
    try {
      // O Codex não tem opção de prompt de sistema; as instruções vão no início da entrada.
      const { stdout, code } = await run(this.command, args, `${system}\n\n${prompt}`, timeoutMs, sandbox);
      if (code !== 0) throw codexFailure(stdout);
      const { json, usage } = parseCodexOutput(stdout);
      return { json, usage, seconds: (performance.now() - started) / 1000 };
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  }
}
