// Rotas de trabalhos e regras gerais do HTTP, via `inject` (sem abrir porta), contra os dois bancos.
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import type { FastifyInstance, InjectOptions } from "fastify";
import { manualClock } from "../../../shared/clock.ts";
import { ActorId, type JobId } from "../../../shared/ids.ts";
import { UnitOfWork } from "../../../platform/database/unit-of-work.ts";
import { createHttpApp } from "../../../platform/http/app.ts";
import { dialects, fresh, type TestDatabase } from "../../../../test/support/databases.ts";
import { testPolicy } from "../../../../test/support/test-policy.ts";
import { jobsStore } from "../infrastructure/jobs-store.ts";
import type { JobsDeps } from "../application/deps.ts";
import { queueLimits } from "../application/queue-limits.ts";
import { claimNextJob, finishRun } from "../application/run-lifecycle.ts";
import { jobsHttp } from "./routes.ts";

const ORIGIN = "http://127.0.0.1:4100";
const HOST = "127.0.0.1:4100";
const TOKEN = "segredo-do-worker";
const opened: { close(): Promise<void> }[] = [];
afterEach(async () => {
  for (const d of opened.splice(0)) await d.close();
});

for (const dialect of dialects) {
  describe(`HTTP de trabalhos — ${dialect}`, () => {
    async function setup(limits = { capacity: 4, resumeReserve: 0, maxWorkers: 1 }) {
      const d: TestDatabase = await fresh(dialect);
      opened.push(d);
      const clock = manualClock("2026-03-01T10:00:00.000Z");
      const leases = new Map<string, string>();
      const jobs: JobsDeps = {
        uow: new UnitOfWork(d.db, jobsStore(clock)),
        policy: testPolicy,
        limits: queueLimits(limits),
        clock,
        workers: { isActive: (id) => leases.has(id), count: () => leases.size },
      };
      let wakes = 0;
      const app = await createHttpApp({
        origin: () => ORIGIN,
        actor: () => ActorId.parse("operador-local"),
        modules: [
          jobsHttp({
            jobs,
            wake: () => void wakes++,
            workerAccess: {
              acceptsToken: (t) => t === TOKEN,
              holdsLease: (id, lease) => leases.get(id) === lease,
            },
          }),
        ],
      });
      opened.push({ close: () => app.close() });
      const call = (opts: InjectOptions) => app.inject({ ...opts, headers: { host: HOST, ...opts.headers } });
      const worker = (id: string, op: string, payload: object, lease = leases.get(id)) =>
        call({ method: "POST", url: `/internal/jobs/${id}/${op}`, headers: { "x-worker-token": TOKEN }, payload: { lease, ...payload } });
      /** Simula o agendador: tira da fila e dá uma concessão ao "worker". */
      async function run() {
        const claim = await claimNextJob(jobs);
        assert.equal(claim.kind, "started");
        if (claim.kind === "started") leases.set(claim.job.id, `lease-${claim.job.id}`);
        return claim.kind === "started" ? claim.job.id : undefined!;
      }
      async function exit(id: JobId, exitCode: number, completed: boolean) {
        leases.delete(id);
        await finishRun(jobs, id, { exitCode, declared: { completed } });
      }
      return { app, call, worker, run, exit, wakes: () => wakes };
    }

    test("jornada completa: pedir → plano → parecer → aprovar → efeito → concluído", async () => {
      const { call, worker, run, exit, wakes } = await setup();
      const created = await call({ method: "POST", url: "/api/jobs", payload: { goal: "Analisar compras" }, headers: { "idempotency-key": "envio-0123456789abcdef" } });
      assert.equal(created.statusCode, 201);
      const id = created.json().id;
      const again = await call({ method: "POST", url: "/api/jobs", payload: { goal: "Analisar compras" }, headers: { "idempotency-key": "envio-0123456789abcdef" } });
      assert.deepEqual([again.statusCode, again.json().id, wakes()], [200, id, 1]);

      await run();
      assert.equal((await worker(id, "snapshot", {})).json().status, "running");
      assert.equal((await worker(id, "plan", { plan: { agents: ["compras"] } })).statusCode, 200);
      const review = (await worker(id, "review", { report: { summary: "Três cotações" } })).json().review;
      await exit(id, 0, false);
      assert.equal((await call({ method: "GET", url: `/api/jobs/${id}` })).json().status, "awaiting_approval");

      const wrong = await call({ method: "POST", url: `/api/jobs/${id}/approve`, payload: { hash: "outro" } });
      assert.deepEqual([wrong.statusCode, wrong.json().code], [409, "approval_mismatch"]);
      const approved = await call({ method: "POST", url: `/api/jobs/${id}/approve`, payload: { hash: review.hash } });
      assert.deepEqual([approved.statusCode, approved.json().status, approved.json().approved], [202, "queued", true]);

      await run();
      const receipt = (await worker(id, "effect", { hash: review.hash })).json().receipt;
      assert.deepEqual((await worker(id, "effect", { hash: review.hash })).json().receipt, receipt);
      await exit(id, 0, true);
      const done = (await call({ method: "GET", url: `/api/jobs/${id}` })).json();
      assert.equal(done.status, "completed");
      assert.ok(done.events.some((e: { kind: string }) => e.kind === "human_approved"));
    });

    test("lista com o estado da fila", async () => {
      const { call } = await setup({ capacity: 3, resumeReserve: 1, maxWorkers: 2 });
      await call({ method: "POST", url: "/api/jobs", payload: { goal: "pedido a" } });
      const list = (await call({ method: "GET", url: "/api/jobs" })).json();
      assert.equal(list.jobs.length, 1);
      assert.deepEqual(list.queue, { capacity: 3, resume_reserve: 1, max_workers: 2, pending: 1, new_pending: 1, running: 0 });
    });

    test("erros viram status certos, com código estável", async () => {
      const { call } = await setup({ capacity: 1, resumeReserve: 0, maxWorkers: 1 });
      const cases: [InjectOptions, number, string][] = [
        [{ method: "POST", url: "/api/jobs", payload: { goal: "" } }, 400, "invalid_goal"],
        [{ method: "POST", url: "/api/jobs", payload: { goal: "pedido" }, headers: { "idempotency-key": "curta" } }, 400, "invalid_admission_key"],
        [{ method: "GET", url: "/api/jobs/nao-existe" }, 404, "job_not_found"],
        [{ method: "GET", url: "/api/jobs/%20" }, 400, "invalid_id"],
        [{ method: "POST", url: "/api/jobs/x/approve", payload: {} }, 400, "invalid_request"],
        [{ method: "GET", url: "/api/nada" }, 404, "route_not_found"],
        [{ method: "POST", url: "/api/jobs", payload: "goal=x", headers: { "content-type": "text/plain" } }, 415, "json_required"],
        [{ method: "POST", url: "/api/jobs", payload: "{", headers: { "content-type": "application/json" } }, 400, "invalid_json"],
        [{ method: "POST", url: "/api/jobs", payload: Buffer.from('{"goal":"Política"}', "latin1"), headers: { "content-type": "application/json" } }, 400, "invalid_encoding"],
        [{ method: "POST", url: "/api/jobs", payload: { goal: "x".repeat(30_000) } }, 413, "body_too_large"],
      ];
      for (const [opts, status, code] of cases) {
        const res = await call(opts);
        assert.deepEqual([res.statusCode, res.json().code], [status, code], `${opts.method} ${opts.url}`);
      }
      await call({ method: "POST", url: "/api/jobs", payload: { goal: "primeiro" } });
      const full = await call({ method: "POST", url: "/api/jobs", payload: { goal: "segundo" } });
      assert.deepEqual([full.statusCode, full.json().code, full.headers["retry-after"]], [429, "queue_full", "2"]);
    });

    test("guarda: host e origem errados são recusados; cabeçalhos de segurança presentes", async () => {
      const { call } = await setup();
      const badHost = await call({ method: "GET", url: "/api/jobs", headers: { host: "evil.example" } });
      assert.deepEqual([badHost.statusCode, badHost.json().code], [403, "invalid_host"]);
      const badOrigin = await call({ method: "POST", url: "/api/jobs", payload: { goal: "pedido" }, headers: { origin: "http://evil.example" } });
      assert.deepEqual([badOrigin.statusCode, badOrigin.json().code], [403, "invalid_origin"]);
      const local = await call({ method: "GET", url: "/api/jobs", headers: { host: "localhost:4100" } });
      assert.equal(local.statusCode, 200, "localhost na mesma porta é a mesma máquina");
      const otherPort = await call({ method: "GET", url: "/api/jobs", headers: { host: "localhost:9999" } });
      assert.equal(otherPort.statusCode, 403);
      const ok = await call({ method: "POST", url: "/api/jobs", payload: { goal: "pedido" }, headers: { origin: ORIGIN } });
      assert.equal(ok.statusCode, 201);
      assert.equal(ok.headers["cache-control"], "no-store");
      assert.equal(ok.headers["x-content-type-options"], "nosniff");
    });

    test("rotas do worker exigem segredo e a concessão da execução atual", async () => {
      const { call, worker, run, exit } = await setup();
      const id = (await call({ method: "POST", url: "/api/jobs", payload: { goal: "pedido" } })).json().id;
      const noToken = await call({ method: "POST", url: `/internal/jobs/${id}/snapshot`, payload: { lease: "x" } });
      assert.deepEqual([noToken.statusCode, noToken.json().code], [403, "worker_token_invalid"]);
      assert.equal((await worker(id, "snapshot", {}, "qualquer")).json().code, "worker_not_active", "sem execução ativa");
      await run();
      assert.equal((await worker(id, "snapshot", {}, "concessao-antiga")).json().code, "worker_not_active");
      assert.equal((await worker(id, "snapshot", {})).statusCode, 200);
      const event = await worker(id, "events", { kind: "agent_started", detail: { agent: "compras" }, event_id: "6f1c2a40-1111-4a2b-8c3d-000000000001" });
      assert.deepEqual(event.json(), { eventId: "6f1c2a40-1111-4a2b-8c3d-000000000001", replayed: false });
      assert.equal((await worker(id, "events", { kind: "agent_started", detail: { agent: "compras" }, event_id: "6f1c2a40-1111-4a2b-8c3d-000000000001" })).json().replayed, true);
      await exit(id as JobId, 1, false);
      assert.equal((await worker(id, "snapshot", {}, `lease-${id}`)).json().code, "worker_not_active", "concessão some no fim");
    });
  });
}
