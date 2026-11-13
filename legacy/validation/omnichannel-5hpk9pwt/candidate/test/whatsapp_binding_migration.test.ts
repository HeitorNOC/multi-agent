import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createDataSource } from '../src/infrastructure/postgres.js';

async function isolated(run: (db: ReturnType<typeof createDataSource>) => Promise<void>): Promise<void> {
  const url = process.env.OMNICHANNEL_TEST_DATABASE_URL;
  assert.ok(url, 'Configure OMNICHANNEL_TEST_DATABASE_URL com um banco de teste dedicado.');
  const schema = `qa_${randomUUID().replaceAll('-', '')}`;
  const setup = createDataSource(url);
  const db = createDataSource(url).setOptions({ schema, extra: { options: `-c search_path=${schema}` } });
  await setup.initialize();
  try {
    await setup.query(`CREATE SCHEMA ${schema}`);
    await db.initialize();
    await run(db);
  } finally {
    if (db.isInitialized) await db.destroy();
    try { await setup.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } finally { await setup.destroy(); }
  }
}

test('migration 006 instala índice único em schema vazio e não é reaplicada', async () => {
  await isolated(async db => {
    db.migrations.pop();
    assert.equal((await db.runMigrations()).length, 6);
    const [binding] = await db.query("SELECT to_regclass('whatsapp_phone_binding') IS NOT NULL AS present");
    assert.equal(binding.present, true);
    const [index] = await db.query("SELECT indisunique FROM pg_index WHERE indexrelid='whatsapp_control_conversation_identity'::regclass");
    assert.equal(index.indisunique, true);
    const [constraint] = await db.query("SELECT convalidated FROM pg_constraint WHERE conrelid='whatsapp_conversation_control'::regclass AND conname='whatsapp_control_phone_binding'");
    assert.equal(constraint.convalidated, false);
    const columns = await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='whatsapp_dispatch_intent' AND column_name = ANY($1::text[]) ORDER BY column_name", [['correlation_id', 'reconciliation_evidence', 'reconciliation_principal', 'reconciliation_correlation']]);
    assert.deepEqual(columns.map((row: { column_name: string }) => row.column_name), ['correlation_id', 'reconciliation_correlation', 'reconciliation_evidence', 'reconciliation_principal']);
    assert.deepEqual(await db.runMigrations(), []);
  });
});

test('migration 006 rejeita controles legados duplicados e reverte sua instalação', async () => {
  await isolated(async db => {
    db.migrations.pop();
    const upgrade = db.migrations.pop();
    assert.ok(upgrade);
    assert.equal((await db.runMigrations()).length, 5);
    const tenant = randomUUID();
    const first = randomUUID();
    const second = randomUUID();
    await db.query("INSERT INTO channel_integration VALUES ($1,$2,'whatsapp'),($1,$3,'whatsapp')", [tenant, first, second]);
    await db.query("INSERT INTO whatsapp_conversation_control (tenant_id,integration_id,phone_number_id,contact_id,control,version) VALUES ($1,$2,'phone','5511999999999','partner',7),($1,$3,'phone','5511999999999','mba',3)", [tenant, first, second]);
    const before = await db.query('SELECT * FROM whatsapp_conversation_control ORDER BY integration_id');
    db.migrations.push(upgrade);
    await assert.rejects(db.runMigrations(), { code: '23505', message: /controles WhatsApp legados duplicados/ });
    assert.deepEqual(await db.query('SELECT * FROM whatsapp_conversation_control ORDER BY integration_id'), before);
    const [binding] = await db.query("SELECT to_regclass('whatsapp_phone_binding') IS NOT NULL AS present");
    assert.equal(binding.present, false);
    const rows = await db.query("SELECT name FROM migrations WHERE name='WhatsappBinding1760000000005'");
    assert.deepEqual(rows, []);
  });
});

test('migration 006 preserva controles legados distintos sem inferir vínculos', async () => {
  await isolated(async db => {
    db.migrations.pop();
    const upgrade = db.migrations.pop();
    assert.ok(upgrade);
    assert.equal((await db.runMigrations()).length, 5);
    const tenant = randomUUID();
    const first = randomUUID();
    const second = randomUUID();
    await db.query("INSERT INTO channel_integration VALUES ($1,$2,'whatsapp'),($1,$3,'whatsapp')", [tenant, first, second]);
    await db.query("INSERT INTO whatsapp_conversation_control (tenant_id,integration_id,phone_number_id,contact_id,control,version) VALUES ($1,$2,'phone','5511999999999','partner',7),($1,$3,'other','5511888888888','unknown',2)", [tenant, first, second]);
    const before = await db.query('SELECT * FROM whatsapp_conversation_control ORDER BY phone_number_id');
    db.migrations.push(upgrade);
    assert.equal((await db.runMigrations()).length, 1);
    assert.deepEqual(await db.query('SELECT * FROM whatsapp_conversation_control ORDER BY phone_number_id'), before);
    assert.deepEqual(await db.query('SELECT * FROM whatsapp_phone_binding'), []);
    await assert.rejects(db.query("INSERT INTO whatsapp_conversation_control (tenant_id,integration_id,phone_number_id,contact_id) VALUES ($1,$2,'new','5511777777777')", [tenant, first]), { code: '23503' });
    await db.query("INSERT INTO whatsapp_phone_binding (tenant_id,integration_id,phone_number_id) VALUES ($1,$2,'phone')", [tenant, first]);
    await assert.rejects(db.query("INSERT INTO whatsapp_phone_binding (tenant_id,integration_id,phone_number_id) VALUES ($1,$2,'phone')", [tenant, second]), { code: '23505' });
    await db.query("UPDATE whatsapp_conversation_control SET version=8 WHERE tenant_id=$1 AND integration_id=$2 AND phone_number_id='phone'", [tenant, first]);
    await assert.rejects(db.query("INSERT INTO whatsapp_conversation_control (tenant_id,integration_id,phone_number_id,contact_id) VALUES ($1,$2,'phone','5511999999999')", [tenant, first]), { code: '23505' });
    await assert.rejects(db.query('ALTER TABLE whatsapp_conversation_control VALIDATE CONSTRAINT whatsapp_control_phone_binding'), { code: '23503' });
    assert.deepEqual(await db.runMigrations(), []);
  });
});
