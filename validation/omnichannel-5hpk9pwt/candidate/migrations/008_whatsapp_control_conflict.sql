-- Cada combinação de evidência e conteúdo conflitante representa uma ocorrência.
-- A referência ao primeiro evento e ao webhook mantém o histórico auditável.
CREATE TABLE whatsapp_control_conflict (
  tenant_id uuid NOT NULL,
  integration_id uuid NOT NULL,
  phone_number_id text NOT NULL,
  event_key text NOT NULL,
  payload_hash text NOT NULL,
  contact_id text,
  kind text NOT NULL,
  provider_order text,
  details jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (tenant_id, integration_id, phone_number_id, event_key)
    REFERENCES whatsapp_control_event (tenant_id, integration_id, phone_number_id, event_key),
  FOREIGN KEY (tenant_id, integration_id, payload_hash) REFERENCES whatsapp_webhook,
  CHECK (contact_id IS NULL OR contact_id ~ '^[0-9]{7,15}$')
);

-- NULLs são tratados como valores iguais para deduplicar ocorrências sem
-- contato ou ordem. A comparação exata de JSONB evita colisões por hash.
CREATE UNIQUE INDEX whatsapp_control_conflict_occurrence
  ON whatsapp_control_conflict (tenant_id, integration_id, phone_number_id, event_key,
    payload_hash, coalesce(contact_id, ''), kind, coalesce(provider_order, ''), details);
