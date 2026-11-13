// Caracterização da central de recuperação humana: sessão, comandos, estados e reinício.
// Só usa a API HTTP; vale para qualquer armazenamento do ledger.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { dropTestSchemas, fakeBackend, newStateDir, startApi, waitFor, type Api } from "./harness.ts";

const INSTALLATION = "test-install";
const CREDENTIAL = "credencial-local-1";
const reviewers = [{ id: "rev-1", label: "Revisor 1", credential: CREDENTIAL }];
const CASE = "caso-00000001";
const OPERATION = `${INSTALLATION}:op-1`;
const EVIDENCE = "e".repeat(64);

let backend: Awaited<ReturnType<typeof fakeBackend>>;
const running: Api[] = [];
after(async () => {
  await Promise.all(running.map((a) => a.stop("SIGKILL")));
  await backend.close();
  await dropTestSchemas();
});
// A ponte simulada: a fila mostra um caso; propor/confirmar devolve um resultado.
const defaultBridge = ({ command }: any) =>
  command.action === "recovery_queue"
    ? { ok: true, result: { installation_id: INSTALLATION, cases: [{ case_id: CASE }], history: [] } }
    : { ok: true, result: { kind: "proposal", operation_id: command.operation_id, evidence_sha: command.evidence_sha } };
before(async () => {
  backend = await fakeBackend();
  backend.handlers.recovery_bridge = defaultBridge;
});

async function start(state = newStateDir()) {
  const a = await startApi({
    state,
    backend: backend.url,
    workerMode: "hang",
    extraConfig: { recoveryReviewers: reviewers },
  });
  running.push(a);
  return { a, state };
}
async function login(a: Api) {
  const r = await a.post("/api/recovery/session", { credential: CREDENTIAL });
  assert.equal(r.status, 200);
  return { cookie: r.headers.get("set-cookie")!.split(";")[0] };
}
const body = (over: object = {}) => ({
  request_id: randomUUID(),
  case_id: CASE,
  operation_id: OPERATION,
  evidence_sha: EVIDENCE,
  reason: "Justificativa suficientemente longa para o teste.",
  ...over,
});
/** `reason` só é aceito em "propose"; "confirm" não o admite. */
const confirmBody = (over: object = {}) => ({ ...body(over), reason: undefined });
const commands = async (a: Api, h: object) => (await a.get("/api/recovery/commands", h as any)).body.commands;

test("sem login a sessão aparece como não autenticada e as rotas exigem credencial", async () => {
  const { a } = await start();
  assert.deepEqual((await a.get("/api/recovery/session")).body, { enabled: true, authenticated: false, local_only: true });
  assert.equal((await a.get("/api/recovery/cases")).status, 401);
  assert.equal((await a.post("/api/recovery/session", { credential: "errada" })).status, 401);
});

test("login cria uma sessão por cookie e o logout a encerra", async () => {
  const { a } = await start();
  const { cookie } = await login(a);
  const session = (await a.get("/api/recovery/session", { cookie })).body;
  assert.deepEqual([session.authenticated, session.actor], [true, "rev-1"]);
  assert.equal((await a.get("/api/recovery/cases", { cookie })).status, 200);
  assert.equal((await a.post("/api/recovery/logout", {}, { cookie })).status, 200);
  assert.equal((await a.get("/api/recovery/cases", { cookie })).status, 401, "o cookie antigo deixa de valer");
});

test("a sessão sobrevive ao reinício da API", async () => {
  const { a, state } = await start();
  const { cookie } = await login(a);
  await a.stop("SIGKILL");
  const { a: b } = await start(state);
  assert.equal((await b.get("/api/recovery/session", { cookie })).body.authenticated, true);
});

