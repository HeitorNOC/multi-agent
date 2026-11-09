/** Business reconciliation only. Never schedules or regenerates inference. */
import { createHash } from "node:crypto";
import { canonical, hash, RetainedError } from "./retained.ts";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
function need(ok: any, message: string): asserts ok {
  if (!ok) throw new RetainedError(503, message);
}
function stripEmptyTombstones(state: any) {
  if (!state.retained_tombstones?.length) delete state.retained_tombstones;
}
function requestRow(r: any, operation: any) {
  const ref = operation.context.inference;
  need(
    r.inference && ref?.id && ref.capability && ref.input_sha,
    "qualified inference context required",
  );
  const row = r.db
    .prepare("SELECT * FROM inference_requests WHERE id=?")
    .get(ref.id) as any;
  need(
    row &&
      row.job === operation.context.job &&
      row.capability === ref.capability &&
      sha(row.input_json) === ref.input_sha,
    "inference admission differs from retained input",
  );
  const job = r.db.prepare("SELECT * FROM jobs WHERE id=?").get(row.job) as any,
    input = JSON.parse(row.input_json);
  need(
    job &&
      job.owner === operation.context.owner &&
      input.installation === r.c.installation &&
      input.job === row.job &&
      input.planHash === job.hash &&
      input.capability === row.capability,
    "inference identity/plan binding mismatch",
  );
  return { row, job, input };
}
export async function discoverUnknown(
  r: any,
  actor: any,
  proof: any,
  local: any[],
  caseId?: string,
) {
  need(r.inference, "inference recovery not configured");
  await r.requireCurrent();
  const candidates = [];
  for (const row of r.db
    .prepare(
      "SELECT * FROM inference_requests WHERE state='admitted' ORDER BY id",
    )
    .all() as any[]) {
    if (caseId && row.id !== caseId) continue;
    const lookup = await r.inference.call("inference_lookup", row.id);
    if (lookup.state === "pending_or_unknown" && lookup.active === false) {
      need(
        lookup.id === row.id && lookup.input_sha === sha(row.input_json),
        "unknown provider input mismatch",
      );
      candidates.push(row);
    }
  }
  need(
    candidates.length === 1,
    "recovery requires one unambiguous unknown inference",
  );
  const row = candidates[0],
    job = r.db.prepare("SELECT * FROM jobs WHERE id=?").get(row.job) as any,
    plan = JSON.parse(job.plan),
    before = hash(r.inventory());
  const context = {
    actor: "governed-inference-recovery",
    owner: job.owner,
    job: job.id,
    action: "inference_close",
    before,
    sources: plan.references.map((x: any) => x.source),
    inference: {
      id: row.id,
      capability: row.capability,
      input_sha: sha(row.input_json),
    },
  };
  const operation = {
    seq: proof.seq + 1,
    id: r.c.installation + ":close:" + hash({ inference: row.id, before }),
    kind: "business_inference_close",
    input_sha: hash(context),
    receipt_sha: null,
    context,
    outcome: null,
  };
  r.governor(actor, operation);
  return inspectInference(r, proof, local, operation, before, true);
}
export async function inspectInference(
  r: any,
  proof: any,
  local: any[],
  operation: any,
  baseline: string,
  candidate = false,
) {
  const { row, job, input } = requestRow(r, operation),
    inventory = r.inventory(),
    current = hash(inventory),
    rebuilt = structuredClone(inventory);
  const read = operation.kind === "business_read_commit",
    record = local.length === operation.seq ? local.at(-1) : null,
    body = record ? JSON.parse(record.body) : null;
  const prepared =
      body?.response?.kind ===
      (read ? "reconciled_read" : "closed_inference_unknown"),
    response = prepared ? body.response : null;
  const votes = (proof.recovery_votes || []).filter(
    (v: any) => v.operation_id === operation.id,
  );
  const receipt = read
    ? r.inference.verify(
        row,
        await r.inference.call("inference_lookup", row.id),
      )
    : await r.inference.call("inference_lookup", row.id);
  if (!read)
    need(
      receipt.id === row.id &&
        receipt.input_sha === sha(row.input_json) &&
        ((receipt.state === "pending_or_unknown" && receipt.active === false) ||
          (receipt.state === "closed_unknown" &&
            receipt.outcome === "unknown_not_reexecuted")),
      "inference active/known/absent; cannot close unknown",
    );
  const evidence = hash({
    operation,
    prefix: local[operation.seq - 2]?.sha,
    baseline,
    input_sha: sha(row.input_json),
    ...(read
      ? { receipt_sha: hash(receipt) }
      : { outcome: "unknown_not_reexecuted" }),
  });
  const rjob = rebuilt.jobs.find((x: any) => x.id === job.id),
    req = rebuilt.inference_requests.find((x: any) => x.id === row.id);
  if (record) {
    need(
      record.id === operation.id &&
        record.kind === operation.kind &&
        record.sha === hash(body) &&
        body.before === baseline &&
        body.after === current,
      "local recovery receipt does not match inventory",
    );
    if (!prepared)
      need(
        read &&
          body.status === 200 &&
          canonical(body.response) ===
            canonical({ ...input.snapshot, semantic: receipt.semantic }),
        "unqualified local read receipt",
      );
  }
  if (prepared) {
    need(
      response.operation_id === operation.id &&
        response.evidence_sha === evidence &&
        response.job === job.id &&
        response.owner === job.owner,
      "prepared inference recovery differs from evidence",
    );
    need(
      response.approvers?.length === 2 &&
        new Set(response.approvers).size === 2 &&
        response.approvers.every((id: string) =>
          votes.some(
            (v: any) =>
              v.actor === id &&
              v.evidence_sha === evidence &&
              v.reason === response.reason,
          ),
        ),
      "prepared recovery needs two retained votes",
    );
    need(
      canonical(response.receipt) === canonical(receipt) &&
        canonical(Object.keys(response.job_before || {}).sort()) ===
          canonical(["deadline", "epoch", "state", "worker"]),
      "prepared receipt or fencing shape differs",
    );
    need(
      rjob.epoch === response.job_before.epoch + 1 &&
        rjob.worker === null &&
        rjob.deadline === 0,
      "recovery fencing mismatch",
    );
    Object.assign(rjob, response.job_before);
    const event = read
      ? "recovery_read_reconciled"
      : "recovery_inference_closed_unknown";
    const audit = rebuilt.audit.filter(
      (x: any) => x.job === job.id && x.event === event,
    );
    need(
      audit.length === 1 &&
        audit[0].actor === response.approvers[1] &&
        audit[0].payload ===
          canonical({
            operation_id: operation.id,
            evidence_sha: evidence,
            approvers: response.approvers,
            inference_id: row.id,
          }),
      "recovery audit differs",
    );
    rebuilt.audit = rebuilt.audit.filter((x: any) => x.seq !== audit[0].seq);
  }
  let committed = false;
  if (read) {
    const result = rebuilt.reads.filter(
      (x: any) => x.job === job.id && x.capability === row.capability,
    );
    if (result.length) {
      committed = true;
      need(
        result.length === 1 &&
          result[0].snapshot ===
            JSON.stringify({ ...input.snapshot, semantic: receipt.semantic }) &&
          req.state === "committed" &&
          canonical(JSON.parse(req.receipt)) === canonical(receipt),
        "persisted read is not the verified provider result",
      );
      const charge = rebuilt.charges.filter(
          (x: any) => x.job === job.id && x.step === "read:" + row.capability,
        ),
        audit = rebuilt.audit.filter(
          (x: any) =>
            x.job === job.id &&
            x.event === "inference_committed" &&
            JSON.parse(x.payload).id === row.id,
        );
      need(
        charge.length === 1 &&
          charge[0].units === 1 &&
          audit.length === 1 &&
          audit[0].actor === operation.context.actor &&
          audit[0].payload ===
            JSON.stringify({
              id: row.id,
              receipt_sha: sha(JSON.stringify(receipt)),
            }),
        "read commit delta incomplete",
      );
      rebuilt.reads = rebuilt.reads.filter((x: any) => x !== result[0]);
      rebuilt.charges = rebuilt.charges.filter((x: any) => x !== charge[0]);
      rebuilt.audit = rebuilt.audit.filter((x: any) => x !== audit[0]);
      rjob.spent -= 1;
      req.state = "admitted";
      req.receipt = null;
    } else
      need(
        req.state === "admitted" && req.receipt === null && !record,
        "partial read delta is not qualified",
      );
  } else if (prepared) {
    const tomb = rebuilt.retained_tombstones?.find(
        (x: any) => x.operation_id === operation.id,
      ),
      charge = rebuilt.charges.filter(
        (x: any) => x.job === job.id && x.step === "unknown:" + row.capability,
      );
    need(
      tomb?.job === job.id &&
        tomb.owner === job.owner &&
        tomb.evidence_sha === evidence &&
        tomb.reason === response.reason &&
        tomb.prepared_by === response.approvers[0] &&
        tomb.confirmed_by === response.approvers[1] &&
        charge.length === 1 &&
        charge[0].units === 1 &&
        req.state === "closed_unknown" &&
        canonical(JSON.parse(req.receipt)) === canonical(receipt),
      "unknown closure delta mismatch",
    );
    rebuilt.retained_tombstones = rebuilt.retained_tombstones.filter(
      (x: any) => x !== tomb,
    );
    stripEmptyTombstones(rebuilt);
    rebuilt.charges = rebuilt.charges.filter((x: any) => x !== charge[0]);
    rjob.spent -= 1;
    req.state = "admitted";
    req.receipt = null;
  } else
    need(
      req.state === "admitted" &&
        req.receipt === null &&
        !rebuilt.reads.some(
          (x: any) => x.job === job.id && x.capability === row.capability,
        ),
      "unknown inference already committed",
    );
  need(
    hash(rebuilt) === baseline,
    "unrelated local delta prevents inference reconciliation",
  );
  if (!prepared && (!read || !committed))
    need(job.spent + 1 <= job.reserved, "recovery exceeds reserved job budget");
  return {
    proof,
    operation,
    mode: prepared ? "prepared" : read ? "read_receipt" : "inference_unknown",
    evidence,
    votes,
    prepared: prepared ? { row: record, body } : null,
    receipt,
    admitted: current,
    committed,
    request: row,
    input,
    job,
    candidate,
  };
}
export function commitInference(r: any, state: any, response: any, actor: any) {
  const row = state.request,
    read = state.mode === "read_receipt";
  if (read && !state.committed) {
    r.db
      .prepare("INSERT INTO charges VALUES(?,?,1)")
      .run(row.job, "read:" + row.capability);
    r.db.prepare("UPDATE jobs SET spent=spent+1 WHERE id=?").run(row.job);
    r.db.prepare("INSERT INTO reads VALUES(?,?,?)").run(
      row.job,
      row.capability,
      JSON.stringify({
        ...state.input.snapshot,
        semantic: state.receipt.semantic,
      }),
    );
    r.db
      .prepare(
        "UPDATE inference_requests SET state='committed',receipt=? WHERE id=?",
      )
      .run(JSON.stringify(state.receipt), row.id);
    r.db
      .prepare("INSERT INTO audit(event,job,actor,payload) VALUES(?,?,?,?)")
      .run(
        "inference_committed",
        row.job,
        state.operation.context.actor,
        JSON.stringify({
          id: row.id,
          receipt_sha: sha(JSON.stringify(state.receipt)),
        }),
      );
  }
  if (!read) {
    r.db
      .prepare("INSERT INTO retained_tombstones VALUES(?,?,?,?,?,?,?)")
      .run(
        state.operation.id,
        row.job,
        response.owner,
        state.evidence,
        response.reason,
        response.approvers[0],
        response.approvers[1],
      );
    r.db
      .prepare("INSERT INTO charges VALUES(?,?,1)")
      .run(row.job, "unknown:" + row.capability);
    r.db
      .prepare(
        "UPDATE inference_requests SET state='closed_unknown',receipt=? WHERE id=?",
      )
      .run(JSON.stringify(response.receipt), row.id);
    r.db
      .prepare(
        "UPDATE jobs SET state='closed_unknown',spent=spent+1 WHERE id=?",
      )
      .run(row.job);
  }
  r.db
    .prepare("UPDATE jobs SET epoch=epoch+1,worker=NULL,deadline=0 WHERE id=?")
    .run(row.job);
  r.db
    .prepare("INSERT INTO audit(event,job,actor,payload) VALUES(?,?,?,?)")
    .run(
      read ? "recovery_read_reconciled" : "recovery_inference_closed_unknown",
      row.job,
      actor.id,
      canonical({
        operation_id: state.operation.id,
        evidence_sha: state.evidence,
        approvers: response.approvers,
        inference_id: row.id,
      }),
    );
}
