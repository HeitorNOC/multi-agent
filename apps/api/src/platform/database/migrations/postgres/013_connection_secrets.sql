-- Conectores com login (Google Drive, Gmail, Slack).
-- Segredo de cada conexão (tokens), cifrado com a chave do cofre, que fica fora do banco.
CREATE TABLE connection_secrets (
  connection_id  TEXT PRIMARY KEY REFERENCES connections (id),
  sealed         TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

-- O que cada item externo virou no Cérebro: sincronizar cria versão nova só quando ele mudou.
CREATE TABLE connection_items (
  connection_id  TEXT NOT NULL REFERENCES connections (id),
  external_id    TEXT NOT NULL,
  source_id      TEXT NOT NULL,
  title          TEXT NOT NULL,
  revision       TEXT NOT NULL,
  imported_at    TEXT NOT NULL,
  checked_at     TEXT NOT NULL,
  PRIMARY KEY (connection_id, external_id)
);

-- Problema que impede a conexão de funcionar até alguém agir (por exemplo, `reauth_required`).
ALTER TABLE connections ADD COLUMN problem TEXT;
