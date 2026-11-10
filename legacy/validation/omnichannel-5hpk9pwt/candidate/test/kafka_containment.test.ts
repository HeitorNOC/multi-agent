import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { Kafka, logLevel } from 'kafkajs';
import type { Consumer, EachMessagePayload } from 'kafkajs';
import type { DataSource } from 'typeorm';
import { DispatchReply, ReceiveInbound } from '../src/domain/use_cases.js';
import { ConsumeReplyEvents, PublishReplyOutbox, startReplyConsumer } from '../src/infrastructure/kafka_dispatch.js';
import { createDataSource, PostgresMessagingStore } from '../src/infrastructure/postgres.js';

test('Kafka preserva WhatsApp e continua webchat na mesma partição', { timeout: 60000 }, async () => {
  const url = process.env.OMNICHANNEL_TEST_DATABASE_URL;
  const broker = process.env.OMNICHANNEL_TEST_KAFKA_BROKER;
  assert.ok(url && broker, 'Configure PostgreSQL e Kafka dedicados.');
  const topic = `containment-${randomUUID()}`;
  const groupId = `group-${topic}`;
  const kafka = new Kafka({ brokers: [broker], logLevel: logLevel.NOTHING });
  const admin = kafka.admin();
  const producer = kafka.producer();
  const consumer = kafka.consumer({ groupId });
  const db = createDataSource(url);
  await db.initialize();
  try {
    await db.runMigrations();
    await admin.connect();
    await admin.createTopics({ topics: [{ topic, numPartitions: 1, replicationFactor: 1 }] });
    await producer.connect();
    const tenantId = randomUUID();
    const integrationId = randomUUID();
    await db.query("INSERT INTO channel_integration VALUES ($1,$2,'whatsapp'),($1,$2,'webchat')", [tenantId, integrationId]);
    const context = { tenantId, principalId: 'fixture', correlationId: randomUUID(), scopes: ['inbound:write'] };
    const store = new PostgresMessagingStore(db);
    const receive = new ReceiveInbound(store);
    const ids: string[] = [];
    for (const [channel, eventId] of [['whatsapp', 'wa1'], ['whatsapp', 'wa2'], ['webchat', 'web']] as const) {
      const result = await receive.execute(context, { integrationId, channel, externalSessionId: 'fixture', eventId, text: eventId });
      assert.ok(result.ok);
      ids.push(result.data.dispatchId);
    }
    const publisher = new PublishReplyOutbox(db, producer, topic);
    for (let i = 0; i < 3; i++) assert.equal(await publisher.execute(), 'published');
    const calls: string[] = [];
    const handler = new ConsumeReplyEvents(db, new DispatchReply(store, {
      async send(dispatch) { calls.push(dispatch.id); return { status: 'accepted', providerId: 'fixture-web' }; },
    }));
    await startReplyConsumer(consumer, topic, handler);
    const deadline = Date.now() + 20000;
    let offset: string | null = null;
    while (Date.now() < deadline) {
      const offsets = await admin.fetchOffsets({ groupId, topics: [topic] });
      offset = offsets[0]?.partitions[0]?.offset ?? null;
      if (offset === '3') break;
      await sleep(100);
    }
    assert.equal(offset, '3');
    assert.deepEqual(calls, [ids[2]]);
    const rows = await db.query('SELECT id,status,provider_id FROM reply_outbox WHERE tenant_id=$1 ORDER BY message_sequence', [tenantId]);
    assert.deepEqual(rows, [
      { id: ids[0], status: 'queued', provider_id: null },
      { id: ids[1], status: 'queued', provider_id: null },
      { id: ids[2], status: 'accepted', provider_id: 'fixture-web' },
    ]);
    const [wa] = await db.query('SELECT session_id, message_sequence::text AS sequence FROM reply_outbox WHERE tenant_id=$1 AND id=$2', [tenantId, ids[0]]);
    const event = { version: 1, tenantId, sessionId: wa.session_id, dispatchId: ids[0], sequence: wa.sequence };
    const payload = { topic, partition: 0, message: { offset: '0', key: Buffer.from(`${tenantId}:${wa.session_id}`), value: Buffer.from(JSON.stringify(event)) } } as EachMessagePayload;
    await handler.execute(payload);
    await handler.execute(payload);
    assert.deepEqual(calls, [ids[2]]);
    const [replayed] = await db.query('SELECT status,provider_id FROM reply_outbox WHERE tenant_id=$1 AND id=$2', [tenantId, ids[0]]);
    assert.deepEqual(replayed, { status: 'queued', provider_id: null });
  } finally {
    await consumer.disconnect();
    await producer.disconnect();
    await admin.disconnect();
    await db.destroy();
  }
});

test('falhas de leitura e persistência impedem confirmação do offset', async () => {
  const tenantId = randomUUID();
  const sessionId = randomUUID();
  const dispatchId = randomUUID();
  const event = { version: 1, tenantId, sessionId, dispatchId, sequence: '1' };
  const valid = { topic: 'fixture', partition: 0, message: { offset: '0', key: Buffer.from(`${tenantId}:${sessionId}`), value: Buffer.from(JSON.stringify(event)) } } as EachMessagePayload;
  const invalid = { ...valid, message: { ...valid.message, value: Buffer.from('{') } } as EachMessagePayload;
  for (const payload of [valid, invalid]) {
    let commits = 0;
    let eachMessage: ((payload: EachMessagePayload) => Promise<void>) | undefined;
    const consumer = {
      async connect() {}, async subscribe() {},
      async run(options: { eachMessage: (payload: EachMessagePayload) => Promise<void> }) { eachMessage = options.eachMessage; },
      async commitOffsets() { commits++; },
    } as unknown as Consumer;
    const db = { async query() { throw new Error('fixture database failure'); } } as unknown as DataSource;
    const dispatch = { async execute() { return assert.fail('transporte não deve ser chamado'); } } as unknown as DispatchReply;
    await startReplyConsumer(consumer, 'fixture', new ConsumeReplyEvents(db, dispatch));
    assert.ok(eachMessage);
    await assert.rejects(eachMessage(payload), /fixture database failure/);
    assert.equal(commits, 0);
  }
});
