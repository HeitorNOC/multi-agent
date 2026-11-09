import http from "node:http";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { randomUUID, timingSafeEqual } from "node:crypto";
import * as miniPolicy from "./demo-policy.ts";
import {
  queueAdmission,
  queueLimits,
  QueueError,
  type QueueKind,
} from "./queue-admission.ts";
import type {
  JobRecord,
  JobStatus,
  JourneyStore,
  QueueEntry,
} from "./ledger/journey-ledger.ts";
import { openJourneyLedger } from "./ledger/open-ledger.ts";
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
const installation = config.installation || "local-demo";
// Todo o estado durável da jornada passa pelo ledger; este arquivo não conhece o armazenamento.
// `config.ledger` escolhe o armazenamento (SQLite local por padrão, ou PostgreSQL). A trava
// de agendador garante um único agendador por instalação, inclusive durante um reinício.
const ledger = await openJourneyLedger({
  driver: config.ledger,
  stateDir: config.state,
  installation,
  destinationJournal: destination !== null,
  schedulerLock: true,
});
const { requireQueueSpace } = queueAdmission(limits);
if (!queueCapacity && (await ledger.queueDepth()).total)
  throw Error("Existem trabalhos pendentes; habilite a fila antes de iniciar");
/** Falha se o trabalho não existe; devolve o registro lido pela `store` informada. */
async function loadJob(store: JourneyStore, id: string): Promise<JobRecord> {
  const job = await store.getJob(id);
  if (!job) throw Error("Trabalho não encontrado");
  return job;
}
const record = (
  store: JourneyStore,
  id: string,
  node: string,
  detail: unknown,
  eventId?: string,
) => store.appendEvent(id, node, detail, eventId);

// Um reinício registra a conciliação junto ao estado interrompido.
await ledger.transaction(async (tx) => {
  for (const id of await tx.listJobIdsByStatus("running")) {
    await tx.updateJob(id, {
      status: "interrupted",
      error: "Servidor reiniciado; consulte o checkpoint com Retomar",
    });
    await record(tx, id, "server_restart_reconciled", { state: "interrupted" });
  }
  if (queueCapacity)
    for (const id of await tx.listJobIdsByStatus("created"))
      await enqueue(tx, id, "new");
});
// Com um único worker, o próprio ledger impede dois trabalhos ativos ao mesmo tempo.
await ledger.setSingleActiveJob(maxWorkers === 1);
const active = new Map<
  string,
  { child: ReturnType<typeof spawn>; modelLease?: string }
>();
let api = "",
  pumping = false,
  stopping = false;
