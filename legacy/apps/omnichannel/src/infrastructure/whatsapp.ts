import { createHash, timingSafeEqual } from 'node:crypto';
import type { DataSource } from 'typeorm';
import type { Dispatch, Receipt, TestChannel } from '../domain/messaging.js';

type WebhookBinding = {
  tenantId: string;
  integrationId: string;
  wabaId: string;
  phoneNumberId: string;
  authorization: string;
};
type JsonObject = Record<string, unknown>;
type Observation = {
  key: string;
  field: string;
  kind: 'customer' | 'mba_echo' | 'status';
  providerId: string;
  details: JsonObject;
};
type ObservedPayload = { observations: Observation[] };

const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest();

function object(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonObject : undefined;
}

function parsePayload(raw: Uint8Array, binding: WebhookBinding): ObservedPayload | undefined {
  let payload: JsonObject | undefined;
  try {
    payload = object(JSON.parse(Buffer.from(raw).toString('utf8')));
  } catch {
    return undefined;
  }
  if (payload?.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry) || !payload.entry.length) return undefined;
  const observations: Observation[] = [];
  for (const entry of payload.entry) {
    const account = object(entry);
    if (account?.id !== binding.wabaId || !Array.isArray(account.changes) || !account.changes.length) return undefined;
    for (const rawChange of account.changes) {
      const change = object(rawChange);
      const value = object(change?.value);
      if (!value || object(value.metadata)?.phone_number_id !== binding.phoneNumberId ||
          typeof change?.field !== 'string') return undefined;
      const field = change.field;
      if (field !== 'messages' && field !== 'standby') continue;
      const categories = [
        ['messages', 'customer'], ['statuses', 'status'],
        ...(field === 'standby' ? [['message_echoes', 'mba_echo']] : []),
      ] as [string, Observation['kind']][];
      for (const [name, kind] of categories) {
        const items = value[name];
        if (!Array.isArray(items)) continue;
        for (const item of items) {
          const details = object(item);
          const id = details?.id;
          if (!details || typeof id !== 'string' || !id.trim()) continue;
          const identity = [field, kind, id];
          if (kind === 'status') {
            if (typeof details.status !== 'string' || typeof details.timestamp !== 'string') continue;
            identity.push(details.status, details.timestamp);
          }
          observations.push({ key: digest(JSON.stringify(identity)).toString('hex'), field, kind, providerId: id, details });
        }
      }
    }
  }
  return { observations };
}

class ObserveWhatsappWebhook {
  constructor(private readonly database: DataSource, private readonly binding: WebhookBinding) {
    if (!binding.authorization.startsWith('Basic ') || binding.authorization.length <= 6) {
      throw new Error('Configure a autenticação do webhook.');
    }
  }

  async execute(authorization: string, raw: Uint8Array, correlationId: string): Promise<200 | 400 | 401 | 413> {
    if (!timingSafeEqual(digest(authorization), digest(this.binding.authorization))) return 401;
    if (raw.byteLength > 1048576) return 413;
    const payload = parsePayload(raw, this.binding);
    if (!payload) return 400;
    const { tenantId, integrationId } = this.binding;
    const hash = digest(raw).toString('hex');
    await this.database.transaction(async manager => {
      await manager.query(`
        INSERT INTO whatsapp_webhook (tenant_id, integration_id, payload_hash, payload, correlation_id)
        VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [tenantId, integrationId, hash, Buffer.from(raw), correlationId]);
      await manager.query(`
        INSERT INTO whatsapp_observation (tenant_id, integration_id, event_key, payload_hash,
          field, kind, provider_id, sender_id, text_body, delivery_status, details)
        SELECT $1, $2, e.key, $3, e.field, e.kind, e."providerId",
          CASE WHEN jsonb_typeof(e.details->'from')='string' THEN e.details->>'from' END,
          CASE WHEN jsonb_typeof(e.details#>'{text,body}')='string' THEN e.details#>>'{text,body}' END,
          CASE WHEN jsonb_typeof(e.details->'status')='string' THEN e.details->>'status' END,
          e.details
        FROM jsonb_to_recordset($4::jsonb)
          AS e(key text, field text, kind text, "providerId" text, details jsonb)
        ORDER BY e.key ON CONFLICT DO NOTHING`,
      [tenantId, integrationId, hash, JSON.stringify(payload.observations)]);
    });
    return 200;
  }
}

type AuthorizeSend = (dispatch: Dispatch) => Promise<{
  apiKey: string;
  control: 'PLATFORM' | 'MBA' | 'UNKNOWN';
  textWindowOpen: boolean;
} | undefined>;

class SendWhatsappText implements TestChannel {
  constructor(private readonly authorize: AuthorizeSend, private readonly request: typeof fetch = fetch) {}

  async send(dispatch: Dispatch): Promise<Receipt> {
    if (dispatch.channel !== 'whatsapp' || !/^\d{7,15}$/.test(dispatch.externalSessionId) ||
        !dispatch.text.trim() || [...dispatch.text].length > 4096) return { status: 'rejected' };
    const access = await this.authorize(dispatch);
    if (!access?.apiKey || access.control !== 'PLATFORM' || !access.textWindowOpen) return { status: 'rejected' };
    try {
      const response = await this.request('https://waba-v2.360dialog.io/messages', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
        headers: { 'D360-API-KEY': access.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp', recipient_type: 'individual',
          to: dispatch.externalSessionId, type: 'text', text: { body: dispatch.text },
        }),
      });
      if ([400, 401, 403, 404].includes(response.status)) return { status: 'rejected' };
      if (!response.ok) return { status: 'unknown' };
      const body = object(await response.json());
      const id = Array.isArray(body?.messages) ? object(body.messages[0])?.id : undefined;
      if (typeof id === 'string' && id.startsWith('wamid.') && id.length > 6) {
        return { status: 'accepted', providerId: id };
      }
    } catch {
      return { status: 'unknown' };
    }
    return { status: 'unknown' };
  }
}

export { ObserveWhatsappWebhook, SendWhatsappText };
