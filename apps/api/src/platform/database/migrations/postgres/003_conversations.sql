-- Conversas do gestor com o Chief of Staff (módulo conversations).
CREATE TABLE conversations (
  id          TEXT PRIMARY KEY,
  actor       TEXT NOT NULL,
  title       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  -- Ordem de criação; desempata conversas atualizadas no mesmo instante.
  ordinal     BIGINT NOT NULL UNIQUE
);
CREATE INDEX conversations_actor ON conversations (actor, updated_at);

CREATE TABLE conversation_messages (
  seq              BIGSERIAL PRIMARY KEY,
  conversation_id  TEXT NOT NULL REFERENCES conversations (id),
  role             TEXT NOT NULL CHECK (role IN ('user', 'chief')),
  text             TEXT NOT NULL,
  job_id           TEXT,
  client_id        TEXT,
  reply_to         BIGINT,
  created_at       TEXT NOT NULL,
  UNIQUE (conversation_id, client_id)
);
CREATE INDEX conversation_messages_by_conversation ON conversation_messages (conversation_id, seq);
-- No máximo uma resposta por mensagem do gestor.
CREATE UNIQUE INDEX conversation_messages_reply ON conversation_messages (conversation_id, reply_to);
