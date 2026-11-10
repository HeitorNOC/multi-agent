// A API composta de ponta a ponta: config real, porta real, worker falso que fala HTTP com a API.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ConfigError, loadConfig } from "../src/config.ts";
import { startServer } from "../src/server.ts";
import { testPolicy } from "./support/test-policy.ts";

/** Worker falso: lê o trabalho, propõe plano e parecer pela API interna e sai declarando não concluído. */
const FAKE_WORKER = `
let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", async () => {
  const c = JSON.parse(input);
  const call = (op, body) => fetch(c.api + "/internal/jobs/" + c.job + "/" + op, {
    method: "POST",
    headers: { "content-type": "application/json", "x-worker-token": c.token },
    body: JSON.stringify({ lease: c.model_lease, ...body }),
  }).then((r) => r.json());
  const job = await call("snapshot", {});
  if (job.approved) {
    await call("effect", { hash: job.review.hash });
    console.log(JSON.stringify({ completed: true }));
    return;
  }
  await call("plan", { plan: { agents: ["compras"] } });
  await call("review", { report: { summary: "Resumo de " + c.goal } });
  console.log(JSON.stringify({ completed: false }));
});`;

async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const value = await read();
    if (ok(value)) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("tempo esgotado");
}

test("config: padrões, PostgreSQL por URL e erros legíveis", () => {
  const base = loadConfig({});
  assert.deepEqual(base.database, { dialect: "sqlite", path: "data/aurora.db" });
  assert.deepEqual(base.queue, { capacity: 20, resumeReserve: 2, maxWorkers: 1 });
  const pg = loadConfig({ AURORA_DATABASE_URL: "postgres://u@h/db", AURORA_WORKER_COMMAND: '["python","w.py"]' });
  assert.equal(pg.database.dialect, "postgres");
  assert.deepEqual(pg.worker.command, ["python", "w.py"]);
  assert.throws(() => loadConfig({ AURORA_QUEUE_CAPACITY: "2", AURORA_RESUME_RESERVE: "2" }), ConfigError);
  assert.throws(() => loadConfig({ AURORA_WORKER_COMMAND: "python w.py" }), /lista JSON/);
});

test("servidor composto: pedido → worker → aprovação → efeito → concluído", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aurora-server-"));
  const config = loadConfig({
    AURORA_SQLITE_PATH: join(dir, "aurora.db"),
    AURORA_WORKER_COMMAND: JSON.stringify([process.execPath, "-e", FAKE_WORKER]),
    AURORA_AUTH: "local",
  });
  const server = await startServer(config, { policy: testPolicy, templates: { areas: [], templates: [] }, model: null });
  try {
    const api = (path: string, body?: object) =>
      fetch(server.url + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}).then((r) =>
        r.json(),
      );
    const { id } = await api("/api/jobs", { goal: "Analisar compras" });
    const waiting = await until(() => api(`/api/jobs/${id}`), (j) => j.status === "awaiting_approval" && !j.worker_active);
    await api(`/api/jobs/${id}/approve`, { hash: waiting.review.hash });
    const done = await until(() => api(`/api/jobs/${id}`), (j) => j.status === "completed" || j.status === "failed");
    assert.equal(done.status, "completed", JSON.stringify(done.events.map((e: { kind: string }) => e.kind)));
    assert.ok(done.receipt);
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
