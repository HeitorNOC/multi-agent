// Contas de acesso: casos de uso nos dois bancos e o caminho HTTP completo (senha e Google).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { manualClock } from "../../shared/clock.ts";
import { AppError } from "../../shared/errors.ts";
import { ActorId } from "../../shared/ids.ts";
import { UnitOfWork } from "../../platform/database/unit-of-work.ts";
import { dialects, fresh, type TestDatabase } from "../../../test/support/databases.ts";
import { loadConfig } from "../../config.ts";
import { startServer } from "../../server.ts";
import {
  authenticate,
  invite,
  listAccess,
  LoginThrottle,
  setEnabled,
  setupOwner,
  signIn,
  signInExternal,
  signOut,
  signUp,
  type AccountsDeps,
} from "./application/accounts.ts";
import { GoogleOidc, MicrosoftOidc } from "./infrastructure/oidc.ts";
import { verifyPassword, hashPassword } from "./infrastructure/password.ts";
import { accountsStore } from "./infrastructure/sql-accounts.ts";

const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : String(e)));
const PASSWORD = "senha-forte-123";
const opened: TestDatabase[] = [];
afterEach(async () => {
  for (const d of opened.splice(0)) await d.close();
});

const idToken = (claims: object) => ["e30", Buffer.from(JSON.stringify(claims)).toString("base64url"), "assinatura"].join(".");
const tokenResponse = (claims: object) => async () => new Response(JSON.stringify({ id_token: idToken(claims) }), { status: 200 });

test("senha: hash com sal, verificação e recusa de hash ausente", async () => {
  const a = await hashPassword(PASSWORD);
  assert.notEqual(a, await hashPassword(PASSWORD), "sal diferente a cada vez");
  assert.equal(await verifyPassword(PASSWORD, a), true);
  assert.equal(await verifyPassword("outra-senha-qualquer", a), false);
  assert.equal(await verifyPassword(PASSWORD, null), false);
});

test("Google: valida público, validade, nonce, emissor e e-mail verificado", async () => {
  const now = Date.parse("2026-03-01T10:00:00Z");
  const base = { iss: "https://accounts.google.com", aud: "cliente", sub: "g-1", exp: now / 1000 + 600, nonce: "n1", email: "ana@empresa.com", email_verified: true, name: "Ana" };
  const google = (claims: object) => new GoogleOidc({ clientId: "cliente", clientSecret: "s" }, { fetch: tokenResponse(claims), now: () => now });
  const ask = (claims: object) => google(claims).exchange({ code: "c", redirectUri: "http://localhost/cb", verifier: "v", nonce: "n1" });
  assert.deepEqual(await ask(base), { subject: "g-1", email: "ana@empresa.com", name: "Ana" });
  assert.equal((await ask({ ...base, email_verified: false })).email, null);
  for (const bad of [{ aud: "outro" }, { exp: now / 1000 - 3600 }, { nonce: "n2" }, { iss: "https://evil.example" }])
    assert.equal(await code(ask({ ...base, ...bad })), "oauth_failed", JSON.stringify(bad));
  const url = new URL(google(base).authorizationUrl({ redirectUri: "http://localhost/cb", state: "s1", nonce: "n1", challenge: "ch" }));
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("state"), "s1");
});

test("Microsoft: e-mail só vale de diretório confiável", async () => {
  const now = Date.now();
  const tid = "11111111-2222-3333-4444-555555555555";
  const base = { iss: `https://login.microsoftonline.com/${tid}/v2.0`, tid, aud: "cliente", sub: "m-1", exp: now / 1000 + 600, nonce: "n", email: "ana@empresa.com" };
  const ask = (claims: object, tenant = "common") =>
    new MicrosoftOidc({ clientId: "cliente", clientSecret: "s", tenant }, { fetch: tokenResponse(claims) }).exchange({ code: "c", redirectUri: "r", verifier: "v", nonce: "n" });
  assert.equal((await ask(base)).email, null, "diretório qualquer: e-mail editável, não serve para ligar contas");
  assert.equal((await ask(base, tid)).email, "ana@empresa.com", "diretório da empresa");
  assert.equal((await ask({ ...base, xms_edov: true })).email, "ana@empresa.com", "domínio verificado");
  assert.equal(await code(ask({ ...base, iss: "https://login.microsoftonline.com/outro/v2.0" })), "oauth_failed");
});

