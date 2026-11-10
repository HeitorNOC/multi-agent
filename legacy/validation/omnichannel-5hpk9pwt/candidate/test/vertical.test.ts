import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { promisify } from 'node:util';
import type { Dispatch, Inbound, Outcome } from '../src/domain/messaging.js';
import { DispatchReply, ListRecoverableDispatches, ReadHistory, ReceiveInbound, ReconcileDispatch } from '../src/domain/use_cases.js';
import { createDataSource, PostgresMessagingStore } from '../src/infrastructure/postgres.js';
import './whatsapp_control_migration.test.js';

function value<T>(result: Outcome<T>): T {
  if (!result.ok) assert.fail(result.message);
  return result.data;
}

test('fluxo vertical PostgreSQL com dois canais, dois tenants, deduplicação e reconciliação', async () => {
  const url = process.env.OMNICHANNEL_TEST_DATABASE_URL;
  assert.ok(url, 'Configure OMNICHANNEL_TEST_DATABASE_URL com um banco de teste dedicado.');
  const database = createDataSource(url);
  await database.initialize();
  try {
    await database.runMigrations();
    assert.deepEqual(await database.runMigrations(), []);
    const tenantId = randomUUID();
    const otherTenant = randomUUID();
    const integrationId = randomUUID();
    await database.query(`INSERT INTO channel_integration VALUES
      ($1, $3, 'whatsapp'), ($1, $3, 'webchat'), ($2, $3, 'whatsapp')`, [tenantId, otherTenant, integrationId]);
    const context = { tenantId, principalId: 'teste', correlationId: randomUUID(),
      scopes: ['inbound:write', 'history:read', 'outbound:dispatch'] };
    const other = { ...context, tenantId: otherTenant };
    const store = new PostgresMessagingStore(database);
    const intake = new ReceiveInbound(store);
    const history = new ReadHistory(store);
    const input: Inbound = { integrationId, channel: 'whatsapp', externalSessionId: 'same',
      eventId: 'same', text: ' Olá ' };
    const original = { ...input, fixtureVersion: 1 };
    assert.equal((await intake.execute({ ...context, scopes: [] }, input)).ok, false);
    assert.equal((await intake.execute(other, { ...input, channel: 'webchat' })).ok, false);
    const results = (await Promise.all(
      Array.from({ length: 8 }, () => intake.execute(context, original)),
    )).map(value);
    assert.equal(results.filter(result => !result.duplicate).length, 1);
    assert.equal(new Set(results.map(result => result.dispatchId)).size, 1);
    const { sessionId, dispatchId } = results[0];
    assert.equal((await intake.execute(context, { ...original, text: 'alterado' })).ok, false);
    const [saved] = await database.query('SELECT payload, principal_id FROM inbound_event WHERE tenant_id=$1', [tenantId]);
    assert.deepEqual(saved, { payload: original, principal_id: context.principalId });
    const web = value(await intake.execute(context, { ...input, channel: 'webchat' }));
    const second = value(await intake.execute(other, input));
    assert.equal(new Set([sessionId, web.sessionId, second.sessionId]).size, 3);
    assert.deepEqual(value(await history.execute(other, sessionId)), []);
    const [first] = value(await history.execute(context, sessionId, '0', 1));
    assert.deepEqual([first.direction, first.text, first.correlationId], ['in', 'Olá', context.correlationId]);
    assert.deepEqual(value(await history.execute(context, sessionId, first.cursor)).map(row => [row.direction, row.text]),
      [['out', 'Simulado: Olá']]);
    assert.equal(value(await history.execute(context, sessionId, first.cursor))[0].deliveryStatus, 'queued');

    const calls: Dispatch[] = [];
    const channel = new DispatchReply(store, {
      async send(dispatch) {
        calls.push(dispatch);
        return { status: 'accepted', providerId: 'fixture-1' };
      },
    });
    assert.equal((await channel.execute(other, dispatchId)).ok, false);
    const sent = await Promise.all(Array.from({ length: 8 }, () => channel.execute(context, dispatchId)));
    assert.equal(sent.filter(result => result.ok).length, 1);
    assert.deepEqual(calls, [{ id: dispatchId, tenantId, integrationId, channel: 'whatsapp',
      externalSessionId: 'same', correlationId: context.correlationId, text: 'Simulado: Olá' }]);
    assert.deepEqual(value(await history.execute(context, sessionId, first.cursor))
      .map(row => [row.deliveryStatus, row.providerMessageId]), [['accepted', 'fixture-1']]);
    const uncertain = new DispatchReply(store, { async send() { throw new Error('timeout de teste'); } });
    assert.deepEqual(value(await uncertain.execute(context, web.dispatchId)), { status: 'unknown' });
    assert.equal(value(await history.execute(context, web.sessionId))[1].deliveryStatus, 'unknown');
    assert.equal((await channel.execute(context, web.dispatchId)).ok, false);
    await database.destroy();
    await database.initialize();
    assert.equal((await channel.execute(context, web.dispatchId)).ok, false);
    const receipt = { status: 'accepted', providerId: 'fixture-late' } as const;
    assert.equal(await store.settle(context, web.dispatchId, receipt), true);
    assert.equal(await store.settle(context, web.dispatchId, receipt), true);
    assert.equal(await store.settle(context, web.dispatchId, { ...receipt, providerId: 'conflict' }), false);
  } finally {
    if (database.isInitialized) await database.destroy();
  }
});

