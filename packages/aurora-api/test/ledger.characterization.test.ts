// Testes de caracterização do ledger de jornada (jobs, fila, admissão, recuperação).
// Só usam a API HTTP, para valer igualmente quando o armazenamento trocar de SQLite para PostgreSQL.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  dropTestSchemas,
  fakeBackend,
  newStateDir,
  startApi,
  waitFor,
  job,
  type Api,
} from "./harness.ts";

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
async function api(opts: Parameters<typeof startApi>[0]) {
  const a = await startApi(opts);
  running.push(a);
  return a;
}
const key = (n: string) => `idem-${n}-`.padEnd(20, "x");

test("admissão devolve 202 e repete a mesma resposta para a mesma Idempotency-Key", async () => {
  const a = await api({ state: newStateDir(), backend: backend.url, workerMode: "hang" });
  const k = key("a");
  const first = await a.post("/api/jobs", {}, { "idempotency-key": k });
  const again = await a.post("/api/jobs", {}, { "idempotency-key": k });
  assert.equal(first.status, 202);
  assert.equal(first.body.replayed, false);
  assert.equal(again.body.id, first.body.id);
  assert.equal(again.body.replayed, true);
  const { body } = await a.get("/api/state");
  assert.equal(body.jobs.length, 1, "a repetição não cria outro trabalho");
});

test("chave de admissão inválida é recusada com 400", async () => {
  const a = await api({ state: newStateDir(), backend: backend.url, workerMode: "hang" });
  const r = await a.post("/api/jobs", {}, { "idempotency-key": "curta" });
  assert.equal(r.status, 400);
});

test("fila cheia responde 429 e a fila preserva a ordem de entrada", async () => {
  const a = await api({
    state: newStateDir(), backend: backend.url, workerMode: "hang", queueCapacity: 2,
  });
  const first = await a.post("/api/jobs");
  await waitFor(async () => (await job(a, first.body.id))?.status === "running", "primeiro em execução");
  const second = await a.post("/api/jobs");
  const third = await a.post("/api/jobs");
  const refused = await a.post("/api/jobs");
  assert.deepEqual([second.status, third.status, refused.status], [202, 202, 429]);
  const { body } = await a.get("/api/state");
  assert.equal(body.queue.pending, 2);
  assert.equal(body.queue.running, 1);
  const seq = (id: string) =>
    body.jobs.find((j: any) => j.id === id).events.find((e: any) => e.node === "job_queued").seq;
  assert.ok(seq(second.body.id) < seq(third.body.id));
});

test("trabalhos concluem em ordem de chegada e param em awaiting_approval", async () => {
  const a = await api({
    state: newStateDir(), backend: backend.url, workerMode: "slow", queueCapacity: 4,
  });
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push((await a.post("/api/jobs")).body.id);
  await waitFor(async () => {
    const { body } = await a.get("/api/state");
    return body.jobs.every((j: any) => j.status === "awaiting_approval");
  }, "três trabalhos aguardando aprovação", 20000);
  const { body } = await a.get("/api/state");
  const dequeued = ids.map(
    (id) => body.jobs.find((j: any) => j.id === id).events.find((e: any) => e.node === "job_dequeued").seq,
  );
  assert.deepEqual(dequeued, [...dequeued].sort((x, y) => x - y));
  assert.equal(body.queue.pending, 0);
});

for (const [mode, expected] of [
  ["fail", "failed"],
  ["crash88", "interrupted"],
] as const) {
  test(`worker com saída ${mode} termina em ${expected}, sem sucesso presumido`, async () => {
    const a = await api({ state: newStateDir(), backend: backend.url, workerMode: mode });
    const id = (await a.post("/api/jobs")).body.id;
    const done = await waitFor(async () => {
      const j = await job(a, id);
      return j.status === expected && j;
    }, `status ${expected}`);
    assert.ok(done.error, "o erro fica registrado");
    assert.ok(done.events.some((e: any) => e.node === "worker_stopped"));
  });
}

test("reinício marca o trabalho em execução como interrupted e registra a conciliação", async () => {
  const state = newStateDir();
  const a = await api({ state, backend: backend.url, workerMode: "hang" });
  const id = (await a.post("/api/jobs")).body.id;
  await waitFor(async () => (await job(a, id))?.status === "running", "em execução");
  await a.stop("SIGKILL");
  const b = await api({ state, backend: backend.url, workerMode: "ok" });
  const j = await job(b, id);
  assert.equal(j.status, "interrupted");
  assert.ok(j.events.some((e: any) => e.node === "server_restart_reconciled"));
});

test("trabalho na fila sobrevive à queda da API, mantém o id e depois executa", async () => {
  const state = newStateDir();
  const a = await api({ state, backend: backend.url, workerMode: "hang", queueCapacity: 4 });
  const first = (await a.post("/api/jobs")).body.id;
  await waitFor(async () => (await job(a, first))?.status === "running", "primeiro em execução");
  const queued = (await a.post("/api/jobs")).body.id;
  await a.stop("SIGKILL");
  const b = await api({ state, backend: backend.url, workerMode: "ok", queueCapacity: 4 });
  const done = await waitFor(async () => {
    const j = await job(b, queued);
    return j?.status === "awaiting_approval" && j;
  }, "trabalho da fila concluído após reinício", 20000);
  assert.equal(done.id, queued);
  assert.equal((await job(b, first)).status, "interrupted");
});

test("uma segunda API no mesmo diretório de estado não inicia (um agendador por instalação)", async () => {
  const state = newStateDir();
  await api({ state, backend: backend.url, workerMode: "hang" });
  await assert.rejects(
    startApi({ state, backend: backend.url, workerMode: "hang" }),
    /encerrou/,
  );
});