async function enqueue(
  store: JourneyStore,
  id: string,
  kind: QueueKind,
  crash = false,
) {
  const queuedAt = new Date().toISOString();
  const item = await store.enqueue({ job: id, kind, crash, queuedAt });
  await store.updateJob(id, { status: "queued", error: null });
  await record(store, id, "job_queued", {
    position_id: item.seq,
    kind,
    queued_at: queuedAt,
  });
}
const recovery = await RecoveryAPI.create(
  ledger,
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
      await ledger.transaction(async (tx) => {
        const changed = await tx.updateJob(
          result.job,
          {
            status: "closed_unknown",
            error: "Inferência encerrada como desconhecida após duas revisões.",
          },
          { statusIn: ["failed", "interrupted", "recovery_required"] },
        );
        if (changed)
          await record(tx, result.job, "model_slot_closed_unknown", {
            operation_id: result.operation_id,
          });
      });
    }
    return reply;
  },
);
async function snapshot(store: JourneyStore, id: string) {
  const r = await loadJob(store, id);
  return {
    ...r,
    plan: r.plan ? JSON.parse(r.plan) : null,
    review: r.review ? JSON.parse(r.review) : null,
    receipt: r.receipt ? JSON.parse(r.receipt) : null,
    approval: !!r.approval,
    worker_active: active.has(id),
    events: (await store.listEvents(id)).map((e) => ({
      ...e,
      detail: JSON.parse(e.detail),
    })),
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
      const item = await ledger.peekQueue();
      if (!item) return;
      await startWorker(item.job, item.crash, item);
    }
  } catch {
    /* An unavailable runtime leaves the head queued for the next tick. */
  } finally {
    pumping = false;
  }
}
async function startWorker(id: string, crash = false, queued?: QueueEntry) {
  const job = await loadJob(ledger, id);
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
      await ledger.transaction(async (tx) => {
        await tx.updateJob(
          id,
          { status: closed ? "closed_unknown" : "recovery_required", error: message },
          {
            statusIn: [
              "queued",
              "failed",
              "interrupted",
              "recovery_required",
              "closed_unknown",
            ],
          },
        );
        if (queued) {
          await tx.dequeue(queued.seq, queued.job);
          await record(tx, id, "queue_recovery_required", { state: status });
        }
      });
      throw Error(message);
    }
  }
  const c = await backend("worker_config");
  if (stopping || active.has(id) || (queued && active.size >= maxWorkers))
    throw Error("Executor indisponível");
  if ((await loadJob(ledger, id)).status === "rejected")
    throw Error("Trabalho rejeitado enquanto aguardava o runtime");
  await ledger.transaction(async (tx) => {
    if (queued) {
      if (
        (await loadJob(tx, id)).status !== "queued" ||
        !(await tx.dequeue(queued.seq, id))
      )
        throw Error("Fila alterada");
      await record(tx, id, "job_dequeued", {
        position_id: queued.seq,
        wait_ms: Math.max(0, Date.now() - Date.parse(queued.queuedAt)),
      });
    }
    await tx.updateJob(id, { status: "running", error: null });
    await record(tx, id, "worker_requested", {});
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
  // Pedido já na fila do ledger: garante que "worker_started" venha antes de "worker_stopped",
  // sem segurar os ouvintes do processo filho até a gravação terminar.
  const started = record(ledger, id, "worker_started", {
    pid: child.pid,
    running: active.size,
  });
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
    await ledger.transaction(async (tx) => {
      await record(tx, id, "worker_stopped", {
        pid: child.pid,
        exit_code: code,
      });
      if (spawnError) {
        await tx.updateJob(id, {
          status: "failed",
          error: "Não foi possível iniciar worker",
        });
        await record(tx, id, "worker_start_failed", {});
        return;
      }
      if (
        modelStatus === "closed_unknown" ||
        modelStatus === "review_required" ||
        modelStatus === "inference_active" ||
        modelStatus === "receipt_unavailable"
      ) {
        await tx.updateJob(id, {
          status:
            modelStatus === "closed_unknown"
              ? "closed_unknown"
              : "recovery_required",
          error: "Consulte a evidência da inferência na central Precisa de você.",
        });
        return;
      }
      if (code !== 0) {
        await tx.updateJob(id, {
          status: code === 88 ? "interrupted" : "failed",
          error:
            code === 88
              ? "Interrupção de teste após recibo; retome para conciliar."
              : "Worker falhou; veja o registro local. Não há sucesso presumido.",
        });
        return;
      }
      let outcome: JobStatus | undefined;
      try {
        const result = JSON.parse(output.trim().split("\n").at(-1)!);
        outcome = result.completed ? "completed" : "awaiting_approval";
      } catch {
        /* Saída ausente ou ilegível: tratada como falha verificável abaixo. */
      }
      await tx.updateJob(
        id,
        outcome
          ? { status: outcome, error: null }
          : {
              status: "failed",
              error: "Worker terminou sem resposta verificável",
            },
      );
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
  await started;
}
async function recheckPilotReference(job: JobRecord) {
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

function referenceRevoked(store: JourneyStore, review: any) {
  return store.isReferenceRevoked(referenceVersion(review));
}

async function effect(
  id: string,
  hash: string,
  destinationReceipt?: string,
  registerRepositoryReview = false,
) {
  const receipt = await ledger.transaction(async (tx) => {
    const r = await loadJob(tx, id),
      review = r.review && JSON.parse(r.review);
    authorize(review, registerRepositoryReview ? hash : r.approval, hash);
    if (registerRepositoryReview) {
      await tx.updateJob(id, { approval: hash, status: "completed" });
      await record(tx, id, "human_approved", {
        hash,
        actor: "operador-local-demo",
      });
    }
    const existing = await tx.getEffect(id);
    if (existing && existing.hash !== hash) throw Error("Intenção divergente");
    if (
      !existing &&
      pilotAccess &&
      config.pilotRefundReference &&
      !destinationReceipt &&
      (await referenceRevoked(tx, review))
    ) {
      await tx.updateJob(id, { approval: null });
      await record(tx, id, "effect_reference_rejected", {
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
    if (!existing) await tx.recordEffect(id, hash, JSON.stringify(receipt));
    await tx.updateJob(id, { receipt: JSON.stringify(receipt) });
    await record(tx, id, "effect_receipt", {
      id: receipt.id,
      replayed: !!existing,
      simulated: true,
    });
    return receipt;
  });
  if (!receipt) throw Error("Versão da referência financeira revogada");
  return receipt;
}

async function destinationIntent(
  store: JourneyStore,
  id: string,
): Promise<DestinationIntent | undefined> {
  if (!destination) return;
  const stored = await store.getDestinationIntent(id);
  return stored ? JSON.parse(stored) : undefined;
}

async function destinationEffect(
  id: string,
  hash: string,
  dispatch: boolean,
  lease?: string,
) {
  const { intent, fresh } = await ledger.transaction(async (tx) => {
    const job = await loadJob(tx, id),
      review = JSON.parse(job.review!);
    authorize(review, job.approval, hash);
    const prior = await destinationIntent(tx, id);
    if (prior) return { intent: prior, fresh: false };
    if (!dispatch || (await referenceRevoked(tx, review)))
      throw Error("Intenção externa ausente ou referência revogada");
    const intent: DestinationIntent = {
      id: review.hash,
      scope: referenceVersion(review),
      epoch: review.report.reference_check.version,
      payload: review.payload,
    };
    await tx.recordDestinationIntent(id, JSON.stringify(intent));
    await record(tx, id, "destination_intent_recorded", { intent: intent.id });
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
        if (active.size || (await ledger.queueDepth()).total)
          return send(
            { error: "Aguarde a fila e os workers antes de encerrar" },
            409,
          );
        if (destination && (await ledger.hasPendingDestinationWork()))
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
        const revoked = await ledger.transaction(async (tx) => {
          const job = await loadJob(tx, body.job);
          const review = job.review && JSON.parse(job.review);
          if (!review || review.hash !== body.hash)
            throw Error("Parecer da revogação inválido");
          const version = referenceVersion(review);
          const isNew = await tx.revokeReference(version);
          if (isNew)
            await record(tx, job.id, "reference_revoked", {
              version,
              actor: pilotActor.id,
            });
          if (destination) await tx.revokeDestinationScope(version);
          return { revoked: true, repeated: !isNew, scope: version };
        });
        const { scope, ...result } = revoked;
        if (!destination) return send(result);
        if (!(await ledger.isDestinationRevocationAcknowledged(scope))) {
          let acknowledged = false;
          try {
            acknowledged = await destination.revoke(scope);
          } catch {
            /* Retry requires an explicit request. */
          }
          if (acknowledged)
            await ledger.transaction(async (tx) => {
              if (await tx.acknowledgeDestinationRevocation(scope))
                await record(
                  tx,
                  body.job,
                  "destination_revocation_acknowledged",
                  { scope },
                );
            });
          if (!(await ledger.isDestinationRevocationAcknowledged(scope)))
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
        const job = await loadJob(ledger, body.job);
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
      await loadJob(ledger, id);
      if (queueCapacity && path !== "/internal/model_snapshot") {
        const lease = active.get(id)?.modelLease;
        if (!lease || body.model_lease !== lease)
          return send({ error: "Executor do trabalho não está ativo" }, 403);
      }
      if (path === "/internal/snapshot") return send(await snapshot(ledger, id));
      if (path === "/internal/model_snapshot") {
        const lease = active.get(id)?.modelLease;
        if (
          typeof body.model_lease !== "string" ||
          !lease ||
          body.model_lease !== lease
        )
          return send({ error: "Executor de inferência não está ativo" }, 403);
        return send(await snapshot(ledger, id));
      }
      if (path === "/internal/event")
        return send(await record(ledger, id, body.node, body.detail, body.event_id));
      if (path === "/internal/plan") {
        const r = await loadJob(ledger, id);
        let p;
        try {
          p = validatePlan(body.plan, r.goal);
        } catch (error) {
          await record(ledger, id, "plan_rejected", {
            code: "invalid_plan",
            reason: error instanceof Error && error.constructor === Error
              ? error.message
              : "Falha inesperada ao validar plano",
          });
          throw error;
        }
        if (r.plan && r.plan !== JSON.stringify(p))
          throw Error("Plano já vinculado");
        await ledger.transaction(async (tx) => {
          await tx.updateJob(id, { plan: JSON.stringify(p) });
          await record(tx, id, "plan", p);
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
          review = reviewable(id, report, (await loadJob(ledger, id)).goal);
          if (
            pilotAccess &&
            config.pilotRefundReference &&
            (await referenceRevoked(ledger, review))
          )
            throw Error("Versão da referência financeira revogada");
        } catch (error) {
          await record(ledger, id, "review_rejected", {
            code: "report_contract_rejected",
            reason:
              error instanceof Error ? error.message : "Relatório recusado",
          });
          throw error;
        }
        const r = await loadJob(ledger, id);
        if (pilotAccess && active.get(id)?.modelLease !== body.model_lease)
          return send(
            { error: "Executor do piloto mudou durante a validação" },
            409,
          );
        if (r.review && r.review !== JSON.stringify(review))
          throw Error("Síntese original já vinculada");
        await ledger.transaction(async (tx) => {
          await tx.updateJob(id, { review: JSON.stringify(review) });
          await record(tx, id, "review_ready", {
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
          !(await loadJob(ledger, id)).receipt &&
          !(await destinationIntent(ledger, id))
        ) {
          const original = await loadJob(ledger, id);
          authorize(JSON.parse(original.review!), original.approval, body.hash);
          const verdict = await recheckPilotReference(original);
          const current = await loadJob(ledger, id);
          if (
            active.get(id)?.modelLease !== body.model_lease ||
            current.review !== original.review ||
            current.approval !== original.approval
          )
            return send({ error: "Trabalho mudou durante a conferência" }, 409);
          if (verdict.ok !== true) {
            await ledger.transaction(async (tx) => {
              await tx.updateJob(id, { approval: null });
              await record(tx, id, "effect_reference_rejected", {
                reason: verdict.reason,
              });
            });
            return send(
              { error: "Referência financeira mudou antes do efeito" },
              409,
            );
          }
        }
        if (destination && !(await loadJob(ledger, id)).receipt) {
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
        return send(await effect(id, body.hash));
      }
      throw Error("Operação interna desconhecida");
    }
    if (req.method === "GET" && path === "/api/state") {
      const depth = await ledger.queueDepth();
      return send({
        runtime: await backend("status"),
        ...(pilotActor ? { actor: pilotActor } : {}),
        jobs: await Promise.all(
          (await ledger.listJobIds()).map((id) => snapshot(ledger, id)),
        ),
        goal: GOAL,
        ...(performanceSnapshot ? { performance: performanceSnapshot() } : {}),
        ...(queueCapacity
          ? {
              queue: {
                capacity: queueCapacity,
                pending: depth.total,
                running: active.size,
                max_workers: maxWorkers,
                ...(resumeReserve
                  ? {
                      new_capacity: newCapacity,
                      new_pending: depth.newRequests,
                      resume_reserve: resumeReserve,
                    }
                  : {}),
              },
            }
          : {}),
      });
    }
    const traceMatch = path.match(/^\/api\/jobs\/([\w-]+)\/trace$/);
    if (req.method === "GET" && traceMatch) {
      await loadJob(ledger, traceMatch[1]);
      return send(await ledger.trace(traceMatch[1]));
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
        const accepted = await ledger.transaction(async (tx) => {
          const previous = await tx.latestJobForGoal(goal);
          if (previous) return { ...previous, replayed: true };
          await tx.insertJob({
            id: repositoryJob,
            goal,
            status: "awaiting_approval",
            review: JSON.stringify(repositoryReview),
            created: new Date().toISOString(),
          });
          const { roster, assignments, attempt, tests, decision, repository } = repositoryReview.report;
          await record(tx, repositoryJob, "repository_delivery_imported", repository);
          await record(tx, repositoryJob, "engineering_chief", { roster });
          await record(tx, repositoryJob, "engineering_assign", { assignments });
          await record(tx, repositoryJob, "engineering_qa", { attempt, tests: { passed: tests.passed, log: tests.log } });
          await record(tx, repositoryJob, "engineering_director", { decision });
          await record(tx, repositoryJob, "review_ready", { hash: repositoryReview.hash });
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
        const accepted = await ledger.transaction(async (tx) => {
          const priorJob = key ? await tx.findAdmittedJob(key as string) : undefined;
          if (priorJob) {
            const existing = await loadJob(tx, priorJob);
            if (existing.goal !== goal)
              throw new QueueError("Chave já vinculada a outro pedido", 409);
            return { id: priorJob, status: existing.status, replayed: true };
          }
          await requireQueueSpace(tx, "new");
          const id = randomUUID();
          await tx.insertJob({
            id,
            goal,
            status: "queued",
            created: new Date().toISOString(),
          });
          if (key) await tx.recordAdmission(key as string, id);
          await record(tx, id, "admission", { goal });
          await enqueue(tx, id, "new");
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
      await ledger.transaction(async (tx) => {
        await tx.insertJob({
          id,
          goal,
          status: "created",
          created: new Date().toISOString(),
        });
        await record(tx, id, "admission", { goal });
      });
      try {
        await startWorker(id);
      } catch (error) {
        await ledger.transaction(async (tx) => {
          await tx.updateJob(id, {
            status: "failed",
            error:
              "Runtime indisponível na admissão; retome quando estiver disponível",
          });
          await record(tx, id, "admission_failed", {
            code: "runtime_unavailable",
          });
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
        r = await loadJob(ledger, id);
      const boundReview = r.review && JSON.parse(r.review);
      const repositoryDelivery = boundReview?.payload?.operation === "engineering-repository-review";
      if (repositoryDelivery && operation === "resume")
        return send({ error: "Entrega externa aguarda uma decisão de revisão" }, 409);
      if (repositoryDelivery && operation === "approve" && r.status === "completed" && body.hash === boundReview.hash)
        return send(await snapshot(ledger, id));
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
          await ledger.transaction(async (tx) => {
            await tx.updateJob(id, { status: "rejected", approval: null });
            await record(tx, id, "human_rejected", {
              hash: body.hash,
              ...(pilotActor ? { actor: pilotActor.id } : {}),
            });
          });
          return send(await snapshot(ledger, id));
        }
      }
      if (["rejected", "closed_unknown"].includes(r.status))
        return send({ error: "Trabalho encerrado" }, 409);
      if (repositoryDelivery && operation === "approve") {
        await effect(id, body.hash, undefined, true);
        return send(await snapshot(ledger, id));
      }
      if (
        operation === "approve" &&
        pilotAccess &&
        config.pilotRefundReference
      ) {
        const verdict = await recheckPilotReference(r);
        const current = await loadJob(ledger, id);
        if (
          active.has(id) ||
          current.status !== r.status ||
          current.review !== r.review ||
          current.approval !== r.approval
        )
          return send({ error: "Trabalho mudou durante a conferência" }, 409);
        const revoked = await referenceRevoked(ledger, JSON.parse(r.review!));
        if (revoked || verdict.ok !== true) {
          await ledger.transaction(async (tx) => {
            await tx.updateJob(id, { status: "rejected", approval: null });
            await record(tx, id, "approval_reference_rejected", {
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
      const approval = async (tx: JourneyStore) => {
        if (operation === "approve") {
          await tx.updateJob(id, { approval: body.hash });
          await record(tx, id, "human_approved", {
            hash: body.hash,
            actor: pilotActor?.id ?? "operador-local-demo",
          });
        }
      };
      if (queueCapacity) {
        await ledger.transaction(async (tx) => {
          await requireQueueSpace(tx, "resume");
          await approval(tx);
          await enqueue(
            tx,
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
      await ledger.transaction(approval);
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
  server.close(() => void ledger.close());
});
