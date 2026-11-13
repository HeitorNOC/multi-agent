CREATE TABLE whatsapp_webhook (
  tenant_id uuid NOT NULL,
  integration_id uuid NOT NULL,
  channel text NOT NULL DEFAULT 'whatsapp' CHECK (channel = 'whatsapp'),
  payload_hash text NOT NULL,
  payload bytea NOT NULL,
  correlation_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, integration_id, payload_hash),
  FOREIGN KEY (tenant_id, integration_id, channel) REFERENCES channel_integration
);

CREATE TABLE whatsapp_observation (
  tenant_id uuid NOT NULL,
  integration_id uuid NOT NULL,
  event_key text NOT NULL,
  payload_hash text NOT NULL,
  field text NOT NULL,
  kind text NOT NULL,
  provider_id text NOT NULL,
  sender_id text,
  text_body text,
  delivery_status text,
  details jsonb NOT NULL,
  PRIMARY KEY (tenant_id, integration_id, event_key),
  FOREIGN KEY (tenant_id, integration_id, payload_hash) REFERENCES whatsapp_webhook
);
CREATE INDEX whatsapp_observation_webhook ON whatsapp_observation (tenant_id, integration_id, payload_hash);
