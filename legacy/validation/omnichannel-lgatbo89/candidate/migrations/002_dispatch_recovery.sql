ALTER TABLE reply_outbox
  ADD COLUMN message_sequence bigint,
  ADD COLUMN claimed_at timestamptz,
  ADD COLUMN recovery_evidence text,
  ADD COLUMN recovery_principal text,
  ADD COLUMN recovery_correlation text;

UPDATE reply_outbox SET claimed_at = clock_timestamp()
WHERE status IN ('in_flight', 'unknown');

WITH candidates AS (
  SELECT o.tenant_id, o.id, m.sequence,
    count(*) OVER (PARTITION BY o.tenant_id, o.id) AS messages,
    count(*) OVER (PARTITION BY m.sequence) AS dispatches
  FROM reply_outbox o
  JOIN conversation_message m ON m.tenant_id = o.tenant_id AND m.session_id = o.session_id
    AND m.correlation_id = o.correlation_id AND m.content = o.content AND m.direction = 'out'
)
UPDATE reply_outbox o SET message_sequence = c.sequence
FROM candidates c
WHERE o.tenant_id = c.tenant_id AND o.id = c.id AND c.messages = 1 AND c.dispatches = 1;

DROP INDEX conversation_history;
CREATE UNIQUE INDEX conversation_history ON conversation_message (tenant_id, session_id, sequence);
ALTER TABLE reply_outbox ADD CONSTRAINT outbox_history_message
  FOREIGN KEY (tenant_id, session_id, message_sequence)
  REFERENCES conversation_message (tenant_id, session_id, sequence);
CREATE UNIQUE INDEX outbox_message_once ON reply_outbox (message_sequence) WHERE message_sequence IS NOT NULL;
CREATE INDEX outbox_recovery ON reply_outbox (tenant_id, claimed_at, id)
  WHERE status IN ('in_flight', 'unknown');
