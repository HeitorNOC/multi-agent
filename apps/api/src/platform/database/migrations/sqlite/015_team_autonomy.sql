-- N1: alçadas do Chief of Staff e contratações feitas por ele.
-- Cada agente diz como entrou: permanente ou só para um trabalho, e quem contratou (CEO ou Chief).
ALTER TABLE agents ADD COLUMN engagement TEXT NOT NULL DEFAULT 'permanent';
ALTER TABLE agents ADD COLUMN engaged_job TEXT;
ALTER TABLE agents ADD COLUMN hired_by TEXT NOT NULL DEFAULT 'ceo';

-- O que o Chief pode fazer sozinho com o time (uma linha; JSON validado pela aplicação).
CREATE TABLE chief_autonomy (
  id          TEXT PRIMARY KEY,
  settings    TEXT NOT NULL,
  updated_by  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Propostas de contratação feitas pelo Chief na conversa, decididas pelo CEO.
CREATE TABLE staffing_proposals (
  id               TEXT PRIMARY KEY,
  conversation_id  TEXT NOT NULL,
  question_seq     INTEGER NOT NULL,
  reply_seq        INTEGER NOT NULL,
  offer_id         TEXT NOT NULL,
  request          TEXT NOT NULL,
  templates        TEXT NOT NULL,
  engagement       TEXT NOT NULL CHECK (engagement IN ('job', 'permanent')),
  status           TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined')),
  job_id           TEXT,
  decided_by       TEXT,
  decided_at       TEXT,
  created_at       TEXT NOT NULL
);
CREATE INDEX staffing_proposals_conversation ON staffing_proposals (conversation_id, reply_seq);
