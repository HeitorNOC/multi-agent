/** Human command gateway. Uses the existing recovery authority; never schedules agents. */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { JourneyLedger } from "./ledger/journey-ledger.ts";
import { sha as hash } from "./ledger/event-codec.ts";
export class RecoveryError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
/** Lança `RecoveryError` se `ok` for falso; ao retornar, o compilador sabe que `ok` é verdadeiro. */
function requireThat(ok: unknown, status: number, message: string): asserts ok {
  if (!ok) throw new RecoveryError(status, message);
}
type Reviewer = { id: string; label: string; credential: string };
export class RecoveryAPI {
  private readonly ledger: JourneyLedger;
  installation: string;
  reviewers: Reviewer[];
  bridge: (p: any) => Promise<any>;
  cookie: string;
  inFlight = new Map<string, { input: string; promise: Promise<any> }>();

  private constructor(
    ledger: JourneyLedger,
    installation: string,
    reviewers: Reviewer[],
    bridge: (p: any) => Promise<any>,
  ) {
    this.ledger = ledger;
    this.installation = installation;
    this.reviewers = reviewers;
    this.bridge = bridge;
    this.cookie = "recovery_" + hash(installation).slice(0, 12);
    requireThat(
      new Set(reviewers.map((x) => x.id)).size === reviewers.length,
      500,
      "Identidades de revisão repetidas",
    );
  }

  /**
   * Cria a central e concilia o que uma queda anterior deixou: todo envio que estava em
   * andamento passa a "unknown", porque não se sabe se o protocolo o recebeu.
   */
  static async create(
    ledger: JourneyLedger,
    installation: string,
    reviewers: Reviewer[],
    bridge: (p: any) => Promise<any>,
  ) {
    const api = new RecoveryAPI(ledger, installation, reviewers, bridge);
    await ledger.transaction(async (tx) => {
      for (const command of await tx.listDispatchingRecoveryCommands()) {
        await tx.updateRecoveryCommandStatus(
          command.id,
          "unknown",
          new Date().toISOString(),
        );
        await tx.appendEvent(
          "recovery:" + command.caseId,
          "recovery_delivery_unknown",
          { request_id: command.id, reason: "api_restart" },
        );
      }
    });
    return api;
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
  async actor(headers: any) {
    const value = String(headers.cookie || "")
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(this.cookie + "="))
      ?.slice(this.cookie.length + 1);
    const session = value
      ? await this.ledger.findRecoverySession(hash(value))
      : undefined;
    const reviewer =
      session && this.reviewers.find((x) => x.id === session.actor);
    requireThat(
      reviewer &&
        session.expires > Date.now() &&
        session.authSha === hash(reviewer),
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
      prior = await this.ledger.getRecoveryCommand(body.request_id);
    requireThat(
      !prior || (prior.actor === actor.id && prior.inputSha === input),
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
            result: JSON.parse(prior.result!),
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
    await this.ledger.transaction(async (tx) => {
      const now = new Date().toISOString();
      if (!prior)
        await tx.insertRecoveryCommand({
          id: request_id,
          actor: actor.id,
          inputSha: input,
          body: JSON.stringify(body),
          action,
          caseId: body.case_id,
          operationId: body.operation_id,
          evidenceSha: body.evidence_sha,
          status: "dispatching",
          result: null,
          updated: now,
        });
      else await tx.updateRecoveryCommandStatus(request_id, "dispatching", now);
      await tx.appendEvent("recovery:" + body.case_id, "recovery_command_started", {
        request_id,
        actor: actor.id,
        action,
        evidence_sha: body.evidence_sha,
      });
    });
    try {
      const result = this.result(await this.protocol(actor, command));
      await this.ledger.transaction(async (tx) => {
        await tx.updateRecoveryCommandStatus(
          request_id,
          "completed",
          new Date().toISOString(),
          JSON.stringify(result),
        );
        await tx.appendEvent("recovery:" + body.case_id, "recovery_command_completed", {
          request_id,
          actor: actor.id,
          action,
        });
      });
      return { request_id, status: "completed", result };
    } catch (error) {
      const unknown = !(error instanceof RecoveryError) || error.status >= 500;
      await this.ledger.transaction(async (tx) => {
        await tx.updateRecoveryCommandStatus(
          request_id,
          unknown ? "unknown" : "rejected",
          new Date().toISOString(),
        );
        await tx.appendEvent(
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
        const actor = await this.actor(headers);
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
      await this.ledger.createRecoverySession({
        hash: hash(token),
        actor: reviewer!.id,
        authSha: hash(reviewer),
        expires: Date.now() + 3600000,
      });
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
    const actor = await this.actor(headers);
    if (path === "/api/recovery/logout" && method === "POST") {
      this.fields(body, []);
      const cookie = String(headers.cookie || "")
        .split(";")
        .map((x) => x.trim())
        .find((x) => x.startsWith(this.cookie + "="))!;
      await this.ledger.deleteRecoverySession(
        hash(cookie.slice(this.cookie.length + 1)),
      );
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
        commands: (await this.ledger.listRecoveryCommandsForActor(actor.id))
          .filter((row) => visible.has(row.caseId))
          .map((row) => ({
            id: row.id,
            action: row.action,
            case_id: row.caseId,
            operation_id: row.operationId,
            evidence_sha: row.evidenceSha,
            status: row.status,
            updated: row.updated,
          })),
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
      const prior = await this.ledger.getRecoveryCommandForActor(
        body.request_id,
        actor.id,
      );
      requireThat(prior, 404, "Envio não encontrado para este revisor");
      return reply(
        await this.command(actor, JSON.parse(prior.body), prior.action),
      );
    }
    return reply({ error: "Rota de recuperação não encontrada" }, 404);
  }
}
