-- Impede alterações concorrentes entre a verificação e a criação do índice.
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
