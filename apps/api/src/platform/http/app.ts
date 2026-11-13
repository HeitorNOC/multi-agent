/**
 * Servidor HTTP. Aqui ficam só as regras que valem para todas as rotas:
 * - guarda de host e origem (a API escuta em loopback e não aceita outro site como origem);
 * - JSON obrigatório e limite de corpo (cada rota pode pedir um limite maior);
 * - cabeçalhos de segurança;
 * - quem faz o pedido: toda rota `/api/` exige uma pessoa identificada (menos `/api/auth/`);
 * - tradução de erros para HTTP, num único lugar.
 *
 * Cada módulo registra suas rotas com um `HttpModule` e não conhece nada disso.
 */
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import { AppError, forbidden, invalid, unauthenticated, type ErrorKind } from "../../shared/errors.ts";
import type { ActorId } from "../../shared/ids.ts";

export type HttpModule = (app: FastifyInstance, context: HttpContext) => void | Promise<void>;

export interface HttpContext {
  /** Quem faz o pedido (identificado antes da rota rodar). */
  actor(req: FastifyRequest): ActorId;
}

export interface HttpOptions {
  /** Origem pública da API (`http://127.0.0.1:porta`), conhecida depois de escutar. */
  origin: () => string;
  /** Quem faz o pedido: a pessoa da sessão, o operador local, ou ninguém (401). */
  identify(req: FastifyRequest): Promise<ActorId | undefined> | ActorId | undefined;
  modules: readonly HttpModule[];
  /** Limite padrão do corpo, em bytes. */
  bodyLimit?: number;
}

const STATUS: Record<ErrorKind, number> = {
  invalid: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  too_large: 413,
  unsupported: 415,
  rate_limited: 429,
  internal: 500,
  unavailable: 503,
};

const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "content-security-policy":
    "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'",
};

export async function createHttpApp(options: HttpOptions): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: options.bodyLimit ?? 20_000, logger: false });

  app.addHook("onRequest", async (req, reply) => {
    reply.headers(SECURITY_HEADERS);
    // A API escuta em loopback: aceita `127.0.0.1` e `localhost` na mesma porta, nada mais
    // (protege contra DNS rebinding e contra outro site usando o navegador do gestor).
    const origin = new URL(options.origin());
    const local = new URL(origin.href);
    local.hostname = "localhost";
    if (req.headers.host !== origin.host && req.headers.host !== local.host) throw forbidden("invalid_host", "Host inválido");
    if (req.method !== "GET" && req.headers.origin && req.headers.origin !== origin.origin && req.headers.origin !== local.origin)
      throw forbidden("invalid_origin", "Origem inválida");
  });

  // Rotas da API exigem alguém identificado; `/api/auth/` é a porta de entrada; `/internal/`
  // é do worker, com o próprio token; o resto é a interface estática.
  const actors = new WeakMap<FastifyRequest, ActorId>();
  // Decide pela rota que atendeu o pedido (o padrão registrado), nunca pelo texto da URL: o
  // roteador decodifica a URL (`/%61pi/jobs` cai em `/api/jobs`), então o texto cru engana.
  app.addHook("onRequest", async (req) => {
    const route = req.routeOptions.url;
    if (!route?.startsWith("/api/") || route.startsWith("/api/auth/")) return;
    const actor = await options.identify(req);
    if (!actor) throw unauthenticated("sign_in_required", "Entre com a sua conta para continuar");
    actors.set(req, actor);
  });

  // Só JSON. Qualquer outro tipo de corpo é recusado pelo Fastify com 415.
  app.removeAllContentTypeParsers();
  // UTF-8 estrito: texto em outra codificação é recusado, em vez de gravado com caracteres trocados.
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => {
    let text: string;
    try {
      text = utf8.decode(body as Buffer);
    } catch {
      return done(invalid("invalid_encoding", "O corpo do pedido precisa estar em UTF-8"), undefined);
    }
    try {
      done(null, text === "" ? {} : JSON.parse(text));
    } catch {
      done(invalid("invalid_json", "JSON inválido"), undefined);
    }
  });

  app.setErrorHandler((error, _req, reply) => sendError(reply, toAppError(error)));
  app.setNotFoundHandler((_req, reply) => sendError(reply, new AppError("not_found", "route_not_found", "Rota não encontrada")));

  const context: HttpContext = {
    actor(req) {
      const actor = actors.get(req);
      if (!actor) throw unauthenticated("sign_in_required", "Entre com a sua conta para continuar");
      return actor;
    },
  };
  for (const register of options.modules) await register(app, context);
  return app;
}

function sendError(reply: FastifyReply, error: AppError) {
  const status = STATUS[error.kind];
  if (status === 429) reply.header("retry-after", "2");
  return reply.code(status).send({ error: error.message, code: error.code });
}

/** Erros conhecidos viram `AppError`; o resto vira 500 sem vazar detalhes. */
function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return invalid("invalid_request", `${where}${issue?.message ?? "Pedido inválido"}`);
  }
  const code = (error as FastifyError)?.code;
  if (code === "FST_ERR_CTP_BODY_TOO_LARGE") return new AppError("too_large", "body_too_large", "Corpo do pedido excede o limite");
  if (code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") return new AppError("unsupported", "json_required", "JSON obrigatório");
  if (code === "FST_ERR_CTP_EMPTY_JSON_BODY") return invalid("invalid_json", "JSON inválido");
  const status = (error as FastifyError)?.statusCode;
  if (status && status >= 400 && status < 500) return invalid("invalid_request", "Pedido inválido");
  console.error(error);
  return new AppError("internal", "internal_error", "Falha interna");
}
