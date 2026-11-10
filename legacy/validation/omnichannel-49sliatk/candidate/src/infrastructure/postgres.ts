import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DataSource } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { Context, Dispatch, HistoryItem, Inbound, Intake, MessagingStore, Receipt,
  RecoveryItem, RecoveryReceipt } from '../domain/messaging.js';

const recoverable = "(status = 'unknown' OR (status = 'in_flight' AND claimed_at <= now() - interval '60 seconds'))";

class Vertical1760000000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const sql = await readFile(new URL('../../../migrations/001_vertical.sql', import.meta.url), 'utf8');
    await runner.query(sql);
  }

  async down(): Promise<void> {
    throw new Error('A migração inicial exige um plano de recuperação aprovado.');
  }
}

class DispatchRecovery1760000000001 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const sql = await readFile(new URL('../../../migrations/002_dispatch_recovery.sql', import.meta.url), 'utf8');
    await runner.query(sql);
  }

  async down(): Promise<void> {
    throw new Error('A migração de recuperação exige um plano de recuperação aprovado.');
  }
}

class KafkaDispatch1760000000002 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const sql = await readFile(new URL('../../../migrations/003_kafka_dispatch.sql', import.meta.url), 'utf8');
    await runner.query(sql);
  }

  async down(): Promise<void> {
    throw new Error('A migração Kafka exige um plano de recuperação aprovado.');
  }
}

class WhatsappWebhooks1760000000003 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const sql = await readFile(new URL('../../../migrations/004_whatsapp_webhooks.sql', import.meta.url), 'utf8');
    await runner.query(sql);
  }

  async down(): Promise<void> {
    throw new Error('A migração de webhooks exige um plano de recuperação aprovado.');
  }
}

function createDataSource(url: string): DataSource {
  return new DataSource({
    type: 'postgres',
    url,
    synchronize: false,
    migrations: [Vertical1760000000000, DispatchRecovery1760000000001, KafkaDispatch1760000000002,
      WhatsappWebhooks1760000000003],
  });
}

class PostgresMessagingStore implements MessagingStore {
  constructor(private readonly database: DataSource) {}

  ingest(context: Context, input: Inbound, reply: string): Promise<Intake | 'conflict' | 'forbidden'> {
    return this.database.transaction(async manager => {
      const key = [context.tenantId, input.integrationId, input.channel, input.eventId];
      const payload = JSON.stringify(input);
      const dispatchId = randomUUID();
      const inserted = await manager.query(`
        INSERT INTO inbound_event (tenant_id, integration_id, channel, external_id, payload, principal_id, correlation_id, dispatch_id)
        SELECT $1, $2, $3, $4, $5::jsonb, $6, $7, $8
        WHERE EXISTS (SELECT 1 FROM channel_integration WHERE tenant_id=$1 AND id=$2 AND channel=$3)
        ON CONFLICT DO NOTHING RETURNING dispatch_id`,
      [...key, payload, context.principalId, context.correlationId, dispatchId]) as { dispatch_id: string }[];
      if (!inserted.length) {
        const [prior] = await manager.query(`
          SELECT o.session_id AS "sessionId", o.id AS "dispatchId", e.payload=$5::jsonb AS same
          FROM inbound_event e JOIN reply_outbox o ON o.tenant_id=e.tenant_id AND o.id=e.dispatch_id
          WHERE e.tenant_id=$1 AND e.integration_id=$2 AND e.channel=$3 AND e.external_id=$4`,
        [...key, payload]) as (Pick<Intake, 'sessionId' | 'dispatchId'> & { same: boolean })[];
        if (!prior) return 'forbidden';
        return prior.same ? { sessionId: prior.sessionId, dispatchId: prior.dispatchId, duplicate: true } : 'conflict';
      }
      const sessionKey = [context.tenantId, input.integrationId, input.channel, input.externalSessionId];
      await manager.query(`
        INSERT INTO channel_session (tenant_id, integration_id, channel, external_id, id)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (tenant_id, integration_id, channel, external_id) DO NOTHING`, [...sessionKey, randomUUID()]);
      const [session] = await manager.query(`
        SELECT id FROM channel_session
        WHERE tenant_id=$1 AND integration_id=$2 AND channel=$3 AND external_id=$4 FOR UPDATE`, sessionKey) as { id: string }[];
      await manager.query(`
        INSERT INTO conversation_message (tenant_id, session_id, correlation_id, direction, content)
        VALUES ($1, $2, $3, 'in', $4)`, [context.tenantId, session.id, context.correlationId, input.text.trim()]);
      await manager.query(`
        WITH response AS (
          INSERT INTO conversation_message (tenant_id, session_id, correlation_id, direction, content)
          VALUES ($1, $2, $3, 'out', $4) RETURNING sequence
        )
        INSERT INTO reply_outbox (tenant_id, id, session_id, content, correlation_id, message_sequence)
        SELECT $1, $5, $2, $4, $3, sequence FROM response`,
      [context.tenantId, session.id, context.correlationId, reply, dispatchId]);
      return { sessionId: session.id, dispatchId, duplicate: false };
    });
  }

