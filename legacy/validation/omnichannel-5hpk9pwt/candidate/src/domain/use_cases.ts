import type { Context, HistoryItem, Inbound, Intake, MessagingStore, Outcome, Receipt,
  RecoveryItem, RecoveryReceipt, TestChannel } from './messaging.js';

const denied = { ok: false, code: 1, message: 'Operação não autorizada.' } as const;
const unavailable = { ok: false, code: 1, message: 'Envio indisponível para despacho.' } as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class ReceiveInbound {
  constructor(private readonly store: MessagingStore) {}

  async execute(context: Context, input: Inbound): Promise<Outcome<Intake>> {
    if (!context.scopes.includes('inbound:write')) return denied;
    const fields = [input?.integrationId, input?.externalSessionId, input?.eventId, input?.text];
    if (fields.some(value => typeof value !== 'string' || !value.trim()) ||
        !uuid.test(input.integrationId) || input.externalSessionId.length > 200 ||
        input.eventId.length > 200 || input.text.length > 4000 ||
        !['whatsapp', 'webchat'].includes(input.channel)) {
      return { ok: false, code: 1, message: 'Revise os dados da mensagem.' };
    }
    const result = await this.store.ingest(context, input, `Simulado: ${input.text.trim()}`);
    if (result === 'forbidden') return denied;
    if (result === 'conflict') return { ok: false, code: 1, message: 'O evento já foi recebido com outros dados.' };
    return { ok: true, data: result };
  }
}

class DispatchReply {
  constructor(private readonly store: MessagingStore, private readonly channel: TestChannel) {}

  async execute(context: Context, id: string): Promise<Outcome<Receipt>> {
    if (!context.scopes.includes('outbound:dispatch')) return denied;
    if (!uuid.test(id)) return unavailable;
    const dispatch = await this.store.claim(context, id);
    if (!dispatch) return unavailable;
    let result: Receipt;
    try {
      result = await this.channel.send(dispatch);
    } catch {
      result = { status: 'unknown' };
    }
    if (!await this.store.settle(context, id, result)) throw new Error('OUTBOX_SETTLEMENT_CONFLICT');
    return { ok: true, data: result };
  }
}

class ReadHistory {
  constructor(private readonly store: MessagingStore) {}

  async execute(context: Context, sessionId: string, cursor = '0', limit = 50): Promise<Outcome<HistoryItem[]>> {
    if (!context.scopes.includes('history:read')) return denied;
    if (!uuid.test(sessionId) || !/^\d{1,19}$/.test(cursor) || BigInt(cursor) > 9223372036854775807n ||
        !Number.isInteger(limit) || limit < 1 || limit > 100) {
      return { ok: false, code: 1, message: 'Revise os parâmetros do histórico.' };
    }
    return { ok: true, data: await this.store.history(context, sessionId, cursor, limit) };
  }
}

class ListRecoverableDispatches {
  constructor(private readonly store: MessagingStore) {}

  async execute(context: Context): Promise<Outcome<RecoveryItem[]>> {
    if (!context.scopes.includes('outbound:reconcile')) return denied;
    return { ok: true, data: await this.store.recoverable(context) };
  }
}

class ReconcileDispatch {
  constructor(private readonly store: MessagingStore) {}

  async execute(context: Context, id: string, evidence: string, receipt: RecoveryReceipt): Promise<Outcome<null>> {
    if (!context.scopes.includes('outbound:reconcile')) return denied;
    if (!uuid.test(id) || typeof evidence !== 'string' || !evidence.trim() || evidence.length > 200 ||
        (receipt?.status !== 'accepted' && receipt?.status !== 'rejected') ||
        (receipt.status === 'accepted' && (typeof receipt.providerId !== 'string' ||
          !receipt.providerId.trim() || receipt.providerId.length > 200))) {
      return { ok: false, code: 1, message: 'Informe uma evidência e um resultado válidos.' };
    }
    if (!await this.store.reconcile(context, id, evidence.trim(), receipt)) {
      return { ok: false, code: 1, message: 'Envio indisponível para reconciliação.' };
    }
    return { ok: true, data: null };
  }
}

export { ReceiveInbound, DispatchReply, ReadHistory, ListRecoverableDispatches, ReconcileDispatch };
