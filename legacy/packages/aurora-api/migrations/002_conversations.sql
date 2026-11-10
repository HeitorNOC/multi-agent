-- Conversa com o Chief of Staff (E2). Espelha o esquema do adaptador SQLite.
CREATE TABLE IF NOT EXISTS conversations (
  id       TEXT PRIMARY KEY,
  actor    TEXT NOT NULL,
  title    TEXT NOT NULL,
  created  TEXT NOT NULL,
  updated  TEXT NOT NULL,
  -- Ordem de criacao (equivale ao rowid do SQLite); desempata conversas atualizadas no mesmo instante.
  ordinal  BIGSERIAL
);
CREATE INDEX IF NOT EXISTS conversations_actor_idx ON conversations (actor, updated DESC);

CREATE TABLE IF NOT EXISTS conversation_messages (
  seq           BIGSERIAL PRIMARY KEY,
  conversation  TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('user', 'chief')),
  text          TEXT NOT NULL,
  job           TEXT,
  client_id     TEXT,
  reply_to      BIGINT,
  created       TEXT NOT NULL,
  UNIQUE (conversation, client_id)
);
CREATE INDEX IF NOT EXISTS conversation_messages_conversation_idx ON conversation_messages (conversation, seq);
