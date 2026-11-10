/**
 * Trilha de eventos append-only, compartilhada pelos módulos. Cada evento pertence a um `stream`
 * (um trabalho, uma conversa, o Cérebro…). A identidade do evento é idempotente: gravar de novo o
 * mesmo `eventId` com o mesmo conteúdo devolve `replayed`; com outro conteúdo, é recusado.
 */
import { randomUUID } from "node:crypto";
import type { Clock } from "../../shared/clock.ts";
import { conflict, invalid } from "../../shared/errors.ts";
import type { Id } from "../../shared/ids.ts";
import { hashOf, type Json } from "../../shared/json.ts";
import type { Sql } from "../database/database.ts";

export type StreamId = Id<"Stream">;
export const stream = {
  job: (id: string) => `job:${id}` as StreamId,
  conversation: (id: string) => `conversation:${id}` as StreamId,
  knowledge: (id: string) => `knowledge:${id}` as StreamId,
  recovery: (id: string) => `recovery:${id}` as StreamId,
};

export interface NewEvent {
  kind: string;
  detail: Json;
  /** Identidade estável para repetir sem duplicar; gerada se omitida. */
  eventId?: string;
  /** Quando aconteceu, se diferente de agora (eventos relatados pelo worker). */
  occurredAt?: string;
}

export interface StoredEvent {
  readonly seq: number;
  readonly stream: StreamId;
  readonly kind: string;
  readonly detail: Json;
  readonly eventId: string;
  readonly occurredAt: string;
  readonly recordedAt: string;
}

export interface EventLog {
  append(streamId: StreamId, event: NewEvent): Promise<{ eventId: string; replayed: boolean }>;
  list(streamId: StreamId): Promise<StoredEvent[]>;
}

const EVENT_ID = /^[\w:-]{8,200}$/;
const KIND = /^[a-z][a-z0-9_]{0,99}$/;

type EventRow = { seq: number | string; stream: string; kind: string; detail: string; event_id: string; occurred_at: string; recorded_at: string };

export class SqlEventLog implements EventLog {
  private readonly sql: Sql;
  private readonly clock: Clock;

  constructor(sql: Sql, clock: Clock) {
    this.sql = sql;
    this.clock = clock;
  }

  async append(streamId: StreamId, event: NewEvent) {
    const eventId = event.eventId ?? randomUUID();
    if (!EVENT_ID.test(eventId) || !KIND.test(event.kind)) throw invalid("invalid_event", "Identidade ou tipo de evento inválido");
    const payloadSha = hashOf({ stream: streamId, kind: event.kind, detail: event.detail });
    const now = this.clock.now();
    const occurred = event.occurredAt && !Number.isNaN(Date.parse(event.occurredAt)) ? event.occurredAt : now;
    const inserted = await this.sql.run(
      `INSERT INTO events (stream, kind, detail, event_id, payload_sha, occurred_at, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (event_id) DO NOTHING`,
      [streamId, event.kind, JSON.stringify(event.detail), eventId, payloadSha, occurred, now],
    );
    if (inserted) return { eventId, replayed: false };
    const prior = await this.sql.one<{ payload_sha: string }>("SELECT payload_sha FROM events WHERE event_id = $1", [eventId]);
    if (prior?.payload_sha !== payloadSha) throw conflict("event_id_reused", "Evento já vinculado a outro conteúdo");
    return { eventId, replayed: true };
  }

  async list(streamId: StreamId): Promise<StoredEvent[]> {
    const rows = await this.sql.all<EventRow>("SELECT * FROM events WHERE stream = $1 ORDER BY seq", [streamId]);
    return rows.map((r) => ({
      seq: Number(r.seq),
      stream: r.stream as StreamId,
      kind: r.kind,
      detail: JSON.parse(r.detail) as Json,
      eventId: r.event_id,
      occurredAt: r.occurred_at,
      recordedAt: r.recorded_at,
    }));
  }
}
