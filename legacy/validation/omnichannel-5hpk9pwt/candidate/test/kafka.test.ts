import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import { Kafka, logLevel } from 'kafkajs';
import { DispatchReply, ReceiveInbound } from '../src/domain/use_cases.js';
import { ConsumeReplyEvents, PublishReplyOutbox, startReplyConsumer } from '../src/infrastructure/kafka_dispatch.js';
import { createDataSource, PostgresMessagingStore } from '../src/infrastructure/postgres.js';

test('Kafka reentrega após queda e preserva ordem por conversa', { timeout: 65000 }, async () => {
  const url = process.env.OMNICHANNEL_TEST_DATABASE_URL;
  const broker = process.env.OMNICHANNEL_TEST_KAFKA_BROKER;
  assert.ok(url && broker, 'Configure PostgreSQL e Kafka de teste dedicados.');
  const topic = `reply-a8-${randomUUID()}`;
  const groupId = `group-${topic}`;
  const kafka = new Kafka({ clientId: 'a8-test', brokers: [broker], logLevel: logLevel.NOTHING });
  const admin = kafka.admin();
  const producer = kafka.producer({ allowAutoTopicCreation: false, retry: { retries: 0 } });
  const consumer = kafka.consumer({ groupId, sessionTimeout: 6000, heartbeatInterval: 1500 });
  const db = createDataSource(url);
  await db.initialize();
  try {
    await db.runMigrations();
    await admin.connect();
    await admin.createTopics({ topics: [{ topic, numPartitions: 3, replicationFactor: 1 }] });
    await producer.connect();
    const tenantId = randomUUID();
    const integrationId = randomUUID();
    const context = { tenantId, principalId: 'qa-kafka', correlationId: randomUUID(), scopes: ['inbound:write'] };
    await db.query("INSERT INTO channel_integration VALUES ($1, $2, 'webchat')", [tenantId, integrationId]);
    const store = new PostgresMessagingStore(db);
    const receive = new ReceiveInbound(store);
    const ids: string[] = [];
    for (const text of ['primeira', 'segunda']) {
      const entry = await receive.execute(context, {
        integrationId, channel: 'webchat', externalSessionId: 'a8', eventId: text, text,
      });
      assert.ok(entry.ok);
      ids.push(entry.data.dispatchId);
    }
    const publisher = new PublishReplyOutbox(db, producer, topic);
    assert.equal(await publisher.execute(), 'published');
    assert.equal(await publisher.execute(), 'published');
    assert.equal(await publisher.execute(), 'idle');
    const [first] = await db.query('SELECT session_id FROM reply_outbox WHERE tenant_id=$1 AND id=$2', [tenantId, ids[0]]);
    await producer.send({ topic, messages: [{ key: `${tenantId}:${first.session_id}`, value: '{inválido' }] });

    const worker = `
      import { Kafka, logLevel } from 'kafkajs';
      import { createDataSource, PostgresMessagingStore } from './dist/src/infrastructure/postgres.js';
      import { DispatchReply } from './dist/src/domain/use_cases.js';
      import { ConsumeReplyEvents, startReplyConsumer } from './dist/src/infrastructure/kafka_dispatch.js';
      const [topic, groupId, first] = process.argv.slice(1);
      const db = createDataSource(process.env.OMNICHANNEL_TEST_DATABASE_URL);
      await db.initialize();
      const dispatch = new DispatchReply(new PostgresMessagingStore(db), {
        async send(event) {
          if (event.id !== first) process.exit(2);
          return { status: 'accepted', providerId: 'fixture-first' };
        },
      });
      const consumer = new Kafka({ brokers: [process.env.OMNICHANNEL_TEST_KAFKA_BROKER], logLevel: logLevel.NOTHING })
        .consumer({ groupId, sessionTimeout: 6000, heartbeatInterval: 1500 });
      class CrashAfterEffect extends ConsumeReplyEvents {
        async execute(payload) {
          await super.execute(payload);
          process.exit(88);
        }
      }
      await startReplyConsumer(consumer, topic, new CrashAfterEffect(db, dispatch));
    `;
    await assert.rejects(promisify(execFile)(process.execPath, [
      '--input-type=module', '--eval', worker, topic, groupId, ids[0],
    ], { cwd: new URL('../../', import.meta.url), timeout: 25000 }), { code: 88 });

    const observed: { offset: string; partition: number }[] = [];
    const effects: string[] = [];
    class ObserveReplay extends ConsumeReplyEvents {
      override async execute(payload: Parameters<ConsumeReplyEvents['execute']>[0]) {
        await super.execute(payload);
        observed.push({ offset: payload.message.offset, partition: payload.partition });
      }
    }
    await startReplyConsumer(consumer, topic, new ObserveReplay(db, new DispatchReply(store, {
      async send(event) {
        effects.push(event.id);
        return { status: 'accepted', providerId: 'fixture-second' };
      },
    })));
    const deadline = Date.now() + 20000;
    while (observed.length < 3 && Date.now() < deadline) await sleep(50);
    assert.deepEqual(observed.map(item => item.offset), ['0', '1', '2']);
    assert.equal(new Set(observed.map(item => item.partition)).size, 1);
    assert.deepEqual(effects, [ids[1]]);
    const [quarantined] = await db.query('SELECT reason FROM kafka_dispatch_quarantine WHERE topic=$1 AND broker_offset=2', [topic]);
    assert.deepEqual(quarantined, { reason: 'invalid_envelope' });
    const rows = await db.query(`SELECT id, status, provider_id FROM reply_outbox
      WHERE tenant_id=$1 ORDER BY message_sequence`, [tenantId]);
    assert.deepEqual(rows, [
      { id: ids[0], status: 'accepted', provider_id: 'fixture-first' },
      { id: ids[1], status: 'accepted', provider_id: 'fixture-second' },
    ]);
    const pending = await receive.execute(context, {
      integrationId, channel: 'webchat', externalSessionId: 'a8', eventId: 'terceira', text: 'terceira',
    });
    assert.ok(pending.ok);
    const offline = new PublishReplyOutbox(db, kafka.producer({ retry: { retries: 0 } }), topic);
    for (let attempt = 1; attempt <= 5; attempt++) {
      assert.equal(await offline.execute(), attempt < 5 ? 'retry' : 'quarantined');
    }
    const behind = await receive.execute(context, {
      integrationId, channel: 'webchat', externalSessionId: 'a8', eventId: 'quarta', text: 'quarta',
    });
    assert.ok(behind.ok);
    assert.equal(await offline.execute(), 'idle');
    const [failure] = await db.query('SELECT publish_attempts, publish_error FROM reply_outbox WHERE tenant_id=$1 AND id=$2',
      [tenantId, pending.data.dispatchId]);
    assert.deepEqual(failure, { publish_attempts: 5, publish_error: 'retry_limit' });
  } finally {
    await consumer.disconnect();
    await producer.disconnect();
    await admin.disconnect();
    await db.destroy();
  }
});
