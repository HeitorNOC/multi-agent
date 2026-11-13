import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Core } from './core.ts';
import { DatabaseSync } from 'node:sqlite';

test('fatia local: histórico, idempotência, isolamento e transferência', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fatia-'));
  const path = join(dir, 'local.sqlite');
  let core = new Core(path);
  try {
    const input = { tenant: 'a', integration: 'web', channel: 'webchat' as const, session: 's', message: 'm', text: '  Olá  ', correlation: 'c' };
    core.receive(input);
    core.receive(input);
    const results = await Promise.all([core.respond('a', 'web', 'm'), core.respond('a', 'web', 'm')]);
    assert.deepEqual(results, ['Simulado: Olá', 'Simulado: Olá']);
    assert.deepEqual(core.history('a', 's').map(row => [row.direction, row.text]), [['in', 'Olá'], ['out', 'Simulado: Olá']]);
    assert.equal(JSON.parse(core.history('a', 's')[0].raw).text, '  Olá  ');
    core.receive({ ...input, tenant: 'b', text: 'Outro' });
    assert.deepEqual(core.history('b', 's').map(row => row.text), ['Outro']);
    assert.equal(core.history('b', 'missing').length, 0);
    core.transfer('a', 's', 'transfer-1', 'request');
    core.transfer('a', 's', 'transfer-1', 'request');
    core.receive({ ...input, message: 'm2', text: 'Ajuda' });
    await assert.rejects(core.respond('a', 'web', 'm2'), { message: 'RESPONSE_BLOCKED' });
    core.transfer('a', 's', 'transfer-2', 'confirm');
    await assert.rejects(core.respond('a', 'web', 'm2'), { message: 'RESPONSE_BLOCKED' });
    assert.equal(await core.respond('b', 'web', 'm'), 'Simulado: Outro');
    core.close();
    core = new Core(path);
    assert.deepEqual(core.history('a', 's').map(row => row.text), ['Olá', 'Simulado: Olá', 'Ajuda']);
    assert.deepEqual(core.history('b', 's').map(row => row.text), ['Outro', 'Simulado: Outro']);
    await assert.rejects(core.respond('a', 'web', 'm2'), { message: 'RESPONSE_BLOCKED' });
    core.transfer('a', 's', 'transfer-2', 'confirm');
  } finally { core.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('retoma após contenção e emite somente a resposta humana após a transferência', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'handoff-'));
  const path = join(dir, 'local.sqlite');
  const core = new Core(path);
  const lock = new DatabaseSync(path);
  try {
    core.receive({ tenant: 'a', integration: 'web', channel: 'webchat', session: 's', message: 'm', text: 'Ajuda', correlation: 'c' });
    core.transfer('a', 's', 'transfer-1', 'request');
    await assert.rejects(core.respond('a', 'web', 'm', 'human', 'Posso ajudar'), { message: 'RESPONSE_BLOCKED' });
    lock.exec('BEGIN IMMEDIATE');
    const contenders = Promise.allSettled([
      core.respond('a', 'web', 'm'),
      core.respond('a', 'web', 'm', 'human', 'Posso ajudar'),
    ]);
    assert.equal(core.deliveries('a', 's').length, 0);
    lock.exec('ROLLBACK');
    core.transfer('a', 's', 'transfer-2', 'confirm');
    core.transfer('a', 's', 'transfer-2', 'confirm');
    const [bot, human] = await contenders;
    assert.equal(bot.status, 'rejected');
    if (bot.status === 'rejected') assert.equal(bot.reason.message, 'RESPONSE_BLOCKED');
    assert.deepEqual(human, { status: 'fulfilled', value: 'Posso ajudar' });
    assert.equal(await core.respond('a', 'web', 'm', 'human', 'Posso ajudar'), 'Posso ajudar');
    const reopened = new Core(path);
    try {
      assert.deepEqual(reopened.deliveries('a', 's').map(row => [row.actor, row.text]), [['human', 'Posso ajudar']]);
      assert.equal(reopened.deliveries('b', 's').length, 0);
      assert.equal(reopened.history('a', 's').filter(row => row.direction === 'out').length, 1);
    } finally { reopened.close(); }
  } finally {
    lock.close();
    core.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('retorno exige confirmação da tentativa atual e preserva o controle após reabertura', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'retorno-'));
  const path = join(dir, 'local.sqlite');
  let core = new Core(path);
  const input = { tenant: 'a', integration: 'wa', channel: 'whatsapp' as const, session: 's', message: 'm', text: 'Ajuda', correlation: 'c' };
  try {
    core.receive(input);
    core.transfer('a', 's', 'handoff', 'request');
    assert.deepEqual({ ...core.conversation('a', 's') }, { attendance: 'WAITING', control: 'PENDING' });
    core.transfer('a', 's', 'takeover', 'confirm');
    assert.equal(await core.respond('a', 'wa', 'm', 'human', 'Posso ajudar'), 'Posso ajudar');
    core.returnToBot('a', 's', 'return1', 'request');
    core.receive({ ...input, message: 'm2' });
    const blocked = await Promise.allSettled([
      core.respond('a', 'wa', 'm2'),
      core.respond('a', 'wa', 'm2', 'human', 'Outra resposta'),
    ]);
    assert.deepEqual(blocked.map(result => result.status === 'rejected' && result.reason.message), [
      'RESPONSE_BLOCKED', 'RESPONSE_BLOCKED',
    ]);
    core.returnToBot('a', 's', 'fail1', 'fail', 'return1');
    assert.deepEqual({ ...core.conversation('a', 's') }, { attendance: 'ACTIVE', control: 'HUMAN' });
    core.returnToBot('a', 's', 'return2', 'request');
    core.close();
    core = new Core(path);
    assert.deepEqual({ ...core.conversation('a', 's') }, { attendance: 'ACTIVE', control: 'RETURN_PENDING' });
    assert.throws(() => core.returnToBot('a', 's', 'late1', 'confirm', 'return1'), { message: 'STALE_RETURN' });
    core.returnToBot('a', 's', 'confirm2', 'confirm', 'return2');
    core.returnToBot('a', 's', 'confirm2', 'confirm', 'return2');
    assert.deepEqual({ ...core.conversation('a', 's') }, { attendance: 'DONE', control: 'OPEN' });
    assert.equal(await core.respond('a', 'wa', 'm2'), 'Simulado: Ajuda');
    await assert.rejects(core.respond('a', 'wa', 'm2', 'human', 'Atrasada'), { message: 'RESPONSE_BLOCKED' });
    assert.deepEqual(core.deliveries('a', 's').map(row => row.actor), ['human', 'bot']);
    assert.equal(core.conversation('b', 's'), undefined);
  } finally {
    core.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('despacho preserva o canal original e aguarda reconciliação de aceite incerto', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'despacho-'));
  const path = join(dir, 'local.sqlite');
  let core = new Core(path);
  const key = { tenant: 'a', integration: 'wa', message: 'm' };
  const input = { ...key, channel: 'whatsapp' as const, session: 's', text: 'Ajuda', correlation: 'c' };
  try {
    core.receive(input);
    core.receive({ ...input, message: 'pending' });
    await core.respond('a', 'wa', 'm');
    await core.respond('a', 'wa', 'pending');
    assert.equal(core.deliveryStatus(key)?.status, 'queued');
    assert.deepEqual({ ...core.claimDelivery(key) }, {
      ...key, session: 's', actor: 'bot', text: 'Simulado: Ajuda', channel: 'whatsapp', correlation: 'c',
    });
    core.close();
    core = new Core(path);
    assert.equal(core.deliveryStatus(key)?.status, 'in_flight');
    assert.equal(core.claimDelivery(key), undefined);
    core.recordDeliveryOutcome(key, { status: 'unknown' });
    assert.equal(core.claimDelivery(key), undefined);
    assert.throws(() => core.transfer('a', 's', 'handoff', 'request'), { message: 'DELIVERY_UNRESOLVED' });
    assert.throws(() => core.recordDeliveryOutcome({ ...key, tenant: 'b' }, {
      status: 'accepted', providerMessageId: 'external-1',
    }), { message: 'INVALID_DELIVERY_TRANSITION' });
    const receipt = { status: 'accepted', providerMessageId: 'external-1' } as const;
    core.recordDeliveryOutcome(key, receipt);
    core.recordDeliveryOutcome(key, receipt);
    assert.deepEqual({ ...core.deliveryStatus(key) }, receipt);
    assert.throws(() => core.recordDeliveryOutcome(key, { ...receipt, providerMessageId: 'other' }),
      { message: 'INVALID_DELIVERY_TRANSITION' });
    core.transfer('a', 's', 'handoff', 'request');
    const pending = { ...key, message: 'pending' };
    assert.equal(core.deliveryStatus(pending)?.status, 'cancelled');
    assert.equal(core.claimDelivery(pending), undefined);
    await assert.rejects(core.respond('a', 'wa', 'pending', 'human', 'Posso ajudar'), { message: 'RESPONSE_BLOCKED' });
    core.transfer('a', 's', 'takeover', 'confirm');
    core.close();
    core = new Core(path);
    await assert.rejects(core.respond('a', 'wa', 'm', 'human', 'Resposta duplicada'), { message: 'IDEMPOTENCY_CONFLICT' });
    const replies = await Promise.all([
      core.respond('a', 'wa', 'pending', 'human', 'Posso ajudar'),
      core.respond('a', 'wa', 'pending', 'human', 'Posso ajudar'),
    ]);
    assert.deepEqual(replies, ['Posso ajudar', 'Posso ajudar']);
    await assert.rejects(core.respond('a', 'wa', 'pending'), { message: 'RESPONSE_BLOCKED' });
    assert.deepEqual({ ...core.claimDelivery(pending) }, {
      ...pending, session: 's', actor: 'human', text: 'Posso ajudar', channel: 'whatsapp', correlation: 'c',
    });
    assert.equal(core.claimDelivery(pending), undefined);
    assert.deepEqual(core.history('a', 's').filter(row => row.message === 'pending' && row.direction === 'out').map(row => row.text),
      ['Posso ajudar']);
  } finally {
    core.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
