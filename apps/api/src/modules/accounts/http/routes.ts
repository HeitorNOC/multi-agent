/**
 * Rotas de acesso. `/api/auth/*` é a porta de entrada (não exige sessão); `/api/access/*` é a
 * gestão de quem entra, só para o dono.
 *
 * A sessão vai num cookie HttpOnly e SameSite=Lax: o JavaScript da página não lê o token, e
 * outro site não consegue usá-lo em pedidos que mudam algo (a guarda de origem também recusa).
 */
import { randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { AppError, notFound, unauthenticated } from "../../../shared/errors.ts";
import { ActorId } from "../../../shared/ids.ts";
import type { HttpModule } from "../../../platform/http/app.ts";
import {
  accessStatus,
  accountView,
  authenticate,
  invite,
  listAccess,
  removeInvite,
  setEnabled,
  setupOwner,
  signIn,
  signInExternal,
  signOut,
  signUp,
  type AccountsDeps,
  type Session,
} from "../application/accounts.ts";
import { PASSWORD_MAX, PROVIDERS, type Provider } from "../domain/account.ts";
import { pkce } from "../infrastructure/oidc.ts";

const SESSION_COOKIE = "aurora_session";
const STATE_COOKIE = "aurora_oauth";
const STATE_TTL_MS = 10 * 60_000;

const newAccount = z.strictObject({
  name: z.string().max(100).default(""),
  email: z.string().min(3).max(200),
  password: z.string().max(PASSWORD_MAX),
});
const credentials = z.strictObject({ email: z.string().max(200), password: z.string().max(PASSWORD_MAX) });
const inviteBody = z.strictObject({ email: z.string().min(3).max(200), role: z.enum(["owner", "member"]).default("member") });
const enabledBody = z.strictObject({ enabled: z.boolean() });
const removeBody = z.strictObject({ email: z.string().min(3).max(200) });

export function readCookie(req: FastifyRequest, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

function cookie(name: string, value: string, maxAgeSeconds: number, path = "/") {
  return `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function startSession(reply: FastifyReply, session: Session) {
  const seconds = Math.floor((Date.parse(session.expiresAt) - Date.now()) / 1000);
  reply.header("set-cookie", cookie(SESSION_COOKIE, session.token, seconds));
}

/** Quem é a pessoa do pedido, pela sessão (usado pela guarda da API). */
export function sessionIdentity(deps: AccountsDeps) {
  return async (req: FastifyRequest) => (await authenticate(deps, readCookie(req, SESSION_COOKIE)))?.id;
}

interface PendingLogin {
  provider: Provider;
  verifier: string;
  nonce: string;
  redirectUri: string;
  expires: number;
}

export function accountsHttp(deps: AccountsDeps): HttpModule {
  // Logins externos em andamento (curtos; um reinício só pede para começar de novo).
  const pending = new Map<string, PendingLogin>();
  const providerOf = (params: unknown) => {
    const id = (params as { provider?: string }).provider as Provider;
    const provider = PROVIDERS.includes(id) ? deps.providers[id] : undefined;
    if (!provider) throw notFound("provider_not_configured", "Este provedor de login não está configurado");
    return provider;
  };

  return (app, { actor }) => {
    app.get("/api/auth/status", async () => accessStatus(deps));

    app.get("/api/auth/me", async (req) => {
      const account = await authenticate(deps, readCookie(req, SESSION_COOKIE));
      if (!account) throw unauthenticated("sign_in_required", "Entre com a sua conta para continuar");
      return accountView(account);
    });

    app.post("/api/auth/setup", async (req, reply) => {
      const session = await setupOwner(deps, newAccount.parse(req.body));
      startSession(reply, session);
      return reply.code(201).send(accountView(session.account));
    });

    app.post("/api/auth/sign-up", async (req, reply) => {
      const session = await signUp(deps, newAccount.parse(req.body));
      startSession(reply, session);
      return reply.code(201).send(accountView(session.account));
    });

    app.post("/api/auth/sign-in", async (req, reply) => {
      const session = await signIn(deps, credentials.parse(req.body));
      startSession(reply, session);
      return accountView(session.account);
    });

    app.post("/api/auth/sign-out", async (req, reply) => {
      await signOut(deps, readCookie(req, SESSION_COOKIE));
      reply.header("set-cookie", cookie(SESSION_COOKIE, "", 0));
      return reply.code(204).send();
    });

    // Google / Microsoft: o navegador vai ao provedor e volta no callback com um código.
    app.get("/api/auth/oauth/:provider/start", async (req, reply) => {
      const provider = providerOf(req.params);
      const now = Date.now();
      for (const [key, p] of pending) if (p.expires < now) pending.delete(key);
      const state = randomBytes(24).toString("base64url");
      const nonce = randomBytes(24).toString("base64url");
      const { verifier, challenge } = pkce();
      // Volta para o mesmo endereço em que a pessoa está (o cookie de sessão é desse endereço).
      const redirectUri = `http://${req.headers.host}/api/auth/oauth/${provider.id}/callback`;
      pending.set(state, { provider: provider.id, verifier, nonce, redirectUri, expires: now + STATE_TTL_MS });
      // O estado também fica num cookie: o retorno só vale no navegador que começou o login.
      reply.header("set-cookie", cookie(STATE_COOKIE, state, STATE_TTL_MS / 1000, "/api/auth/oauth"));
      return reply.redirect(provider.authorizationUrl({ redirectUri, state, nonce, challenge }));
    });

    app.get("/api/auth/oauth/:provider/callback", async (req, reply) => {
      const provider = providerOf(req.params);
      const query = req.query as { state?: string; code?: string; error?: string };
      const state = query.state ?? "";
      const login = pending.get(state);
      pending.delete(state);
      reply.header("set-cookie", cookie(STATE_COOKIE, "", 0, "/api/auth/oauth"));
      const fail = (code: string) => reply.redirect(`/entrar?erro=${encodeURIComponent(code)}`);
      if (query.error) return fail("oauth_cancelled");
      if (!login || login.provider !== provider.id || login.expires < Date.now() || readCookie(req, STATE_COOKIE) !== state || !query.code)
        return fail("oauth_expired");
      try {
        const person = await provider.exchange({ code: query.code, redirectUri: login.redirectUri, verifier: login.verifier, nonce: login.nonce });
        startSession(reply, await signInExternal(deps, provider.id, person));
        return reply.redirect("/");
      } catch (error) {
        if (error instanceof AppError) return fail(error.code);
        throw error;
      }
    });

    // Quem tem acesso (dono).
    app.get("/api/access", async (req) => listAccess(deps, actor(req)));
    app.post("/api/access/invites", async (req, reply) => {
      await invite(deps, actor(req), inviteBody.parse(req.body));
      return reply.code(201).send(await listAccess(deps, actor(req)));
    });
    app.post("/api/access/invites/remove", async (req) => {
      await removeInvite(deps, actor(req), removeBody.parse(req.body).email);
      return listAccess(deps, actor(req));
    });
    app.post("/api/access/accounts/:id", async (req) => {
      await setEnabled(deps, actor(req), ActorId.parse((req.params as { id: string }).id), enabledBody.parse(req.body).enabled);
      return listAccess(deps, actor(req));
    });
  };
}

/** Sem contas (uso individual no próprio computador): todo pedido é do operador local. */
export function localAccessHttp(): HttpModule {
  return (app) => {
    app.get("/api/auth/status", async () => ({ mode: "local", setup_required: false, providers: [] }));
    app.get("/api/auth/me", async () => ({ id: "operador-local", email: null, name: "Operador local", role: "owner" }));
  };
}
