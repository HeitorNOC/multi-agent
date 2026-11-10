ALTER TABLE reply_outbox
  ADD COLUMN published_at timestamptz,
  ADD COLUMN publish_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN publish_error text;

CREATE INDEX outbox_publish_pending ON reply_outbox (message_sequence)
  WHERE published_at IS NULL AND status = 'queued' AND message_sequence IS NOT NULL;
CREATE INDEX outbox_session_order ON reply_outbox (tenant_id, session_id, message_sequence);

CREATE TABLE kafka_dispatch_quarantine (
  topic text NOT NULL,
  partition_id integer NOT NULL,
  broker_offset bigint NOT NULL,
  reason text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (topic, partition_id, broker_offset)
);
