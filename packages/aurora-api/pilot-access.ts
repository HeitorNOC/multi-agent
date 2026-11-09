import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

type Account = {
  id: string;
  role: "operator" | "viewer";
  salt: string;
  verifier: string;
};
type Session = { actor: Account; expires: number };

export class PilotAccess {
  private sessions = new Map<string, Session>();
  private failures = 0;
  private blockedUntil = 0;
  private cookie = "aurora_pilot_" + randomBytes(8).toString("hex");
  private accounts: Account[];

  constructor(accounts: Account[]) {
    this.accounts = accounts;
  }

  private sessionId(headers: IncomingHttpHeaders) {
    return (
      (headers.cookie ?? "")
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith(this.cookie + "="))
        ?.slice(this.cookie.length + 1) ?? ""
    );
  }

  actor(headers: IncomingHttpHeaders) {
    const session = this.sessions.get(this.sessionId(headers));
    if (!session || session.expires <= Date.now()) return null;
    return { id: session.actor.id, role: session.actor.role };
  }

  login(body: unknown) {
    if (Date.now() < this.blockedUntil) return null;
    const credentials = body as { id?: unknown; password?: unknown } | null;
    if (
      typeof credentials?.id !== "string" ||
      typeof credentials.password !== "string" ||
      credentials.password.length > 128
    )
      return null;
    const account = this.accounts.find(({ id }) => id === credentials.id);
    const verifier = account ?? this.accounts[0];
    const key = scryptSync(
      credentials.password,
      Buffer.from(verifier.salt, "hex"),
      32,
    );
    if (
      !timingSafeEqual(key, Buffer.from(verifier.verifier, "hex")) ||
      !account
    ) {
      if (++this.failures >= 5) {
        this.failures = 0;
        this.blockedUntil = Date.now() + 30_000;
      }
      return null;
    }
    this.failures = 0;
    for (const [id, session] of this.sessions) {
      if (session.actor.id === account.id || session.expires <= Date.now())
        this.sessions.delete(id);
    }
    const token = randomBytes(32).toString("hex");
    this.sessions.set(token, {
      actor: account,
      expires: Date.now() + 3_600_000,
    });
    return `${this.cookie}=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=3600`;
  }

  logout(headers: IncomingHttpHeaders) {
    this.sessions.delete(this.sessionId(headers));
    return `${this.cookie}=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0`;
  }
}
