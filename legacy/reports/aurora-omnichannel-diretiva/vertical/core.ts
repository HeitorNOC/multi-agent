import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';

export type Input = { tenant: string; integration: string; channel: 'webchat' | 'whatsapp'; session: string; message: string; text: string; correlation: string };
type Row = { id: number; tenant: string; integration: string; channel: string; session: string; message: string; direction: string; text: string; correlation: string; raw: string };
type Actor = 'bot' | 'human';
type ReturnKind = 'request' | 'confirm' | 'fail';
const returnTransitions = {
  request: ['HUMAN', 'RETURN_PENDING'],
  confirm: ['RETURN_PENDING', 'OPEN'],
  fail: ['RETURN_PENDING', 'HUMAN'],
} as const;
type Delivery = { tenant: string; integration: string; session: string; message: string; actor: Actor; text: string };
type DeliveryKey = Pick<Delivery, 'tenant' | 'integration' | 'message'>;
type Dispatch = Delivery & Pick<Row, 'channel' | 'correlation'>;
type Receipt = { status: 'unknown' | 'rejected' } | { status: 'accepted'; providerMessageId: string };

export class Core {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS sessions (tenant TEXT NOT NULL, session TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY(tenant, session));
      CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, tenant TEXT NOT NULL, integration TEXT NOT NULL, channel TEXT NOT NULL, session TEXT NOT NULL, message TEXT NOT NULL, direction TEXT NOT NULL, text TEXT NOT NULL, correlation TEXT NOT NULL, raw TEXT NOT NULL, UNIQUE(tenant, integration, message, direction), FOREIGN KEY(tenant, session) REFERENCES sessions(tenant, session));
      CREATE TABLE IF NOT EXISTS transfers (tenant TEXT NOT NULL, event TEXT NOT NULL, session TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY(tenant, event));
      CREATE TABLE IF NOT EXISTS deliveries (tenant TEXT NOT NULL, integration TEXT NOT NULL, session TEXT NOT NULL, message TEXT NOT NULL, actor TEXT NOT NULL, text TEXT NOT NULL, PRIMARY KEY(tenant, integration, message));
      CREATE TABLE IF NOT EXISTS delivery_dispatches (
        tenant TEXT NOT NULL, integration TEXT NOT NULL, message TEXT NOT NULL,
        status TEXT NOT NULL, provider_message_id TEXT,
        PRIMARY KEY(tenant, integration, message),
        FOREIGN KEY(tenant, integration, message) REFERENCES deliveries(tenant, integration, message)
      );
      CREATE TABLE IF NOT EXISTS attendance (tenant TEXT NOT NULL, session TEXT NOT NULL, status TEXT NOT NULL, PRIMARY KEY(tenant, session));
      CREATE TABLE IF NOT EXISTS bot_returns (tenant TEXT NOT NULL, session TEXT NOT NULL, event TEXT NOT NULL, kind TEXT NOT NULL, request TEXT NOT NULL, PRIMARY KEY(tenant, event));
      INSERT OR IGNORE INTO attendance
        SELECT tenant, session, CASE state WHEN 'PENDING' THEN 'WAITING' ELSE 'ACTIVE' END
        FROM sessions WHERE state IN ('PENDING', 'HUMAN');`);
  }
  close(): void { this.db.close(); }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  receive(input: Input): void {
    for (const key of ['tenant', 'integration', 'channel', 'session', 'message', 'text', 'correlation'] as const)
      if (typeof input[key] !== 'string' || !input[key].trim()) throw new Error('INVALID_INPUT');
    if (input.channel !== 'webchat' && input.channel !== 'whatsapp') throw new Error('INVALID_CHANNEL');
    const normalized = { ...input, text: input.text.trim() };
    this.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO sessions VALUES (?, ?, ?)').run(input.tenant, input.session, 'OPEN');
      const existing = this.db.prepare('SELECT * FROM messages WHERE tenant=? AND integration=? AND message=? AND direction=?').get(input.tenant, input.integration, input.message, 'in') as Row | undefined;
      if (existing) {
        if (existing.session !== input.session || existing.channel !== input.channel || existing.text !== normalized.text || existing.correlation !== input.correlation) throw new Error('IDEMPOTENCY_CONFLICT');
        return;
      }
      this.db.prepare('INSERT INTO messages (tenant,integration,channel,session,message,direction,text,correlation,raw) VALUES (?,?,?,?,?,?,?,?,?)').run(input.tenant, input.integration, input.channel, input.session, input.message, 'in', normalized.text, input.correlation, JSON.stringify(input));
    });
  }
  async respond(tenant: string, integration: string, message: string, actor: Actor = 'bot', humanText?: string): Promise<string> {
    if (actor !== 'bot' && actor !== 'human') throw new Error('INVALID_ACTOR');
    if (actor === 'human' && (typeof humanText !== 'string' || !humanText.trim())) {
      throw new Error('INVALID_HUMAN_REPLY');
    }
    for (let attempt = 0; ; attempt++) {
      try {
        return this.deliver(tenant, integration, message, actor, humanText?.trim());
      } catch (error) {
        // SQLite uses extended result codes; the low byte identifies SQLITE_BUSY.
        const errno = (error as { errcode?: number }).errcode;
        if (errno === undefined || (errno & 255) !== 5 || attempt === 5) throw error;
        await delay(20 * (attempt + 1));
      }
    }
  }
  private deliver(tenant: string, integration: string, message: string, actor: Actor, humanText?: string): string {
    return this.transaction(() => {
      const incoming = this.db.prepare('SELECT * FROM messages WHERE tenant=? AND integration=? AND message=? AND direction=?').get(tenant, integration, message, 'in') as Row | undefined;
      if (!incoming) throw new Error('MESSAGE_NOT_FOUND');
      const session = this.db.prepare('SELECT state FROM sessions WHERE tenant=? AND session=?').get(tenant, incoming.session) as { state: string };
      if (session.state !== (actor === 'bot' ? 'OPEN' : 'HUMAN')) throw new Error('RESPONSE_BLOCKED');
      const reply = humanText ?? `Simulado: ${incoming.text}`;
      const existing = this.db.prepare('SELECT text FROM messages WHERE tenant=? AND integration=? AND message=? AND direction=?').get(tenant, integration, message, 'out') as { text: string } | undefined;
      if (existing) {
        const dispatch = this.deliveryStatus({ tenant, integration, message });
        if (dispatch?.status === 'cancelled') {
          this.db.prepare("UPDATE messages SET text=? WHERE tenant=? AND integration=? AND message=? AND direction='out'")
            .run(reply, tenant, integration, message);
          this.db.prepare('UPDATE deliveries SET actor=?, text=? WHERE tenant=? AND integration=? AND message=?')
            .run(actor, reply, tenant, integration, message);
          this.db.prepare("UPDATE delivery_dispatches SET status='queued' WHERE tenant=? AND integration=? AND message=?")
            .run(tenant, integration, message);
          return reply;
        }
        const prior = this.db.prepare('SELECT actor FROM deliveries WHERE tenant=? AND integration=? AND message=?').get(tenant, integration, message) as Pick<Delivery, 'actor'> | undefined;
        if ((prior?.actor ?? 'bot') !== actor || (humanText !== undefined && humanText !== existing.text)) {
          throw new Error('IDEMPOTENCY_CONFLICT');
        }
        return existing.text;
      }
      this.db.prepare('INSERT INTO messages (tenant,integration,channel,session,message,direction,text,correlation,raw) VALUES (?,?,?,?,?,?,?,?,?)').run(tenant, integration, incoming.channel, incoming.session, message, 'out', reply, incoming.correlation, '{}');
      this.db.prepare('INSERT INTO deliveries VALUES (?,?,?,?,?,?)').run(tenant, integration, incoming.session, message, actor, reply);
      this.db.prepare("INSERT INTO delivery_dispatches VALUES (?, ?, ?, 'queued', NULL)")
        .run(tenant, integration, message);
      return reply;
    });
  }
  claimDelivery({ tenant, integration, message }: DeliveryKey): Dispatch | undefined {
    return this.transaction(() => {
      const dispatch = this.db.prepare(`SELECT d.*, m.channel, m.correlation
        FROM delivery_dispatches q
        JOIN deliveries d USING (tenant, integration, message)
        JOIN messages m USING (tenant, integration, message)
        JOIN sessions s ON s.tenant=d.tenant AND s.session=d.session
        WHERE q.tenant=? AND q.integration=? AND q.message=? AND q.status='queued'
          AND m.direction='out'
          AND s.state=CASE d.actor WHEN 'bot' THEN 'OPEN' ELSE 'HUMAN' END`)
        .get(tenant, integration, message) as Dispatch | undefined;
      if (!dispatch) return undefined;
      this.db.prepare("UPDATE delivery_dispatches SET status='in_flight' WHERE tenant=? AND integration=? AND message=?")
        .run(tenant, integration, message);
      return dispatch;
    });
  }
  deliveryStatus({ tenant, integration, message }: DeliveryKey) {
    return this.db.prepare('SELECT status, provider_message_id AS providerMessageId FROM delivery_dispatches WHERE tenant=? AND integration=? AND message=?')
      .get(tenant, integration, message);
  }
  recordDeliveryOutcome(key: DeliveryKey, receipt: Receipt): void {
    const providerId = receipt.status === 'accepted' ? receipt.providerMessageId : null;
    if (!['unknown', 'rejected', 'accepted'].includes(receipt.status) ||
        (receipt.status === 'accepted' && (typeof providerId !== 'string' || !providerId.trim()))) {
      throw new Error('INVALID_DELIVERY_RECEIPT');
    }
    this.transaction(() => {
      const current = this.deliveryStatus(key);
      if (current?.status === receipt.status && current.providerMessageId === providerId) return;
      if (current?.status !== 'in_flight' && current?.status !== 'unknown') {
        throw new Error('INVALID_DELIVERY_TRANSITION');
      }
      this.db.prepare('UPDATE delivery_dispatches SET status=?, provider_message_id=? WHERE tenant=? AND integration=? AND message=?')
        .run(receipt.status, providerId, key.tenant, key.integration, key.message);
    });
  }
  private prepareOwnershipChange(tenant: string, session: string): void {
    const pending = this.db.prepare(`SELECT 1 FROM delivery_dispatches q
      JOIN deliveries d USING (tenant, integration, message)
      WHERE d.tenant=? AND d.session=? AND q.status IN ('in_flight', 'unknown') LIMIT 1`)
      .get(tenant, session);
    if (pending) throw new Error('DELIVERY_UNRESOLVED');
    this.db.prepare(`UPDATE delivery_dispatches SET status='cancelled'
      WHERE tenant=? AND status='queued' AND (integration, message) IN (
        SELECT integration, message FROM deliveries WHERE tenant=? AND session=?
      )`).run(tenant, tenant, session);
  }
  transfer(tenant: string, session: string, event: string, kind: 'request' | 'confirm'): void {
    if (![tenant, session, event].every(value => typeof value === 'string' && value.trim()) || !['request', 'confirm'].includes(kind)) throw new Error('INVALID_TRANSFER');
    this.transaction(() => {
      const prior = this.db.prepare('SELECT session, kind FROM transfers WHERE tenant=? AND event=?').get(tenant, event) as { session: string; kind: string } | undefined;
      if (prior) { if (prior.session !== session || prior.kind !== kind) throw new Error('IDEMPOTENCY_CONFLICT'); return; }
      const current = this.db.prepare('SELECT state FROM sessions WHERE tenant=? AND session=?').get(tenant, session) as { state: string } | undefined;
      if (!current) throw new Error('SESSION_NOT_FOUND');
      if ((kind === 'request' && current.state !== 'OPEN') || (kind === 'confirm' && current.state !== 'PENDING')) throw new Error('INVALID_TRANSITION');
      if (kind === 'request') this.prepareOwnershipChange(tenant, session);
      this.db.prepare('INSERT INTO transfers VALUES (?,?,?,?)').run(tenant, event, session, kind);
      this.db.prepare('UPDATE sessions SET state=? WHERE tenant=? AND session=?').run(kind === 'request' ? 'PENDING' : 'HUMAN', tenant, session);
      this.db.prepare('INSERT INTO attendance VALUES (?, ?, ?) ON CONFLICT(tenant, session) DO UPDATE SET status=excluded.status')
        .run(tenant, session, kind === 'request' ? 'WAITING' : 'ACTIVE');
    });
  }
  returnToBot(tenant: string, session: string, event: string, kind: ReturnKind, request = event): void {
    if (![tenant, session, event, request].every(value => typeof value === 'string' && value.trim())
        || !Object.hasOwn(returnTransitions, kind) || ((kind === 'request') !== (request === event))) {
      throw new Error('INVALID_RETURN');
    }
    this.transaction(() => {
      const prior = this.db.prepare('SELECT session, kind, request FROM bot_returns WHERE tenant=? AND event=?')
        .get(tenant, event);
      if (prior) {
        if (prior.session !== session || prior.kind !== kind || prior.request !== request) {
          throw new Error('IDEMPOTENCY_CONFLICT');
        }
        return;
      }
      const [required, next] = returnTransitions[kind];
      if (this.conversation(tenant, session)?.control !== required) throw new Error('INVALID_TRANSITION');
      if (kind === 'request') this.prepareOwnershipChange(tenant, session);
      if (kind !== 'request') {
        const active = this.db.prepare("SELECT event FROM bot_returns WHERE tenant=? AND session=? AND kind='request' ORDER BY rowid DESC LIMIT 1")
          .get(tenant, session);
        if (active?.event !== request) throw new Error('STALE_RETURN');
      }
      this.db.prepare('INSERT INTO bot_returns VALUES (?, ?, ?, ?, ?)').run(tenant, session, event, kind, request);
      this.db.prepare('UPDATE sessions SET state=? WHERE tenant=? AND session=?').run(next, tenant, session);
      if (kind === 'confirm') {
        this.db.prepare("UPDATE attendance SET status='DONE' WHERE tenant=? AND session=?").run(tenant, session);
      }
    });
  }
  conversation(tenant: string, session: string) {
    return this.db.prepare('SELECT s.state AS control, a.status AS attendance FROM sessions s LEFT JOIN attendance a ON a.tenant=s.tenant AND a.session=s.session WHERE s.tenant=? AND s.session=?')
      .get(tenant, session);
  }
  history(tenant: string, session: string): Row[] {
    return this.db.prepare('SELECT * FROM messages WHERE tenant=? AND session=? ORDER BY id').all(tenant, session) as Row[];
  }
  deliveries(tenant: string, session: string): Delivery[] {
    return this.db.prepare('SELECT * FROM deliveries WHERE tenant=? AND session=? ORDER BY rowid').all(tenant, session) as Delivery[];
  }
}
