import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AppError } from "../../../shared/errors.ts";
import { JobId } from "../../../shared/ids.ts";
import { newJob, type Job } from "./job.ts";
import * as t from "./transitions.ts";

const fresh = () => newJob({ id: JobId.create(), goal: "Analisar compras", createdAt: "2026-01-01T00:00:00.000Z" });
const review = { hash: "h1", summary: "s" };
const awaiting = (): Job => t.finishRun(t.attachReview(t.start(fresh()), review), "awaiting_approval");
const code = (fn: () => unknown) => {
  try {
    fn();
    return "ok";
  } catch (e) {
    return e instanceof AppError ? e.code : String(e);
  }
};

describe("transições do trabalho", () => {
  test("ciclo feliz: fila → execução → aprovação → retomada → concluído", () => {
    const approved = t.approve(awaiting(), "h1");
    assert.equal(approved.approval, "h1");
    const done = t.finishRun(t.start(t.requeue(approved)), "completed");
    assert.equal(done.status, "completed");
  });

  test("transição fora da tabela é recusada", () => {
    assert.equal(code(() => t.finishRun(fresh(), "completed")), "invalid_transition");
    assert.equal(code(() => t.requeue(t.reject(awaiting(), "h1"))), "invalid_transition", "rejeitado é final");
  });

  test("aprovar e rejeitar exigem o hash do parecer atual", () => {
    assert.equal(code(() => t.approve(awaiting(), "outro")), "approval_mismatch");
    assert.equal(code(() => t.reject(awaiting(), "outro")), "approval_mismatch");
    assert.equal(code(() => t.approve(fresh(), "h1")), "approval_mismatch");
  });

  test("plano e parecer: repetir o mesmo é aceito; trocar é recusado", () => {
    const running = t.start(fresh());
    const planned = t.attachPlan(running, { agents: ["a"], b: 1 });
    assert.equal(t.attachPlan(planned, { b: 1, agents: ["a"] }), planned, "mesma estrutura em outra ordem de chaves");
    assert.equal(code(() => t.attachPlan(planned, { agents: ["b"] })), "plan_already_bound");
    assert.equal(code(() => t.attachPlan(fresh(), {})), "not_running");
    const reviewed = t.attachReview(running, review);
    assert.equal(code(() => t.attachReview(reviewed, { hash: "h2" })), "review_already_bound");
  });

  test("reinício interrompe só o que estava em execução", () => {
    assert.equal(t.interruptOnRestart(t.start(fresh())).status, "interrupted");
    assert.equal(code(() => t.interruptOnRestart(fresh())), "invalid_transition");
  });

  test("efeito só com aprovação", () => {
    assert.equal(code(() => t.recordReceipt(awaiting(), { id: "r" })), "not_approved");
    assert.deepEqual(t.recordReceipt(t.approve(awaiting(), "h1"), { id: "r" }).receipt, { id: "r" });
  });

  test("revisão humana e encerramento como desconhecido", () => {
    const blocked = t.requireRecovery(t.start(fresh()), "inferência sem recibo");
    assert.deepEqual([blocked.status, blocked.error], ["recovery_required", "inferência sem recibo"]);
    assert.equal(t.closeAsUnknown(blocked, "revisado").status, "closed_unknown");
  });
});
