import http from "node:http";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import * as miniPolicy from "./demo-policy.ts";
import {
  queueAdmission,
  queueLimits,
  QueueError,
  type QueueKind,
} from "./queue-admission.ts";
import { Events } from "./telemetry.ts";
import { RecoveryAPI, RecoveryError } from "./recovery.ts";
import { monitorPerformance } from "./performance.ts";
import { PilotAccess } from "./pilot-access.ts";
import {
  PilotDestination,
  type DestinationIntent,
} from "./pilot-destination.ts";

let input = "";
for await (const c of process.stdin) input += c;
const config = JSON.parse(input),
  here = fileURLToPath(new URL("../../demo/", import.meta.url));
// Only the trusted local launcher selects a profile; HTTP clients cannot import code.
const policy: any = config.policyModule
  ? await import(config.policyModule)
  : miniPolicy;
const { GOAL, validatePlan, reviewable, authorize } = policy,
  uiDir = config.uiDir || here;
const pilotAccess = config.pilotAccounts
  ? new PilotAccess(config.pilotAccounts)
  : null;
const destination =
  config.pilotDestination && pilotAccess && config.pilotRefundReference
    ? new PilotDestination(config.pilotDestination)
    : null;
if (config.pilotDestination && !destination)
  throw Error("Destino requer o piloto financeiro");
const performanceSnapshot = config.monitorPerformance
  ? monitorPerformance()
  : null;
