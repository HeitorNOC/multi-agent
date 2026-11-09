import type { Consumer, EachMessagePayload, Producer } from 'kafkajs';
import type { DataSource } from 'typeorm';
import type { DispatchReply } from '../domain/use_cases.js';

type ReplyEvent = {
  version: 1;
  tenantId: string;
  sessionId: string;
  dispatchId: string;
  sequence: string;
};

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const publishLimit = 5;
const publisherLock = 31827106;

function conversationKey(event: ReplyEvent): string {
  return `${event.tenantId}:${event.sessionId}`;
}

function parseEvent(message: EachMessagePayload['message']): ReplyEvent | undefined {
  try {
    const event: ReplyEvent = JSON.parse(message.value?.toString() ?? '');
    if (event?.version === 1 && typeof event.tenantId === 'string' && uuid.test(event.tenantId) &&
        typeof event.sessionId === 'string' && uuid.test(event.sessionId) &&
        typeof event.dispatchId === 'string' && uuid.test(event.dispatchId) &&
        typeof event.sequence === 'string' && /^\d{1,19}$/.test(event.sequence) &&
        message.key?.toString() === conversationKey(event)) return event;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
}

class PublishReplyOutbox {
  constructor(private readonly database: DataSource, private readonly producer: Producer,
    private readonly topic: string) {}

  async execute(): Promise<'published' | 'retry' | 'quarantined' | 'idle'> {
    const connection = this.database.createQueryRunner();
    let locked = false;
    try {
      await connection.connect();
      const [lock] = await connection.query('SELECT pg_try_advisory_lock($1) AS acquired', [publisherLock]);
      locked = lock.acquired;
      if (!locked) return 'idle';
      const [event] = await connection.query(`
        SELECT 1 AS version, o.tenant_id AS "tenantId", o.session_id AS "sessionId",
          o.id AS "dispatchId", o.message_sequence::text AS sequence, o.publish_attempts AS attempts
        FROM reply_outbox o
        WHERE o.published_at IS NULL AND o.status='queued' AND o.message_sequence IS NOT NULL
          AND o.publish_error IS DISTINCT FROM 'retry_limit'
          AND NOT EXISTS (
            SELECT 1 FROM reply_outbox earlier
            WHERE earlier.tenant_id=o.tenant_id AND earlier.session_id=o.session_id
              AND earlier.message_sequence<o.message_sequence AND earlier.published_at IS NULL
              AND earlier.status='queued'
          )
        ORDER BY o.message_sequence LIMIT 1`) as (ReplyEvent & { attempts: number })[];
      if (!event) return 'idle';
      const { attempts, ...payload } = event;
      const key = [payload.tenantId, payload.dispatchId];
      if (attempts >= publishLimit) {
        await connection.query("UPDATE reply_outbox SET publish_error='retry_limit' WHERE tenant_id=$1 AND id=$2", key);
        return 'quarantined';
      }
      await connection.query('UPDATE reply_outbox SET publish_attempts=publish_attempts+1 WHERE tenant_id=$1 AND id=$2', key);
      try {
        await this.producer.send({
          topic: this.topic, acks: -1, timeout: 3000,
          messages: [{ key: conversationKey(payload), value: JSON.stringify(payload) }],
        });
      } catch {
        await connection.query('UPDATE reply_outbox SET publish_error=$3 WHERE tenant_id=$1 AND id=$2',
          [...key, attempts + 1 >= publishLimit ? 'retry_limit' : 'broker_unavailable']);
        return attempts + 1 >= publishLimit ? 'quarantined' : 'retry';
      }
      await connection.query('UPDATE reply_outbox SET published_at=clock_timestamp(), publish_error=NULL WHERE tenant_id=$1 AND id=$2', key);
      return 'published';
    } finally {
      try {
        if (locked) await connection.query('SELECT pg_advisory_unlock($1)', [publisherLock]);
      } finally {
        await connection.release();
      }
    }
  }
}

class ConsumeReplyEvents {
  constructor(private readonly database: DataSource, private readonly dispatch: DispatchReply) {}

  async execute({ topic, partition, message }: EachMessagePayload): Promise<void> {
    const event = parseEvent(message);
    if (!event) {
      await this.quarantine(topic, partition, message.offset, 'invalid_envelope');
      return;
    }
    const [row] = await this.database.query(`
      SELECT o.status, o.correlation_id AS correlation, EXISTS (
        SELECT 1 FROM reply_outbox earlier
        WHERE earlier.tenant_id=o.tenant_id AND earlier.session_id=o.session_id
          AND earlier.message_sequence<o.message_sequence
          AND earlier.status IN ('queued', 'in_flight', 'unknown')
      ) AS blocked
      FROM reply_outbox o WHERE o.tenant_id=$1 AND o.id=$2 AND o.session_id=$3
        AND o.message_sequence::text=$4`,
    [event.tenantId, event.dispatchId, event.sessionId, event.sequence]);
    if (!row) {
      await this.quarantine(topic, partition, message.offset, 'dispatch_mismatch');
      return;
    }
    if (row.status !== 'queued') return;
    if (row.blocked) throw new Error('CONVERSATION_AWAITING_PREVIOUS_DISPATCH');
    const result = await this.dispatch.execute({
      tenantId: event.tenantId, principalId: 'kafka-dispatch', correlationId: row.correlation,
      scopes: ['outbound:dispatch'],
    }, event.dispatchId);
    if (!result.ok) {
      const [current] = await this.database.query('SELECT status FROM reply_outbox WHERE tenant_id=$1 AND id=$2',
        [event.tenantId, event.dispatchId]);
      if (!current || current.status === 'queued') throw new Error('DISPATCH_NOT_CLAIMED');
    }
  }

  private async quarantine(topic: string, partition: number, offset: string, reason: string): Promise<void> {
    await this.database.query(`
      INSERT INTO kafka_dispatch_quarantine (topic, partition_id, broker_offset, reason)
      VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [topic, partition, offset, reason]);
  }
}

async function startReplyConsumer(consumer: Consumer, topic: string, handler: ConsumeReplyEvents): Promise<void> {
  await consumer.connect();
  await consumer.subscribe({ topic, fromBeginning: true });
  await consumer.run({
    autoCommit: false,
    eachMessage: async payload => {
      await handler.execute(payload);
      await consumer.commitOffsets([{
        topic: payload.topic, partition: payload.partition,
        offset: (BigInt(payload.message.offset) + 1n).toString(),
      }]);
    },
  });
}

export { PublishReplyOutbox, ConsumeReplyEvents, startReplyConsumer };
