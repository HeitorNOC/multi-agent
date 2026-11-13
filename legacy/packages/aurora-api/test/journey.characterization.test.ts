// Caracterização do caminho de aprovação e efeito: plano → parecer → aprovação → recibo único.
// Usa só a API HTTP; vale igualmente para qualquer armazenamento do ledger.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { dropTestSchemas, fakeBackend, newStateDir, startApi, waitFor, job, type Api } from "./harness.ts";

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

async function reviewedJob() {
  const a = await startApi({ state: newStateDir(), backend: backend.url, workerMode: "journey" });
  running.push(a);
  const id = (await a.post("/api/jobs")).body.id;
  const j = await waitFor(async () => {
    const x = await job(a, id);
    return x?.status === "awaiting_approval" && x;
  }, "parecer pronto para aprovação");
  return { a, id, j };
}

test("worker registra plano e parecer e o trabalho aguarda aprovação exata", async () => {
  const { j } = await reviewedJob();
  assert.equal(j.plan.strategy, "A3");
  assert.equal(j.plan.requires_approval, true);
  assert.match(j.review.hash, /^[a-f0-9]{64}$/);
  assert.equal(j.approval, false);
  const nodes = j.events.map((e: any) => e.node);
  assert.ok(nodes.indexOf("plan") < nodes.indexOf("review_ready"));
});

test("aprovar com o hash correto executa o efeito uma vez e conclui com recibo", async () => {
  const { a, id, j } = await reviewedJob();
  const approved = await a.post(`/api/jobs/${id}/approve`, { hash: j.review.hash });
  assert.equal(approved.status, 202);
  const done = await waitFor(async () => {
    const x = await job(a, id);
    return x?.status === "completed" && x;
  }, "trabalho concluído após aprovação");
  assert.equal(done.receipt.hash, j.review.hash);
  assert.equal(done.receipt.simulated, true);
  const nodes = done.events.map((e: any) => e.node);
  assert.equal(nodes.filter((n: string) => n === "effect_receipt").length, 1);
  assert.ok(nodes.indexOf("human_approved") < nodes.indexOf("effect_receipt"));
});

test("aprovar com hash diferente é recusado e nada muda", async () => {
  const { a, id } = await reviewedJob();
  const r = await a.post(`/api/jobs/${id}/approve`, { hash: "0".repeat(64) });
  assert.equal(r.status, 409);
  const after = await job(a, id);
  assert.equal(after.status, "awaiting_approval");
  assert.equal(after.approval, false);
  assert.ok(!after.events.some((e: any) => e.node === "human_approved"));
});

test("rejeitar encerra o trabalho, registra a decisão e impede aprovação posterior", async () => {
  const { a, id, j } = await reviewedJob();
  const rejected = await a.post(`/api/jobs/${id}/reject`, { hash: j.review.hash });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.status, "rejected");
  assert.ok(rejected.body.events.some((e: any) => e.node === "human_rejected"));
  const late = await a.post(`/api/jobs/${id}/approve`, { hash: j.review.hash });
  assert.equal(late.status, 409);
  assert.equal((await job(a, id)).receipt, null);
});

test("aprovar duas vezes o mesmo trabalho na fila não duplica a retomada", async () => {
  const { a, id, j } = await reviewedJob();
  const first = await a.post(`/api/jobs/${id}/approve`, { hash: j.review.hash });
  const second = await a.post(`/api/jobs/${id}/approve`, { hash: j.review.hash });
  assert.equal(first.status, 202);
  assert.ok([202, 409].includes(second.status));
  const done = await waitFor(async () => {
    const x = await job(a, id);
    return x?.status === "completed" && x;
  }, "concluído");
  assert.equal(done.events.filter((e: any) => e.node === "effect_receipt").length, 1);
});
