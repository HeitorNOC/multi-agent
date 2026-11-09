import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { DispatchReply, ReceiveInbound } from '../src/domain/use_cases.js';
import { createDataSource, PostgresMessagingStore } from '../src/infrastructure/postgres.js';
import { ObserveWhatsappWebhook, SendWhatsappText } from '../src/infrastructure/whatsapp.js';

test('WhatsApp autentica, persiste original, deduplica standby e registra aceite simulado', async () => {
  const url = process.env.OMNICHANNEL_TEST_DATABASE_URL;
  assert.ok(url);
  const db = createDataSource(url);
  await db.initialize();
  try {
    await db.runMigrations();
    const [tenantId, integrationId, correlationId] = [randomUUID(), randomUUID(), randomUUID()];
    const binding = { tenantId, integrationId, wabaId: '100', phoneNumberId: '200', authorization: 'Basic Zml4dHVyZTpmYWtl' };
    await db.query("INSERT INTO channel_integration VALUES ($1,$2,'whatsapp')", [tenantId, integrationId]);
    const observer = new ObserveWhatsappWebhook(db, binding);
    const customer = { id: 'wamid.customer', from: '5511999999999', type: 'text', text: { body: ' Olá ' } };
    const echo = { id: 'wamid.agent', type: 'text', text: { body: 'Resposta MBA' } };
    const delivered = { id: echo.id, status: 'delivered', timestamp: '1700000001' };
    const callback = (values: object, field = 'standby', phoneNumberId = '200') => Buffer.from(JSON.stringify({
      object: 'whatsapp_business_account', entry: [{ id: '100', changes: [
        { field, value: { ...values, metadata: { phone_number_id: phoneNumberId } } },
      ] }],
    }));
    const raw = callback({ messages: [customer], message_echoes: [echo], statuses: [delivered] });
    assert.equal(await observer.execute('Basic errada', raw, correlationId), 401);
    assert.equal(await observer.execute(binding.authorization, callback({ messages: [customer] }, 'standby', '999'), correlationId), 400);
    assert.equal(await observer.execute(binding.authorization, Buffer.alloc(1048577), correlationId), 413);
    assert.deepEqual(await db.query('SELECT payload_hash FROM whatsapp_webhook WHERE tenant_id=$1', [tenantId]), []);
    assert.deepEqual(await Promise.all([
      observer.execute(binding.authorization, raw, correlationId),
      observer.execute(binding.authorization, raw, correlationId),
    ]), [200, 200]);
    assert.equal(await observer.execute(binding.authorization, callback({ statuses: [delivered] }), correlationId), 200);
    assert.equal(await observer.execute(binding.authorization, callback({ messages: [customer] }, 'messages'), correlationId), 200);
    const observations = await db.query(`
      SELECT field, kind, provider_id, sender_id, text_body, delivery_status
      FROM whatsapp_observation WHERE tenant_id=$1 ORDER BY field, kind`, [tenantId]);
    assert.deepEqual(observations, [
      { field: 'messages', kind: 'customer', provider_id: customer.id, sender_id: customer.from, text_body: ' Olá ', delivery_status: null },
      { field: 'standby', kind: 'customer', provider_id: customer.id, sender_id: customer.from, text_body: ' Olá ', delivery_status: null },
      { field: 'standby', kind: 'mba_echo', provider_id: echo.id, sender_id: null, text_body: 'Resposta MBA', delivery_status: null },
      { field: 'standby', kind: 'status', provider_id: echo.id, sender_id: null, text_body: null, delivery_status: 'delivered' },
    ]);
    const [preserved] = await db.query('SELECT payload FROM whatsapp_webhook WHERE tenant_id=$1 AND payload=$2', [tenantId, raw]);
    assert.deepEqual(preserved.payload, raw);
    assert.deepEqual(await db.query('SELECT id FROM reply_outbox WHERE tenant_id=$1', [tenantId]), []);

    const store = new PostgresMessagingStore(db);
    const context = { tenantId, principalId: 'fixture-a9', correlationId, scopes: ['inbound:write', 'outbound:dispatch'] };
    const intake = await new ReceiveInbound(store).execute(context, {
      integrationId, channel: 'whatsapp', externalSessionId: customer.from, eventId: 'fixture-saida', text: 'Olá',
    });
    assert.ok(intake.ok);
    const fakeFetch: typeof fetch = async (input, init) => {
      assert.equal(input, 'https://waba-v2.360dialog.io/messages');
      assert.equal(init?.method, 'POST');
      assert.equal(init?.redirect, 'error');
      assert.equal(new Headers(init?.headers).get('D360-API-KEY'), 'fake-key');
      assert.deepEqual(JSON.parse(String(init?.body)), {
        messaging_product: 'whatsapp', recipient_type: 'individual',
        to: customer.from, type: 'text', text: { body: 'Simulado: Olá' },
      });
      return Response.json({ messages: [{ id: 'wamid.fixture' }] });
    };
    const send = new SendWhatsappText(async dispatch => {
      assert.equal(dispatch.tenantId, tenantId);
      assert.equal(dispatch.integrationId, integrationId);
      return { apiKey: 'fake-key', control: 'PLATFORM', textWindowOpen: true };
    }, fakeFetch);
    assert.deepEqual(await new DispatchReply(store, send).execute(context, intake.data.dispatchId),
      { ok: true, data: { status: 'accepted', providerId: 'wamid.fixture' } });
    const [result] = await db.query('SELECT status, provider_id FROM reply_outbox WHERE tenant_id=$1 AND id=$2',
      [tenantId, intake.data.dispatchId]);
    assert.deepEqual(result, { status: 'accepted', provider_id: 'wamid.fixture' });
  } finally {
    await db.destroy();
  }
});

test('WhatsApp bloqueia controle incerto ou janela fechada e não repete falha de transporte', async () => {
  const dispatch = { id: '1', tenantId: 'tenant', integrationId: 'wa', channel: 'whatsapp' as const,
    externalSessionId: '5511999999999', correlationId: 'corr', text: 'Olá' };
  const blockedFetch: typeof fetch = async () => assert.fail('Envio deveria estar bloqueado');
  for (const access of [
    { control: 'MBA' as const, textWindowOpen: true },
    { control: 'UNKNOWN' as const, textWindowOpen: true },
    { control: 'PLATFORM' as const, textWindowOpen: false },
  ]) {
    const channel = new SendWhatsappText(async () => ({ apiKey: 'fake', ...access }), blockedFetch);
    assert.deepEqual(await channel.send(dispatch), { status: 'rejected' });
  }
  const authorize = async () => ({ apiKey: 'fake', control: 'PLATFORM' as const, textWindowOpen: true });
  let calls = 0;
  const failing = new SendWhatsappText(authorize, async () => { calls++; throw new Error('timeout'); });
  assert.deepEqual(await failing.send(dispatch), { status: 'unknown' });
  assert.equal(calls, 1);
  const bad = new SendWhatsappText(authorize, async () => new Response(null, { status: 400 }));
  assert.deepEqual(await bad.send(dispatch), { status: 'rejected' });
  const ambiguous = new SendWhatsappText(authorize, async () => Response.json({ messages: [] }));
  assert.deepEqual(await ambiguous.send(dispatch), { status: 'unknown' });
});
