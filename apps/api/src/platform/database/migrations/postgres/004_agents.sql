-- Empresa, time de agentes e organograma (módulo agents).
CREATE TABLE organization (
  id                  TEXT PRIMARY KEY CHECK (id = 'default'),
  name                TEXT NOT NULL,
  sector              TEXT NOT NULL,
  objectives          TEXT NOT NULL,
  policies            TEXT NOT NULL,
  setup_completed_at  TEXT,
  updated_at          TEXT NOT NULL
);

CREATE TABLE agents (
  id            TEXT PRIMARY KEY,
  template_id   TEXT,
  name          TEXT NOT NULL,
  title         TEXT NOT NULL,
  area          TEXT NOT NULL,
  tagline       TEXT NOT NULL,
  focus         TEXT NOT NULL,
  -- Lista JSON de habilidades.
  skills        TEXT NOT NULL,
  instructions  TEXT NOT NULL,
  reports_to    TEXT REFERENCES agents (id),
  status        TEXT NOT NULL CHECK (status IN ('active', 'removed')),
  hired_at      TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  ordinal       BIGINT NOT NULL UNIQUE
);
CREATE INDEX agents_status ON agents (status, ordinal);
