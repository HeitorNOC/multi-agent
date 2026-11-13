-- Contas de acesso (módulo accounts): quem entra no Aurora, por senha ou por Google/Microsoft.
-- O id da conta é o identificador da pessoa no resto do sistema (dono e leitores de fontes, conversas).
CREATE TABLE accounts (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL,
  -- Hash scrypt com sal; nulo para quem só entra por Google/Microsoft.
  password_hash  TEXT,
  created_at     TEXT NOT NULL,
  disabled_at    TEXT
);

-- Contas externas ligadas (provedor + identificador estável da pessoa nele). Nenhum token é guardado.
CREATE TABLE account_identities (
  provider    TEXT NOT NULL,
  subject     TEXT NOT NULL,
  account_id  TEXT NOT NULL REFERENCES accounts (id),
  created_at  TEXT NOT NULL,
  PRIMARY KEY (provider, subject)
);

-- E-mails liberados pelo dono para criar conta.
CREATE TABLE account_invites (
  email       TEXT PRIMARY KEY,
  role        TEXT NOT NULL,
  invited_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- Sessões: só o hash do token fica no banco; o token vai num cookie HttpOnly.
CREATE TABLE account_sessions (
  token_hash  TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts (id),
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE INDEX account_sessions_account ON account_sessions (account_id);