for (const dialect of dialects) {
  describe(`Contas — ${dialect}`, () => {
    async function setup() {
      const d = await fresh(dialect);
      opened.push(d);
      const clock = manualClock("2026-03-01T10:00:00.000Z");
      const adopted: string[] = [];
      const deps: AccountsDeps = {
        uow: new UnitOfWork(d.db, accountsStore(clock)),
        clock,
        providers: {},
        adoptLocalOperator: async (to) => void adopted.push(to),
        throttle: new LoginThrottle(),
      };
      return { deps, clock, adopted };
    }

    test("primeiro acesso cria o dono, que assume o operador local; não se repete", async () => {
      const { deps, adopted } = await setup();
      const s = await setupOwner(deps, { name: "Ana", email: " Ana@Empresa.com ", password: PASSWORD });
      assert.deepEqual([s.account.id, s.account.role], ["ana@empresa.com", "owner"]);
      assert.deepEqual(adopted, ["ana@empresa.com"]);
      assert.equal((await authenticate(deps, s.token))?.id, "ana@empresa.com");
      assert.equal(await code(setupOwner(deps, { name: "Eva", email: "eva@x.com", password: PASSWORD })), "already_set_up");
      assert.equal(await code(setupOwner(deps, { name: "", email: "não é email", password: PASSWORD })), "invalid_email");
    });

    test("cadastro por senha só com convite; senha fraca é recusada", async () => {
      const { deps } = await setup();
      const owner = (await setupOwner(deps, { name: "Ana", email: "ana@empresa.com", password: PASSWORD })).account.id;
      assert.equal(await code(signUp(deps, { name: "Caio", email: "caio@empresa.com", password: PASSWORD })), "not_invited");
      await invite(deps, owner, { email: "caio@empresa.com", role: "member" });
      assert.equal(await code(signUp(deps, { name: "Caio", email: "caio@empresa.com", password: "curta" })), "weak_password");
      const caio = await signUp(deps, { name: "Caio", email: "caio@empresa.com", password: PASSWORD });
      assert.equal(caio.account.role, "member");
      assert.equal(await code(signUp(deps, { name: "Caio", email: "caio@empresa.com", password: PASSWORD })), "email_taken");
      assert.equal(await code(listAccess(deps, caio.account.id)), "owner_only");
      const access = await listAccess(deps, owner);
      assert.deepEqual(access.accounts.map((a) => [a.email, a.role, a.password]), [["ana@empresa.com", "owner", true], ["caio@empresa.com", "member", true]]);
      assert.deepEqual(access.invites, [], "o convite é consumido");
    });

    test("entrar: senha errada, bloqueio após tentativas, suspensão e saída", async () => {
      const { deps, clock } = await setup();
      const owner = (await setupOwner(deps, { name: "Ana", email: "ana@empresa.com", password: PASSWORD })).account.id;
      await invite(deps, owner, { email: "caio@empresa.com", role: "member" });
      await signUp(deps, { name: "Caio", email: "caio@empresa.com", password: PASSWORD });
      assert.equal(await code(signIn(deps, { email: "ninguem@empresa.com", password: PASSWORD })), "wrong_credentials");
      for (let i = 0; i < 5; i++) assert.equal(await code(signIn(deps, { email: "caio@empresa.com", password: "errada-errada" })), "wrong_credentials");
      assert.equal(await code(signIn(deps, { email: "caio@empresa.com", password: PASSWORD })), "too_many_attempts");
      clock.advance(6 * 60_000);
      const s = await signIn(deps, { email: "CAIO@empresa.com", password: PASSWORD });
      assert.equal(await code(setEnabled(deps, owner, owner, false)), "cannot_disable_self");
      await setEnabled(deps, owner, ActorId.parse("caio@empresa.com"), false);
      assert.equal(await authenticate(deps, s.token), undefined, "suspender encerra as sessões");
      assert.equal(await code(signIn(deps, { email: "caio@empresa.com", password: PASSWORD })), "account_disabled");
      await setEnabled(deps, owner, ActorId.parse("caio@empresa.com"), true);
      const again = await signIn(deps, { email: "caio@empresa.com", password: PASSWORD });
      await signOut(deps, again.token);
      assert.equal(await authenticate(deps, again.token), undefined);
      clock.advance(31 * 86_400_000);
      const old = await signIn(deps, { email: "ana@empresa.com", password: PASSWORD });
      clock.advance(31 * 86_400_000);
      assert.equal(await authenticate(deps, old.token), undefined, "sessão vence em 30 dias");
    });

    test("Google/Microsoft: primeira pessoa vira dono; depois, liga por e-mail ou convite", async () => {
      const { deps, adopted } = await setup();
      const owner = await signInExternal(deps, "google", { subject: "g-ana", email: "ana@empresa.com", name: "Ana Lima" });
      assert.deepEqual([owner.account.role, owner.account.name, owner.account.passwordHash], ["owner", "Ana Lima", null]);
      assert.deepEqual(adopted, ["ana@empresa.com"]);
      assert.equal((await signInExternal(deps, "google", { subject: "g-ana", email: null, name: "" })).account.id, "ana@empresa.com", "ligada: entra mesmo sem e-mail");
      assert.equal((await signInExternal(deps, "microsoft", { subject: "m-ana", email: "ana@empresa.com", name: "Ana" })).account.id, "ana@empresa.com", "liga pelo e-mail");
      assert.equal(await code(signInExternal(deps, "google", { subject: "g-eva", email: "eva@fora.com", name: "Eva" })), "not_invited");
      assert.equal(await code(signInExternal(deps, "microsoft", { subject: "m-x", email: null, name: "X" })), "email_not_verified");
      await invite(deps, owner.account.id, { email: "eva@fora.com", role: "member" });
      assert.equal((await signInExternal(deps, "google", { subject: "g-eva", email: "eva@fora.com", name: "Eva" })).account.role, "member");
      const access = await listAccess(deps, owner.account.id);
      assert.deepEqual(access.accounts.find((a) => a.id === "ana@empresa.com")!.providers, ["google", "microsoft"]);
      assert.deepEqual(adopted, ["ana@empresa.com"], "só a primeira conta assume o operador local");
    });
  });
}