mkdirSync(config.state, { recursive: true });
const limits = queueLimits(config.queueCapacity, config.resumeReserve);
const { queueCapacity, resumeReserve, newCapacity } = limits;
const maxWorkers = config.maxWorkers ?? 1;
if (
  ![1, 2].includes(maxWorkers) ||
  (maxWorkers > 1 && (!queueCapacity || !config.governedModelSlots))
) {
  throw Error("Dois workers exigem fila durável e slots governados");
}
// One scheduler per local state directory, including during API restart.
const owner = new DatabaseSync(join(config.state, "scheduler-owner.sqlite"), {
  timeout: 0,
});
owner.exec("BEGIN EXCLUSIVE");
process.once("exit", () => owner.close());
const db = new DatabaseSync(join(config.state, "journey.sqlite"));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,goal TEXT,status TEXT,plan TEXT,review TEXT,approval TEXT,receipt TEXT,error TEXT,created TEXT);
 CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,job TEXT,at TEXT,node TEXT,detail TEXT);
 CREATE TABLE IF NOT EXISTS effects(job TEXT PRIMARY KEY,hash TEXT NOT NULL,receipt TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS pilot_reference_revocations(reference_version TEXT PRIMARY KEY);
 CREATE TABLE IF NOT EXISTS job_queue(seq INTEGER PRIMARY KEY AUTOINCREMENT,job TEXT UNIQUE NOT NULL,kind TEXT NOT NULL,crash INTEGER NOT NULL,queued_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS job_admissions(key TEXT PRIMARY KEY,job TEXT NOT NULL);`);
if (destination)
  db.exec(`
 CREATE TABLE IF NOT EXISTS pilot_destination_revocations(scope TEXT PRIMARY KEY, acknowledged INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS pilot_destination_intents(job TEXT PRIMARY KEY, intent TEXT NOT NULL);`);
else if (
  db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE name='pilot_destination_intents'",
    )
    .get()
)
  throw Error(
    "Esta sessão possui um diário de destino e requer sua configuração",
  );
type QueueItem = {
  seq: number;
  job: string;
  kind: QueueKind;
  crash: number;
  queued_at: string;
};
const { queueCount, newQueueCount, requireQueueSpace } = queueAdmission(
  db,
  limits,
);
if (!queueCapacity && queueCount())
  throw Error("Existem trabalhos pendentes; habilite a fila antes de iniciar");
const installation = config.installation || "local-demo",
  events = new Events(db, installation);
function transaction<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = fn();
    db.exec("COMMIT");
    return value;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
// A restart records reconciliation alongside the interrupted state.
transaction(() => {
  for (const job of db
    .prepare("SELECT id FROM jobs WHERE status='running'")
    .all() as any[]) {
    db.prepare(
      "UPDATE jobs SET status='interrupted',error='Servidor reiniciado; consulte o checkpoint com Retomar' WHERE id=?",
    ).run(job.id);
    events.append(job.id, "server_restart_reconciled", {
      state: "interrupted",
    });
  }
  if (queueCapacity)
    for (const job of db
      .prepare("SELECT id FROM jobs WHERE status='created'")
      .all() as { id: string }[])
      enqueue(job.id, "new");
});
if (maxWorkers === 1)
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS one_running_job ON jobs((1)) WHERE status IN ('created','running')",
  );
else db.exec("DROP INDEX IF EXISTS one_running_job");
const active = new Map<
  string,
  { child: ReturnType<typeof spawn>; modelLease?: string }
>();
let api = "",
  pumping = false,
  stopping = false;
function enqueue(id: string, kind: QueueKind, crash = false) {
  const queuedAt = new Date().toISOString();
  const item = db
    .prepare("INSERT INTO job_queue(job,kind,crash,queued_at) VALUES(?,?,?,?)")
    .run(id, kind, Number(crash), queuedAt);
  db.prepare("UPDATE jobs SET status='queued',error=NULL WHERE id=?").run(id);
  event(id, "job_queued", {
    position_id: Number(item.lastInsertRowid),
    kind,
    queued_at: queuedAt,
  });
}
const recovery = new RecoveryAPI(
  db,
  installation,
  config.recoveryReviewers || [],
  async (payload) => {
    const reply = await backend("recovery_bridge", payload),
      result = reply.result;
    if (
      config.governedModelSlots &&
      reply.ok &&
      payload.command.action === "recovery_confirm" &&
      result.operation_id?.startsWith(installation + ":model:") &&
      result.kind === "closed_inference_unknown"
    ) {
      transaction(() => {
        const changed = db
          .prepare(
            "UPDATE jobs SET status='closed_unknown',error=? WHERE id=? AND status IN ('failed','interrupted','recovery_required')",
          )
          .run(
            "Inferência encerrada como desconhecida após duas revisões.",
            result.job,
          );
        if (changed.changes)
          event(result.job, "model_slot_closed_unknown", {
            operation_id: result.operation_id,
          });
      });
    }
    return reply;
  },
  event,
);
function row(id: string) {
  const r = db.prepare("SELECT * FROM jobs WHERE id=?").get(id) as any;
  if (!r) throw Error("Trabalho não encontrado");
  return r;
}
function event(id: string, node: string, detail: any, eventId?: string) {
  return events.append(id, node, detail, eventId);
}
function snapshot(id: string) {
  const r = row(id);
  return {
    ...r,
    plan: r.plan ? JSON.parse(r.plan) : null,
    review: r.review ? JSON.parse(r.review) : null,
    receipt: r.receipt ? JSON.parse(r.receipt) : null,
    approval: !!r.approval,
    worker_active: active.has(id),
    events: db
      .prepare("SELECT seq,at,node,detail FROM events WHERE job=? ORDER BY seq")
      .all(id)
      .map((e: any) => ({ ...e, detail: JSON.parse(e.detail) })),
  };
}
async function backend(action: string, extra: any = {}) {
  const res = await fetch(config.backend + "/rpc", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-demo-token": config.token,
      ...(action === "recovery_bridge"
        ? { "x-recovery-bridge-token": config.recoveryBridgeKey || "" }
        : {}),
    },
    body: JSON.stringify({ action, ...extra }),
    signal: AbortSignal.timeout(
      action === "recovery_bridge"
        ? 15000
        : queueCapacity &&
            ["worker_config", "model_job_status"].includes(action)
          ? 5000
          : 360000,
    ),
  });
  const data = await res.json();
  if (!res.ok) throw Error(data.error || "Runtime indisponível");
  return data;
}
function tokenOK(value: string) {
  const a = Buffer.from(value || ""),
    b = Buffer.from(config.token);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function pump() {
  if (!queueCapacity || pumping || stopping || active.size >= maxWorkers)
    return;
  pumping = true;
  try {
    while (!stopping && active.size < maxWorkers) {
      const item = db
        .prepare("SELECT * FROM job_queue ORDER BY seq LIMIT 1")
        .get() as QueueItem | undefined;
      if (!item) return;
      await startWorker(item.job, !!item.crash, item);
    }
  } catch {
    /* An unavailable runtime leaves the head queued for the next tick. */
  } finally {
    pumping = false;
  }
}
async function startWorker(id: string, crash = false, queued?: QueueItem) {
  const job = row(id);
  if (active.has(id)) throw Error("Já existe um worker ativo");
  if (
    config.governedModelSlots &&
    (queued ? queued.kind === "resume" : job.status !== "created")
  ) {
    const { status } = await backend("model_job_status", { job: id });
    if (status !== "resumable") {
      const closed = status === "closed_unknown";
      const message = closed
        ? "Inferência encerrada como desconhecida após duas revisões."
        : "Inferência pendente ou recibo indisponível. Consulte a central Precisa de você.";
      transaction(() => {
        db.prepare(
          "UPDATE jobs SET status=?,error=? WHERE id=? AND status IN ('queued','failed','interrupted','recovery_required','closed_unknown')",
        ).run(closed ? "closed_unknown" : "recovery_required", message, id);
        if (queued) {
          db.prepare("DELETE FROM job_queue WHERE seq=?").run(queued.seq);
          event(id, "queue_recovery_required", { state: status });
        }
      });
      throw Error(message);
    }
  }
  const c = await backend("worker_config");
  if (stopping || active.has(id) || (queued && active.size >= maxWorkers))
    throw Error("Executor indisponível");
  if (row(id).status === "rejected")
    throw Error("Trabalho rejeitado enquanto aguardava o runtime");
  transaction(() => {
    if (queued) {
      if (
        row(id).status !== "queued" ||
        !db
          .prepare("DELETE FROM job_queue WHERE seq=? AND job=?")
          .run(queued.seq, id).changes
      )
        throw Error("Fila alterada");
      event(id, "job_dequeued", {
        position_id: queued.seq,
        wait_ms: Math.max(0, Date.now() - Date.parse(queued.queued_at)),
      });
    }
    db.prepare("UPDATE jobs SET status='running',error=NULL WHERE id=?").run(
      id,
    );
    event(id, "worker_requested", {});
  });
  const child = spawn(
    config.python,
    [config.worker || join(here, "worker.py")],
    {
      cwd: config.root,
      windowsHide: true,
      env: {
        ...process.env,
        LANGCHAIN_TRACING_V2: "false",
        LANGSMITH_TRACING: "false",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const modelLease =
    config.governedModelSlots || queueCapacity ? randomUUID() : undefined;
  active.set(id, { child, modelLease });
  event(id, "worker_started", { pid: child.pid, running: active.size });
  let output = "",
    spawnError = false;
  child.stdout.on("data", (b) => {
    output += b.toString();
    if (output.length > 200000) output = output.slice(-200000);
  });
  child.stderr.resume();
  child.stdin.on("error", () => {});
  child.on("error", () => {
    spawnError = true;
  });
  child.on("close", async (code) => {
    if (stopping) {
      active.delete(id);
      return;
    }
    let modelStatus = "resumable";
    if (code !== 0 && config.governedModelSlots) {
      try {
        modelStatus = (await backend("model_job_status", { job: id })).status;
      } catch {}
    }
    active.delete(id);
    if (stopping) return;
    transaction(() => {
      event(id, "worker_stopped", { pid: child.pid, exit_code: code });
      if (spawnError) {
        db.prepare(
          "UPDATE jobs SET status='failed',error='Não foi possível iniciar worker' WHERE id=?",
        ).run(id);
        event(id, "worker_start_failed", {});
        return;
      }
      if (
        modelStatus === "closed_unknown" ||
        modelStatus === "review_required" ||
        modelStatus === "inference_active" ||
        modelStatus === "receipt_unavailable"
      ) {
        db.prepare("UPDATE jobs SET status=?,error=? WHERE id=?").run(
          modelStatus === "closed_unknown"
            ? "closed_unknown"
            : "recovery_required",
          "Consulte a evidência da inferência na central Precisa de você.",
          id,
        );
        return;
      }
      if (code !== 0) {
        db.prepare("UPDATE jobs SET status=?,error=? WHERE id=?").run(
          code === 88 ? "interrupted" : "failed",
          code === 88
            ? "Interrupção de teste após recibo; retome para conciliar."
            : "Worker falhou; veja o registro local. Não há sucesso presumido.",
          id,
        );
        return;
      }
      try {
        const result = JSON.parse(output.trim().split("\n").at(-1)!);
        db.prepare("UPDATE jobs SET status=?,error=NULL WHERE id=?").run(
          result.completed ? "completed" : "awaiting_approval",
          id,
        );
      } catch {
        db.prepare(
          "UPDATE jobs SET status='failed',error='Worker terminou sem resposta verificável' WHERE id=?",
        ).run(id);
      }
    });
    void pump();
  });
  child.stdin.end(
    JSON.stringify({
      ...c,
      api,
      token: config.token,
      job: id,
      goal: job.goal,
      crash_after_effect: crash,
      installation,
      model_lease: modelLease,
      durable_queue: queueCapacity > 0,
      telemetry_path: join(config.state, "telemetry-outbox.sqlite"),
      evidence_contract: config.evidenceContract === true,
      pilot: pilotAccess !== null,
      directive_review:
        pilotAccess !== null &&
        typeof config.pilotDirective === "string" &&
        job.goal === "Analisar a diretiva executiva vinculada a esta tarefa. SHA-256 " + config.pilotDirective,
    }),
  );
}
async function recheckPilotReference(job: ReturnType<typeof row>) {
  return backend("pilot_recheck_reference", {
    goal: job.goal,
    report: JSON.parse(job.review!).report,
  });
}

function referenceVersion(review: any) {
  const check = review?.report?.reference_check;
  const source = review?.report?.citations?.[0]?.source;
  if (
    check?.status !== "confirmed" ||
    typeof check.issuer !== "string" ||
    typeof check.field !== "string" ||
    typeof source !== "string" ||
    !Number.isSafeInteger(check.version)
  )
    throw Error("Referência financeira ausente no parecer");
  return JSON.stringify([check.issuer, check.field, source, check.version]);
}

function referenceRevoked(review: any) {
  return !!db
    .prepare(
      "SELECT 1 FROM pilot_reference_revocations WHERE reference_version=?",
    )
    .get(referenceVersion(review));
}

function effect(id: string, hash: string, destinationReceipt?: string, registerRepositoryReview = false) {
  const receipt = transaction(() => {
    const r = row(id),
      review = r.review && JSON.parse(r.review);
    authorize(review, registerRepositoryReview ? hash : r.approval, hash);
    if (registerRepositoryReview) {
      db.prepare("UPDATE jobs SET approval=?,status='completed' WHERE id=?").run(hash, id);
      event(id, "human_approved", { hash, actor: "operador-local-demo" });
    }
    const existing = db
      .prepare("SELECT hash,receipt FROM effects WHERE job=?")
      .get(id) as any;
    if (existing && existing.hash !== hash) throw Error("Intenção divergente");
    if (
      !existing &&
      pilotAccess &&
      config.pilotRefundReference &&
      !destinationReceipt &&
      referenceRevoked(review)
    ) {
      db.prepare("UPDATE jobs SET approval=NULL WHERE id=?").run(id);
      event(id, "effect_reference_rejected", {
        reason: "refund_reference_revoked",
      });
      return null;
    }
    const receipt = existing
      ? JSON.parse(existing.receipt)
      : {
          id: randomUUID(),
          job: id,
          hash,
          simulated: true,
          recipient: review.payload.recipient,
          content: review.payload.content,
          created: new Date().toISOString(),
          ...(destinationReceipt
            ? { destination_receipt_id: destinationReceipt }
            : {}),
        };
    if (!existing)
      db.prepare("INSERT INTO effects VALUES(?,?,?)").run(
        id,
        hash,
        JSON.stringify(receipt),
      );
    db.prepare("UPDATE jobs SET receipt=? WHERE id=?").run(
      JSON.stringify(receipt),
      id,
    );
    event(id, "effect_receipt", {
      id: receipt.id,
      replayed: !!existing,
      simulated: true,
    });
    return receipt;
  });
  if (!receipt) throw Error("Versão da referência financeira revogada");
  return receipt;
}

function destinationIntent(id: string): DestinationIntent | undefined {
  if (!destination) return;
  const stored = db
    .prepare("SELECT intent FROM pilot_destination_intents WHERE job=?")
    .get(id);
  return stored ? JSON.parse(String(stored.intent)) : undefined;
}

async function destinationEffect(
  id: string,
  hash: string,
  dispatch: boolean,
  lease?: string,
) {
  const { intent, fresh } = transaction(() => {
    const job = row(id),
      review = JSON.parse(job.review!);
    authorize(review, job.approval, hash);
    const prior = destinationIntent(id);
    if (prior) return { intent: prior, fresh: false };
    if (!dispatch || referenceRevoked(review))
      throw Error("Intenção externa ausente ou referência revogada");
    const intent: DestinationIntent = {
      id: review.hash,
      scope: referenceVersion(review),
      epoch: review.report.reference_check.version,
      payload: review.payload,
    };
    db.prepare("INSERT INTO pilot_destination_intents VALUES(?,?)").run(
      id,
      JSON.stringify(intent),
    );
    event(id, "destination_intent_recorded", { intent: intent.id });
    return { intent, fresh: true };
  });
  const receipt = await destination!.receipt(fresh ? "send" : "lookup", intent);
  if (dispatch && active.get(id)?.modelLease !== lease)
    throw Error("Executor mudou durante a consulta ao destino");
  if (!receipt) return null;
  return effect(id, hash, receipt);
}
const server = http.createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'",
  );
  function send(data: any, status = 200) {
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(data));
  }
  try {
    if (req.headers.host !== new URL(api || "http://127.0.0.1:1").host)
      throw Error("Host inválido");
    const path = new URL(req.url!, "http://localhost").pathname;
    if (
      pilotAccess &&
      path.startsWith("/api/") &&
      Date.now() >= config.pilotExpiresAt
    )
      return send({ pilot: true, error: "A sessão do piloto expirou" }, 410);
    if (req.method === "GET" && (path === "/" || path === "/recovery")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        readFileSync(
          join(
            uiDir,
            path === "/recovery" || config.recoveryOnly
              ? "recovery.html"
              : "index.html",
          ),
        ),
      );
      return;
    }
    if (req.method === "GET" && path === "/app.js") {
      res.writeHead(200, { "content-type": "text/javascript" });
      res.end(readFileSync(join(uiDir, "dist/app.js")));
      return;
    }
    if (req.method === "GET" && path === "/app.css") {
      res.writeHead(200, { "content-type": "text/css" });
      res.end(readFileSync(join(uiDir, "dist/app.css")));
      return;
    }
    if (req.method === "GET" && path === "/recovery.js") {
      res.writeHead(200, { "content-type": "text/javascript" });
      res.end(readFileSync(join(uiDir, "dist/recovery.js")));
      return;
    }
    if (req.method === "GET" && path === "/recovery.css") {
      res.writeHead(200, { "content-type": "text/css" });
      res.end(readFileSync(join(uiDir, "dist/recovery.css")));
      return;
    }
    let body: any = {};
    if (req.method === "POST") {
      if (req.headers["content-type"] !== "application/json")
        throw Error("JSON obrigatório");
      if (req.headers.origin && req.headers.origin !== api)
        throw Error("Origem inválida");
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const b of req) {
        bytes += b.length;
        if (bytes > 20000) throw Error("Payload excedido");
        chunks.push(b);
      }
      body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    }
    const pilotActor = pilotAccess?.actor(req.headers);
    if (pilotAccess && path.startsWith("/api/")) {
      if (req.method === "GET" && path === "/api/pilot/session")
        return send({ pilot: true, actor: pilotActor });
      if (req.method === "POST" && path === "/api/pilot/login") {
        const cookie = pilotAccess.login(body);
        if (!cookie)
          return send(
            {
              error:
                "Credenciais inválidas ou aguarde antes de tentar novamente",
            },
            401,
          );
        res.setHeader("Set-Cookie", cookie);
        return send({ ok: true });
      }
      if (!pilotActor)
        return send({ pilot: true, error: "Entre para acessar o piloto" }, 401);
      if (req.method === "POST" && path === "/api/pilot/logout") {
        res.setHeader("Set-Cookie", pilotAccess.logout(req.headers));
        return send({ ok: true });
      }
      if (
        (req.method !== "GET" || path.startsWith("/api/recovery/")) &&
        pilotActor.role !== "operator"
      )
        return send({ error: "A operação exige o perfil de operador" }, 403);
      if (req.method === "POST" && path === "/api/pilot/stop") {
        if (active.size || queueCount())
          return send(
            { error: "Aguarde a fila e os workers antes de encerrar" },
            409,
          );
        if (
          destination &&
          (db
            .prepare(
              "SELECT 1 FROM pilot_destination_revocations WHERE acknowledged=0 LIMIT 1",
            )
            .get() ||
            db
              .prepare(
                "SELECT 1 FROM pilot_destination_intents i LEFT JOIN effects e ON e.job=i.job WHERE e.job IS NULL LIMIT 1",
              )
              .get())
        )
          return send(
            { error: "Ainda há operações do destino sem confirmação" },
            409,
          );
        stopping = true;
        try {
          await backend("stop");
        } catch (error) {
          stopping = false;
          throw error;
        }
        return send({ stopping: true });
      }
      if (stopping && req.method !== "GET")
        return send({ error: "O piloto está encerrando" }, 409);
      if (
        config.pilotRefundReference &&
        req.method === "POST" &&
        path === "/api/pilot/revoke-reference"
      ) {
        const revoked = transaction(() => {
          const job = row(body.job);
          const review = job.review && JSON.parse(job.review);
          if (!review || review.hash !== body.hash)
            throw Error("Parecer da revogação inválido");
          const version = referenceVersion(review);
          const inserted = db
            .prepare(
              "INSERT OR IGNORE INTO pilot_reference_revocations VALUES(?)",
            )
            .run(version);
          if (inserted.changes)
            event(job.id, "reference_revoked", {
              version,
              actor: pilotActor.id,
            });
          if (destination)
            db.prepare(
              "INSERT OR IGNORE INTO pilot_destination_revocations(scope) VALUES(?)",
            ).run(version);
          return { revoked: true, repeated: !inserted.changes, scope: version };
        });
        const { scope, ...result } = revoked;
        if (!destination) return send(result);
        if (
          !db
            .prepare(
              "SELECT 1 FROM pilot_destination_revocations WHERE scope=? AND acknowledged=1",
            )
            .get(scope)
        ) {
          let acknowledged = false;
          try {
            acknowledged = await destination.revoke(scope);
          } catch {
            /* Retry requires an explicit request. */
          }
          if (acknowledged)
            transaction(() => {
              const changed = db
                .prepare(
                  "UPDATE pilot_destination_revocations SET acknowledged=1 WHERE scope=? AND acknowledged=0",
                )
                .run(scope);
              if (changed.changes)
                event(body.job, "destination_revocation_acknowledged", {
                  scope,
                });
            });
          if (
            !db
              .prepare(
                "SELECT 1 FROM pilot_destination_revocations WHERE scope=? AND acknowledged=1",
              )
              .get(scope)
          )
            return send({ ...result, destination: "pending" }, 202);
        }
        return send({ ...result, destination: "acknowledged" });
      }
      if (
        destination &&
        req.method === "POST" &&
        path === "/api/pilot/connector/reconcile"
      ) {
        if (active.has(body.job))
          return send({ error: "Worker ainda está ativo" }, 409);
        const job = row(body.job);
        authorize(JSON.parse(job.review!), job.approval, body.hash);
        if (job.receipt)
          return send({
            status: "confirmed",
            receipt: JSON.parse(job.receipt),
          });
        const receipt = await destinationEffect(body.job, body.hash, false);
        return send(
          receipt ? { status: "confirmed", receipt } : { status: "unknown" },
        );
      }
    }
    if (path.startsWith("/api/recovery/")) {
      const result = await recovery.handle(
        req.method || "",
        path,
        body,
        req.headers,
      );
      if (result.cookie) res.setHeader("Set-Cookie", result.cookie);
      return send(result.body, result.status);
    }
    if (path.startsWith("/internal/")) {
      if (!tokenOK(String(req.headers["x-demo-token"] || "")))
        return send({ error: "Acesso interno negado" }, 403);
      if (req.method !== "POST")
        return send({ error: "POST obrigatório" }, 405);
      const id = body.job;
      if (!id) throw Error("Trabalho ausente");
      row(id);
      if (queueCapacity && path !== "/internal/model_snapshot") {
        const lease = active.get(id)?.modelLease;
        if (!lease || body.model_lease !== lease)
          return send({ error: "Executor do trabalho não está ativo" }, 403);
      }
      if (path === "/internal/snapshot") return send(snapshot(id));
      if (path === "/internal/model_snapshot") {
        const lease = active.get(id)?.modelLease;
        if (
          typeof body.model_lease !== "string" ||
          !lease ||
          body.model_lease !== lease
        )
          return send({ error: "Executor de inferência não está ativo" }, 403);
        return send(snapshot(id));
      }
      if (path === "/internal/event")
        return send(event(id, body.node, body.detail, body.event_id));
      if (path === "/internal/plan") {
        const r = row(id);
        let p;
        try {
          p = validatePlan(body.plan, r.goal);
        } catch (error) {
          event(id, "plan_rejected", {
            code: "invalid_plan",
            reason: error instanceof Error && error.constructor === Error
              ? error.message
              : "Falha inesperada ao validar plano",
          });
          throw error;
        }
        if (r.plan && r.plan !== JSON.stringify(p))
          throw Error("Plano já vinculado");
        transaction(() => {
          db.prepare("UPDATE jobs SET plan=? WHERE id=?").run(
            JSON.stringify(p),
            id,
          );
          event(id, "plan", p);
        });
        return send(p);
      }
      if (path === "/internal/review") {
        let review: any;
        try {
          const report = pilotAccess
            ? await backend("pilot_report", {
                job: id,
                model_lease: body.model_lease,
                selection: body.report,
              })
            : body.report;
          review = reviewable(id, report, row(id).goal);
          if (
            pilotAccess &&
            config.pilotRefundReference &&
            referenceRevoked(review)
          )
            throw Error("Versão da referência financeira revogada");
        } catch (error) {
          event(id, "review_rejected", {
            code: "report_contract_rejected",
            reason:
              error instanceof Error ? error.message : "Relatório recusado",
          });
          throw error;
        }
        const r = row(id);
        if (pilotAccess && active.get(id)?.modelLease !== body.model_lease)
          return send(
            { error: "Executor do piloto mudou durante a validação" },
            409,
          );
        if (r.review && r.review !== JSON.stringify(review))
          throw Error("Síntese original já vinculada");
        transaction(() => {
          db.prepare("UPDATE jobs SET review=? WHERE id=?").run(
            JSON.stringify(review),
            id,
          );
          event(id, "review_ready", {
            hash: review.hash,
            model_approval_mismatch:
              !pilotAccess && body.report.requires_approval !== true,
          });
        });
        return send(review);
      }
      if (path === "/internal/effect") {
        if (
          pilotAccess &&
          config.pilotRefundReference &&
          !row(id).receipt &&
          !destinationIntent(id)
        ) {
          const original = row(id);
          authorize(JSON.parse(original.review!), original.approval, body.hash);
          const verdict = await recheckPilotReference(original);
          const current = row(id);
          if (
            active.get(id)?.modelLease !== body.model_lease ||
            current.review !== original.review ||
            current.approval !== original.approval
          )
            return send({ error: "Trabalho mudou durante a conferência" }, 409);
          if (verdict.ok !== true) {
            transaction(() => {
              db.prepare("UPDATE jobs SET approval=NULL WHERE id=?").run(id);
              event(id, "effect_reference_rejected", {
                reason: verdict.reason,
              });
            });
            return send(
              { error: "Referência financeira mudou antes do efeito" },
              409,
            );
          }
        }
        if (destination && !row(id).receipt) {
          const receipt = await destinationEffect(
            id,
            body.hash,
            true,
            body.model_lease,
          );
          if (!receipt)
            return send({ error: "Resultado desconhecido no destino" }, 409);
          return send(receipt);
        }
        return send(effect(id, body.hash));
      }
      throw Error("Operação interna desconhecida");
    }
    if (req.method === "GET" && path === "/api/state")
      return send({
        runtime: await backend("status"),
        ...(pilotActor ? { actor: pilotActor } : {}),
        jobs: db
          .prepare("SELECT id FROM jobs ORDER BY created DESC,rowid DESC")
          .all()
          .map((r: any) => snapshot(r.id)),
        goal: GOAL,
        ...(performanceSnapshot ? { performance: performanceSnapshot() } : {}),
        ...(queueCapacity
          ? {
              queue: {
                capacity: queueCapacity,
                pending: queueCount(),
                running: active.size,
                max_workers: maxWorkers,
                ...(resumeReserve
                  ? {
                      new_capacity: newCapacity,
                      new_pending: newQueueCount(),
                      resume_reserve: resumeReserve,
                    }
                  : {}),
              },
            }
          : {}),
      });
    const traceMatch = path.match(/^\/api\/jobs\/([\w-]+)\/trace$/);
    if (req.method === "GET" && traceMatch) {
      row(traceMatch[1]);
      return send(events.trace(traceMatch[1]));
    }
    if (req.method === "POST" && path === "/api/jobs") {
      if (config.recoveryOnly)
        throw Error(
          "Este perfil oferece somente a central de recuperação operacional",
        );
      // One bounded synthetic journey, not an unrestricted prompt/agent console.
      const goal = policy.chooseGoal
        ? policy.chooseGoal(body, config.pilotDirective)
        : GOAL;
      if (!config.engineeringRepository && goal === policy.QUE_EXECUTION_GOAL)
        return send({ error: "Repositório de engenharia indisponível nesta sessão" }, 409);
      if (!policy.chooseGoal && body.goal !== undefined && body.goal !== GOAL)
        throw Error(
          "Esta demonstração aceita somente o pedido fictício exibido",
        );
      const repositoryJob = randomUUID();
      const repositoryReview = !pilotAccess && policy.repositoryReview?.(repositoryJob, goal);
      if (repositoryReview) {
        const accepted = transaction(() => {
          const previous = db.prepare("SELECT id,status FROM jobs WHERE goal=? ORDER BY rowid DESC LIMIT 1").get(goal);
          if (previous) return { ...previous, replayed: true };
          db.prepare("INSERT INTO jobs(id,goal,status,review,created) VALUES(?,?,?,?,?)").run(
            repositoryJob, goal, "awaiting_approval", JSON.stringify(repositoryReview), new Date().toISOString(),
          );
          const { roster, assignments, attempt, tests, decision, repository } = repositoryReview.report;
          event(repositoryJob, "repository_delivery_imported", repository);
          event(repositoryJob, "engineering_chief", { roster });
          event(repositoryJob, "engineering_assign", { assignments });
          event(repositoryJob, "engineering_qa", { attempt, tests: { passed: tests.passed, log: tests.log } });
          event(repositoryJob, "engineering_director", { decision });
          event(repositoryJob, "review_ready", { hash: repositoryReview.hash });
          return { id: repositoryJob, status: "awaiting_approval", replayed: false };
        });
        return send(accepted, accepted.replayed ? 200 : 201);
      }
      if (queueCapacity) {
        const key = req.headers["idempotency-key"];
        if (
          key !== undefined &&
          (typeof key !== "string" || !/^[a-zA-Z0-9_-]{16,100}$/.test(key))
        )
          throw new QueueError("Chave de admissão inválida", 400);
        const accepted = transaction(() => {
          const prior = key
            ? (db
                .prepare("SELECT job FROM job_admissions WHERE key=?")
                .get(key as string) as { job: string } | undefined)
            : undefined;
          if (prior) {
            const existing = row(prior.job);
            if (existing.goal !== goal)
              throw new QueueError("Chave já vinculada a outro pedido", 409);
            return { id: prior.job, status: existing.status, replayed: true };
          }
          requireQueueSpace("new");
          const id = randomUUID();
          db.prepare(
            "INSERT INTO jobs(id,goal,status,created) VALUES(?,?,?,?)",
          ).run(id, goal, "queued", new Date().toISOString());
          if (key)
            db.prepare("INSERT INTO job_admissions VALUES(?,?)").run(
              key as string,
              id,
            );
          event(id, "admission", { goal });
          enqueue(id, "new");
          return { id, status: "queued", replayed: false };
        });
        send(accepted, 202);
        void pump();
        return;
      }
      const status = await backend("status");
      if (status.phase !== "ready")
        return send({ error: "Conhecimento ainda está sendo preparado" }, 409);
      if (active.size) throw Error("Aguarde o trabalho em execução");
      const id = randomUUID();
      transaction(() => {
        db.prepare(
          "INSERT INTO jobs(id,goal,status,created) VALUES(?,?,?,?)",
        ).run(id, goal, "created", new Date().toISOString());
        event(id, "admission", { goal });
      });
      try {
        await startWorker(id);
      } catch (error) {
        transaction(() => {
          db.prepare(
            "UPDATE jobs SET status='failed',error='Runtime indisponível na admissão; retome quando estiver disponível' WHERE id=?",
          ).run(id);
          event(id, "admission_failed", { code: "runtime_unavailable" });
        });
        throw error;
      }
      return send({ id }, 201);
    }
    const match = path.match(
      /^\/api\/jobs\/([\w-]+)\/(approve|reject|resume)$/,
    );
    if (req.method === "POST" && match) {
      const [, id, operation] = match,
        r = row(id);
      const boundReview = r.review && JSON.parse(r.review);
      const repositoryDelivery = boundReview?.payload?.operation === "engineering-repository-review";
      if (repositoryDelivery && operation === "resume")
        return send({ error: "Entrega externa aguarda uma decisão de revisão" }, 409);
      if (repositoryDelivery && operation === "approve" && r.status === "completed" && body.hash === boundReview.hash)
        return send(snapshot(id));
      if (active.has(id))
        return send({ error: "Worker ainda está ativo" }, 409);
      if (queueCapacity && r.status === "queued") {
        if (
          operation === "resume" ||
          (operation === "approve" && r.approval && r.approval === body.hash)
        )
          return send({ id, status: "queued" }, 202);
        return send({ error: "Trabalho já está na fila" }, 409);
      }
      if (operation === "approve" || operation === "reject") {
        if (
          r.status !== "awaiting_approval" ||
          !r.review ||
          body.hash !== JSON.parse(r.review).hash
        )
          return send(
            { error: "Plano alterado ou não está aguardando aprovação" },
            409,
          );
        if (operation === "reject") {
          transaction(() => {
            db.prepare(
              "UPDATE jobs SET status='rejected',approval=NULL WHERE id=?",
            ).run(id);
            event(id, "human_rejected", {
              hash: body.hash,
              ...(pilotActor ? { actor: pilotActor.id } : {}),
            });
          });
          return send(snapshot(id));
        }
      }
      if (["rejected", "closed_unknown"].includes(r.status))
        return send({ error: "Trabalho encerrado" }, 409);
      if (repositoryDelivery && operation === "approve") {
        effect(id, body.hash, undefined, true);
        return send(snapshot(id));
      }
      if (
        operation === "approve" &&
        pilotAccess &&
        config.pilotRefundReference
      ) {
        const verdict = await recheckPilotReference(r);
        const current = row(id);
        if (
          active.has(id) ||
          current.status !== r.status ||
          current.review !== r.review ||
          current.approval !== r.approval
        )
          return send({ error: "Trabalho mudou durante a conferência" }, 409);
        const revoked = referenceRevoked(JSON.parse(r.review!));
        if (revoked || verdict.ok !== true) {
          transaction(() => {
            db.prepare(
              "UPDATE jobs SET status='rejected',approval=NULL WHERE id=?",
            ).run(id);
            event(id, "approval_reference_rejected", {
              reason: revoked ? "refund_reference_revoked" : verdict.reason,
            });
          });
          return send(
            {
              error:
                "Referência financeira indisponível ou alterada. Crie um novo parecer.",
            },
            409,
          );
        }
      }
      const approval = () => {
        if (operation === "approve") {
          db.prepare("UPDATE jobs SET approval=? WHERE id=?").run(
            body.hash,
            id,
          );
          event(id, "human_approved", {
            hash: body.hash,
            actor: pilotActor?.id ?? "operador-local-demo",
          });
        }
      };
      if (queueCapacity) {
        transaction(() => {
          requireQueueSpace("resume");
          approval();
          enqueue(
            id,
            "resume",
            !pilotAccess &&
              operation === "approve" &&
              body.crash_after_effect === true,
          );
        });
        send({ id, status: "queued" }, 202);
        void pump();
        return;
      }
      transaction(approval);
      await startWorker(
        id,
        operation === "approve" && body.crash_after_effect === true,
      );
      return send({ id });
    }
    send({ error: "Rota não encontrada" }, 404);
  } catch (error) {
    const status =
      error instanceof RecoveryError || error instanceof QueueError
        ? error.status
        : 409;
    if (status === 429) res.setHeader("Retry-After", "2");
    send({ error: error instanceof Error ? error.message : "Falha" }, status);
  }
});
server.listen(config.port || 0, "127.0.0.1", () => {
  const port = (server.address() as any).port;
  api = "http://127.0.0.1:" + port;
  console.log(JSON.stringify({ ready: true, url: api, port }));
  void pump();
});
if (queueCapacity) setInterval(() => void pump(), 1000).unref();
process.on("SIGTERM", () => {
  stopping = true;
  for (const { child } of active.values()) child.kill();
  server.close();
});
