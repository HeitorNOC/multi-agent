-- Rotinas e suas execuções (módulo routines).
CREATE TABLE routines (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  goal         TEXT NOT NULL,
  -- Agenda em JSON: {"kind":"daily","time":"08:00","weekdays":[1,2,3,4,5]} ou {"kind":"interval","minutes":60}.
  schedule     TEXT NOT NULL,
  enabled      INTEGER NOT NULL,
  archived     INTEGER NOT NULL,
  next_run_at  TEXT,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  ordinal      INTEGER NOT NULL UNIQUE
);
CREATE INDEX routines_due ON routines (enabled, next_run_at);

CREATE TABLE routine_runs (
  routine_id       TEXT NOT NULL REFERENCES routines (id),
  slot             TEXT NOT NULL,
  origin           TEXT NOT NULL CHECK (origin IN ('schedule', 'manual')),
  status           TEXT NOT NULL CHECK (status IN ('admitted', 'retrying', 'gave_up')),
  job_id           TEXT UNIQUE,
  attempts         INTEGER NOT NULL,
  next_attempt_at  TEXT,
  last_error       TEXT,
  missed           INTEGER NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  -- Um horário de uma rotina dispara no máximo uma vez, mesmo depois de reiniciar.
  PRIMARY KEY (routine_id, slot)
);
CREATE INDEX routine_runs_retry ON routine_runs (status, next_attempt_at);
