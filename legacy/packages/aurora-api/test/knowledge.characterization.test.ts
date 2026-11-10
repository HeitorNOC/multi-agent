// Cérebro (E3) pela API HTTP do servidor real. Roda sobre SQLite ou, com AURORA_TEST_LEDGER=postgres, sobre PostgreSQL.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dropTestSchemas, fakeBackend, newStateDir, startApi, type Api } from "./harness.ts";

let backend: Awaited<ReturnType<typeof fakeBackend>>;
const running: Api[] = [];
before(async () => {
  backend = await fakeBackend();
});
after(async () => {
  await Promise.all(running.map((a) => a.stop("SIGKILL")));
  await backend.close();
  await dropTestSchemas();
});

async function start(opts: { state?: string; extraConfig?: Record<string, unknown> } = {}) {
  const state = opts.state ?? newStateDir();
  const api = await startApi({ state, backend: backend.url, workerMode: "hang", extraConfig: opts.extraConfig });
  running.push(api);
  return { api, state };
}

const POLICY = "# Política de reembolso\n\nDespesas de viagem são reembolsadas em até 15 dias úteis após a prestação de contas.\n\nHospedagem acima de 400 reais por noite exige aprovação prévia.";
const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
const uploadBody = (text = POLICY, extra: Record<string, unknown> = {}) => ({
  title: "Reembolso",
  filename: "reembolso.md",
  media_type: "text/markdown",
  content_base64: b64(text),
  ...extra,
});
const ask = (api: Api, question: string) => api.post("/api/knowledge/query", { question });

test("enviar, consultar com citação e abrir o original pela citação", async () => {
  const { api } = await start();
  const created = await api.post("/api/knowledge/sources", uploadBody());
  assert.equal(created.status, 201);
  assert.equal(created.body.status, "current");

  const answer = await ask(api, "Em quantos dias as despesas de viagem são reembolsadas?");
  assert.equal(answer.status, 200);
  assert.equal(answer.body.abstained, false);
  assert.match(answer.body.answer, /15 dias úteis.*\[1\]/s);
  const [citation] = answer.body.citations;
  assert.deepEqual([citation.source, citation.version, citation.title], [created.body.id, 1, "Reembolso"]);

  // A citação leva ao arquivo exatamente como foi enviado, servido como texto puro e em sandbox.
  const original = await fetch(api.url + citation.url);
  assert.equal(original.status, 200);
  assert.equal(await original.text(), POLICY);
  assert.equal(original.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.match(original.headers.get("content-security-policy") ?? "", /sandbox/);
  assert.match(original.headers.get("content-disposition") ?? "", /inline; filename="reembolso.md"/);
  assert.equal(original.headers.get("x-content-type-options"), "nosniff");
});

test("versão nova passa a responder; revogar faz a consulta se abster", async () => {
  const { api } = await start();
  const { id } = (await api.post("/api/knowledge/sources", uploadBody())).body;
  const v2 = await api.post(`/api/knowledge/sources/${id}/versions`, {
    filename: "reembolso-v2.md",
    media_type: "text/markdown",
    content_base64: b64(POLICY.replace("15 dias úteis", "10 dias úteis")),
  });
  assert.equal(v2.status, 201);
  assert.equal(v2.body.current_version, 2);
  const answer = await ask(api, "prazo de reembolso de despesas de viagem");
  assert.deepEqual([answer.body.citations[0].version, /10 dias/.test(answer.body.answer)], [2, true]);

  assert.equal((await api.post(`/api/knowledge/sources/${id}/revoke`, {})).body.status, "revoked");
  assert.equal((await ask(api, "prazo de reembolso de despesas de viagem")).body.abstained, true);
  // O histórico continua acessível a quem pode ler.
  assert.equal((await fetch(`${api.url}/api/knowledge/sources/${id}/versions/1/original`)).status, 200);
});

test("só as rotas de envio aceitam corpo grande", async () => {
  const { api } = await start();
  const big = `${POLICY}\n\n${"Parágrafo de apoio com texto de preenchimento. ".repeat(1500)}`;
  assert.ok(b64(big).length > 60_000);
  assert.equal((await api.post("/api/knowledge/sources", uploadBody(big))).status, 201);
  const conversation = (await api.post("/api/conversations", {})).body.id;
  const tooBig = await api.post(`/api/conversations/${conversation}/messages`, { text: "x".repeat(30_000) });
  assert.equal(tooBig.status, 409);
  assert.match(tooBig.body.error, /Payload excedido/);
});

test("validações e rotas desconhecidas", async () => {
  const { api } = await start();
  assert.equal((await api.post("/api/knowledge/sources", uploadBody(POLICY, { media_type: "application/pdf" }))).status, 415);
  assert.equal((await api.post("/api/knowledge/sources", uploadBody(POLICY, { content_base64: "@@@" }))).status, 400);
  assert.equal((await api.get("/api/knowledge/sources/nao-existe")).status, 404);
  assert.equal((await api.get("/api/knowledge/sources/nao-existe/versions/1/original")).status, 404);
  assert.equal((await api.post("/api/knowledge/query", { question: "" })).status, 400);
  assert.equal((await api.get("/api/knowledge/outra")).status, 404);
  assert.equal((await api.get("/api/knowledge/sources")).body.sources.length, 0);
});

test("fontes e consultas sobrevivem ao reinício da API", async () => {
  const { api, state } = await start();
  await api.post("/api/knowledge/sources", uploadBody());
  await api.stop("SIGKILL");
  const { api: restarted } = await start({ state });
  assert.equal((await restarted.get("/api/knowledge/sources")).body.sources.length, 1);
  assert.equal((await ask(restarted, "hospedagem acima de 400 reais por noite")).body.abstained, false);
});

test("com o respondedor por modelo, uma falha da CLI cai no extrativo e a resposta mostra o motivo", async () => {
  const fakeCli = fileURLToPath(new URL("../conversation/fixtures/fake-cli.ts", import.meta.url));
  const report = fileURLToPath(new URL("./.fake-cli-report.json", import.meta.url));
  const answerer = { engine: "model", provider: "claude", command: [process.execPath, fakeCli, "claude", "exit1", report] };
  const { api } = await start({ extraConfig: { knowledge: { answerer } } });
  await api.post("/api/knowledge/sources", uploadBody());
  const answer = await ask(api, "prazo de reembolso de despesas de viagem");
  assert.equal(answer.body.abstained, false);
  assert.deepEqual(answer.body.decision, { engine: "extractive", fallback: "nonzero_exit" });
});
