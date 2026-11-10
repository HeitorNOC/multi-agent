/**
 * Casos de uso das contas: primeiro acesso do dono, convites, entrar com senha ou com
 * Google/Microsoft, sessões e a lista de quem tem acesso.
 */
import { createHash, randomBytes } from "node:crypto";
import type { Clock } from "../../../shared/clock.ts";
import { conflict, ensure, forbidden, notFound, rateLimited, unauthenticated } from "../../../shared/errors.ts";
import type { ActorId } from "../../../shared/ids.ts";
import type { Transaction, UnitOfWork } from "../../../platform/database/unit-of-work.ts";
import { stream } from "../../../platform/events/event-log.ts";
import { accountId, checkPassword, cleanName, LOCAL_OPERATOR, normalizeEmail, type Account, type Provider, type Role } from "../domain/account.ts";
import type { ExternalPerson, OidcProvider } from "../infrastructure/oidc.ts";
import { hashPassword, verifyPassword } from "../infrastructure/password.ts";
import type { AccountsStore } from "../infrastructure/sql-accounts.ts";

const SESSION_DAYS = 30;
const MAX_FAILURES = 5;
const LOCK_MS = 5 * 60_000;

export interface AccountsDeps {
  uow: UnitOfWork<AccountsStore>;
  clock: Clock;
  providers: Partial<Record<Provider, OidcProvider>>;
  /** Passa à primeira conta o que era do operador local (fontes, conversas), na mesma transação. */
  adoptLocalOperator(to: ActorId, tx: Transaction): Promise<void>;
  /** Depois de confirmada a adoção (por exemplo, para descartar caches de leitura). */
  afterAdoption?(): void;
  throttle?: LoginThrottle;
}

export interface Session {
  /** Vai só no cookie; o banco guarda o hash. */
  token: string;
  account: Account;
  expiresAt: string;
}

/** Tentativas erradas por e-mail: depois de algumas, espera alguns minutos. */
export class LoginThrottle {
  private readonly failures = new Map<string, { count: number; until: number }>();
  check(email: string, now: number) {
    const f = this.failures.get(email);
    if (f && f.until > now) throw rateLimited("too_many_attempts", "Muitas tentativas. Espere alguns minutos e tente de novo.");
  }
  fail(email: string, now: number) {
    const f = this.failures.get(email);
    const count = f && f.until <= now && f.count >= MAX_FAILURES ? 1 : (f?.count ?? 0) + 1;
    this.failures.set(email, { count, until: count >= MAX_FAILURES ? now + LOCK_MS : 0 });
  }
  clear(email: string) {
    this.failures.delete(email);
  }
}
const sharedThrottle = new LoginThrottle();

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function accessStatus(deps: AccountsDeps) {
  return {
    mode: "accounts" as const,
    setup_required: (await deps.uow.read.accounts.count()) === 0,
    providers: (Object.keys(deps.providers) as Provider[]).filter((p) => deps.providers[p]),
  };
}

/** Primeiro acesso: cria a conta do dono, que assume os dados do operador local. */
export async function setupOwner(deps: AccountsDeps, input: { name: string; email: string; password: string }): Promise<Session> {
  const email = normalizeEmail(input.email);
  checkPassword(input.password);
  const passwordHash = await hashPassword(input.password);
  const account = await deps.uow.run(async (r, tx) => {
    ensure((await r.accounts.count()) === 0, () => conflict("already_set_up", "O Aurora já tem dono. Entre com a sua conta."));
    return createAccount(deps, r, tx, { email, name: input.name, role: "owner", passwordHash, via: "password" });
  });
  deps.afterAdoption?.();
  return openSession(deps, account);
}

