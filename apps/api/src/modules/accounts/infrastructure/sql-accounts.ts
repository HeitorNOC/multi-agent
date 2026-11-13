/** Repositórios SQL das contas (mesmo SQL para SQLite e PostgreSQL). */
import type { Clock } from "../../../shared/clock.ts";
import type { ActorId } from "../../../shared/ids.ts";
import type { Sql } from "../../../platform/database/database.ts";
import { SqlEventLog, type EventLog } from "../../../platform/events/event-log.ts";
import type { Account, Invite, Provider, Role } from "../domain/account.ts";

type AccountRow = { id: string; email: string; name: string; role: string; password_hash: string | null; created_at: string; disabled_at: string | null };
type InviteRow = { email: string; role: string; invited_by: string; created_at: string };

const toAccount = (r: AccountRow): Account => ({
  id: r.id as ActorId,
  email: r.email,
  name: r.name,
  role: r.role as Role,
  passwordHash: r.password_hash,
  createdAt: r.created_at,
  disabledAt: r.disabled_at,
});
const toInvite = (r: InviteRow): Invite => ({ email: r.email, role: r.role as Role, invitedBy: r.invited_by as ActorId, createdAt: r.created_at });

export class AccountRepository {
  private readonly sql: Sql;
  constructor(sql: Sql) {
    this.sql = sql;
  }
  async count() {
    return Number((await this.sql.one<{ n: number | string }>("SELECT COUNT(*) AS n FROM accounts"))!.n);
  }
  async get(id: ActorId) {
    const row = await this.sql.one<AccountRow>("SELECT * FROM accounts WHERE id = $1", [id]);
    return row && toAccount(row);
  }
  async byEmail(email: string) {
    const row = await this.sql.one<AccountRow>("SELECT * FROM accounts WHERE email = $1", [email]);
    return row && toAccount(row);
  }
  async add(a: Account) {
    await this.sql.run(
      "INSERT INTO accounts (id, email, name, role, password_hash, created_at, disabled_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [a.id, a.email, a.name, a.role, a.passwordHash, a.createdAt, a.disabledAt],
    );
  }
  async save(a: Account) {
    await this.sql.run("UPDATE accounts SET name = $2, role = $3, password_hash = $4, disabled_at = $5 WHERE id = $1", [
      a.id,
      a.name,
      a.role,
      a.passwordHash,
      a.disabledAt,
    ]);
  }
  async list() {
    return (await this.sql.all<AccountRow>("SELECT * FROM accounts ORDER BY created_at, email")).map(toAccount);
  }
}

export class IdentityRepository {
  private readonly sql: Sql;
  constructor(sql: Sql) {
    this.sql = sql;
  }
  async find(provider: Provider, subject: string) {
    const row = await this.sql.one<{ account_id: string }>("SELECT account_id FROM account_identities WHERE provider = $1 AND subject = $2", [provider, subject]);
    return row?.account_id as ActorId | undefined;
  }
  async link(provider: Provider, subject: string, accountId: ActorId, at: string) {
    await this.sql.run("INSERT INTO account_identities (provider, subject, account_id, created_at) VALUES ($1, $2, $3, $4)", [provider, subject, accountId, at]);
  }
  async providersOf(accountId: ActorId) {
    return (await this.sql.all<{ provider: string }>("SELECT provider FROM account_identities WHERE account_id = $1 ORDER BY provider", [accountId])).map(
      (r) => r.provider as Provider,
    );
  }
}

export class InviteRepository {
  private readonly sql: Sql;
  constructor(sql: Sql) {
    this.sql = sql;
  }
  async get(email: string) {
    const row = await this.sql.one<InviteRow>("SELECT * FROM account_invites WHERE email = $1", [email]);
    return row && toInvite(row);
  }
  async put(i: Invite) {
    await this.sql.run(
      `INSERT INTO account_invites (email, role, invited_by, created_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET role = excluded.role, invited_by = excluded.invited_by, created_at = excluded.created_at`,
      [i.email, i.role, i.invitedBy, i.createdAt],
    );
  }
  async remove(email: string) {
    return (await this.sql.run("DELETE FROM account_invites WHERE email = $1", [email])) > 0;
  }
  async list() {
    return (await this.sql.all<InviteRow>("SELECT * FROM account_invites ORDER BY created_at, email")).map(toInvite);
  }
}

export class SessionRepository {
  private readonly sql: Sql;
  constructor(sql: Sql) {
    this.sql = sql;
  }
  async add(tokenHash: string, accountId: ActorId, createdAt: string, expiresAt: string) {
    await this.sql.run("INSERT INTO account_sessions (token_hash, account_id, created_at, expires_at) VALUES ($1, $2, $3, $4)", [
      tokenHash,
      accountId,
      createdAt,
      expiresAt,
    ]);
  }
  async find(tokenHash: string) {
    const row = await this.sql.one<{ account_id: string; expires_at: string }>("SELECT account_id, expires_at FROM account_sessions WHERE token_hash = $1", [tokenHash]);
    return row && { accountId: row.account_id as ActorId, expiresAt: row.expires_at };
  }
  async remove(tokenHash: string) {
    await this.sql.run("DELETE FROM account_sessions WHERE token_hash = $1", [tokenHash]);
  }
  async removeFor(accountId: ActorId) {
    await this.sql.run("DELETE FROM account_sessions WHERE account_id = $1", [accountId]);
  }
  async removeExpired(now: string) {
    await this.sql.run("DELETE FROM account_sessions WHERE expires_at <= $1", [now]);
  }
}

export interface AccountsStore {
  accounts: AccountRepository;
  identities: IdentityRepository;
  invites: InviteRepository;
  sessions: SessionRepository;
  events: EventLog;
}

export const accountsStore =
  (clock: Clock) =>
  (sql: Sql): AccountsStore => ({
    accounts: new AccountRepository(sql),
    identities: new IdentityRepository(sql),
    invites: new InviteRepository(sql),
    sessions: new SessionRepository(sql),
    events: new SqlEventLog(sql, clock),
  });
