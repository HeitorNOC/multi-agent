import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createDataSource } from '../src/infrastructure/postgres.js';
import './whatsapp_binding_migration.test.js';
import './whatsapp_convergence_migration.test.js';
import './whatsapp_historical_upgrade.test.js';

test('migrations criam o controle WhatsApp em schema vazio e não são reaplicadas', async () => {
  const url = process.env.OMNICHANNEL_TEST_DATABASE_URL;
  assert.ok(url, 'Configure OMNICHANNEL_TEST_DATABASE_URL com um banco de teste dedicado.');
  const schema = `qa_${randomUUID().replaceAll('-', '')}`;
  const setup = createDataSource(url);
  const database = createDataSource(url).setOptions({ schema, extra: { options: `-c search_path=${schema}` } });
  await setup.initialize();
  try {
    await setup.query(`CREATE SCHEMA ${schema}`);
    await database.initialize();
    const expected = [
      'Vertical1760000000000', 'DispatchRecovery1760000000001', 'KafkaDispatch1760000000002',
      'WhatsappWebhooks1760000000003', 'WhatsappControl1760000000004',
      'WhatsappBinding1760000000005', 'WhatsappBindingConvergence1760000000006',
      'WhatsappControlConflict1760000000007',
    ];
    assert.deepEqual(database.migrations.map(migration => migration.constructor.name), expected);
    const applied = await database.runMigrations();
    assert.deepEqual(applied.map(migration => migration.name), expected);
    const recorded = await database.query('SELECT name, timestamp::text AS timestamp FROM migrations ORDER BY timestamp');
    assert.deepEqual(recorded, expected.map((name, index) => ({ name, timestamp: String(1760000000000 + index) })));
    const tables = await database.query(`SELECT tablename FROM pg_tables
      WHERE schemaname=$1 AND tablename = ANY($2::text[]) ORDER BY tablename`,
    [schema, ['whatsapp_conversation_control', 'whatsapp_dispatch_intent', 'whatsapp_control_event']]);
    assert.deepEqual(tables.map((row: { tablename: string }) => row.tablename),
      ['whatsapp_control_event', 'whatsapp_conversation_control', 'whatsapp_dispatch_intent']);
    const indexes = await database.query(`SELECT indexname FROM pg_indexes
      WHERE schemaname=$1 AND indexname = ANY($2::text[]) ORDER BY indexname`,
    [schema, ['whatsapp_dispatch_provider_identity', 'whatsapp_control_event_pending_status']]);
    assert.deepEqual(indexes.map((row: { indexname: string }) => row.indexname),
      ['whatsapp_control_event_pending_status', 'whatsapp_dispatch_provider_identity']);
    assert.deepEqual(await database.runMigrations(), []);
  } finally {
    if (database.isInitialized) await database.destroy();
    try { await setup.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } finally { await setup.destroy(); }
  }
});
