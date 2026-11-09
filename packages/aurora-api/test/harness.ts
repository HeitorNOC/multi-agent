import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(new URL("../server.ts", import.meta.url));
const workerPath = fileURLToPath(new URL("./fake-worker.ts", import.meta.url));

export async function fakeBackend() {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { action } = JSON.parse(body || "{}");
      const reply: Record<string, unknown> =
        action === "status"
          ? { phase: "ready" }
          : action === "model_job_status"
            ? { status: "resumable" }
            : {};
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(reply));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

export const newStateDir = () => mkdtempSync(join(tmpdir(), "aurora-ledger-"));

export type Api = {
  url: string;
  child: ChildProcess;
  get: (path: string) => Promise<{ status: number; body: any }>;
  post: (
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ) => Promise<{ status: number; body: any }>;
  stop: (signal?: NodeJS.Signals) => Promise<void>;
};

export async function startApi(opts: {
  state: string;
  backend: string;
  workerMode: string;
  queueCapacity?: number;
  resumeReserve?: number;
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
    return { status: res.status, body: await res.json().catch(() => null) };
  }
  return {
    url,
    child,
    get: (p) => call("GET", p),
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
