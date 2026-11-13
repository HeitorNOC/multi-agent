import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const serverPath = fileURLToPath(new URL("../server.ts", import.meta.url));
const workerPath = fileURLToPath(new URL("./fake-worker.ts", import.meta.url));

export type BackendHandler = (body: any) => unknown | Promise<unknown>;

/**
 * Runtime falso. `handlers` pode ser alterado durante o teste para simular a ponte de
 * recuperação. Um handler pode devolver `{ __status: 500 }` para simular falha HTTP, ou
 * uma promessa que nunca resolve para simular um protocolo que não responde.
 */
export async function fakeBackend() {
  const handlers: Record<string, BackendHandler> = {
    status: () => ({ phase: "ready" }),
    model_job_status: () => ({ status: "resumable" }),
  };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      const body = JSON.parse(raw || "{}");
      const reply: any = (await handlers[body.action]?.(body)) ?? {};
      const { __status, ...payload } = reply;
      res.writeHead(__status ?? 200, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    handlers,
    close: () => {
      server.closeAllConnections();
      return new Promise<void>((r) => server.close(() => r()));
    },
  };
}

/**
 * Com AURORA_TEST_LEDGER=postgres, as APIs sobem sobre PostgreSQL (AURORA_TEST_POSTGRES_URL).
 * Cada diretório de estado ganha um esquema próprio, estável entre reinícios da mesma API.
 */
const RUN_ID = randomBytes(3).toString("hex");
const postgresUrl = process.env.AURORA_TEST_LEDGER === "postgres" ? process.env.AURORA_TEST_POSTGRES_URL : undefined;
export const ledgerDriver = postgresUrl ? "PostgreSQL" : "SQLite";
function ledgerConfig(state: string) {
  if (!postgresUrl) return {};
  const schema = `h_${RUN_ID}_${createHash("sha256").update(state).digest("hex").slice(0, 10)}`;
  return { ledger: { driver: "postgres", connectionString: postgresUrl, schema } };
}
/** Remove os esquemas criados por esta execução; chame no `after` de cada arquivo de teste. */
export async function dropTestSchemas() {
  if (!postgresUrl) return;
  const admin = new pg.Pool({ connectionString: postgresUrl, max: 1 });
  try {
    const { rows } = await admin.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE $1", [`h\\_${RUN_ID}\\_%`]);
    for (const r of rows) await admin.query(`DROP SCHEMA ${r.schema_name} CASCADE`);
  } finally {
    await admin.end();
  }
}

export const newStateDir = () => mkdtempSync(join(tmpdir(), "aurora-ledger-"));

export type ApiResponse = { status: number; body: any; headers: Headers };
export type Api = {
  url: string;
  child: ChildProcess;
  get: (path: string, headers?: Record<string, string>) => Promise<ApiResponse>;
  post: (
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ) => Promise<ApiResponse>;
  stop: (signal?: NodeJS.Signals) => Promise<void>;
};

export async function startApi(opts: {
  state: string;
  backend: string;
  workerMode: string;
  queueCapacity?: number;
  resumeReserve?: number;
  /** Campos extras da configuração, por exemplo `recoveryReviewers`. */
  extraConfig?: Record<string, unknown>;
}): Promise<Api> {
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, WORKER_MODE: opts.workerMode },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr!.on("data", (b) => (stderr += b));
  child.stdin!.end(
    JSON.stringify({
      state: opts.state,
      backend: opts.backend,
      token: "t".repeat(32),
      python: process.execPath,
      worker: workerPath,
      root: process.cwd(),
      port: 0,
      queueCapacity: opts.queueCapacity ?? 4,
      resumeReserve: opts.resumeReserve ?? 0,
      installation: "test-install",
      ...ledgerConfig(opts.state),
      ...opts.extraConfig,
    }),
  );
  const url: string = await new Promise((resolve, reject) => {
    let out = "";
    child.stdout!.on("data", (b) => {
      out += b;
      const line = out.split("\n").find((l) => l.startsWith("{"));
      if (line) resolve(JSON.parse(line).url);
    });
    child.on("exit", (code) =>
      reject(new Error(`API encerrou (${code}) antes de ficar pronta: ${stderr.slice(0, 500)}`)),
    );
    setTimeout(() => reject(new Error("API não ficou pronta em 15 s")), 15000);
  });
  async function call(method: string, path: string, body?: unknown, headers = {}) {
    const res = await fetch(url + path, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: res.status,
      body: await res.json().catch(() => null),
      headers: res.headers,
    };
  }
  return {
    url,
    child,
    get: (p, h) => call("GET", p, undefined, h),
    post: (p, b = {}, h) => call("POST", p, b, h),
    stop: (signal = "SIGTERM") =>
      new Promise((r) => {
        if (child.exitCode !== null || child.signalCode) return r();
        child.once("exit", () => r());
        child.kill(signal);
      }),
  };
}

export async function waitFor<T>(
  fn: () => Promise<T | undefined | false>,
  what: string,
  ms = 10000,
): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Tempo esgotado: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

export async function job(api: Api, id: string) {
  const { body } = await api.get("/api/state");
  return body.jobs.find((j: any) => j.id === id);
}
