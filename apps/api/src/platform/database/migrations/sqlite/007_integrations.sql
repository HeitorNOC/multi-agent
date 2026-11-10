-- Conexões da empresa com conectores (módulo integrations). A trilha de cada conexão fica em events.
CREATE TABLE connections (
  id            TEXT PRIMARY KEY,
  connector_id  TEXT NOT NULL,
  name          TEXT NOT NULL,
  -- Configuração do conector em JSON (nunca credenciais).
  config        TEXT NOT NULL,
  can_read      INTEGER NOT NULL,
  can_write     INTEGER NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('active', 'disconnected')),
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  ordinal       INTEGER NOT NULL UNIQUE
);