test('QA verifica persistência e impede novo despacho após saída abrupta do executor', async () => {
  const url = process.env.OMNICHANNEL_TEST_DATABASE_URL;
  assert.ok(url, 'Configure OMNICHANNEL_TEST_DATABASE_URL com um banco de teste dedicado.');
  const database = createDataSource(url);
  await database.initialize();
  try {
    await database.runMigrations();
    const tenantId = randomUUID();
    const otherTenant = randomUUID();
    const integrationId = randomUUID();
    await database.query("INSERT INTO channel_integration VALUES ($1, $3, 'webchat'), ($2, $3, 'webchat')",
      [tenantId, otherTenant, integrationId]);
    const context = { tenantId, principalId: 'qa', correlationId: randomUUID(),
      scopes: ['inbound:write', 'outbound:dispatch', 'history:read', 'outbound:reconcile'] };
    const store = new PostgresMessagingStore(database);
    const intake = new ReceiveInbound(store);
    const input = { integrationId, channel: 'webchat' as const, externalSessionId: 'qa', eventId: 'qa', text: '  ' };
    assert.equal((await intake.execute(context, input)).ok, false);
    assert.deepEqual(await database.query('SELECT id FROM channel_session WHERE tenant_id=$1', [tenantId]), []);
    assert.deepEqual(await database.query('SELECT dispatch_id FROM inbound_event WHERE tenant_id=$1', [tenantId]), []);

    const entry = value(await intake.execute(context, { ...input, text: 'Olá' }));
    await assert.rejects(database.query(`
      INSERT INTO conversation_message (tenant_id, session_id, direction, content, correlation_id)
      VALUES ($1, $2, 'in', 'cruzada', $3)`, [otherTenant, entry.sessionId, context.correlationId]),
    { code: '23503' });
    const [queued] = await database.query(`
      SELECT e.correlation_id AS inbound, o.correlation_id AS outbound, o.status, o.provider_id
      FROM inbound_event e JOIN reply_outbox o ON o.tenant_id=e.tenant_id AND o.id=e.dispatch_id
      WHERE e.tenant_id=$1 AND e.dispatch_id=$2`, [tenantId, entry.dispatchId]);
    assert.deepEqual(queued, { inbound: context.correlationId, outbound: context.correlationId,
      status: 'queued', provider_id: null });

    const worker = `
      import { createDataSource, PostgresMessagingStore } from './dist/src/infrastructure/postgres.js';
      const db = createDataSource(process.env.OMNICHANNEL_TEST_DATABASE_URL);
      await db.initialize();
      const dispatch = await new PostgresMessagingStore(db).claim(JSON.parse(process.argv[1]), process.argv[2]);
      process.exit(dispatch?.id === process.argv[2] ? 88 : 1);
    `;
    await assert.rejects(promisify(execFile)(process.execPath, [
      '--input-type=module', '--eval', worker, JSON.stringify(context), entry.dispatchId,
    ], { cwd: new URL('../../', import.meta.url), timeout: 15000 }), { code: 88 });

    const sender = new DispatchReply(store, { async send() { return assert.fail('Despacho duplicado'); } });
    assert.equal((await sender.execute(context, entry.dispatchId)).ok, false);
    const [inFlight] = await database.query('SELECT status FROM reply_outbox WHERE tenant_id=$1 AND id=$2',
      [tenantId, entry.dispatchId]);
    assert.equal(inFlight.status, 'in_flight');
    const recovery = new ListRecoverableDispatches(store);
    const reconcile = new ReconcileDispatch(store);
    const receipt = { status: 'accepted', providerId: 'fixture-qa' } as const;
    assert.deepEqual(value(await recovery.execute(context)), []);
    assert.equal((await reconcile.execute(context, entry.dispatchId, 'recibo-qa', receipt)).ok, false);
    await database.query("UPDATE reply_outbox SET claimed_at=now()-interval '61 seconds' WHERE tenant_id=$1 AND id=$2",
      [tenantId, entry.dispatchId]);
    assert.equal((await recovery.execute({ ...context, scopes: [] })).ok, false);
    assert.deepEqual(value(await recovery.execute({ ...context, tenantId: otherTenant })), []);
    assert.deepEqual(value(await recovery.execute(context)).map(item => [item.id, item.status]),
      [[entry.dispatchId, 'in_flight']]);
    assert.equal(await store.settle({ ...context, tenantId: otherTenant }, entry.dispatchId,
      { status: 'accepted', providerId: 'fixture-qa' }), false);
    assert.equal((await reconcile.execute(context, entry.dispatchId, '', receipt)).ok, false);
    const reconciled = await Promise.all([
      reconcile.execute(context, entry.dispatchId, 'recibo-qa', receipt),
      reconcile.execute(context, entry.dispatchId, 'recibo-qa', receipt),
    ]);
    assert.deepEqual(reconciled.map(result => result.ok), [true, true]);
    assert.equal((await reconcile.execute(context, entry.dispatchId, 'outro-recibo', receipt)).ok, false);
    assert.deepEqual(value(await recovery.execute(context)), []);
    const [settled] = await database.query(`SELECT status, provider_id, recovery_evidence,
      recovery_principal, recovery_correlation FROM reply_outbox WHERE tenant_id=$1 AND id=$2`,
      [tenantId, entry.dispatchId]);
    assert.deepEqual(settled, { status: 'accepted', provider_id: 'fixture-qa',
      recovery_evidence: 'recibo-qa', recovery_principal: 'qa', recovery_correlation: context.correlationId });
  } finally {
    await database.destroy();
  }
});

