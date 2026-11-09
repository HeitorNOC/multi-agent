CREATE TABLE channel_integration (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'webchat')),
  PRIMARY KEY (tenant_id, id, channel)
);

CREATE TABLE channel_session (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  integration_id uuid NOT NULL,
  channel text NOT NULL,
  external_id text NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (id),
  UNIQUE (tenant_id, integration_id, channel, external_id),
  FOREIGN KEY (tenant_id, integration_id, channel) REFERENCES channel_integration
);

CREATE TABLE inbound_event (
  tenant_id uuid NOT NULL,
  integration_id uuid NOT NULL,
  channel text NOT NULL,
  external_id text NOT NULL,
  payload jsonb NOT NULL,
  principal_id text NOT NULL,
  correlation_id text NOT NULL,
  dispatch_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, integration_id, channel, external_id),
  FOREIGN KEY (tenant_id, integration_id, channel) REFERENCES channel_integration
);

CREATE TABLE conversation_message (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL,
  session_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  content text NOT NULL,
  correlation_id text NOT NULL,
  FOREIGN KEY (tenant_id, session_id) REFERENCES channel_session
);
CREATE INDEX conversation_history ON conversation_message (tenant_id, session_id, sequence);

CREATE TABLE reply_outbox (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  session_id uuid NOT NULL,
  content text NOT NULL,
  correlation_id text NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'in_flight', 'accepted', 'rejected', 'unknown')),
  provider_id text,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES channel_session,
  CHECK ((status = 'accepted') = (provider_id IS NOT NULL))
);

ALTER TABLE inbound_event ADD CONSTRAINT inbound_reply_exists
  FOREIGN KEY (tenant_id, dispatch_id) REFERENCES reply_outbox
  DEFERRABLE INITIALLY DEFERRED;
