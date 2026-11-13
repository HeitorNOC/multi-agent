/**
 * Rotas das integrações: catálogo, conexões, as ações dos conectores e o login no Google.
 *
 * Login no Google para uma conexão: `GET /api/integrations/google/start?connector=…` leva à tela de
 * consentimento; o Google volta em `/api/integrations/google/callback`, o Aurora troca o código
 * pelo token (guardado cifrado) e volta para a tela de Integrações. O estado do login fica preso
 * ao navegador que começou (cookie) e expira em 10 minutos.
 */
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { AppError, invalid, notFound, rateLimited } from "../../../shared/errors.ts";
import type { Json } from "../../../shared/json.ts";
import type { HttpModule } from "../../../platform/http/app.ts";
import {
  catalogView,
  changeConnection,
  connect,
  exportDeliverable,
  importFile,
  listConnections,
  listFiles,
  syncConnection,
  viewConnection,
  type IntegrationsDeps,
} from "../application/integrations.ts";
import type { ConnectionId } from "../domain/connection.ts";
import { GOOGLE_SCOPES, type GoogleOAuth } from "../infrastructure/google.ts";

const permissions = z.strictObject({ read: z.boolean().optional(), write: z.boolean().optional() });
const secret = z.strictObject({ token: z.string().min(1).max(500) });
const connectBody = z.strictObject({
  connector_id: z.string().max(60),
  name: z.string().max(80),
  config: z.record(z.string(), z.json()),
  permissions,
  secret: secret.optional(),
});
const changeBody = z.strictObject({
  name: z.string().max(80).optional(),
  permissions: permissions.optional(),
  active: z.boolean().optional(),
  config: z.record(z.string(), z.json()).optional(),
  secret: secret.optional(),
});
const importBody = z.strictObject({ file: z.string().max(200).optional(), item: z.string().max(300).optional(), title: z.string().max(200).optional() });
const exportBody = z.strictObject({ deliverable_id: z.string().max(60), version: z.number().int().min(1) });
const browseQuery = z.object({ parent: z.string().max(300).optional(), q: z.string().max(300).optional(), cursor: z.string().max(2000).optional() });
const googleStart = z.object({
  connector: z.enum(["google_drive", "gmail"]),
  name: z.string().min(2).max(80),
  read: z.enum(["0", "1"]).default("1"),
  write: z.enum(["0", "1"]).default("0"),
  connection: z.string().regex(/^[0-9a-f-]{36}$/).optional(),
});

const idOf = (params: unknown): ConnectionId => {
  const id = (params as { id?: unknown }).id;
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) throw invalid("invalid_id", "Identificador de conexão inválido");
  return id as ConnectionId;
};

const STATE_COOKIE = "aurora_connect";
const STATE_TTL_MS = 10 * 60_000;
const MAX_PENDING = 100;

function cookieOf(req: FastifyRequest, name: string) {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}

interface PendingGoogle {
  connector: "google_drive" | "gmail";
  name: string;
  permissions: { read: boolean; write: boolean };
  connection?: ConnectionId;
  verifier: string;
  redirectUri: string;
  expires: number;
}

export function integrationsHttp(deps: IntegrationsDeps, options: { google?: GoogleOAuth } = {}): HttpModule {
  const pending = new Map<string, PendingGoogle>();
  return (app, { actor }) => {
    app.get("/api/integrations/catalog", async () => catalogView(deps));
    app.get("/api/integrations", async () => listConnections(deps));
    app.get("/api/integrations/:id", async (req) => viewConnection(deps, idOf(req.params)));

    app.post("/api/integrations", async (req, reply) => {
      const b = connectBody.parse(req.body);
      const view = await connect(deps, actor(req), { connectorId: b.connector_id, name: b.name, config: b.config as Json, permissions: b.permissions, secret: b.secret });
      return reply.code(201).send(view);
    });
    app.post("/api/integrations/:id", async (req) => changeConnection(deps, actor(req), idOf(req.params), changeBody.parse(req.body) as never));

    app.get("/api/integrations/:id/files", async (req) => {
      const q = browseQuery.parse(req.query);
      return listFiles(deps, actor(req), idOf(req.params), { parent: q.parent, query: q.q, cursor: q.cursor });
    });
    // Baixar e ler um arquivo grande (ou uma imagem) pode levar alguns segundos.
    app.post("/api/integrations/:id/import", async (req, reply) => reply.code(201).send(await importFile(deps, actor(req), idOf(req.params), importBody.parse(req.body))));
    app.post("/api/integrations/:id/sync", async (req) => syncConnection(deps, actor(req), idOf(req.params)));
    app.post("/api/integrations/:id/export", async (req, reply) => {
      const b = exportBody.parse(req.body);
      return reply.code(201).send(await exportDeliverable(deps, actor(req), idOf(req.params), { deliverableId: b.deliverable_id, version: b.version }));
    });

    // ── Login no Google para conectar o Drive ou o Gmail ──
    app.get("/api/integrations/google/start", async (req, reply) => {
      const google = options.google;
      if (!google) throw notFound("google_not_configured", "O login no Google não está configurado (AURORA_GOOGLE_CLIENT_ID)");
      const q = googleStart.parse(req.query);
      const now = Date.now();
      for (const [key, p] of pending) if (p.expires < now) pending.delete(key);
      if (pending.size >= MAX_PENDING) throw rateLimited("too_many_logins", "Muitos logins em andamento. Tente de novo em alguns minutos.");
      const redirectUri = `http://${req.headers.host}/api/integrations/google/callback`;
      const { url, state, verifier } = google.start(GOOGLE_SCOPES[q.connector], redirectUri);
      pending.set(state, {
        connector: q.connector,
        name: q.name,
        permissions: { read: q.read === "1", write: q.write === "1" },
        connection: q.connection as ConnectionId | undefined,
        verifier,
        redirectUri,
        expires: now + STATE_TTL_MS,
      });
      reply.header("set-cookie", `${STATE_COOKIE}=${state}; Path=/api/integrations/google; HttpOnly; SameSite=Lax; Max-Age=${STATE_TTL_MS / 1000}`);
      return reply.redirect(url);
    });

    app.get("/api/integrations/google/callback", async (req, reply) => {
      const query = req.query as { state?: string; code?: string; error?: string };
      const state = query.state ?? "";
      const login = pending.get(state);
      pending.delete(state);
      reply.header("set-cookie", `${STATE_COOKIE}=; Path=/api/integrations/google; HttpOnly; SameSite=Lax; Max-Age=0`);
      const back = (params: Record<string, string>) => reply.redirect(`/integracoes?${new URLSearchParams(params)}`);
      if (query.error) return back({ erro: "google_cancelled" });
      if (!options.google || !login || login.expires < Date.now() || cookieOf(req, STATE_COOKIE) !== state || !query.code) return back({ erro: "google_expired" });
      try {
        const tokens = await options.google.exchange(query.code, login.verifier, login.redirectUri);
        const view = login.connection
          ? await changeConnection(deps, actor(req), login.connection, { secret: tokens, active: true })
          : await connect(deps, actor(req), { connectorId: login.connector, name: login.name, config: {}, permissions: login.permissions, secret: tokens });
        return back({ conectado: view.id });
      } catch (error) {
        if (error instanceof AppError) return back({ erro: error.code });
        throw error;
      }
    });
  };
}
