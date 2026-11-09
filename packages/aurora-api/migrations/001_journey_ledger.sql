-- Ledger de jornada (hoje journey.sqlite em server.ts) para PostgreSQL.
-- Mapeamento fiel do DDL atual; nenhuma regra de negocio muda nesta migration.
-- AUTOINCREMENT -> BIGSERIAL; INTEGER booleano -> SMALLINT (mantem 0/1 do codigo atual).
-- Datas continuam TEXT (ISO) para preservar o comportamento e os hashes ja gravados.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jobs (
  id       TEXT PRIMARY KEY,
  goal     TEXT,
  status   TEXT,
  plan     TEXT,
  review   TEXT,
  approval TEXT,
  receipt  TEXT,
  error    TEXT,
  created  TEXT
);

-- event_id, payload_sha e recorded_at sao acrescentadas em runtime pela classe Events no SQLite;
-- aqui ja nascem no esquema. event_id unico garante a idempotencia da trilha.
CREATE TABLE IF NOT EXISTS events (
  seq          BIGSERIAL PRIMARY KEY,
  job          TEXT,
  at           TEXT,
  node         TEXT,
  detail       TEXT,
  event_id     TEXT NOT NULL UNIQUE,
  payload_sha  TEXT NOT NULL,
  recorded_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_job_idx ON events (job);

CREATE TABLE IF NOT EXISTS effects (
  job     TEXT PRIMARY KEY,
  hash    TEXT NOT NULL,
  receipt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pilot_reference_revocations (
  reference_version TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS job_queue (
  seq       BIGSERIAL PRIMARY KEY,
  job       TEXT NOT NULL UNIQUE,
  kind      TEXT NOT NULL,
  crash     SMALLINT NOT NULL,
  queued_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_admissions (
  key TEXT PRIMARY KEY,
  job TEXT NOT NULL
);

-- Perfil de destino do piloto (criadas hoje de forma condicional em server.ts).
CREATE TABLE IF NOT EXISTS pilot_destination_revocations (
  scope        TEXT PRIMARY KEY,
  acknowledged SMALLINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pilot_destination_intents (
  job    TEXT PRIMARY KEY,
  intent TEXT NOT NULL
);

-- Recuperacao humana (hoje em recovery.ts).
CREATE TABLE IF NOT EXISTS recovery_sessions (
  hash     TEXT PRIMARY KEY,
  actor    TEXT,
  auth_sha TEXT,
  expires  BIGINT
);

CREATE TABLE IF NOT EXISTS recovery_commands (
  id           TEXT PRIMARY KEY,
  actor        TEXT,
  input_sha    TEXT,
  body         TEXT,
  action       TEXT,
  case_id      TEXT,
  operation_id TEXT,
  evidence_sha TEXT,
  status       TEXT,
  result       TEXT,
  updated      TEXT
);

INSERT INTO schema_migrations (version) VALUES ('001_journey_ledger')
  ON CONFLICT (version) DO NOTHING;
