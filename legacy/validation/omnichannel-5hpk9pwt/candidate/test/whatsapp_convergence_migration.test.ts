import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createDataSource } from '../src/infrastructure/postgres.js';

test('migration 007 protege controles sem vínculo e não é reaplicada', async () => {
  const url = process.env.OMNICHANNEL_TEST_DATABASE_URL;
  assert.ok(url, 'Configure OMNICHANNEL_TEST_DATABASE_URL com um banco de teste dedicado.');
  const schema = `qa_${randomUUID().replaceAll('-', '')}`;
  const setup = createDataSource(url);
  const db = createDataSource(url).setOptions({ schema, extra: { options: `-c search_path=${schema}` } });
  await setup.initialize();
  try {
    await setup.query(`CREATE SCHEMA ${schema}`);
    await db.initialize();
    const expected = [
      'Vertical1760000000000', 'DispatchRecovery1760000000001', 'KafkaDispatch1760000000002',
      'WhatsappWebhooks1760000000003', 'WhatsappControl1760000000004',
      'WhatsappBinding1760000000005', 'WhatsappBindingConvergence1760000000006',
    ];
    const selected = expected.map(name => {
      const migration = db.migrations.find(item => item.constructor.name === name);
      assert.ok(migration, `Migration ausente: ${name}`);
      return migration;
    });
    db.migrations.splice(0, db.migrations.length, ...selected);
    const applied = await db.runMigrations();
    assert.deepEqual(applied.map(migration => migration.name), expected);
    const recorded = await db.query('SELECT name, timestamp::text AS timestamp FROM migrations ORDER BY timestamp');
    assert.deepEqual(recorded, expected.map((name, index) => ({ name, timestamp: String(1760000000000 + index) })));
    const [index] = await db.query(`SELECT indisunique FROM pg_index
      WHERE indexrelid='whatsapp_control_conversation_identity'::regclass`);
    assert.equal(index.indisunique, false);
    const tenant = randomUUID();
    const integration = randomUUID();
    await db.query("INSERT INTO channel_integration VALUES ($1,$2,'whatsapp')", [tenant, integration]);
    await assert.rejects(db.query(`INSERT INTO whatsapp_conversation_control
      (tenant_id,integration_id,phone_number_id,contact_id) VALUES ($1,$2,'phone','5511999999999')`,
    [tenant, integration]), { code: '23503' });
    await db.query("INSERT INTO whatsapp_phone_binding (tenant_id,integration_id,phone_number_id) VALUES ($1,$2,'phone')", [tenant, integration]);
    await db.query(`INSERT INTO whatsapp_conversation_control
      (tenant_id,integration_id,phone_number_id,contact_id) VALUES ($1,$2,'phone','5511999999999')`,
    [tenant, integration]);
    await db.query("UPDATE whatsapp_conversation_control SET version=1 WHERE tenant_id=$1", [tenant]);
    assert.deepEqual(await db.runMigrations(), []);
  } finally {
    if (db.isInitialized) await db.destroy();
    try { await setup.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } finally { await setup.destroy(); }
  }
});
