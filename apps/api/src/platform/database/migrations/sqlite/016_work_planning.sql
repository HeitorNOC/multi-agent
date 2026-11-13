-- N2: planejamento na conversa. O Chief entende o pedido, escreve os requisitos e propõe o plano;
-- o CEO aprova, ajusta ou cancela. Aprovado, o trabalho nasce com o time do plano (`jobs.preset`).
ALTER TABLE jobs ADD COLUMN preset TEXT;

CREATE TABLE work_plans (
  id               TEXT PRIMARY KEY,
  conversation_id  TEXT NOT NULL,
  -- Mensagem do CEO que começou o planejamento e resposta do Chief com a versão atual.
  origin_seq       INTEGER NOT NULL,
  reply_seq        INTEGER NOT NULL,
  offer_id         TEXT NOT NULL,
  version          INTEGER NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('drafting', 'specifying', 'proposed', 'approved', 'cancelled')),
  brief            TEXT NOT NULL,
  questions        TEXT NOT NULL,
  plan             TEXT,
  job_id           TEXT,
  decided_by       TEXT,
  decided_at       TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX work_plans_conversation ON work_plans (conversation_id, status);

-- Especificação delegada aos diretores: cada um detalha a sua parte de uma versão do plano, em
-- segundo plano; depois o Chief consolida numa versão nova. Uma linha por diretor e versão.
CREATE TABLE plan_specs (
  plan_id     TEXT NOT NULL,
  version     INTEGER NOT NULL,
  agent_id    TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('pending', 'done', 'failed')),
  output      TEXT,
  error       TEXT,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (plan_id, version, agent_id)
);
