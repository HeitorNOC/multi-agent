import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createDataSource } from '../src/infrastructure/postgres.js';

const historical006 = `-- Impede alterações concorrentes entre a verificação e a criação do índice.
-- A migration deve ser executada em uma transação, como nas migrations do DataSource.
LOCK TABLE whatsapp_conversation_control IN SHARE ROW EXCLUSIVE MODE;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM whatsapp_conversation_control
    GROUP BY tenant_id, phone_number_id, contact_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'Migration 006: controles WhatsApp legados duplicados por tenant, número e contato; saneamento manual necessário';
  END IF;
END
$migration$;

-- Vínculo persistente do número à integração de um tenant.
CREATE TABLE whatsapp_phone_binding (
  tenant_id uuid NOT NULL,
  integration_id uuid NOT NULL,
  channel text NOT NULL DEFAULT 'whatsapp' CHECK (channel = 'whatsapp'),
  phone_number_id text NOT NULL CHECK (phone_number_id <> ''),
  PRIMARY KEY (tenant_id, phone_number_id),
  UNIQUE (tenant_id, integration_id, phone_number_id),
  FOREIGN KEY (tenant_id, integration_id, channel) REFERENCES channel_integration
);

CREATE UNIQUE INDEX whatsapp_control_conversation_identity
  ON whatsapp_conversation_control (tenant_id, phone_number_id, contact_id);

-- NOT VALID preserva controles legados sem presumir seu vínculo; novas linhas
-- e alterações de linhas existentes devem respeitar o vínculo persistido.
ALTER TABLE whatsapp_conversation_control
  ADD CONSTRAINT whatsapp_control_phone_binding
  FOREIGN KEY (tenant_id, integration_id, phone_number_id)
  REFERENCES whatsapp_phone_binding (tenant_id, integration_id, phone_number_id)
  NOT VALID;

ALTER TABLE whatsapp_dispatch_intent
  ADD COLUMN correlation_id text,
  ADD COLUMN reconciliation_evidence text,
  ADD COLUMN reconciliation_principal text,
  ADD COLUMN reconciliation_correlation text;
`;

test('upgrade histórico 006 aplica somente 007 e não a reaplica', async () => {
  const url = process.env.OMNICHANNEL_TEST_DATABASE_URL;
  assert.ok(url, 'Configure OMNICHANNEL_TEST_DATABASE_URL com um banco de teste dedicado.');
  const schema = `qa_${randomUUID().replaceAll('-', '')}`;
  const setup = createDataSource(url);
  const db = createDataSource(url).setOptions({
    schema, extra: { options: `-c search_path=${schema}` },
  });
  await setup.initialize();
  try {
    await setup.query(`CREATE SCHEMA ${schema}`);
    await db.initialize();
    const seventh = db.migrations.pop();
    assert.ok(seventh);
    assert.equal(seventh.constructor.name, 'WhatsappBindingConvergence1760000000006');
    const sixth = db.migrations.pop();
    assert.ok(sixth);
    assert.equal(sixth.constructor.name, 'WhatsappBinding1760000000005');
    assert.equal((await db.runMigrations()).length, 5);

    const tenant = randomUUID();
    const integration = randomUUID();
    await db.query("INSERT INTO channel_integration VALUES ($1, $2, 'whatsapp')", [tenant, integration]);
    await db.query(`INSERT INTO whatsapp_conversation_control
      (tenant_id, integration_id, phone_number_id, contact_id, control)
      VALUES ($1, $2, 'fixture-phone', '5511999999999', 'unknown')`, [tenant, integration]);

    const registered = await db.transaction(async manager => {
      await manager.query(historical006);
      const [row] = await manager.query(
        'INSERT INTO migrations (timestamp, name) VALUES ($1, $2) RETURNING id, timestamp, name',
        [1760000000005, 'WhatsappBinding1760000000005'],
      );
      return row;
    });
    assert.ok(Number.isInteger(registered.id) && registered.id > 0);
    assert.equal(String(registered.timestamp), '1760000000005');
    assert.equal(registered.name, 'WhatsappBinding1760000000005');
    const before = await db.query('SELECT * FROM whatsapp_conversation_control WHERE tenant_id=$1', [tenant]);
    db.migrations.push(sixth, seventh);
    assert.equal(await db.showMigrations(), true);
    const applied = await db.runMigrations();
    assert.equal(applied.length, 1);
    assert.equal(applied[0].name, 'WhatsappBindingConvergence1760000000006');
    assert.equal(await db.showMigrations(), false);
    assert.deepEqual(await db.runMigrations(), []);
    const rows = await db.query('SELECT id, timestamp, name FROM migrations WHERE name=$1',
      ['WhatsappBinding1760000000005']);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, registered.id);
    const convergence = await db.query('SELECT timestamp, name FROM migrations WHERE name=$1',
      ['WhatsappBindingConvergence1760000000006']);
    assert.equal(convergence.length, 1);
    assert.equal(String(convergence[0].timestamp), '1760000000006');
    const [index] = await db.query(`SELECT indisunique FROM pg_index
      WHERE indexrelid='whatsapp_control_conversation_identity'::regclass`);
    assert.equal(index.indisunique, false);
    assert.deepEqual(await db.query('SELECT * FROM whatsapp_conversation_control WHERE tenant_id=$1', [tenant]), before);
    assert.deepEqual(await db.query('SELECT * FROM whatsapp_phone_binding'), []);
    await assert.rejects(db.query("UPDATE whatsapp_conversation_control SET version=version+1 WHERE tenant_id=$1 AND integration_id=$2",
      [tenant, integration]), { code: '23503' });
    await assert.rejects(db.query(`INSERT INTO whatsapp_conversation_control
      (tenant_id, integration_id, phone_number_id, contact_id)
      VALUES ($1, $2, 'fixture-phone', '5511888888888')`, [tenant, integration]), { code: '23503' });
    await db.query("INSERT INTO whatsapp_phone_binding (tenant_id, integration_id, phone_number_id) VALUES ($1, $2, 'fixture-phone')",
      [tenant, integration]);
    await db.query('UPDATE whatsapp_conversation_control SET version=version+1 WHERE tenant_id=$1 AND integration_id=$2',
      [tenant, integration]);
    const [updated] = await db.query('SELECT control, version FROM whatsapp_conversation_control WHERE tenant_id=$1', [tenant]);
    assert.equal(updated.control, 'unknown');
    assert.equal(String(updated.version), '1');
    assert.deepEqual(await db.runMigrations(), []);
  } finally {
    if (db.isInitialized) await db.destroy();
    try {
      await setup.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await setup.destroy();
    }
  }
});
