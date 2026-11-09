-- Base para o contrato local de A9/A10. A aplicação deve bloquear a linha
-- da conversa em uma transação antes de alterar controle ou reservar envio.
-- Nenhuma chamada externa deve ocorrer dentro dessa transação.
CREATE TABLE whatsapp_conversation_control (
  tenant_id uuid NOT NULL,
  integration_id uuid NOT NULL,
  channel text NOT NULL DEFAULT 'whatsapp' CHECK (channel = 'whatsapp'),
  phone_number_id text NOT NULL CHECK (phone_number_id <> ''),
  contact_id text NOT NULL CHECK (contact_id ~ '^[0-9]{7,15}$'),
  control text NOT NULL DEFAULT 'unknown'
    CHECK (control IN ('partner', 'mba', 'transitioning', 'unknown')),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  provider_order text,
  reservation_id uuid,
  reservation_kind text CHECK (reservation_kind IN ('send', 'handoff')),
  reserved_at timestamptz,
  PRIMARY KEY (tenant_id, integration_id, phone_number_id, contact_id),
  FOREIGN KEY (tenant_id, integration_id, channel) REFERENCES channel_integration,
  CHECK ((reservation_id IS NULL AND reservation_kind IS NULL AND reserved_at IS NULL) OR
         (reservation_id IS NOT NULL AND reservation_kind IS NOT NULL AND reserved_at IS NOT NULL))
);

CREATE TABLE whatsapp_dispatch_intent (
  tenant_id uuid NOT NULL,
  integration_id uuid NOT NULL,
  phone_number_id text NOT NULL,
  contact_id text NOT NULL,
  id uuid NOT NULL,
  reservation_id uuid NOT NULL,
  control_version bigint NOT NULL CHECK (control_version >= 0),
  state text NOT NULL CHECK (state IN ('reserved', 'in_flight', 'accepted', 'rejected', 'unknown')),
  provider_message_id text,
  delivery_status text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, integration_id, id),
  UNIQUE (tenant_id, integration_id, reservation_id),
  FOREIGN KEY (tenant_id, integration_id, phone_number_id, contact_id)
    REFERENCES whatsapp_conversation_control (tenant_id, integration_id, phone_number_id, contact_id),
  CHECK ((state = 'accepted') = (provider_message_id IS NOT NULL))
);

-- A unicidade impede atribuição ambígua de um ID do provedor no mesmo canal.
CREATE UNIQUE INDEX whatsapp_dispatch_provider_identity
  ON whatsapp_dispatch_intent (tenant_id, integration_id, phone_number_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- Eventos sem despacho correspondente permanecem disponíveis para reconciliação.
-- A chave deve ser calculada deterministicamente pelo adaptador a partir da
-- identidade do provedor ou dos campos que distinguem a ocorrência.
CREATE TABLE whatsapp_control_event (
  tenant_id uuid NOT NULL,
  integration_id uuid NOT NULL,
  phone_number_id text NOT NULL,
  event_key text NOT NULL CHECK (event_key <> ''),
  payload_hash text NOT NULL,
  contact_id text,
  provider_message_id text,
  kind text NOT NULL,
  provider_order text,
  details jsonb NOT NULL,
  dispatch_id uuid,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, integration_id, phone_number_id, event_key),
  FOREIGN KEY (tenant_id, integration_id, payload_hash) REFERENCES whatsapp_webhook,
  FOREIGN KEY (tenant_id, integration_id, dispatch_id)
    REFERENCES whatsapp_dispatch_intent (tenant_id, integration_id, id),
  CHECK (contact_id IS NULL OR contact_id ~ '^[0-9]{7,15}$')
);

CREATE INDEX whatsapp_control_event_pending_status
  ON whatsapp_control_event (tenant_id, integration_id, phone_number_id, provider_message_id)
  WHERE kind = 'status' AND dispatch_id IS NULL;