  async claim(context: Context, id: string): Promise<Dispatch | undefined> {
    const [dispatch] = await this.database.query(`
      WITH claimed AS (
        UPDATE reply_outbox SET status='in_flight', claimed_at=clock_timestamp()
        WHERE tenant_id=$1 AND id=$2 AND status='queued'
        RETURNING tenant_id, id, session_id, correlation_id, content
      )
      SELECT c.id, c.tenant_id AS "tenantId", s.integration_id AS "integrationId",
        s.channel, s.external_id AS "externalSessionId",
        c.correlation_id AS "correlationId", c.content AS text
      FROM claimed c JOIN channel_session s ON s.tenant_id=c.tenant_id AND s.id=c.session_id`,
    [context.tenantId, id]) as Dispatch[];
    return dispatch;
  }

  async settle(context: Context, id: string, receipt: Receipt): Promise<boolean> {
    const [result] = await this.database.query(`
      WITH settled AS (
        UPDATE reply_outbox SET status=$3, provider_id=$4
        WHERE tenant_id=$1 AND id=$2 AND (
          status IN ('in_flight', 'unknown') OR (status=$3 AND provider_id IS NOT DISTINCT FROM $4)
        ) RETURNING id
      ) SELECT id FROM settled`,
    [context.tenantId, id, receipt.status, receipt.status === 'accepted' ? receipt.providerId : null]) as { id: string }[];
    return Boolean(result);
  }

  history(context: Context, sessionId: string, cursor: string, limit: number): Promise<HistoryItem[]> {
    return this.database.query(`
      SELECT m.sequence::text AS cursor, m.direction, m.content AS text, m.correlation_id AS "correlationId",
        CASE WHEN m.direction='out' THEN coalesce(o.status, 'untracked') END AS "deliveryStatus",
        o.provider_id AS "providerMessageId"
      FROM conversation_message m
      LEFT JOIN reply_outbox o ON o.message_sequence=m.sequence AND o.tenant_id=m.tenant_id
        AND o.session_id=m.session_id
      WHERE m.tenant_id=$1 AND m.session_id=$2 AND m.sequence>$3
      ORDER BY m.sequence LIMIT $4`, [context.tenantId, sessionId, cursor, limit]);
  }

  recoverable(context: Context): Promise<RecoveryItem[]> {
    return this.database.query(`
      SELECT id, correlation_id AS "correlationId", status, claimed_at AS "claimedAt"
      FROM reply_outbox WHERE tenant_id=$1 AND ${recoverable}
      ORDER BY claimed_at, id LIMIT 100`, [context.tenantId]);
  }

  async reconcile(context: Context, id: string, evidence: string, receipt: RecoveryReceipt): Promise<boolean> {
    const [row] = await this.database.query(`
      WITH updated AS (
        UPDATE reply_outbox SET status=$3, provider_id=$4, recovery_evidence=$5,
          recovery_principal=$6, recovery_correlation=coalesce(recovery_correlation, $7)
        WHERE tenant_id=$1 AND id=$2 AND (
          ${recoverable} OR (status=$3 AND provider_id IS NOT DISTINCT FROM $4
            AND recovery_evidence=$5 AND recovery_principal=$6)
        )
        RETURNING id
      )
      SELECT id FROM updated`,
    [context.tenantId, id, receipt.status, receipt.status === 'accepted' ? receipt.providerId : null,
      evidence, context.principalId, context.correlationId]) as { id: string }[];
    return Boolean(row);
  }
}

export { createDataSource, PostgresMessagingStore };
