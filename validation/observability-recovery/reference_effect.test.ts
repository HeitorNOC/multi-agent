/** API, scheduler and SQLite are real. The worker and reference backend are controlled. */
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID, scryptSync } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");

test(
  "revogação e efeito têm ordem única e recibo sobrevive à retomada",
  { timeout: 45000 },
  async () => {
    const waitingAtEffect = Promise.withResolvers<void>();
    const continueEffect = Promise.withResolvers<void>();
    let checks = 0;
    const native = createServer(async (req, res) => {
      let text = "";
      for await (const chunk of req) text += chunk;
      const input = JSON.parse(text);
      let result: object = {};
      if (input.action === "status")
        result = { phase: "ready", usage: { calls: 0 } };
      if (input.action === "model_job_status") result = { status: "resumable" };
      if (input.action === "pilot_report") {
        const version = input.selection.fixture_goal.includes("queda") ? 2 : 1;
        result = {
          citations: [{ source: "politica", version }],
          reference_check: {
            status: "confirmed",
            issuer: "financeiro-ficticio",
            field: "refund_deadline_business_days",
            version,
          },
        };
      }
      if (input.action === "pilot_recheck_reference") {
        if (input.report.reference_check.version === 1 && ++checks === 2) {
          waitingAtEffect.resolve();
          await continueEffect.promise;
        }
        result = { ok: true };
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(result));
    });
    native.listen(0, "127.0.0.1");
    await once(native, "listening");
    const backendAddress = native.address();
    assert.ok(backendAddress && typeof backendAddress !== "string");
    const stateRoot = join(here, ".state");
    mkdirSync(stateRoot, { recursive: true });
    const state = mkdtempSync(join(stateRoot, "reference-effect-"));
    const password = "fictitious-reference-password";
    const salt = Buffer.alloc(16, 1);
    const config = {
      root,
      state,
      backend: `http://127.0.0.1:${backendAddress.port}`,
      token: "fictitious-reference-backend-token",
      queueCapacity: 4,
      governedModelSlots: true,
      python: join(
        root,
        "validation/integrated-pilot/.venv/Scripts/python.exe",
      ),
      worker: join(here, "fixture_reference_worker.py"),
      policyModule: pathToFileURL(
        join(root, "apps/aurora/domain/pilot-policy.ts"),
      ).href,
      pilotRefundReference: true,
      pilotExpiresAt: Date.now() + 600000,
      pilotAccounts: ["operator", "viewer"].map((role) => ({
        id: role,
        role,
        salt: salt.toString("hex"),
        verifier: scryptSync(password, salt, 32).toString("hex"),
      })),
    };
    let child: ChildProcessWithoutNullStreams | undefined;
    let url = "",
      operator = "",
      viewer = "";

    const post = (
      path: string,
      body: object,
      cookie = operator,
      key?: string,
    ) =>
      fetch(url + path, {
        method: "POST",
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
        headers: {
          "content-type": "application/json",
          cookie,
          ...(key ? { "idempotency-key": key } : {}),
        },
      });

    async function start() {
      const apiProcess = spawn(
        process.execPath,
        [join(root, "demo/server.ts")],
        { windowsHide: true },
      );
      child = apiProcess;
      const ready = new Promise<string>((resolve, reject) => {
        let output = "",
          error = "";
        apiProcess.stderr.on("data", (chunk) => {
          error += chunk;
        });
        apiProcess.stdout.on("data", (chunk) => {
          output += chunk;
          if (output.includes("\n"))
            resolve(JSON.parse(output.split("\n")[0]).url);
        });
        apiProcess.once("exit", (code) =>
          reject(Error(`API encerrou (${code}) ${error}`)),
        );
      });
      apiProcess.stdin.end(JSON.stringify(config));
      url = await ready;
      const login = async (id: string) => {
        const response = await post("/api/pilot/login", { id, password }, "");
        assert.equal(response.status, 200);
        return response.headers.get("set-cookie")!.split(";", 1)[0];
      };
      operator = await login("operator");
      viewer = await login("viewer");
    }

    async function idle(id: string, status: string) {
      for (let attempt = 0; attempt < 120; attempt++) {
        const state = (await (
          await fetch(url + "/api/state", {
            headers: { cookie: operator },
            signal: AbortSignal.timeout(5000),
          })
        ).json()) as any;
        const job = state.jobs.find((candidate: any) => candidate.id === id);
        if (job?.status === status && !job.worker_active) return job;
        await delay(35);
      }
      throw Error(`Estado ${status} não alcançado`);
    }

    async function submit(goal: string, status = "awaiting_approval") {
      const response = await post(
        "/api/jobs",
        { goal },
        operator,
        randomUUID(),
      );
      assert.equal(response.status, 202);
      return idle(((await response.json()) as any).id, status);
    }

    const approve = (job: any) =>
      post(`/api/jobs/${job.id}/approve`, { hash: job.review.hash });
    const revoke = (job: any, cookie = operator) =>
      post(
        "/api/pilot/revoke-reference",
        { job: job.id, hash: job.review.hash },
        cookie,
      );

    try {
      await start();
      const first = await submit("Teste de bloqueio por revogação");
      assert.equal((await revoke(first, viewer)).status, 403);
      assert.equal((await approve(first)).status, 202);
      await Promise.race([
        waitingAtEffect.promise,
        delay(5000, undefined, { ref: false }).then(() => {
          throw Error("Worker não chegou ao efeito");
        }),
      ]);
      const revoked = await revoke(first);
      assert.equal(revoked.status, 200);
      assert.deepEqual(await revoked.json(), {
        revoked: true,
        repeated: false,
      });
      continueEffect.resolve();
      const blocked = await idle(first.id, "failed");
      assert.equal(blocked.receipt, null);
      assert.ok(
        blocked.events.some(
          (e: any) =>
            e.node === "effect_reference_rejected" &&
            e.detail.reason === "refund_reference_revoked",
        ),
      );

      const second = await submit("Teste de queda após recibo");
      assert.equal((await approve(second)).status, 202);
      const interrupted = await idle(second.id, "interrupted");
      assert.ok(interrupted.receipt?.id);
      assert.equal((await revoke(interrupted)).status, 200);
      const terminated = once(child!, "exit");
      child!.kill();
      await terminated;
      await start();
      assert.equal(
        (await post(`/api/jobs/${second.id}/resume`, {})).status,
        202,
      );
      const completed = await idle(second.id, "completed");
      assert.equal(completed.receipt.id, interrupted.receipt.id);
      assert.deepEqual(
        completed.events
          .filter((e: any) =>
            ["effect_receipt", "reference_revoked"].includes(e.node),
          )
          .map((e: any) => [e.node, e.detail.replayed]),
        [
          ["effect_receipt", false],
          ["reference_revoked", undefined],
          ["effect_receipt", true],
        ],
      );
      const duplicate = await revoke(completed);
      assert.deepEqual(await duplicate.json(), {
        revoked: true,
        repeated: true,
      });
      const afterRestart = await submit(
        "Novo parecer para versão revogada",
        "failed",
      );
      assert.equal(afterRestart.review, null);
      const db = new DatabaseSync(join(state, "journey.sqlite"), {
        readOnly: true,
      });
      try {
        assert.equal(
          db.prepare("SELECT count(*) AS total FROM effects").get()?.total,
          1,
        );
        assert.equal(
          db
            .prepare(
              "SELECT count(*) AS total FROM pilot_reference_revocations",
            )
            .get()?.total,
          2,
        );
      } finally {
        db.close();
      }
    } finally {
      continueEffect.resolve();
      if (child && child.exitCode === null && child.signalCode === null) {
        const stopped = once(child, "exit");
        child.kill();
        await stopped;
      }
      await new Promise<void>((resolve) => native.close(() => resolve()));
    }
  },
);
