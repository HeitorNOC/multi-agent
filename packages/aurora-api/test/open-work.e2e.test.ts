// Trabalho aberto de ponta a ponta: servidor real + worker LangGraph real (Python) com checkpoints
// em PostgreSQL + Cérebro. O modelo é simulado (nenhuma conta real é usada).
// Precisa de AURORA_TEST_POSTGRES_URL e do ambiente Python em apps/aurora/.venv; sem eles, é ignorado.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { dropTestSchemas, fakeBackend, newStateDir, startApi, waitFor, job, type Api } from "./harness.ts";

const url = process.env.AURORA_TEST_POSTGRES_URL;
const python = fileURLToPath(new URL("../../../apps/aurora/.venv/Scripts/python.exe", import.meta.url));
const worker = fileURLToPath(new URL("../../../apps/aurora/runtime/open_worker.py", import.meta.url));
const policyModule = pathToFileURL(fileURLToPath(new URL("../open-work/open-policy.ts", import.meta.url))).href;
const fakeModel = fileURLToPath(new URL("../open-work/fixtures/fake-open-model.ts", import.meta.url));
const skip = !url ? "defina AURORA_TEST_POSTGRES_URL" : !existsSync(python) ? "crie apps/aurora/.venv com LangGraph" : false;

const checkpointDb = "open_ck_" + randomBytes(5).toString("hex");
const AGENTS = "financial_planning_analyst,procurement_analyst";
let backend: Awaited<ReturnType<typeof fakeBackend>>;
const running: Api[] = [];

before(async () => {
  if (skip) return;
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  await admin.query(`CREATE DATABASE ${checkpointDb}`);
  await admin.end();
  backend = await fakeBackend();
  const dsn = new URL(url!);
  dsn.pathname = "/" + checkpointDb;
  backend.handlers.worker_config = () => ({ dsn: dsn.toString() });
});
after(async () => {
  if (skip) return;
  await Promise.all(running.map((a) => a.stop("SIGKILL")));
  await backend.close();
  await dropTestSchemas();
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  await admin.query(`DROP DATABASE IF EXISTS ${checkpointDb} WITH (FORCE)`);
  await admin.end();
});

let calls = 0;
async function start(mode = `ok:${AGENTS}`, state = newStateDir(), callsFile?: string) {
  const file = callsFile ?? fileURLToPath(new URL(`./.open-calls-${++calls}.log`, import.meta.url));
  if (!callsFile) writeFileSync(file, "");
  const api = await startApi({
    state,
    backend: backend.url,
    workerMode: "unused",
    extraConfig: {
      policyModule,
      python,
      worker,
      work: { provider: "claude", command: [process.execPath, fakeModel, mode, file] },
    },
  });
  running.push(api);
  const modelCalls = () => readFileSync(file, "utf8").split("\n").filter(Boolean);
  return { api, state, file, modelCalls };
}

const POLICY = "# Política de compras\n\nCompras acima de dez mil reais exigem três cotações de fornecedores e aprovação do diretor financeiro.\n\nO orçamento anual de compras é revisado em março.";
const SECRET = "# Plano confidencial\n\nCompras com fornecedor exclusivo autorizadas sem cotação para o projeto Netuno.";
const upload = (api: Api, title: string, text: string, readers?: string[]) =>
  api.post("/api/knowledge/sources", {
    title,
    filename: "f.md",
    media_type: "text/markdown",
    content_base64: Buffer.from(text).toString("base64"),
    ...(readers ? { readers } : {}),
  });
const GOAL = "Avalie como devemos conduzir as compras de fornecedores acima de dez mil reais neste trimestre.";

async function untilStatus(api: Api, id: string, status: string, ms = 60_000) {
  return waitFor(async () => {
    const j = await job(api, id);
    return j?.status === status && j;
  }, `trabalho em ${status}`, ms);
}