test("propor conclui, fica registrado e a repetição do mesmo envio devolve replayed", async () => {
  const { a } = await start();
  const { cookie } = await login(a);
  const b = body();
  const first = await a.post("/api/recovery/propose", b, { cookie });
  assert.equal(first.status, 200);
  assert.deepEqual([first.body.status, first.body.result.operation_id], ["completed", OPERATION]);
  const [listed] = await commands(a, { cookie });
  assert.deepEqual(
    [listed.id, listed.status, listed.case_id, listed.action],
    [b.request_id, "completed", CASE, "recovery_propose"],
  );
  const again = await a.post("/api/recovery/propose", b, { cookie });
  assert.equal(again.body.replayed, true);
});

test("reutilizar o request_id com outro conteúdo é recusado", async () => {
  const { a } = await start();
  const { cookie } = await login(a);
  const b = body();
  await a.post("/api/recovery/propose", b, { cookie });
  const other = await a.post("/api/recovery/propose", { ...b, reason: "Outra justificativa também suficientemente longa." }, { cookie });
  assert.equal(other.status, 409);
});

test("validação: operação de outra instalação, evidência inválida e campo extra", async () => {
  const { a } = await start();
  const { cookie } = await login(a);
  assert.equal((await a.post("/api/recovery/confirm", confirmBody({ operation_id: "outra:op-1" }), { cookie })).status, 403);
  assert.equal((await a.post("/api/recovery/confirm", confirmBody({ evidence_sha: "xyz" }), { cookie })).status, 400);
  assert.equal((await a.post("/api/recovery/confirm", { ...confirmBody(), extra: 1 }, { cookie })).status, 400);
  assert.equal((await commands(a, { cookie })).length, 0, "nada inválido é gravado");
});

test("o protocolo recusar marca o envio como rejected", async () => {
  const { a } = await start();
  const { cookie } = await login(a);
  backend.handlers.recovery_bridge = ({ command }: any) =>
    command.action === "recovery_queue" ? defaultBridge({ command }) : { ok: false, status: 409 };
  const b = confirmBody();
  const r = await a.post("/api/recovery/confirm", b, { cookie });
  backend.handlers.recovery_bridge = defaultBridge;
  assert.equal(r.status, 409);
  assert.equal((await commands(a, { cookie }))[0].status, "rejected");
});

test("falha do protocolo vira unknown: sem sucesso presumido, e pode ser repetida depois", async () => {
  const { a } = await start();
  const { cookie } = await login(a);
  backend.handlers.recovery_bridge = ({ command }: any) =>
    command.action === "recovery_queue" ? defaultBridge({ command }) : { __status: 500, error: "indisponível" };
  const b = confirmBody();
  const failed = await a.post("/api/recovery/confirm", b, { cookie });
  backend.handlers.recovery_bridge = defaultBridge;
  assert.equal(failed.status, 503);
  assert.equal((await commands(a, { cookie }))[0].status, "unknown");
  const retried = await a.post("/api/recovery/retry", { request_id: b.request_id }, { cookie });
  assert.equal(retried.status, 200);
  assert.equal((await commands(a, { cookie }))[0].status, "completed");
});

test("queda durante o envio: ao reiniciar o comando fica unknown", async () => {
  const { a, state } = await start();
  const { cookie } = await login(a);
  backend.handlers.recovery_bridge = ({ command }: any) =>
    command.action === "recovery_queue" ? defaultBridge({ command }) : new Promise(() => {});
  const b = confirmBody();
  void a.post("/api/recovery/confirm", b, { cookie }).catch(() => {});
  await waitFor(async () => (await commands(a, { cookie }))[0]?.status === "dispatching", "envio em andamento");
  await a.stop("SIGKILL");
  backend.handlers.recovery_bridge = defaultBridge;
  const { a: restarted } = await start(state);
  const [after] = await commands(restarted, { cookie });
  assert.deepEqual([after.id, after.status], [b.request_id, "unknown"]);
});

test("retry de um envio inexistente é 404", async () => {
  const { a } = await start();
  const { cookie } = await login(a);
  assert.equal((await a.post("/api/recovery/retry", { request_id: randomUUID() }, { cookie })).status, 404);
});
