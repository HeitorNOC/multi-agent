-- Trabalhos, trilha de eventos, fila, admissões e recibos (módulo jobs).
CREATE TABLE jobs (
  id          TEXT PRIMARY KEY,
  goal        TEXT NOT NULL,
  status      TEXT NOT NULL,
  plan        TEXT,
  review      TEXT,
  approval    TEXT,
  receipt     TEXT,
  error       TEXT,
  created_at  TEXT NOT NULL,
  ordinal     BIGINT NOT NULL UNIQUE,
  version     INTEGER NOT NULL
);
CREATE INDEX jobs_status ON jobs (status);

-- Trilha append-only. `stream` agrupa eventos: um trabalho, uma conversa, o Cérebro…
CREATE TABLE events (
  seq          BIGSERIAL PRIMARY KEY,
  stream       TEXT NOT NULL,
  kind         TEXT NOT NULL,
  detail       TEXT NOT NULL,
  event_id     TEXT NOT NULL UNIQUE,
  payload_sha  TEXT NOT NULL,
  occurred_at  TEXT NOT NULL,
  recorded_at  TEXT NOT NULL
);
CREATE INDEX events_stream ON events (stream, seq);

CREATE TABLE job_queue (
  seq                 BIGSERIAL PRIMARY KEY,
  job_id              TEXT NOT NULL UNIQUE,
  kind                TEXT NOT NULL CHECK (kind IN ('new', 'resume')),
  crash_after_effect  SMALLINT NOT NULL,
  queued_at           TEXT NOT NULL
);

CREATE TABLE admissions (
  key     TEXT PRIMARY KEY,
  job_id  TEXT NOT NULL
);

CREATE TABLE effect_receipts (
  job_id   TEXT PRIMARY KEY,
  hash     TEXT NOT NULL,
  receipt  TEXT NOT NULL
);

CREATE TABLE inference_receipts (
  job_id      TEXT NOT NULL,
  slot        TEXT NOT NULL,
  input_sha   TEXT NOT NULL,
  state       TEXT NOT NULL CHECK (state IN ('reserved', 'completed')),
  output      TEXT,
  usage       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  ordinal     BIGINT NOT NULL,
  PRIMARY KEY (job_id, slot)
);
