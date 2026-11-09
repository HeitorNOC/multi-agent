/** Human command gateway. Uses the existing recovery authority; never schedules agents. */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
const canonical = (x: any): string =>
  Array.isArray(x)
    ? "[" + x.map(canonical).join(",") + "]"
    : x !== null && typeof x === "object"
      ? "{" +
        Object.keys(x)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + canonical(x[k]))
          .join(",") +
        "}"
      : JSON.stringify(x);
const hash = (x: any) =>
  createHash("sha256").update(canonical(x)).digest("hex");
export class RecoveryError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
const requireThat = (ok: any, status: number, message: string) => {
  if (!ok) throw new RecoveryError(status, message);
};
type Reviewer = { id: string; label: string; credential: string };
export class RecoveryAPI {
  db: DatabaseSync;
  installation: string;
  reviewers: Reviewer[];
  bridge: (p: any) => Promise<any>;
  event: (job: string, node: string, detail: any) => any;
  cookie: string;
  inFlight = new Map<string, { input: string; promise: Promise<any> }>();
  constructor(
    db: DatabaseSync,
    installation: string,
    reviewers: Reviewer[],
    bridge: (p: any) => Promise<any>,
    event: (job: string, node: string, detail: any) => any,
  ) {
    this.db = db;
    this.installation = installation;
    this.reviewers = reviewers;
    this.bridge = bridge;
    this.event = event;
    this.cookie = "recovery_" + hash(installation).slice(0, 12);
    requireThat(
      new Set(reviewers.map((x) => x.id)).size === reviewers.length,
      500,
      "Identidades de revisão repetidas",
    );
    db.exec(`CREATE TABLE IF NOT EXISTS recovery_sessions(hash TEXT PRIMARY KEY,actor TEXT,auth_sha TEXT,expires INTEGER);
   CREATE TABLE IF NOT EXISTS recovery_commands(id TEXT PRIMARY KEY,actor TEXT,input_sha TEXT,body TEXT,action TEXT,case_id TEXT,operation_id TEXT,evidence_sha TEXT,status TEXT,result TEXT,updated TEXT);`);
    this.tx(() => {
      for (const row of db
        .prepare(
          "SELECT id,case_id FROM recovery_commands WHERE status='dispatching'",
        )
        .all() as any[]) {
        db.prepare(
          "UPDATE recovery_commands SET status='unknown',updated=? WHERE id=?",
        ).run(new Date().toISOString(), row.id);
        event("recovery:" + row.case_id, "recovery_delivery_unknown", {
          request_id: row.id,
          reason: "api_restart",
        });
      }
    });
  }
  tx<T>(fn: () => T) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  fields(body: any, allowed: string[]) {
    requireThat(
      body &&
        typeof body === "object" &&
        !Array.isArray(body) &&
        Object.keys(body).every((k) => allowed.includes(k)),
      400,
      "Campo de recuperação não permitido",
    );
  }
  actor(headers: any) {
    const value = String(headers.cookie || "")
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(this.cookie + "="))
      ?.slice(this.cookie.length + 1);
    const session =
      value &&
      (this.db
        .prepare("SELECT * FROM recovery_sessions WHERE hash=?")
        .get(hash(value)) as any);
    const reviewer =
      session && this.reviewers.find((x) => x.id === session.actor);
    requireThat(
      reviewer &&
        session.expires > Date.now() &&
        session.auth_sha === hash(reviewer),
      401,
      "Entre com uma credencial local de revisão",
    );
    return reviewer as Reviewer;
  }
  async protocol(actor: Reviewer, command: any) {
    let response: any;
    try {
      response = await this.bridge({ reviewer: actor.id, command });
    } catch {
      throw new RecoveryError(
        503,
        "Protocolo indisponível; o envio pode exigir conciliação",
      );
    }
    if (response?.ok !== true)
      throw new RecoveryError(
        response?.status || 503,
        response?.code === "forbidden"
          ? "Revisão sem autorização atual"
          : response?.status === 409
            ? "Estado ou evidência mudou; inspecione novamente"
            : response?.status === 400
              ? "Contrato de revisão inválido"
              : "Protocolo de recuperação indisponível ou bloqueado",
      );
    if (["recovery_queue", "recovery_inspect"].includes(command.action))
      requireThat(
        response.result?.installation_id === this.installation,
        503,
        "Ponte de recuperação pertence a outra instalação",
      );
    return response.result;
  }
  result(value: any) {
    const out: any = {};
    for (const key of [
      "kind",
      "operation_id",
      "job",
      "owner",
      "evidence_sha",
      "reservation",
      "original_outcome",
      "approvers",
      "proposed",
      "actor",
    ])
      if (value[key] !== undefined) out[key] = value[key];
    if (value.receipt) out.receipt_sha = hash(value.receipt);
    if (value.votes) out.reviewers = value.votes.map((x: any) => x.actor);
    return out;
  }
  async command(actor: Reviewer, body: any, action: string) {
    const input = hash({ actor: actor.id, action, body }),
      prior = this.inFlight.get(body?.request_id);
    if (prior) {
      requireThat(
        prior.input === input,
        409,
        "Envio em andamento com outro conteúdo ou revisor",
      );
      return prior.promise;
    }
    const promise = this.executeCommand(actor, body, action);
    this.inFlight.set(body?.request_id, { input, promise });
    try {
      return await promise;
    } finally {
      this.inFlight.delete(body?.request_id);
    }
  }
  async executeCommand(actor: Reviewer, body: any, action: string) {
    this.fields(body, [
      "request_id",
      "case_id",
      "operation_id",
      "evidence_sha",
      ...(action === "recovery_propose" ? ["reason"] : []),
    ]);
    requireThat(
      typeof body.request_id === "string" &&
        /^[a-f0-9-]{36}$/.test(body.request_id),
      400,
      "Identificação do envio inválida",
    );
    requireThat(
      typeof body.case_id === "string" &&
        body.case_id.length >= 8 &&
        body.case_id.length <= 300 &&
        typeof body.operation_id === "string" &&
        body.operation_id.length <= 300 &&
        /^[a-f0-9]{64}$/.test(body.evidence_sha),
      400,
      "Caso, operação e evidência exatos são obrigatórios",
    );
    requireThat(
      body.operation_id.startsWith(this.installation + ":"),
      403,
      "Operação pertence a outra instalação",
    );
    if (action === "recovery_propose")
      requireThat(
        typeof body.reason === "string" &&
          body.reason.length >= 20 &&
          body.reason.length <= 500,
        400,
        "Informe uma justificativa de 20 a 500 caracteres",
      );
    const input = hash({ actor: actor.id, action, body }),
      prior = this.db
        .prepare("SELECT * FROM recovery_commands WHERE id=?")
        .get(body.request_id) as any;
    requireThat(
      !prior || (prior.actor === actor.id && prior.input_sha === input),
      409,
      "Envio já vinculado a outro conteúdo ou revisor",
    );
    const { request_id, ...fields } = body,
      command = { action, ...fields };
    if (prior?.status === "completed") {
      if (action === "recovery_propose") {
        const queue = await this.protocol(actor, { action: "recovery_queue" });
        if (
          queue.history.some(
            (x: any) =>
              x.operation_id === body.operation_id &&
              x.reviewers.includes(actor.id),
          )
        )
          return {
            request_id,
            status: "completed",
            replayed: true,
            result: JSON.parse(prior.result),
          };
      }
      const response = await this.protocol(actor, command);
      return {
        request_id,
        status: "completed",
        replayed: true,
        result: this.result(response),
      };
    }
    this.tx(() => {
      if (!prior)
        this.db
          .prepare(
            "INSERT INTO recovery_commands VALUES(?,?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            request_id,
            actor.id,
            input,
            JSON.stringify(body),
            action,
            body.case_id,
            body.operation_id,
            body.evidence_sha,
            "dispatching",
            null,
            new Date().toISOString(),
          );
      else
        this.db
          .prepare(
            "UPDATE recovery_commands SET status='dispatching',updated=? WHERE id=?",
          )
          .run(new Date().toISOString(), request_id);
      this.event("recovery:" + body.case_id, "recovery_command_started", {
        request_id,
        actor: actor.id,
        action,
        evidence_sha: body.evidence_sha,
      });
    });
    try {
      const result = this.result(await this.protocol(actor, command));
      this.tx(() => {
        this.db
          .prepare(
            "UPDATE recovery_commands SET status='completed',result=?,updated=? WHERE id=?",
          )
          .run(JSON.stringify(result), new Date().toISOString(), request_id);
        this.event("recovery:" + body.case_id, "recovery_command_completed", {
          request_id,
          actor: actor.id,
          action,
        });
      });
      return { request_id, status: "completed", result };
    } catch (error) {
      const unknown = !(error instanceof RecoveryError) || error.status >= 500;
      this.tx(() => {
        this.db
          .prepare("UPDATE recovery_commands SET status=?,updated=? WHERE id=?")
          .run(
            unknown ? "unknown" : "rejected",
            new Date().toISOString(),
            request_id,
          );
        this.event(
          "recovery:" + body.case_id,
          unknown ? "recovery_delivery_unknown" : "recovery_command_rejected",
          { request_id, actor: actor.id, action },
        );
      });
      throw error instanceof RecoveryError
        ? error
        : new RecoveryError(
            503,
            "Confirmação indisponível; consulte o envio antes de tentar outra operação",
          );
    }
  }
  async handle(method: string, path: string, body: any, headers: any) {
    const reply = (data: any, status = 200, cookie?: string) => ({
      body: data,
      status,
      cookie,
    });
    if (path === "/api/recovery/session" && method === "GET") {
      if (!this.reviewers.length)
        return reply({ enabled: false, authenticated: false });
      try {
        const actor = this.actor(headers);
        return reply({
          enabled: true,
          authenticated: true,
          actor: actor.id,
          label: actor.label,
          local_only: true,
        });
      } catch {
        return reply({ enabled: true, authenticated: false, local_only: true });
      }
    }
    requireThat(
      this.reviewers.length,
      503,
      "Recuperação não conectada nesta instalação",
    );
    if (path === "/api/recovery/session" && method === "POST") {
      this.fields(body, ["credential"]);
      requireThat(
        typeof body.credential === "string" && body.credential.length <= 256,
        401,
        "Credencial local inválida",
      );
      const reviewer = this.reviewers.find((x) =>
        timingSafeEqual(
          Buffer.from(hash(x.credential)),
          Buffer.from(hash(body.credential)),
        ),
      );
      requireThat(reviewer, 401, "Credencial local inválida");
      const token = randomBytes(32).toString("hex");
      this.db
        .prepare("INSERT INTO recovery_sessions VALUES(?,?,?,?)")
        .run(hash(token), reviewer!.id, hash(reviewer), Date.now() + 3600000);
      return reply(
        {
          authenticated: true,
          actor: reviewer!.id,
          label: reviewer!.label,
          local_only: true,
        },
        200,
        this.cookie +
          "=" +
          token +
          "; HttpOnly; SameSite=Strict; Path=/api/recovery; Max-Age=3600",
      );
    }
    const actor = this.actor(headers);
    if (path === "/api/recovery/logout" && method === "POST") {
      this.fields(body, []);
      const cookie = String(headers.cookie || "")
        .split(";")
        .map((x) => x.trim())
        .find((x) => x.startsWith(this.cookie + "="))!;
      this.db
        .prepare("DELETE FROM recovery_sessions WHERE hash=?")
        .run(hash(cookie.slice(this.cookie.length + 1)));
      return reply(
        { authenticated: false },
        200,
        this.cookie +
          "=; HttpOnly; SameSite=Strict; Path=/api/recovery; Max-Age=0",
      );
    }
    if (path === "/api/recovery/cases" && method === "GET")
      return reply(await this.protocol(actor, { action: "recovery_queue" }));
    if (path === "/api/recovery/commands" && method === "GET") {
      const scope = await this.protocol(actor, { action: "recovery_queue" }),
        visible = new Set(
          [...scope.cases, ...scope.history].map((x: any) => x.case_id),
        );
      return reply({
        commands: (
          this.db
            .prepare(
              "SELECT id,action,case_id,operation_id,evidence_sha,status,updated FROM recovery_commands WHERE actor=? ORDER BY updated DESC",
            )
            .all(actor.id) as any[]
        ).filter((row) => visible.has(row.case_id)),
      });
    }
    if (path === "/api/recovery/inspect" && method === "POST") {
      this.fields(body, ["case_id"]);
      requireThat(typeof body.case_id === "string", 400, "Selecione um caso");
      return reply(
        await this.protocol(actor, {
          action: "recovery_inspect",
          case_id: body.case_id,
        }),
      );
    }
    if (path === "/api/recovery/propose" && method === "POST")
      return reply(await this.command(actor, body, "recovery_propose"));
    if (path === "/api/recovery/confirm" && method === "POST")
      return reply(await this.command(actor, body, "recovery_confirm"));
    if (path === "/api/recovery/retry" && method === "POST") {
      this.fields(body, ["request_id"]);
      const prior = this.db
        .prepare("SELECT * FROM recovery_commands WHERE id=? AND actor=?")
        .get(body.request_id, actor.id) as any;
      requireThat(prior, 404, "Envio não encontrado para este revisor");
      return reply(
        await this.command(actor, JSON.parse(prior.body), prior.action),
      );
    }
    return reply({ error: "Rota de recuperação não encontrada" }, 404);
  }
}
