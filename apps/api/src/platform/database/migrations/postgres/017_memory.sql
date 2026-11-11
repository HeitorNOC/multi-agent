-- N5: memória. Da conversa (decisões registradas e resumo das mensagens antigas) e da empresa
-- (fatos estáveis que o CEO edita e que todo agente recebe).
CREATE TABLE conversation_memory (
  conversation_id  TEXT PRIMARY KEY,
  summary          TEXT NOT NULL,
  decisions        TEXT NOT NULL,
  summarized_seq   INTEGER NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE company_facts (
  id          TEXT PRIMARY KEY,
  text        TEXT NOT NULL,
  category    TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  ordinal     INTEGER NOT NULL
);