test("pedido livre: Chief of Staff escala especialistas, que citam só fontes abertas do Cérebro; aprovação entrega", { skip, timeout: 180_000 }, async () => {
  const { api, modelCalls } = await start();
  const open = (await upload(api, "Compras", POLICY)).body;
  await upload(api, "Confidencial", SECRET, ["diretoria"]);
  const created = await api.post("/api/jobs", { goal: GOAL });
  assert.equal(created.status, 202);

  const ready = await untilStatus(api, created.body.id, "awaiting_approval");
  assert.deepEqual(ready.plan.agents, AGENTS.split(","));
  const report = ready.review.report;
  assert.equal(report.abstained, false);
  assert.ok(report.findings.length >= 1);
  assert.deepEqual([...new Set(report.citations.map((c: any) => c.source))], [open.id], "só a fonte aberta a todos foi citada");
  assert.ok(!JSON.stringify(report).includes("Netuno"), "a fonte restrita nunca chegou aos agentes");
  assert.deepEqual(modelCalls().sort(), ["plan", "specialist", "specialist", "synthesis"]);

  assert.equal((await api.post(`/api/jobs/${created.body.id}/approve`, { hash: ready.review.hash })).status, 202);
  const done = await untilStatus(api, created.body.id, "completed");
  assert.equal(done.receipt.hash, ready.review.hash);
  assert.equal(modelCalls().length, 4, "retomar depois da aprovação não chama o modelo de novo");
  const nodes = done.events.map((e: any) => e.node);
  assert.equal(nodes.filter((n: string) => n === "inference_completed").length, 4);
  assert.equal(nodes.filter((n: string) => n === "effect_receipt").length, 1);
});

test("sem fonte que trate do assunto, o parecer é uma abstenção explícita e só o plano chama o modelo", { skip, timeout: 120_000 }, async () => {
  const { api, modelCalls } = await start();
  const created = await api.post("/api/jobs", { goal: GOAL });
  const ready = await untilStatus(api, created.body.id, "awaiting_approval");
  assert.equal(ready.review.report.abstained, true);
  assert.deepEqual(ready.review.report.citations, []);
  assert.deepEqual(modelCalls(), ["plan"]);
});

test("a conversa abre o trabalho aberto com o texto do gestor como pedido", { skip, timeout: 120_000 }, async () => {
  const { api } = await start();
  await upload(api, "Compras", POLICY);
  const conversation = (await api.post("/api/conversations", {})).body.id;
  const sent = await api.post(`/api/conversations/${conversation}/messages`, { text: `Faça uma análise: ${GOAL}` });
  assert.ok(sent.body.reply.job, "a resposta abriu um trabalho");
  const ready = await untilStatus(api, sent.body.reply.job.id, "awaiting_approval");
  assert.equal(ready.goal, `Faça uma análise: ${GOAL}`);
});

test("queda logo depois da entrega: a retomada conclui sem entregar de novo e sem chamar o modelo", { skip, timeout: 180_000 }, async () => {
  const { api, modelCalls } = await start();
  await upload(api, "Compras", POLICY);
  const id = (await api.post("/api/jobs", { goal: GOAL })).body.id;
  const ready = await untilStatus(api, id, "awaiting_approval");
  await api.post(`/api/jobs/${id}/approve`, { hash: ready.review.hash, crash_after_effect: true });
  await untilStatus(api, id, "interrupted");
  assert.equal((await api.post(`/api/jobs/${id}/resume`, {})).status, 202);
  const done = await untilStatus(api, id, "completed");
  assert.equal(done.events.filter((e: any) => e.node === "effect_receipt").length, 2, "o segundo é a repetição do mesmo recibo");
  assert.equal(done.events.filter((e: any) => e.node === "effect_receipt" && e.detail.replayed).length, 1);
  assert.equal(modelCalls().length, 4);
});

test("API cai no meio de uma chamada ao modelo: a retomada não repete a chamada e pede revisão", { skip, timeout: 180_000 }, async () => {
  const { api, state, file, modelCalls } = await start(`hang-specialist:${AGENTS}`);
  await upload(api, "Compras", POLICY);
  const id = (await api.post("/api/jobs", { goal: GOAL })).body.id;
  await waitFor(async () => modelCalls().includes("specialist"), "chamada de especialista em andamento", 60_000);
  await api.stop("SIGKILL");

  const { api: restarted } = await start(`ok:${AGENTS}`, state, file);
  assert.equal((await job(restarted, id)).status, "interrupted");
  assert.equal((await restarted.post(`/api/jobs/${id}/resume`, {})).status, 202);
  const blocked = await untilStatus(restarted, id, "recovery_required");
  assert.ok(blocked.events.some((e: any) => e.node === "inference_unknown"));
  assert.deepEqual(modelCalls(), ["plan", "specialist"], "o plano veio do recibo; o especialista sem recibo não foi repetido");
});

test("saída do modelo com citação inventada é recusada: o trabalho falha sem parecer", { skip, timeout: 120_000 }, async () => {
  const { api } = await start(`bad-cite:${AGENTS}`);
  await upload(api, "Compras", POLICY);
  const id = (await api.post("/api/jobs", { goal: GOAL })).body.id;
  const failed = await untilStatus(api, id, "failed");
  assert.equal(failed.review, null);
  assert.ok(failed.events.some((e: any) => e.node === "inference_failed" && e.detail.code === "unknown_citation"));
});