test('migration de recuperação vincula legado inequívoco e marca histórico ambíguo', async () => {
  const url = process.env.OMNICHANNEL_TEST_DATABASE_URL;
  assert.ok(url, 'Configure OMNICHANNEL_TEST_DATABASE_URL com um banco de teste dedicado.');
  const setup = createDataSource(url);
  const schema = `qa_${randomUUID().replaceAll('-', '')}`;
  await setup.initialize();
  const database = createDataSource(url).setOptions({
    schema, extra: { options: `-c search_path=${schema}` },
  });
  try {
    await setup.query(`CREATE SCHEMA ${schema}`);
    await database.initialize();
    const registeredCount = database.migrations.length;
    const upgrades = database.migrations.splice(1);
    assert.ok(upgrades.length > 0);
    assert.equal(upgrades.length, registeredCount - 1);
    await database.runMigrations();
    const [tenantId, sessionId, integrationId] = [randomUUID(), randomUUID(), randomUUID()];
    await database.query("INSERT INTO channel_integration VALUES ($1, $2, 'webchat')", [tenantId, integrationId]);
    await database.query("INSERT INTO channel_session VALUES ($1, $2, $3, 'webchat', 'legado')",
      [tenantId, sessionId, integrationId]);
    for (const [correlation, status] of [['unique', 'rejected'], ['ambiguous', 'queued'], ['ambiguous', 'queued']]) {
      await database.query(`INSERT INTO conversation_message (tenant_id, session_id, direction, content, correlation_id)
        VALUES ($1, $2, 'out', 'resposta', $3)`, [tenantId, sessionId, correlation]);
      await database.query(`INSERT INTO reply_outbox (tenant_id, session_id, id, content, correlation_id, status)
        VALUES ($1, $2, $3, 'resposta', $4, $5)`, [tenantId, sessionId, randomUUID(), correlation, status]);
    }
    database.migrations.push(...upgrades);
    assert.equal((await database.runMigrations()).length, upgrades.length);
    const rows = value(await new ReadHistory(new PostgresMessagingStore(database)).execute(
      { tenantId, principalId: 'qa', correlationId: 'upgrade', scopes: ['history:read'] }, sessionId,
    ));
    assert.deepEqual(rows.map(row => row.deliveryStatus), ['rejected', 'untracked', 'untracked']);
  } finally {
    if (database.isInitialized) await database.destroy();
    await setup.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await setup.destroy();
  }
});
