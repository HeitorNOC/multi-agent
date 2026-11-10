-- Cérebro: fontes de conhecimento e suas versões (módulo knowledge).
CREATE TABLE knowledge_sources (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  owner           TEXT NOT NULL,
  -- Lista JSON de leitores ("*" = todos da instalação).
  readers         TEXT NOT NULL,
  supersedes      TEXT REFERENCES knowledge_sources (id),
  created_at      TEXT NOT NULL,
  revoked_at      TEXT,
  revoked_by      TEXT,
  latest_version  INTEGER NOT NULL,
  ordinal         BIGINT NOT NULL UNIQUE
);

CREATE TABLE knowledge_versions (
  source_id    TEXT NOT NULL REFERENCES knowledge_sources (id),
  version      INTEGER NOT NULL,
  filename     TEXT NOT NULL,
  media_type   TEXT NOT NULL,
  content_sha  TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  bytes        BYTEA NOT NULL,
  text         TEXT NOT NULL,
  valid_from   TEXT NOT NULL,
  uploaded_by  TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (source_id, version)
);