/** Conta por senha para um e-mail que o dono liberou. */
export async function signUp(deps: AccountsDeps, input: { name: string; email: string; password: string }): Promise<Session> {
  const email = normalizeEmail(input.email);
  checkPassword(input.password);
  const passwordHash = await hashPassword(input.password);
  const account = await deps.uow.run(async (r, tx) => {
    ensure(!(await r.accounts.byEmail(email)), () => conflict("email_taken", "Este e-mail já tem conta. Entre com ela."));
    const invite = await r.invites.get(email);
    ensure(invite, () => forbidden("not_invited", "Este e-mail não foi liberado. Peça acesso ao dono do Aurora."));
    await r.invites.remove(email);
    return createAccount(deps, r, tx, { email, name: input.name, role: invite.role, passwordHash, via: "password" });
  });
  return openSession(deps, account);
}

export async function signIn(deps: AccountsDeps, input: { email: string; password: string }): Promise<Session> {
  const throttle = deps.throttle ?? sharedThrottle;
  const email = input.email.trim().toLowerCase();
  const now = Date.parse(deps.clock.now());
  throttle.check(email, now);
  const account = await deps.uow.read.accounts.byEmail(email);
  const ok = await verifyPassword(input.password, account?.passwordHash ?? null);
  if (!account || !ok) {
    throttle.fail(email, now);
    throw unauthenticated("wrong_credentials", "E-mail ou senha incorretos");
  }
  ensure(!account.disabledAt, () => forbidden("account_disabled", "Seu acesso foi suspenso pelo dono do Aurora"));
  throttle.clear(email);
  return openSession(deps, account);
}

/**
 * Entrar com Google/Microsoft. Conta já ligada entra direto; senão, liga pelo e-mail verificado
 * a uma conta existente ou a um convite. Numa instalação nova, a primeira pessoa vira o dono.
 */
export async function signInExternal(deps: AccountsDeps, provider: Provider, person: ExternalPerson): Promise<Session> {
  const account = await deps.uow.run(async (r, tx) => {
    const linked = await r.identities.find(provider, person.subject);
    if (linked) return (await r.accounts.get(linked))!;
    ensure(person.email, () => forbidden("email_not_verified", "O provedor não confirmou o seu e-mail. Use outra forma de entrar."));
    const email = normalizeEmail(person.email);
    const now = deps.clock.now();
    const existing = await r.accounts.byEmail(email);
    if (existing) {
      await r.identities.link(provider, person.subject, existing.id, now);
      await r.events.append(stream.access(existing.id), { kind: "identity_linked", detail: { provider } });
      return existing;
    }
    let role: Role;
    if ((await r.accounts.count()) === 0) role = "owner";
    else {
      const invite = await r.invites.get(email);
      ensure(invite, () => forbidden("not_invited", "Este e-mail não foi liberado. Peça acesso ao dono do Aurora."));
      await r.invites.remove(email);
      role = invite.role;
    }
    const created = await createAccount(deps, r, tx, { email, name: person.name, role, passwordHash: null, via: provider });
    await r.identities.link(provider, person.subject, created.id, now);
    return created;
  });
  if (account.role === "owner") deps.afterAdoption?.();
  ensure(!account.disabledAt, () => forbidden("account_disabled", "Seu acesso foi suspenso pelo dono do Aurora"));
  return openSession(deps, account);
}

/** A conta da sessão, se o token for válido, não tiver vencido e a conta estiver ativa. */
export async function authenticate(deps: AccountsDeps, token: string | undefined): Promise<Account | undefined> {
  if (!token || token.length > 100) return undefined;
  const session = await deps.uow.read.sessions.find(tokenHash(token));
  if (!session || session.expiresAt <= deps.clock.now()) return undefined;
  const account = await deps.uow.read.accounts.get(session.accountId);
  return account && !account.disabledAt ? account : undefined;
}

export async function signOut(deps: AccountsDeps, token: string | undefined) {
  if (token) await deps.uow.run((r) => r.sessions.remove(tokenHash(token)));
}

export function accountView(account: Account) {
  return { id: account.id, email: account.email, name: account.name, role: account.role };
}

// --- Quem tem acesso (só o dono) ---

async function owner(deps: AccountsDeps, actor: ActorId) {
  const account = await deps.uow.read.accounts.get(actor);
  ensure(account?.role === "owner", () => forbidden("owner_only", "Só o dono do Aurora gerencia o acesso"));
  return account;
}

