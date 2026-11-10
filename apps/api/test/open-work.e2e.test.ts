// Trabalho aberto de ponta a ponta na v2: API composta + worker LangGraph real (Python) com
// checkpoints em PostgreSQL + Cérebro. O modelo é uma CLI falsa (nenhuma conta real é usada).
// Precisa de AURORA_TEST_POSTGRES_URL e do Python com LangGraph; sem eles, é ignorado.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import pg from "pg";
import { loadConfig } from "../src/config.ts";
import { ClaudeCliClient } from "../src/platform/model/cli-clients.ts";
import { loadTemplates } from "../src/modules/agents/domain/template.ts";
import { startServer, type RunningServer } from "../src/server.ts";

const url = process.env.AURORA_TEST_POSTGRES_URL;
const python = process.env.AURORA_TEST_PYTHON ?? fileURLToPath(new URL("../../runtime/.venv/Scripts/python.exe", import.meta.url));
const worker = fileURLToPath(new URL("../../runtime/open_worker.py", import.meta.url));
const fakeModel = fileURLToPath(new URL("./fixtures/fake-open-model.ts", import.meta.url));
const skip = !url ? "defina AURORA_TEST_POSTGRES_URL" : !existsSync(python) ? "Python com LangGraph não encontrado" : false;

/** Agentes contratados pela API no início de cada cenário (personas do catálogo real). */
const CATALOG = [
  { id: "procurement_analyst", title: "Analista de compras", focus: "compras fornecedores cotações", domain: "compras" },
  { id: "financial_planning_analyst", title: "Analista financeiro", focus: "orçamento aprovação diretor financeiro", domain: "finanças" },
];
const AGENTS = CATALOG.map((a) => a.id).join(",");
const GOAL = "Avalie como devemos conduzir as compras de fornecedores acima de dez mil reais neste trimestre.";
const POLICY = "# Política de compras\n\nCompras acima de dez mil reais exigem três cotações de fornecedores e aprovação do diretor financeiro.\n\nO orçamento anual de compras é revisado em março.";
const SECRET = "# Plano confidencial\n\nCompras com fornecedor exclusivo autorizadas sem cotação para o projeto Netuno.";

const checkpointDb = "v2_ck_" + randomBytes(5).toString("hex");
const dir = mkdtempSync(join(tmpdir(), "aurora-open-e2e-"));
let checkpointDsn = "";
const running: RunningServer[] = [];

before(async () => {
  if (skip) return;
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  await admin.query(`CREATE DATABASE ${checkpointDb}`);
  await admin.end();
  const dsn = new URL(url!);
  dsn.pathname = "/" + checkpointDb;
  checkpointDsn = dsn.toString();
});

after(async () => {
  for (const s of running.splice(0)) await s.close();
  if (!skip) {
    const admin = new pg.Pool({ connectionString: url, max: 1 });
    await admin.query(`DROP DATABASE IF EXISTS ${checkpointDb} WITH (FORCE)`);
    await admin.end();
  }
  rmSync(dir, { recursive: true, force: true });
});