test("HTTP: sem sessão a API recusa; dono entra, assume os dados locais e entra com Google", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aurora-accounts-"));
  let claims: Record<string, unknown> = {};
  const oauthFetch = (async () => new Response(JSON.stringify({ id_token: idToken(claims) }), { status: 200 })) as unknown as typeof fetch;
  // Antes das contas: o operador local tem uma conversa.
  const localConfig = loadConfig({ AURORA_SQLITE_PATH: join(dir, "aurora.db"), AURORA_AUTH: "local", AURORA_WEB_DIR: "none" });
  const empty = { templates: { areas: [], templates: [] }, model: null };
  const before = await startServer(localConfig, empty);
  const post = (base: string, path: string, body: object, cookie = "") =>
    fetch(base + path, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
  assert.equal((await post(before.url, "/api/conversations", {})).status, 201);
  await before.close();

  const config = loadConfig({
    AURORA_SQLITE_PATH: join(dir, "aurora.db"),
    AURORA_WEB_DIR: "none",
    AURORA_GOOGLE_CLIENT_ID: "cliente",
    AURORA_GOOGLE_CLIENT_SECRET: "segredo",
  });
  const server = await startServer(config, { ...empty, oauthFetch });
  try {
    const url = server.url;
    assert.equal((await fetch(url + "/api/conversations")).status, 401);
    // O roteador decodifica a URL: a guarda decide pela rota atendida, não pelo texto.
    for (const sneaky of ["/%61pi/conversations", "/%61pi/jobs", "/api/%6Aobs"]) assert.equal((await fetch(url + sneaky)).status, 401, sneaky);
    assert.notEqual((await fetch(url + "/%E0")).status, 500, "URL malformada não derruba nada");
    assert.equal((await fetch(url + "/api/jobs", { headers: { cookie: "aurora_session=%E0" } })).status, 401, "cookie malformado vale como ausente");
    assert.deepEqual(await (await fetch(url + "/api/auth/status")).json(), { mode: "accounts", setup_required: true, providers: ["google"] });

    const created = await post(url, "/api/auth/setup", { name: "Ana", email: "ana@empresa.com", password: PASSWORD });
    assert.equal(created.status, 201);
    const setCookie = created.headers.get("set-cookie")!;
    assert.match(setCookie, /HttpOnly; SameSite=Lax/);
    const session = setCookie.split(";")[0]!;
    const mine = await (await fetch(url + "/api/conversations", { headers: { cookie: session } })).json();
    assert.equal(mine.conversations.length, 1, "a conversa do operador local passou para o dono");
    assert.equal((await (await fetch(url + "/api/auth/me", { headers: { cookie: session } })).json()).email, "ana@empresa.com");

    // Login com Google de uma pessoa convidada.
    assert.equal((await post(url, "/api/access/invites", { email: "caio@empresa.com" }, session)).status, 201);
    const start = await fetch(url + "/api/auth/oauth/google/start", { redirect: "manual" });
    assert.equal(start.status, 302);
    const authorize = new URL(start.headers.get("location")!);
    assert.equal(authorize.origin, "https://accounts.google.com");
    const state = authorize.searchParams.get("state")!;
    claims = { iss: "https://accounts.google.com", aud: "cliente", sub: "g-caio", exp: Date.now() / 1000 + 600, nonce: authorize.searchParams.get("nonce"), email: "caio@empresa.com", email_verified: true, name: "Caio" };
    const callback = `/api/auth/oauth/google/callback?state=${state}&code=abc`;
    const forged = await fetch(url + callback, { redirect: "manual" });
    assert.equal(forged.headers.get("location"), "/entrar?erro=oauth_expired", "sem o cookie do navegador que começou, não entra");
    const again = await fetch(url + "/api/auth/oauth/google/start", { redirect: "manual" });
    const s2 = new URL(again.headers.get("location")!);
    claims.nonce = s2.searchParams.get("nonce");
    const back = await fetch(url + `/api/auth/oauth/google/callback?state=${s2.searchParams.get("state")}&code=abc`, {
      redirect: "manual",
      headers: { cookie: again.headers.get("set-cookie")!.split(";")[0]! },
    });
    assert.equal(back.headers.get("location"), "/");
    const caio = back.headers.getSetCookie().find((c) => c.startsWith("aurora_session="))!.split(";")[0]!;
    assert.equal((await (await fetch(url + "/api/auth/me", { headers: { cookie: caio } })).json()).email, "caio@empresa.com");
    assert.equal((await fetch(url + "/api/access", { headers: { cookie: caio } })).status, 403, "só o dono gerencia o acesso");

    assert.equal((await post(url, "/api/auth/sign-out", {}, caio)).status, 204);
    assert.equal((await fetch(url + "/api/conversations", { headers: { cookie: caio } })).status, 401);
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