export async function listAccess(deps: AccountsDeps, actor: ActorId) {
  await owner(deps, actor);
  const r = deps.uow.read;
  const accounts = await r.accounts.list();
  return {
    accounts: await Promise.all(
      accounts.map(async (a) => ({
        ...accountView(a),
        password: a.passwordHash !== null,
        providers: await r.identities.providersOf(a.id),
        disabled: a.disabledAt !== null,
        created_at: a.createdAt,
      })),
    ),
    invites: (await r.invites.list()).map((i) => ({ email: i.email, role: i.role, invited_by: i.invitedBy, created_at: i.createdAt })),
  };
}

export async function invite(deps: AccountsDeps, actor: ActorId, input: { email: string; role: Role }) {
  await owner(deps, actor);
  const email = normalizeEmail(input.email);
  await deps.uow.run(async (r) => {
    ensure(!(await r.accounts.byEmail(email)), () => conflict("email_taken", "Este e-mail já tem conta"));
    await r.invites.put({ email, role: input.role, invitedBy: actor, createdAt: deps.clock.now() });
    await r.events.append(stream.access(email), { kind: "invite_added", detail: { by: actor, role: input.role } });
  });
}

export async function removeInvite(deps: AccountsDeps, actor: ActorId, rawEmail: string) {
  await owner(deps, actor);
  const email = rawEmail.trim().toLowerCase();
  await deps.uow.run(async (r) => {
    ensure(await r.invites.remove(email), () => notFound("invite_not_found", "Convite não encontrado"));
    await r.events.append(stream.access(email), { kind: "invite_removed", detail: { by: actor } });
  });
}

/** Suspende ou devolve o acesso. Suspender encerra as sessões abertas da pessoa. */
export async function setEnabled(deps: AccountsDeps, actor: ActorId, id: ActorId, enabled: boolean) {
  await owner(deps, actor);
  await deps.uow.run(async (r) => {
    const target = await r.accounts.get(id);
    ensure(target, () => notFound("account_not_found", "Conta não encontrada"));
    ensure(target.id !== actor, () => conflict("cannot_disable_self", "Você não pode suspender o próprio acesso"));
    await r.accounts.save({ ...target, disabledAt: enabled ? null : deps.clock.now() });
    if (!enabled) await r.sessions.removeFor(target.id);
    await r.events.append(stream.access(target.id), { kind: enabled ? "access_restored" : "access_suspended", detail: { by: actor } });
  });
}

// --- internos ---

async function createAccount(
  deps: AccountsDeps,
  r: AccountsStore,
  tx: Transaction,
  input: { email: string; name: string; role: Role; passwordHash: string | null; via: Provider | "password" },
): Promise<Account> {
  const account: Account = {
    id: accountId(input.email),
    email: input.email,
    name: cleanName(input.name, input.email),
    role: input.role,
    passwordHash: input.passwordHash,
    createdAt: deps.clock.now(),
    disabledAt: null,
  };
  await r.accounts.add(account);
  // A primeira conta é a de quem já usava o Aurora como operador local.
  const first = (await r.accounts.count()) === 1;
  if (first) await deps.adoptLocalOperator(account.id, tx);
  await r.events.append(stream.access(account.id), {
    kind: "account_created",
    detail: { role: account.role, via: input.via, adopted_from: first ? LOCAL_OPERATOR : null },
  });
  return account;
}

async function openSession(deps: AccountsDeps, account: Account): Promise<Session> {
  const token = randomBytes(32).toString("base64url");
  const now = deps.clock.now();
  const expiresAt = new Date(Date.parse(now) + SESSION_DAYS * 86_400_000).toISOString();
  await deps.uow.run(async (r) => {
    await r.sessions.removeExpired(now);
    await r.sessions.add(tokenHash(token), account.id, now, expiresAt);
    await r.events.append(stream.access(account.id), { kind: "signed_in", detail: {} });
  });
  return { token, account, expiresAt };
}