let n = 0;
async function start(mode = `ok:${AGENTS}`) {
  const calls = join(dir, `calls-${++n}.log`);
  writeFileSync(calls, "");
  const config = loadConfig({
    AURORA_SQLITE_PATH: join(dir, `aurora-${n}.db`),
    AURORA_WORKER_COMMAND: JSON.stringify([python, "-I", worker]),
    AURORA_CHECKPOINT_DSN: checkpointDsn,
  });
  const server = await startServer(config, {
    templates: loadTemplates(fileURLToPath(new URL("../data/agent-templates.json", import.meta.url))),
    model: new ClaudeCliClient({ command: [process.execPath, fakeModel, mode, calls] }),
  });
  running.push(server);
  const call = async (path: string, body?: object) => {
    const res = await fetch(server.url + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
    return { status: res.status, body: await res.json() };
  };
  for (const agent of CATALOG) assert.equal((await call("/api/agents/hire", { template_id: agent.id })).status, 201);
  const upload = (title: string, text: string, readers?: string[]) =>
    call("/api/knowledge/sources", { title, filename: "f.md", media_type: "text/markdown", content_base64: Buffer.from(text).toString("base64"), ...(readers ? { readers } : {}) });
  const modelCalls = () => readFileSync(calls, "utf8").split("\n").filter(Boolean);
  return { call, upload, modelCalls };
}

type View = { status: string; plan: { agents: string[] }; review: { hash: string; report: Record<string, unknown> } | null; receipt: { hash: string } | null; worker_active: boolean; events: { kind: string; detail: Record<string, unknown> }[] };

async function until(call: Awaited<ReturnType<typeof start>>["call"], id: string, status: string, ms = 90_000): Promise<View> {
  const deadline = Date.now() + ms;
  let last: View | undefined;
  while (Date.now() < deadline) {
    last = (await call(`/api/jobs/${id}`)).body as View;
    if (last.status === status && !last.worker_active) return last;
    if (["failed", "completed", "rejected"].includes(last.status) && last.status !== status && !last.worker_active)
      throw new Error(`terminou em ${last.status}: ${last.events.map((e) => e.kind).join(", ")}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`tempo esgotado esperando ${status}; último: ${last?.status}`);
}

test("pedido livre: especialistas citam só fontes abertas; aprovação entrega uma vez", { skip, timeout: 240_000 }, async () => {
  const { call, upload, modelCalls } = await start();
  const open = (await upload("Compras", POLICY)).body;
  await upload("Confidencial", SECRET, ["diretoria"]);
  const created = await call("/api/jobs", { goal: GOAL });
  assert.equal(created.status, 201);
  const ready = await until(call, created.body.id, "awaiting_approval");
  assert.deepEqual(ready.plan.agents, CATALOG.map((a) => a.id));
  const report = ready.review!.report as { abstained: boolean; findings: unknown[]; citations: { source: string }[] };
  assert.equal(report.abstained, false);
  assert.ok(report.findings.length >= 1);
  assert.deepEqual([...new Set(report.citations.map((c) => c.source))], [open.id], "só a fonte aberta a todos foi citada");
  assert.ok(!JSON.stringify(report).includes("Netuno"), "a fonte restrita nunca chegou aos agentes");
  assert.deepEqual(modelCalls().sort(), ["plan", "specialist", "specialist", "synthesis"]);

  assert.equal((await call(`/api/jobs/${created.body.id}/approve`, { hash: ready.review!.hash })).status, 202);
  const done = await until(call, created.body.id, "completed");
  assert.equal(done.receipt!.hash, ready.review!.hash);
  assert.equal(modelCalls().length, 4, "retomar depois da aprovação não chama o modelo de novo");
  assert.equal(done.events.filter((e) => e.kind === "inference_completed").length, 4);
  assert.equal(done.events.filter((e) => e.kind === "effect_receipt").length, 1);
});

test("sem fonte sobre o assunto, o parecer é abstenção explícita e só o plano chama o modelo", { skip, timeout: 180_000 }, async () => {
  const { call, modelCalls } = await start();
  const created = await call("/api/jobs", { goal: GOAL });
  const ready = await until(call, created.body.id, "awaiting_approval");
  const report = ready.review!.report as { abstained: boolean; citations: unknown[] };
  assert.deepEqual([report.abstained, report.citations], [true, []]);
  assert.deepEqual(modelCalls(), ["plan"]);
});

test("queda logo depois da entrega: a retomada conclui sem entregar de novo e sem chamar o modelo", { skip, timeout: 240_000 }, async () => {
  const { call, upload, modelCalls } = await start();
  await upload("Compras", POLICY);
  const id = (await call("/api/jobs", { goal: GOAL })).body.id;
  const ready = await until(call, id, "awaiting_approval");
  await call(`/api/jobs/${id}/approve`, { hash: ready.review!.hash, crash_after_effect: true });
  await until(call, id, "interrupted");
  assert.equal((await call(`/api/jobs/${id}/resume`, {})).status, 202);
  const done = await until(call, id, "completed");
  const receipts = done.events.filter((e) => e.kind === "effect_receipt");
  assert.deepEqual(receipts.map((e) => e.detail.replayed), [false, true], "o segundo é a repetição do mesmo recibo");
  assert.equal(modelCalls().length, 4);
});

test("citação inventada pelo modelo é recusada: o trabalho falha sem parecer", { skip, timeout: 180_000 }, async () => {
  const { call, upload } = await start(`bad-cite:${AGENTS}`);
  await upload("Compras", POLICY);
  const id = (await call("/api/jobs", { goal: GOAL })).body.id;
  const failed = await until(call, id, "failed");
  assert.equal(failed.review, null);
  assert.ok(failed.events.some((e) => e.kind === "inference_failed" && e.detail.code === "unknown_citation"));
});

test("a conversa abre o trabalho aberto com o texto do gestor como pedido", { skip, timeout: 180_000 }, async () => {
  const { call, upload } = await start();
  await upload("Compras", POLICY);
  const conversation = (await call("/api/conversations", {})).body.id;
  const sent = await call(`/api/conversations/${conversation}/messages`, { text: `Faça uma análise: ${GOAL}` });
  assert.equal(sent.status, 201);
  assert.ok(sent.body.reply.job, "a resposta abriu um trabalho");
  const ready = await until(call, sent.body.reply.job.id, "awaiting_approval");
  assert.equal((ready as unknown as { goal: string }).goal, `Faça uma análise: ${GOAL}`);
  const read = (await call(`/api/conversations/${conversation}`)).body;
  assert.equal(read.messages[1].job.status, "awaiting_approval");
  assert.deepEqual(read.messages[1].job.agents, CATALOG.map((a) => a.id));
});

/** A API num processo próprio (`main.ts`), para poder derrubá-la de verdade. */
async function spawnApi(env: Record<string, string>) {
  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, [fileURLToPath(new URL("../src/main.ts", import.meta.url))], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stderr.resume();
  const base = await new Promise<string>((resolve, reject) => {
    let out = "";
    child.stdout.on("data", (c) => {
      out += c;
      const m = out.match(/"url":"([^"]+)"/);
      if (m) resolve(m[1]!);
    });
    child.on("exit", (code) => reject(new Error(`API saiu com ${code}`)));
  });
  const call = async (path: string, body?: object) => {
    const res = await fetch(base + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
    return { status: res.status, body: await res.json() };
  };
  const exited = new Promise<void>((r) => child.on("exit", () => r()));
  return { call, kill: async () => (child.kill("SIGKILL"), exited), stop: async () => (child.kill(), exited) };
}

test("API cai no meio de uma chamada ao modelo: não repete sozinha; a central autoriza e o trabalho segue", { skip, timeout: 300_000 }, async () => {
  const calls = join(dir, "calls-crash.log");
  writeFileSync(calls, "");
  const modelCalls = () => readFileSync(calls, "utf8").split("\n").filter(Boolean);
  const env = (mode: string) => ({
    AURORA_SQLITE_PATH: join(dir, "aurora-crash.db"),
    AURORA_WORKER_COMMAND: JSON.stringify([python, "-I", worker]),
    AURORA_CHECKPOINT_DSN: checkpointDsn,
    AURORA_MODEL_PROVIDER: "claude",
    AURORA_MODEL_COMMAND: JSON.stringify([process.execPath, fakeModel, mode, calls]),
  });

  const first = await spawnApi(env(`hang-specialist:${AGENTS}`));
  for (const agent of CATALOG) await first.call("/api/agents/hire", { template_id: agent.id });
  await first.call("/api/knowledge/sources", { title: "Compras", filename: "f.md", media_type: "text/markdown", content_base64: Buffer.from(POLICY).toString("base64") });
  const id = (await first.call("/api/jobs", { goal: GOAL })).body.id;
  for (let i = 0; i < 300 && !modelCalls().includes("specialist"); i++) await new Promise((r) => setTimeout(r, 200));
  assert.ok(modelCalls().includes("specialist"), "chamada de especialista em andamento");
  await first.kill();

  const api = await spawnApi(env(`ok:${AGENTS}`));
  try {
    assert.equal((await api.call(`/api/jobs/${id}`)).body.status, "interrupted");
    assert.equal((await api.call(`/api/jobs/${id}/resume`, {})).status, 202);
    const blocked = await until(api.call, id, "recovery_required");
    assert.ok(blocked.events.some((e) => e.kind === "inference_unknown"));
    assert.deepEqual(modelCalls(), ["plan", "specialist"], "o plano veio do recibo; o especialista sem recibo não foi repetido");
    assert.equal((await api.call(`/api/jobs/${id}/resume`, {})).body.code, "recovery_review_required");

    const { cases } = (await api.call("/api/recovery/cases")).body;
    const steps = cases.find((c: { job: { id: string } }) => c.job.id === id).pending_steps.map((s: { slot: string }) => s.slot);
    assert.deepEqual(steps, [`specialist:${CATALOG[0]!.id}`]);
    const retry = await api.call(`/api/recovery/jobs/${id}/retry`, { reason: "Conferi no provedor que a chamada não foi concluída.", steps });
    assert.equal(retry.status, 202);
    const ready = await until(api.call, id, "awaiting_approval");
    assert.ok(ready.events.some((e) => e.kind === "recovery_retry_authorized"));
    assert.deepEqual(modelCalls().slice(2).sort(), ["specialist", "specialist", "synthesis"], "só o passo autorizado e os seguintes foram chamados");
  } finally {
    await api.stop();
  }
});
