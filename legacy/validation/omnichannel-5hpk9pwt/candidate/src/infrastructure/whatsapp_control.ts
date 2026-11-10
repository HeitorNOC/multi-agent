import type { DataSource } from 'typeorm';

type ControlEvent = {
  tenantId: string;
  integrationId: string;
  phoneNumberId: string;
  eventKey: string;
  payloadHash: string;
  contactId?: string;
  kind: 'standby' | 'handoff_started' | 'messages' | 'insufficient';
  providerOrder?: string;
  details: Record<string, unknown>;
};

/**
 * Contrato de fixture: eventKey identifica uma ocorrência do provedor dentro
 * do número; providerOrder é um inteiro decimal monotônico por conversa.
 * A validade dessa ordem na conta real ainda exige homologação. O webhook
 * referido por payloadHash deve já estar persistido. A correspondência entre
 * seus bytes e os campos normalizados ainda exige validação específica.
 *
 * O primeiro evento ordenado pode estabelecer mba ou transitioning. Evento
 * sem ordem ou não posterior torna o controle unknown e preserva a última
 * ordem confiável. Unknown existente permanece bloqueado até reconciliação
 * com evidência. Messages e eventos insuficientes não comprovam transferência.
 * Uma ocorrência conflitante nova torna unknown todos os contatos envolvidos,
 * sem alterar sua ordem; uma repetição idêntica não altera novamente o controle.
 */
class PersistWhatsappControlEvent {
  constructor(private readonly database: DataSource) {}

  async execute(event: ControlEvent): Promise<'applied' | 'duplicate' | 'unassociated'> {
    if (!event.eventKey || !event.phoneNumberId || !event.payloadHash ||
        (event.providerOrder !== undefined && !/^(0|[1-9][0-9]{0,39})$/.test(event.providerOrder))) {
      throw new Error('INVALID_CONTROL_EVENT');
    }
    const contact = event.contactId && /^[0-9]{7,15}$/.test(event.contactId)
      ? event.contactId : null;
    const details = JSON.stringify(event.details);
    if (details === undefined) throw new Error('INVALID_CONTROL_DETAILS');

    return this.database.transaction(async manager => {
      const key = [event.tenantId, event.integrationId, event.phoneNumberId];
      const [binding] = await manager.query(`
        SELECT 1 FROM whatsapp_phone_binding
        WHERE tenant_id=$1 AND integration_id=$2 AND phone_number_id=$3
        FOR KEY SHARE`, key);
      if (!binding) throw new Error('WHATSAPP_PHONE_BINDING_REQUIRED');

      const [payload] = await manager.query(`
        SELECT 1 FROM whatsapp_webhook
        WHERE tenant_id=$1 AND integration_id=$2 AND payload_hash=$3
        FOR KEY SHARE`, [event.tenantId, event.integrationId, event.payloadHash]);
      if (!payload) throw new Error('WHATSAPP_WEBHOOK_PAYLOAD_REQUIRED');

      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [JSON.stringify([...key, event.eventKey])]);

      const [prior] = await manager.query(`
        SELECT contact_id AS contact, kind, provider_order AS ordering,
          details=$5::jsonb AS same_details
        FROM whatsapp_control_event
        WHERE tenant_id=$1 AND integration_id=$2 AND phone_number_id=$3 AND event_key=$4`,
      [...key, event.eventKey, details]) as
        { contact: string | null; kind: string; ordering: string | null; same_details: boolean }[];

      if (prior && prior.contact === contact && prior.kind === event.kind &&
          prior.ordering === (event.providerOrder ?? null) && prior.same_details) return 'duplicate';

      if (prior) {
        const inserted = await manager.query(`
          INSERT INTO whatsapp_control_conflict
            (tenant_id,integration_id,phone_number_id,event_key,payload_hash,contact_id,kind,provider_order,details)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
          ON CONFLICT DO NOTHING RETURNING event_key`,
        [...key, event.eventKey, event.payloadHash, contact, event.kind, event.providerOrder ?? null, details]);
        if (!inserted.length) return 'duplicate';
      }

      // Ordenação estável evita deadlocks quando uma chave envolve dois contatos.
      const contacts = [...new Set([contact, prior?.contact ?? null].filter(
        (value): value is string => value !== null))].sort();
      const created = new Set<string>();
      for (const id of contacts) {
        const inserted = await manager.query(`
          INSERT INTO whatsapp_conversation_control
            (tenant_id,integration_id,phone_number_id,contact_id)
          VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING contact_id`, [...key, id]);
        if (inserted.length) created.add(id);
        await manager.query(`
          SELECT control FROM whatsapp_conversation_control
          WHERE tenant_id=$1 AND integration_id=$2 AND phone_number_id=$3 AND contact_id=$4
          FOR UPDATE`, [...key, id]);
      }

      if (prior) {
        for (const id of contacts) {
          await manager.query(`UPDATE whatsapp_conversation_control
            SET control='unknown', version=version+1
            WHERE tenant_id=$1 AND integration_id=$2 AND phone_number_id=$3 AND contact_id=$4`,
          [...key, id]);
        }
        return 'applied';
      }

      await manager.query(`
        INSERT INTO whatsapp_control_event
          (tenant_id,integration_id,phone_number_id,event_key,payload_hash,contact_id,kind,provider_order,details)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
      [...key, event.eventKey, event.payloadHash, contact, event.kind, event.providerOrder ?? null, details]);
      if (!contact) return 'unassociated';

      const [current] = await manager.query(`
        SELECT control, provider_order AS ordering FROM whatsapp_conversation_control
        WHERE tenant_id=$1 AND integration_id=$2 AND phone_number_id=$3 AND contact_id=$4`,
      [...key, contact]) as { control: string; ordering: string | null }[];
      const ordered = event.providerOrder !== undefined &&
        (current.ordering === null || (/^(0|[1-9][0-9]{0,39})$/.test(current.ordering) &&
          BigInt(event.providerOrder) > BigInt(current.ordering)));
      const eligible = created.has(contact) || current.control !== 'unknown';
      const next = !ordered || !eligible ? 'unknown' : event.kind === 'standby' ? 'mba' :
        event.kind === 'handoff_started' ? 'transitioning' : 'unknown';
      const ordering = ordered && eligible ? event.providerOrder : current.ordering;
      await manager.query(`UPDATE whatsapp_conversation_control
        SET control=$5, version=version+1, provider_order=$6
        WHERE tenant_id=$1 AND integration_id=$2 AND phone_number_id=$3 AND contact_id=$4`,
      [...key, contact, next, ordering ?? null]);
      return 'applied';
    });
  }
}

export { PersistWhatsappControlEvent };
export type { ControlEvent };
