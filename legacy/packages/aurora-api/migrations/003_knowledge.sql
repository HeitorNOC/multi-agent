-- Cérebro: fontes de conhecimento e versões (E3). Espelha o esquema do adaptador SQLite.
CREATE TABLE IF NOT EXISTS knowledge_sources (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  owner           TEXT NOT NULL,
  -- JSON com a lista de leitores ("*" = todos da instalação).
  readers         TEXT NOT NULL,
  supersedes      TEXT,
  created         TEXT NOT NULL,
  revoked         TEXT,
  revoked_by      TEXT,
  latest_version  INTEGER NOT NULL DEFAULT 0,
  ordinal         BIGSERIAL
);

CREATE TABLE IF NOT EXISTS knowledge_versions (
  source       TEXT NOT NULL,
  version      INTEGER NOT NULL,
  media_type   TEXT NOT NULL,
  filename     TEXT NOT NULL,
  content_sha  TEXT NOT NULL,
  bytes        BYTEA NOT NULL,
  text         TEXT NOT NULL,
  valid_from   TEXT NOT NULL,
  uploaded_by  TEXT NOT NULL,
  created      TEXT NOT NULL,
  PRIMARY KEY (source, version)
);
